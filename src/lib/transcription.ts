import { supabase } from "./supabase";

export const MAX_TRANSCRIPTION_BYTES = 6 * 1024 * 1024;
export const TRANSCRIPTION_TIMEOUT_MS = 90_000;

export type TranscriptionErrorCode =
  | "empty-audio"
  | "unsupported-audio"
  | "audio-too-large"
  | "session"
  | "unauthorized"
  | "rate-limit"
  | "timeout"
  | "aborted"
  | "network"
  | "invalid-response"
  | "service";

export class TranscriptionError extends Error {
  readonly code: TranscriptionErrorCode;
  readonly status?: number;
  readonly retryable: boolean;

  constructor(
    code: TranscriptionErrorCode,
    message: string,
    options?: { status?: number; retryable?: boolean }
  ) {
    super(message);
    this.name = "TranscriptionError";
    this.code = code;
    this.status = options?.status;
    this.retryable = options?.retryable ?? false;
  }
}

export interface TranscriptionRequest {
  blob: Blob;
  mimeType: string;
  language?: string;
  prompt?: string;
  signal?: AbortSignal;
}

export interface TranscriptionResult {
  text: string;
  model?: string;
}

const activeRequests = new WeakMap<Blob, Promise<TranscriptionResult>>();

function audioExtension(mimeType: string): string {
  if (mimeType.includes("mp4")) return "m4a";
  if (mimeType.includes("ogg")) return "ogg";
  if (mimeType.includes("mpeg")) return "mp3";
  if (mimeType.includes("wav")) return "wav";
  return "webm";
}

function safeServiceMessage(status: number, message?: string): string {
  if (status === 400 && message?.trim()) return message.trim();
  if (status === 401 || status === 403) {
    return "La sessió no és vàlida. Torna a iniciar sessió abans de transcriure.";
  }
  if (status === 413) {
    return "L'àudio supera el límit de 6 MB i no es pot transcriure.";
  }
  if (status === 429) {
    return "Hi ha massa peticions de transcripció. Espera uns segons i torna-ho a provar.";
  }
  if (status >= 500) {
    return "El servei de transcripció no està disponible temporalment. L'àudio es conserva i es pot reintentar més tard.";
  }
  return message?.trim() || "No s'ha pogut transcriure l'àudio.";
}

function validateAudio(blob: Blob, mimeType: string): void {
  if (blob.size === 0) {
    throw new TranscriptionError(
      "empty-audio",
      "La gravació està buida. Torna a gravar la nota de veu."
    );
  }

  if (blob.size > MAX_TRANSCRIPTION_BYTES) {
    throw new TranscriptionError(
      "audio-too-large",
      "L'àudio supera el límit de 6 MB. Desa'l sense transcriure o grava una nota més curta."
    );
  }

  const effectiveMimeType = mimeType || blob.type;
  if (effectiveMimeType && !effectiveMimeType.startsWith("audio/")) {
    throw new TranscriptionError(
      "unsupported-audio",
      "El fitxer no té un format d'àudio compatible."
    );
  }
}

async function performTranscription({
  blob,
  mimeType,
  language,
  prompt,
  signal
}: TranscriptionRequest): Promise<TranscriptionResult> {
  const effectiveMimeType = mimeType || blob.type || "audio/webm";
  validateAudio(blob, effectiveMimeType);

  const {
    data: { session },
    error: sessionError
  } = await supabase.auth.getSession();

  if (sessionError) {
    throw new TranscriptionError(
      "session",
      "No s'ha pogut validar la sessió. Torna-ho a provar.",
      { retryable: true }
    );
  }

  if (!session) {
    throw new TranscriptionError(
      "session",
      "La sessió ha caducat. Torna a iniciar sessió abans de transcriure."
    );
  }

  const body = new FormData();
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

  const controller = new AbortController();
  let timedOut = false;

  const timeout = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, TRANSCRIPTION_TIMEOUT_MS);

  const abortFromCaller = () => controller.abort();
  signal?.addEventListener("abort", abortFromCaller, { once: true });

  try {
    let response: Response;

    try {
      response = await fetch("/api/transcribe", {
        method: "POST",
        headers: {
          authorization: `Bearer ${session.access_token}`
        },
        body,
        signal: controller.signal
      });
    } catch (caught) {
      if (controller.signal.aborted) {
        if (timedOut) {
          throw new TranscriptionError(
            "timeout",
            "La transcripció ha trigat massa. L'àudio es conserva i pots tornar-ho a provar.",
            { retryable: true }
          );
        }

        throw new TranscriptionError(
          "aborted",
          "La transcripció s'ha cancel·lat. L'àudio no s'ha perdut.",
          { retryable: true }
        );
      }

      throw new TranscriptionError(
        "network",
        "No s'ha pogut connectar amb el servei de transcripció. Comprova la connexió i torna-ho a provar.",
        { retryable: true }
      );
    }

    let payload: { text?: string; model?: string; error?: string };

    try {
      payload = (await response.json()) as typeof payload;
    } catch {
      throw new TranscriptionError(
        "invalid-response",
        "El servei de transcripció ha retornat una resposta no vàlida.",
        { status: response.status, retryable: response.status >= 500 }
      );
    }

    if (!response.ok) {
      const code: TranscriptionErrorCode =
        response.status === 401 || response.status === 403
          ? "unauthorized"
          : response.status === 429
            ? "rate-limit"
            : "service";

      throw new TranscriptionError(
        code,
        safeServiceMessage(response.status, payload.error),
        {
          status: response.status,
          retryable: response.status === 429 || response.status >= 500
        }
      );
    }

    if (!payload.text?.trim()) {
      throw new TranscriptionError(
        "invalid-response",
        "La transcripció ha acabat sense retornar cap text. L'àudio es conserva.",
        { status: response.status, retryable: true }
      );
    }

    return {
      text: payload.text.trim(),
      model: payload.model
    };
  } finally {
    window.clearTimeout(timeout);
    signal?.removeEventListener("abort", abortFromCaller);
  }
}

export function transcribeAudio(
  request: TranscriptionRequest
): Promise<TranscriptionResult> {
  const existing = activeRequests.get(request.blob);
  if (existing) return existing;

  const promise = performTranscription(request).finally(() => {
    activeRequests.delete(request.blob);
  });

  activeRequests.set(request.blob, promise);
  return promise;
}
