import { useEffect, useMemo, useRef, useState } from "react";
import { CircleStop, Mic2, RotateCcw, Sparkles, X } from "lucide-react";

type RecorderStage = "idle" | "recording" | "ready" | "transcribing" | "error";

interface VoiceRecorderProps {
  onClose: () => void;
  onComplete: (blob: Blob, transcript: string, mimeType: string, language: string) => Promise<void>;
  onFailure: (blob: Blob, error: string, mimeType: string, language: string) => Promise<void>;
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

export function VoiceRecorder({ onClose, onComplete, onFailure }: VoiceRecorderProps) {
  const [stage, setStage] = useState<RecorderStage>("idle");
  const [seconds, setSeconds] = useState(0);
  const [audioBlob, setAudioBlob] = useState<Blob>();
  const [error, setError] = useState("");
  const [language, setLanguage] = useState("");
  const [context, setContext] = useState("");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const mimeTypeRef = useRef("audio/webm");

  const audioUrl = useMemo(() => audioBlob ? URL.createObjectURL(audioBlob) : undefined, [audioBlob]);

  useEffect(() => {
    return () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      if (timerRef.current) window.clearInterval(timerRef.current);
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, [audioUrl]);

  async function startRecording() {
    setError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      });
      const mimeType = supportedMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];
      streamRef.current = stream;
      recorderRef.current = recorder;
      mimeTypeRef.current = recorder.mimeType || mimeType || "audio/webm";
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mimeTypeRef.current });
        setAudioBlob(blob);
        setStage("ready");
        stream.getTracks().forEach((track) => track.stop());
      };
      recorder.start(500);
      setSeconds(0);
      setStage("recording");
      timerRef.current = window.setInterval(() => setSeconds((value) => value + 1), 1000);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "No s'ha pogut accedir al micròfon.";
      setError(message);
      setStage("error");
    }
  }

  function stopRecording() {
    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = null;
    recorderRef.current?.stop();
  }

  function resetRecording() {
    setAudioBlob(undefined);
    setSeconds(0);
    setError("");
    setStage("idle");
  }

  async function transcribe() {
    if (!audioBlob) return;
    setStage("transcribing");
    setError("");
    const extension = mimeTypeRef.current.includes("mp4") ? "m4a" : mimeTypeRef.current.includes("ogg") ? "ogg" : "webm";
    const body = new FormData();
    body.append("audio", audioBlob, `nota-veu.${extension}`);
    if (language) body.append("language", language);
    if (context.trim()) body.append("prompt", context.trim());

    try {
      const response = await fetch("/api/transcribe", { method: "POST", body });
      const payload = await response.json() as { text?: string; error?: string };
      if (!response.ok || !payload.text) {
        throw new Error(payload.error || "No s'ha pogut transcriure l'àudio.");
      }
      await onComplete(audioBlob, payload.text, mimeTypeRef.current, language);
      onClose();
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Error desconegut de transcripció.";
      setError(message);
      setStage("error");
    }
  }

  async function keepWithoutTranscript() {
    if (!audioBlob) return;
    await onFailure(audioBlob, error || "Transcripció pendent", mimeTypeRef.current, language);
    onClose();
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="voice-modal" role="dialog" aria-modal="true" aria-labelledby="voice-title">
        <button className="modal-close" onClick={onClose} aria-label="Tancar"><X size={20} /></button>
        <p className="eyebrow">Captura immediata</p>
        <h2 id="voice-title">Nota de veu</h2>
        <p className="modal-intro">
          Parla amb naturalitat. En acabar, Idearium conservarà l'àudio i crearà una nota a pendent de revisió.
        </p>

        <div className={`recorder-orb ${stage === "recording" ? "recording" : ""}`}>
          <Mic2 size={34} />
          <strong>{formatDuration(seconds)}</strong>
          <span>{stage === "recording" ? "Escoltant" : stage === "transcribing" ? "Transcrivint" : "Preparat"}</span>
        </div>

        {audioUrl && stage !== "recording" && (
          <audio className="recording-player" controls src={audioUrl} preload="metadata" />
        )}

        <div className="voice-options">
          <label>
            <span>Idioma principal</span>
            <select value={language} onChange={(event) => setLanguage(event.target.value)}>
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
            />
          </label>
        </div>

        {error && <div className="error-banner">{error}</div>}

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
            <button className="danger-button large" onClick={stopRecording}>
              <CircleStop size={19} /> Aturar gravació
            </button>
          )}
          {(stage === "ready" || stage === "error") && audioBlob && (
            <>
              <button className="secondary-button" onClick={resetRecording}>
                <RotateCcw size={18} /> Repetir
              </button>
              <button className="primary-button" onClick={transcribe}>
                <Sparkles size={18} /> Transcriure i crear nota
              </button>
            </>
          )}
          {stage === "transcribing" && (
            <button className="primary-button" disabled>
              <span className="spinner" /> Processant l'àudio...
            </button>
          )}
        </div>

        {stage === "error" && audioBlob && (
          <button className="text-button" onClick={keepWithoutTranscript}>
            Desar igualment i tornar-ho a transcriure més tard
          </button>
        )}
      </section>
    </div>
  );
}
