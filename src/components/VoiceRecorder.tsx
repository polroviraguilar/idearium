import { useEffect, useMemo, useRef, useState } from "react";
import { CircleStop, Mic2, RotateCcw, Sparkles, X } from "lucide-react";
import {
  MAX_TRANSCRIPTION_BYTES,
  TranscriptionError,
  transcribeAudio
} from "../lib/transcription";

const MAX_RECORDING_SECONDS = 180;

type RecorderStage =
  | "idle"
  | "recording"
  | "ready"
  | "transcribing"
  | "saving"
  | "error";

interface VoiceRecorderProps {
  onClose: () => void;
  onComplete: (
    blob: Blob,
    transcript: string,
    mimeType: string,
    language: string
  ) => Promise<void>;
  onFailure: (
    blob: Blob,
    error: string,
    mimeType: string,
    language: string
  ) => Promise<void>;
}

function supportedMimeType(): string {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/mp4",
    "audio/webm",
    "audio/ogg;codecs=opus"
  ];

  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
}

function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60).toString().padStart(2, "0");
  const rest = Math.floor(seconds % 60).toString().padStart(2, "0");
  return `${minutes}:${rest}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function VoiceRecorder({
  onClose,
  onComplete,
  onFailure
}: VoiceRecorderProps) {
  const [stage, setStage] = useState<RecorderStage>("idle");
  const [seconds, setSeconds] = useState(0);
  const [audioBlob, setAudioBlob] = useState<Blob>();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [language, setLanguage] = useState("");
  const [context, setContext] = useState("");

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const mimeTypeRef = useRef("audio/webm");
  const recordedBytesRef = useRef(0);
  const stopReasonRef = useRef<"manual" | "duration" | "size">("manual");
  const actionInProgressRef = useRef(false);
  const transcriptionAbortRef = useRef<AbortController | null>(null);

  const audioUrl = useMemo(
    () => (audioBlob ? URL.createObjectURL(audioBlob) : undefined),
    [audioBlob]
  );

  const audioTooLarge = Boolean(
    audioBlob && audioBlob.size > MAX_TRANSCRIPTION_BYTES
  );

  function clearTimer(): void {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }

  function stopStream(): void {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }

  function stopRecorder(reason: "manual" | "duration" | "size" = "manual") {
    if (recorderRef.current?.state !== "recording") return;

    stopReasonRef.current = reason;
    clearTimer();
    recorderRef.current.stop();
  }

  useEffect(() => {
    return () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      clearTimer();
      transcriptionAbortRef.current?.abort();
      stopStream();
    };
  }, [audioUrl]);

  async function startRecording() {
    if (actionInProgressRef.current) return;

    setError("");
    setNotice("");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });

      const mimeType = supportedMimeType();
      const recorder = new MediaRecorder(
        stream,
        mimeType ? { mimeType } : undefined
      );

      chunksRef.current = [];
      recordedBytesRef.current = 0;
      stopReasonRef.current = "manual";
      streamRef.current = stream;
      recorderRef.current = recorder;
      mimeTypeRef.current = recorder.mimeType || mimeType || "audio/webm";

      recorder.ondataavailable = (event) => {
        if (event.data.size === 0) return;

        chunksRef.current.push(event.data);
        recordedBytesRef.current += event.data.size;

        if (
          recordedBytesRef.current >= MAX_TRANSCRIPTION_BYTES &&
          recorder.state === "recording"
        ) {
          stopRecorder("size");
        }
      };

      recorder.onerror = () => {
        clearTimer();
        stopStream();
        setError("S'ha produït un error mentre es gravava l'àudio.");
        setStage("error");
      };

      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, {
          type: mimeTypeRef.current
        });

        setAudioBlob(blob);
        stopStream();

        if (blob.size === 0) {
          setError("La gravació està buida. Torna-ho a provar.");
          setStage("error");
          return;
        }

        if (
          stopReasonRef.current === "size" ||
          blob.size > MAX_TRANSCRIPTION_BYTES
        ) {
          setError(
            "La gravació ha arribat al límit de 6 MB. Pots desar-la sense transcriure o repetir-la més curta."
          );
          setStage("error");
          return;
        }

        if (stopReasonRef.current === "duration") {
          setNotice(
            "La gravació s'ha aturat automàticament en arribar al límit de 3 minuts."
          );
        }

        setStage("ready");
      };

      recorder.start(500);
      setAudioBlob(undefined);
      setSeconds(0);
      setStage("recording");

      timerRef.current = window.setInterval(() => {
        setSeconds((current) => {
          const next = current + 1;

          if (next >= MAX_RECORDING_SECONDS) {
            stopRecorder("duration");
            return MAX_RECORDING_SECONDS;
          }

          return next;
        });
      }, 1000);
    } catch (caught) {
      stopStream();

      const message =
        caught instanceof DOMException && caught.name === "NotAllowedError"
          ? "No s'ha concedit permís per utilitzar el micròfon. Revisa els permisos del navegador."
          : caught instanceof Error
            ? caught.message
            : "No s'ha pogut accedir al micròfon.";

      setError(message);
      setStage("error");
    }
  }

  function resetRecording() {
    if (stage === "transcribing" || stage === "saving") return;

    transcriptionAbortRef.current?.abort();
    setAudioBlob(undefined);
    setSeconds(0);
    setError("");
    setNotice("");
    chunksRef.current = [];
    recordedBytesRef.current = 0;
    setStage("idle");
  }

  async function transcribe() {
    if (
      !audioBlob ||
      audioTooLarge ||
      actionInProgressRef.current ||
      stage === "transcribing"
    ) {
      return;
    }

    actionInProgressRef.current = true;
    const controller = new AbortController();
    transcriptionAbortRef.current = controller;
    setStage("transcribing");
    setError("");

    try {
      const transcription = await transcribeAudio({
        blob: audioBlob,
        mimeType: mimeTypeRef.current,
        language,
        prompt: context,
        signal: controller.signal
      });

      setStage("saving");
      await onComplete(
        audioBlob,
        transcription.text,
        mimeTypeRef.current,
        language
      );
      onClose();
    } catch (caught) {
      const message =
        caught instanceof TranscriptionError
          ? caught.message
          : caught instanceof Error
            ? caught.message
            : "Error desconegut de transcripció.";

      setError(message);
      setStage("error");
    } finally {
      actionInProgressRef.current = false;
      transcriptionAbortRef.current = null;
    }
  }

  async function keepWithoutTranscript() {
    if (!audioBlob || actionInProgressRef.current) return;

    actionInProgressRef.current = true;
    setStage("saving");

    try {
      await onFailure(
        audioBlob,
        error || "Transcripció pendent",
        mimeTypeRef.current,
        language
      );
      onClose();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "No s'ha pogut desar la gravació."
      );
      setStage("error");
    } finally {
      actionInProgressRef.current = false;
    }
  }

  function requestClose() {
    if (stage === "transcribing" || stage === "saving") return;

    if (stage === "recording" || audioBlob) {
      const discard = window.confirm(
        "La gravació encara no s'ha desat. Vols tancar i descartar-la?"
      );

      if (!discard) return;
    }

    clearTimer();

    const recorder = recorderRef.current;
    if (recorder?.state === "recording") {
      recorder.onstop = null;
      recorder.stop();
    }

    stopStream();
    onClose();
  }

  const nearDurationLimit =
    stage === "recording" && seconds >= MAX_RECORDING_SECONDS - 30;

  return (
    <div className="modal-backdrop" role="presentation">
      <section
        className="voice-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="voice-title"
      >
        <button
          className="modal-close"
          onClick={requestClose}
          aria-label="Tancar"
          disabled={stage === "transcribing" || stage === "saving"}
          title={
            stage === "transcribing" || stage === "saving"
              ? "Espera que acabi el procés"
              : "Tancar"
          }
        >
          <X size={20} />
        </button>

        <p className="eyebrow">Captura immediata</p>
        <h2 id="voice-title">Nota de veu</h2>
        <p className="modal-intro">
          Parla amb naturalitat. La gravació té un màxim de 3 minuts i
          Idearium conservarà sempre l'àudio, encara que la transcripció falli.
        </p>

        <div
          className={`recorder-orb ${stage === "recording" ? "recording" : ""} ${nearDurationLimit ? "near-limit" : ""}`}
        >
          <Mic2 size={34} />
          <strong>{formatDuration(seconds)}</strong>
          <span>
            {stage === "recording"
              ? "Escoltant"
              : stage === "transcribing"
                ? "Transcrivint"
                : stage === "saving"
                  ? "Desant"
                  : "Preparat"}
          </span>
        </div>

        <div className="recorder-meta" aria-live="polite">
          <span>
            Límit de temps: {formatDuration(MAX_RECORDING_SECONDS)}
          </span>
          <span>
            {audioBlob
              ? `${formatBytes(audioBlob.size)} de 6 MB`
              : "Límit de mida: 6 MB"}
          </span>
        </div>

        {audioUrl && stage !== "recording" && (
          <audio
            className="recording-player"
            controls
            src={audioUrl}
            preload="metadata"
          />
        )}

        <div className="voice-options">
          <label>
            <span>Idioma principal</span>
            <select
              value={language}
              onChange={(event) => setLanguage(event.target.value)}
              disabled={stage === "transcribing" || stage === "saving"}
            >
              <option value="">Detecció automàtica</option>
              <option value="ca">Català</option>
              <option value="es">Castellà</option>
              <option value="en">Anglès</option>
            </select>
          </label>

          <label>
            <span>Paraules o context especial</span>
            <input
              value={context}
              onChange={(event) => setContext(event.target.value)}
              placeholder="Noms propis, projectes, sigles..."
              maxLength={1000}
              disabled={stage === "transcribing" || stage === "saving"}
            />
          </label>
        </div>

        {notice && <div className="notice-banner">{notice}</div>}
        {error && <div className="error-banner" role="alert">{error}</div>}

        <div className="modal-actions">
          {stage === "idle" && (
            <button className="primary-button large" onClick={startRecording}>
              <Mic2 size={19} /> Començar a gravar
            </button>
          )}

          {stage === "error" && !audioBlob && (
            <button className="primary-button large" onClick={startRecording}>
              <RotateCcw size={19} /> Tornar a provar
            </button>
          )}

          {stage === "recording" && (
            <button
              className="danger-button large"
              onClick={() => stopRecorder("manual")}
            >
              <CircleStop size={19} /> Aturar gravació
            </button>
          )}

          {(stage === "ready" || stage === "error") && audioBlob && (
            <>
              <button className="secondary-button" onClick={resetRecording}>
                <RotateCcw size={18} /> Repetir
              </button>
              <button
                className="primary-button"
                onClick={transcribe}
                disabled={audioTooLarge}
              >
                <Sparkles size={18} /> Transcriure i crear nota
              </button>
            </>
          )}

          {stage === "transcribing" && (
            <button className="primary-button" disabled>
              <span className="spinner" /> Processant l'àudio...
            </button>
          )}

          {stage === "saving" && (
            <button className="primary-button" disabled>
              <span className="spinner" /> Desant la nota...
            </button>
          )}
        </div>

        {(stage === "error" || audioTooLarge) && audioBlob && (
          <button className="text-button" onClick={keepWithoutTranscript}>
            Desar l'àudio sense transcripció
          </button>
        )}
      </section>
    </div>
  );
}
