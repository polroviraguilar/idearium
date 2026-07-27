import { supabase } from "./supabase";

export interface TranscriptionRequest {
  blob: Blob;
  mimeType: string;
  language?: string;
  prompt?: string;
}

export interface TranscriptionResult {
  text: string;
  model?: string;
}

function audioExtension(mimeType: string): string {
  if (mimeType.includes("mp4")) return "m4a";
  if (mimeType.includes("ogg")) return "ogg";
  if (mimeType.includes("mpeg")) return "mp3";
  if (mimeType.includes("wav")) return "wav";
  return "webm";
}

export async function transcribeAudio({
  blob,
  mimeType,
  language,
  prompt
}: TranscriptionRequest): Promise<TranscriptionResult> {
  const {
    data: { session },
    error: sessionError
  } = await supabase.auth.getSession();

  if (sessionError) {
    throw new Error(sessionError.message);
  }

  if (!session) {
    throw new Error(
      "La sessió ha caducat. Torna a iniciar sessió abans de transcriure."
    );
  }

  const body = new FormData();
  const effectiveMimeType = mimeType || blob.type || "audio/webm";

  body.append(
    "audio",
    blob,
    `nota-veu.${audioExtension(effectiveMimeType)}`
  );

  if (language?.trim()) {
    body.append("language", language.trim());
  }

  if (prompt?.trim()) {
    body.append("prompt", prompt.trim().slice(0, 1000));
  }

  const response = await fetch("/api/transcribe", {
    method: "POST",
    headers: {
      authorization: `Bearer ${session.access_token}`
    },
    body
  });

  let payload: { text?: string; model?: string; error?: string };

  try {
    payload = (await response.json()) as typeof payload;
  } catch {
    throw new Error(
      "El servei de transcripció ha retornat una resposta no vàlida."
    );
  }

  if (!response.ok || !payload.text?.trim()) {
    throw new Error(
      payload.error || "No s'ha pogut transcriure l'àudio."
    );
  }

  return {
    text: payload.text.trim(),
    model: payload.model
  };
}
