import { useEffect, useMemo, useState } from "react";
import {
  Archive,
  FileUp,
  Link2,
  Mic2,
  MoreHorizontal,
  Pin,
  PinOff,
  RotateCw,
  Save,
  Trash2
} from "lucide-react";
import type { Attachment, Category, Note } from "../lib/types";
import { safeUrl } from "../lib/media";
import { AttachmentCard } from "./AttachmentCard";

interface NoteEditorProps {
  note?: Note;
  categories: Category[];
  attachments: Attachment[];
  onUpdate: (id: string, changes: Partial<Note>) => Promise<void>;
  onAddFiles: (noteId: string, files: File[]) => Promise<void>;
  onAddLink: (noteId: string, url: string, name: string) => Promise<void>;
  onDeleteAttachment: (id: string) => Promise<void>;
  onDeleteNote: (id: string) => Promise<void>;
  onRetryTranscription: (note: Note) => Promise<void>;
}

export function NoteEditor(props: NoteEditorProps) {
  const { note } = props;
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [tags, setTags] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [linkName, setLinkName] = useState("");
  const [showLinkForm, setShowLinkForm] = useState(false);
  const [saveState, setSaveState] = useState<"saved" | "saving">("saved");
  const [retryingTranscription, setRetryingTranscription] = useState(false);
  const category = useMemo(() => props.categories.find((item) => item.id === note?.categoryId), [props.categories, note?.categoryId]);

  useEffect(() => {
    setTitle(note?.title ?? "");
    setBody(note?.body ?? "");
    setTags(note?.tags.join(", ") ?? "");
    setSaveState("saved");
    setRetryingTranscription(false);
  }, [note?.id]);

  useEffect(() => {
    if (!note) return;
    const parsedTags = tags.split(",").map((tag) => tag.trim()).filter(Boolean);
    const unchanged = title === note.title && body === note.body && parsedTags.join("|") === note.tags.join("|");
    if (unchanged) return;
    setSaveState("saving");
    const timer = window.setTimeout(async () => {
      await props.onUpdate(note.id, { title, body, tags: parsedTags, updatedAt: Date.now() });
      setSaveState("saved");
    }, 450);
    return () => window.clearTimeout(timer);
  }, [title, body, tags, note?.id, note?.title, note?.body, note?.tags.join("|")]);

  if (!note) {
    return (
      <main className="editor-panel empty-editor">
        <div className="empty-editor-mark">I</div>
        <h2>Selecciona o crea una nota</h2>
        <p>Les idees no han d'arribar ordenades. Captura-les primer; ja les treballaràs després.</p>
      </main>
    );
  }

  const activeNote = note;

  async function addLink() {
    const url = safeUrl(linkUrl);
    if (!url) return;
    await props.onAddLink(activeNote.id, url, linkName.trim() || new URL(url).hostname);
    setLinkUrl("");
    setLinkName("");
    setShowLinkForm(false);
  }

  async function archiveNote() {
    const archived = activeNote.status === "archived";
    await props.onUpdate(activeNote.id, {
      status: archived ? "active" : "archived",
      categoryId: archived ? "inbox" : "archive",
      updatedAt: Date.now()
    });
  }

  async function retryTranscription() {
    if (retryingTranscription || activeNote.transcriptionStatus === "processing") {
      return;
    }

    setRetryingTranscription(true);

    try {
      await props.onRetryTranscription(activeNote);
    } finally {
      setRetryingTranscription(false);
    }
  }

  return (
    <main className="editor-panel">
      <header className="editor-toolbar">
        <div className="editor-breadcrumb">
          <span className="category-dot" style={{ background: category?.accent ?? "#777" }} />
          <select
            value={activeNote.categoryId}
            onChange={(event) => props.onUpdate(activeNote.id, {
              categoryId: event.target.value,
              status: event.target.value === "pending-review" ? "pending-review" : event.target.value === "archive" ? "archived" : "active",
              updatedAt: Date.now()
            })}
          >
            {props.categories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </div>
        <div className="editor-tools">
          <span className={`save-indicator ${saveState}`}><Save size={14} /> {saveState === "saving" ? "Desant" : "Desat"}</span>
          <button
            className="toolbar-button"
            onClick={() => props.onUpdate(activeNote.id, { pinned: !activeNote.pinned, updatedAt: Date.now() })}
            title={activeNote.pinned ? "Desfixar" : "Fixar"}
          >
            {activeNote.pinned ? <PinOff size={18} /> : <Pin size={18} />}
          </button>
          <button className="toolbar-button" onClick={archiveNote} title={activeNote.status === "archived" ? "Restaurar" : "Arxivar"}>
            <Archive size={18} />
          </button>
          <button className="toolbar-button danger" onClick={() => props.onDeleteNote(activeNote.id)} title="Eliminar nota">
            <Trash2 size={18} />
          </button>
          <button className="toolbar-button ghost" title="Més opcions"><MoreHorizontal size={18} /></button>
        </div>
      </header>

      <div className="editor-scroll">
        <article className="editor-document">
          {activeNote.source === "voice" && (
            <div className="source-badge"><Mic2 size={14} /> Nota creada des d'una gravació</div>
          )}

          {activeNote.transcriptionStatus === "processing" && (
            <div className="transcription-processing" aria-live="polite">
              <div>
                <strong>Transcrivint la nota de veu...</strong>
                <span>No tanquis l'aplicació fins que acabi el procés.</span>
              </div>
              <span className="spinner transcription-spinner" />
            </div>
          )}

          {activeNote.transcriptionStatus === "failed" && (
            <div className="transcription-warning">
              <div>
                <strong>La nota de veu encara no s'ha transcrit.</strong>
                <span>L'àudio s'ha conservat i pots tornar-ho a provar.</span>
              </div>
              <button
                className="secondary-button"
                onClick={retryTranscription}
                disabled={retryingTranscription}
              >
                {retryingTranscription ? (
                  <>
                    <span className="spinner transcription-spinner" />
                    Reintentant...
                  </>
                ) : (
                  <>
                    <RotateCw size={17} /> Reintentar
                  </>
                )}
              </button>
            </div>
          )}

          <input
            className="title-input"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Títol de la idea"
          />
          <textarea
            className="body-input"
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder="Escriu sense preocupar-te encara per l'ordre..."
          />

          <label className="tags-field">
            <span>Etiquetes</span>
            <input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="disseny, projecte, investigar" />
          </label>

          <section className="attachments-section">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Materials</p>
                <h3>Adjunts i referències</h3>
              </div>
              <div className="attachment-buttons">
                <label className="secondary-button compact">
                  <FileUp size={17} /> Afegir fitxers
                  <input
                    type="file"
                    multiple
                    hidden
                    onChange={(event) => {
                      const files = Array.from(event.target.files ?? []) as File[];
                      if (files.length) props.onAddFiles(activeNote.id, files);
                      event.target.value = "";
                    }}
                  />
                </label>
                <button className="secondary-button compact" onClick={() => setShowLinkForm((value) => !value)}>
                  <Link2 size={17} /> Afegir enllaç
                </button>
              </div>
            </div>

            {showLinkForm && (
              <div className="link-form">
                <input value={linkUrl} onChange={(event) => setLinkUrl(event.target.value)} placeholder="https://..." />
                <input value={linkName} onChange={(event) => setLinkName(event.target.value)} placeholder="Nom opcional" />
                <button className="primary-button compact" onClick={addLink} disabled={!safeUrl(linkUrl)}>Afegir</button>
              </div>
            )}

            {props.attachments.length === 0 ? (
              <div className="attachments-empty">
                Arrossega mentalment qualsevol material aquí: imatges, àudio, vídeo, documents o enllaços.
              </div>
            ) : (
              <div className="attachments-grid">
                {props.attachments.map((attachment) => (
                  <AttachmentCard key={attachment.id} attachment={attachment} onDelete={props.onDeleteAttachment} />
                ))}
              </div>
            )}
          </section>
        </article>
      </div>
    </main>
  );
}
