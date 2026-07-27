interface AiBinding {
  run(model: string, input: Record<string, unknown>): Promise<unknown>;
}

interface Env {
  AI: AiBinding;
  SUPABASE_URL: string;
  SUPABASE_PUBLISHABLE_KEY: string;
}

interface FunctionContext {
  request: Request;
  env: Env;
}

interface WhisperResponse {
  text?: string;
  transcription_info?: {
    text?: string;
  };
}

const MODEL = "@cf/openai/whisper-large-v3-turbo";
const MAX_AUDIO_BYTES = 6 * 1024 * 1024;
const ALLOWED_LANGUAGES = new Set(["ca", "es", "en"]);

function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8"
    }
  });
}

function bearerToken(request: Request): string | null {
  const authorization = request.headers.get("authorization")?.trim();
  if (!authorization?.toLowerCase().startsWith("bearer ")) return null;

  const token = authorization.slice(7).trim();
  return token || null;
}

async function validateSupabaseSession(
  request: Request,
  env: Env
): Promise<boolean> {
  const token = bearerToken(request);
  if (!token) return false;

  if (!env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY) {
    throw new Error(
      "Falten SUPABASE_URL o SUPABASE_PUBLISHABLE_KEY a Cloudflare Pages."
    );
  }

  const response = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    method: "GET",
    headers: {
      apikey: env.SUPABASE_PUBLISHABLE_KEY,
      authorization: `Bearer ${token}`
    }
  });

  return response.ok;
}

function extractText(result: unknown): string {
  if (!result || typeof result !== "object") return "";

  const response = result as WhisperResponse;
  return (
    response.text?.trim() ??
    response.transcription_info?.text?.trim() ??
    ""
  );
}


function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 32_768;
  let binary = "";

  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}

function isAcceptedAudio(file: File): boolean {
  return (
    file.type.startsWith("audio/") ||
    file.type === "application/octet-stream" ||
    file.type === ""
  );
}

export async function onRequestPost(
  context: FunctionContext
): Promise<Response> {
  try {
    const authenticated = await validateSupabaseSession(
      context.request,
      context.env
    );

    if (!authenticated) {
      return jsonResponse(
        { error: "La sessió ha caducat o no és vàlida." },
        401
      );
    }

    if (!context.env.AI) {
      return jsonResponse(
        { error: "Falta el binding AI al projecte de Cloudflare Pages." },
        503
      );
    }

    const formData = await context.request.formData();
    const audio = formData.get("audio");

    if (!(audio instanceof File)) {
      return jsonResponse(
        { error: "No s'ha rebut cap fitxer d'àudio." },
        400
      );
    }

    if (!isAcceptedAudio(audio)) {
      return jsonResponse(
        { error: "El fitxer enviat no sembla un àudio compatible." },
        415
      );
    }

    if (audio.size === 0) {
      return jsonResponse({ error: "El fitxer d'àudio és buit." }, 400);
    }

    if (audio.size > MAX_AUDIO_BYTES) {
      return jsonResponse(
        {
          error:
            "L'àudio supera el límit temporal de 6 MB. Redueix la durada de la gravació."
        },
        413
      );
    }

    const rawLanguage = String(formData.get("language") ?? "")
      .trim()
      .toLowerCase();
    const language = ALLOWED_LANGUAGES.has(rawLanguage)
      ? rawLanguage
      : undefined;
    const prompt = String(formData.get("prompt") ?? "")
      .trim()
      .slice(0, 1000);

    const audioBase64 = arrayBufferToBase64(await audio.arrayBuffer());

    const result = await context.env.AI.run(MODEL, {
      audio: audioBase64,
      task: "transcribe",
      vad_filter: true,
      condition_on_previous_text: true,
      ...(language ? { language } : {}),
      ...(prompt ? { initial_prompt: prompt } : {})
    });

    const text = extractText(result);

    if (!text) {
      return jsonResponse(
        {
          error:
            "Cloudflare Workers AI no ha retornat cap text per aquesta gravació."
        },
        502
      );
    }

    return jsonResponse({ text, model: MODEL });
  } catch (caught) {
    const message =
      caught instanceof Error
        ? caught.message
        : "Error desconegut durant la transcripció.";

    console.error("Error de transcripció a Workers AI:", caught);
    return jsonResponse({ error: message }, 500);
  }
}
