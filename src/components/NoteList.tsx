import { Mic2, Paperclip, Pin } from "lucide-react";
import type { Category, Note } from "../lib/types";
import { formatRelativeDate } from "../lib/media";

interface NoteListProps {
  notes: Note[];
  categories: Category[];
  selectedNoteId?: string;
  attachmentCounts: Record<string, number>;
  onSelect: (id: string) => void;
  onNewNote: () => void;
}

export function NoteList({ notes, categories, selectedNoteId, attachmentCounts, onSelect, onNewNote }: NoteListProps) {
  const categoryMap = new Map(categories.map((category) => [category.id, category]));

  return (
    <section className="note-list-panel">
      <header className="note-list-header">
        <div>
          <p className="eyebrow">Biblioteca</p>
          <h1>{notes.length} {notes.length === 1 ? "nota" : "notes"}</h1>
        </div>
        <button className="small-add-button" onClick={onNewNote} aria-label="Crear una nota">+</button>
      </header>

      <div className="note-list-scroll">
        {notes.length === 0 ? (
          <button className="empty-list" onClick={onNewNote}>
            <span className="empty-glyph">+</span>
            <strong>No hi ha cap nota aquí</strong>
            <span>Crea la primera entrada d'aquesta vista.</span>
          </button>
        ) : (
          notes.map((note) => {
            const category = categoryMap.get(note.categoryId);
            const preview = note.body.trim() || "Nota sense contingut";
            return (
              <button
                key={note.id}
                className={`note-card ${selectedNoteId === note.id ? "selected" : ""}`}
                onClick={() => onSelect(note.id)}
              >
                <div className="note-card-topline">
                  <span className="note-category">
                    <span className="category-dot" style={{ background: category?.accent ?? "#777" }} />
                    {category?.name ?? "Sense categoria"}
                  </span>
                  <span className="note-date">{formatRelativeDate(note.updatedAt)}</span>
                </div>
                <div className="note-title-row">
                  <strong>{note.title.trim() || "Nota sense títol"}</strong>
                  {note.pinned && <Pin size={14} fill="currentColor" />}
                </div>
                <p>{preview}</p>
                <div className="note-card-meta">
                  {note.source === "voice" && (
                    <span><Mic2 size={13} /> Veu</span>
                  )}
                  {(attachmentCounts[note.id] ?? 0) > 0 && (
                    <span><Paperclip size={13} /> {attachmentCounts[note.id]}</span>
                  )}
                  {note.transcriptionStatus === "failed" && (
                    <span className="warning-label">Transcripció pendent</span>
                  )}
                </div>
              </button>
            );
          })
        )}
      </div>
    </section>
  );
}
