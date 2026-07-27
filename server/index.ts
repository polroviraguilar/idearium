import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express, { type NextFunction, type Request, type Response } from "express";
import multer, { type FileFilterCallback } from "multer";
import OpenAI, { toFile } from "openai";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const uploadDirectory = path.join(projectRoot, "uploads");
fs.mkdirSync(uploadDirectory, { recursive: true });

const app = express();
const port = Number(process.env.PORT || 8787);
const upload = multer({
  dest: uploadDirectory,
  limits: { fileSize: 24 * 1024 * 1024 },
  fileFilter: (
  _request: Request,
  file: Express.Multer.File,
  callback: FileFilterCallback
) => {
  const valid =
    file.mimetype.startsWith("audio/") ||
    file.mimetype === "application/octet-stream";

  if (!valid) {
    callback(new Error("El fitxer enviat no sembla un àudio."));
    return;
  }

  callback(null, true);
}
});

app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_request: Request, response: Response) => {
  response.json({ ok: true, transcriptionConfigured: Boolean(process.env.OPENAI_API_KEY) });
});

app.post("/api/transcribe", upload.single("audio"), async (request: Request, response: Response) => {
  const uploadedFile = request.file;
  if (!uploadedFile) {
    response.status(400).json({ error: "No s'ha rebut cap fitxer d'àudio." });
    return;
  }

  try {
    if (!process.env.OPENAI_API_KEY) {
      response.status(503).json({
        error: "Falta OPENAI_API_KEY al fitxer .env del servidor. L'àudio es pot conservar i transcriure més tard."
      });
      return;
    }

    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      timeout: 60_000,
      maxRetries: 0
    });
    const language = typeof request.body.language === "string" ? request.body.language.trim() : "";
    const prompt = typeof request.body.prompt === "string" ? request.body.prompt.trim().slice(0, 1000) : "";
    const model = process.env.OPENAI_TRANSCRIPTION_MODEL || "gpt-4o-transcribe";

        /*
    * Multer desa el fitxer temporal amb un nom sense extensió.
    * Amb toFile recuperem el nom original, l'extensió i el tipus MIME
    * abans d'enviar-lo al servei de transcripció.
    */
    const audioFile = await toFile(
      fs.createReadStream(uploadedFile.path),
      uploadedFile.originalname,
      {
        type: uploadedFile.mimetype
      }
    );

    console.log("Àudio enviat a transcripció:", {
      originalname: uploadedFile.originalname,
      mimetype: uploadedFile.mimetype,
      size: uploadedFile.size,
      temporaryPath: uploadedFile.path
    });

    console.log("Iniciant petició de transcripció a OpenAI...", {
      model,
      language: language || "automàtic",
      hasPrompt: Boolean(prompt)
    });

    const startedAt = Date.now();

    const transcription = await openai.audio.transcriptions.create({
      file: audioFile,
      model,
      response_format: "json",
      ...(language ? { language } : {}),
      ...(prompt ? { prompt } : {})
    });

    console.log("Transcripció completada correctament:", {
      model,
      durationMs: Date.now() - startedAt,
      textLength: transcription.text?.length ?? 0,
      preview: transcription.text?.slice(0, 100) ?? ""
    });

    response.json({
      text: transcription.text,
      model
    });
  } catch (caught) {
  const errorDetails =
    caught && typeof caught === "object"
      ? {
          name:
            "name" in caught
              ? String(caught.name)
              : "UnknownError",

          message:
            "message" in caught
              ? String(caught.message)
              : "Error desconegut del servei de transcripció.",

          status:
            "status" in caught
              ? caught.status
              : undefined,

          code:
            "code" in caught
              ? caught.code
              : undefined,

          type:
            "type" in caught
              ? caught.type
              : undefined,

          requestId:
            "request_id" in caught
              ? caught.request_id
              : undefined
        }
      : {
          name: "UnknownError",
          message: String(caught)
        };

  console.error("Error complet de transcripció:", errorDetails);

  response.status(502).json({
    error: errorDetails.message
  });
} finally {
    fs.promises.unlink(uploadedFile.path).catch(() => undefined);
  }
});

app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
  const message = error instanceof Error ? error.message : "Error intern del servidor.";
  response.status(400).json({ error: message });
});

if (process.env.NODE_ENV === "production") {
  const distDirectory = path.join(projectRoot, "dist");
  app.use(express.static(distDirectory));
  app.get("*", (_request: Request, response: Response) => response.sendFile(path.join(distDirectory, "index.html")));
}

app.listen(port, () => {
  console.log(`Idearium API running at http://localhost:${port}`);
});
