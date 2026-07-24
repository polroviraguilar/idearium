import { useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, exportBackup, importBackup, newId, seedDatabase } from "./lib/db";
import { attachmentKindFromFile } from "./lib/media";
import type { Attachment, Category, Note } from "./lib/types";
import { Sidebar } from "./components/Sidebar";
import { NoteList } from "./components/NoteList";
import { NoteEditor } from "./components/NoteEditor";
import { VoiceRecorder } from "./components/VoiceRecorder";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function voiceTitle(transcript?: string): string {
  if (transcript?.trim()) {
    const firstSentence = transcript.trim().split(/[.!?\n]/)[0].trim();
    if (firstSentence) return firstSentence.slice(0, 72);
  }
  return `Nota de veu - ${new Intl.DateTimeFormat("ca-ES", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(Date.now())}`;
}

export default function App() {
  const categories = useLiveQuery(() => db.categories.orderBy("order").toArray(), [], []) ?? [];
  const allNotes = useLiveQuery(() => db.notes.toArray(), [], []) ?? [];
  const allAttachments = useLiveQuery(() => db.attachments.toArray(), [], []) ?? [];
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [selectedNoteId, setSelectedNoteId] = useState<string | undefined>(undefined);
  const [search, setSearch] = useState("");
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    const saved = localStorage.getItem("idearium-theme");
    if (saved === "light" || saved === "dark") return saved;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    seedDatabase().catch(console.error);
    navigator.storage?.persist?.().catch(() => false);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("idearium-theme", theme);
  }, [theme]);

  useEffect(() => {
    const handler = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const filteredNotes = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("ca");
    return allNotes
      .filter((note) => {
        if (selectedCategory === "all" && note.status === "archived") return false;
        if (selectedCategory !== "all" && note.categoryId !== selectedCategory) return false;
        if (!query) return true;
        return [note.title, note.body, note.tags.join(" ")]
          .join(" ")
          .toLocaleLowerCase("ca")
          .includes(query);
      })
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt);
  }, [allNotes, search, selectedCategory]);

  useEffect(() => {
    if (selectedNoteId && filteredNotes.some((note) => note.id === selectedNoteId)) return;
    setSelectedNoteId(filteredNotes[0]?.id);
  }, [filteredNotes, selectedNoteId]);

  const selectedNote = allNotes.find((note) => note.id === selectedNoteId);
  const selectedAttachments = allAttachments
    .filter((attachment) => attachment.noteId === selectedNoteId)
    .sort((a, b) => a.createdAt - b.createdAt);
  const attachmentCounts = useMemo(() => allAttachments.reduce<Record<string, number>>((accumulator, item) => {
    accumulator[item.noteId] = (accumulator[item.noteId] ?? 0) + 1;
    return accumulator;
  }, {}), [allAttachments]);

  async function createNote(categoryId?: string) {
    const targetCategory = categoryId ?? (selectedCategory !== "all" && selectedCategory !== "archive" ? selectedCategory : "inbox");
    const now = Date.now();
    const note: Note = {
      id: newId(),
      title: "",
      body: "",
      categoryId: targetCategory,
      tags: [],
      pinned: false,
      status: targetCategory === "pending-review" ? "pending-review" : "active",
      source: "text",
      transcriptionStatus: "none",
      createdAt: now,
      updatedAt: now
    };
    await db.notes.add(note);
    setSelectedCategory(targetCategory === "archive" ? "all" : targetCategory);
    setSelectedNoteId(note.id);
  }

  async function updateNote(id: string, changes: Partial<Note>) {
    await db.notes.update(id, changes);
  }

  async function deleteNote(id: string) {
    if (!window.confirm("Vols eliminar definitivament aquesta nota i tots els seus adjunts?")) return;
    await db.transaction("rw", db.notes, db.attachments, async () => {
      await db.attachments.where("noteId").equals(id).delete();
      await db.notes.delete(id);
    });
  }

  async function addFiles(noteId: string, files: File[]) {
    const now = Date.now();
    const attachments: Attachment[] = files.map((file, index) => ({
      id: newId(),
      noteId,
      kind: attachmentKindFromFile(file),
      name: file.name,
      mimeType: file.type || "application/octet-stream",
      size: file.size,
      blob: file,
      createdAt: now + index
    }));
    await db.attachments.bulkAdd(attachments);
    await db.notes.update(noteId, { updatedAt: Date.now() });
  }

  async function addLink(noteId: string, url: string, name: string) {
    await db.attachments.add({
      id: newId(),
      noteId,
      kind: "link",
      name,
      url,
      createdAt: Date.now()
    });
    await db.notes.update(noteId, { updatedAt: Date.now() });
  }

  async function createVoiceNote(blob: Blob, transcript: string, mimeType: string, language: string) {
    const now = Date.now();
    const note: Note = {
      id: newId(),
      title: voiceTitle(transcript),
      body: transcript.trim(),
      categoryId: "pending-review",
      tags: ["nota-de-veu"],
      pinned: false,
      status: "pending-review",
      source: "voice",
      transcriptionStatus: "complete",
      transcriptionLanguage: language || undefined,
      createdAt: now,
      updatedAt: now
    };
    const attachment: Attachment = {
      id: newId(),
      noteId: note.id,
      kind: "audio",
      name: `Gravació ${new Intl.DateTimeFormat("ca-ES", { dateStyle: "short", timeStyle: "short" }).format(now)}`,
      mimeType,
      size: blob.size,
      blob,
      createdAt: now
    };
    await db.transaction("rw", db.notes, db.attachments, async () => {
      await db.notes.add(note);
      await db.attachments.add(attachment);
    });
    setSelectedCategory("pending-review");
    setSelectedNoteId(note.id);
  }

  async function createFailedVoiceNote(blob: Blob, _error: string, mimeType: string, language: string) {
    const now = Date.now();
    const note: Note = {
      id: newId(),
      title: voiceTitle(),
      body: "",
      categoryId: "pending-review",
      tags: ["nota-de-veu"],
      pinned: false,
      status: "pending-review",
      source: "voice",
      transcriptionStatus: "failed",
      transcriptionLanguage: language || undefined,
      createdAt: now,
      updatedAt: now
    };
    await db.transaction("rw", db.notes, db.attachments, async () => {
      await db.notes.add(note);
      await db.attachments.add({
        id: newId(),
        noteId: note.id,
        kind: "audio",
        name: `Gravació pendent ${new Intl.DateTimeFormat("ca-ES", { dateStyle: "short", timeStyle: "short" }).format(now)}`,
        mimeType,
        size: blob.size,
        blob,
        createdAt: now
      });
    });
    setSelectedCategory("pending-review");
    setSelectedNoteId(note.id);
  }

  async function retryTranscription(note: Note) {
    const audio = allAttachments.find((attachment) => attachment.noteId === note.id && attachment.kind === "audio" && attachment.blob);
    if (!audio?.blob) {
      window.alert("No s'ha trobat l'àudio original d'aquesta nota.");
      return;
    }
    await db.notes.update(note.id, { transcriptionStatus: "processing" });
    const body = new FormData();
    const extension = audio.mimeType?.includes("mp4") ? "m4a" : audio.mimeType?.includes("ogg") ? "ogg" : "webm";
    body.append("audio", audio.blob, `nota-veu.${extension}`);
    if (note.transcriptionLanguage) body.append("language", note.transcriptionLanguage);
    try {
      const response = await fetch("/api/transcribe", { method: "POST", body });
      const payload = await response.json() as { text?: string; error?: string };
      if (!response.ok || !payload.text) throw new Error(payload.error || "No s'ha pogut transcriure l'àudio.");
      await db.notes.update(note.id, {
        title: note.title.startsWith("Nota de veu -") ? voiceTitle(payload.text) : note.title,
        body: payload.text.trim(),
        transcriptionStatus: "complete",
        updatedAt: Date.now()
      });
    } catch (caught) {
      await db.notes.update(note.id, { transcriptionStatus: "failed" });
      window.alert(caught instanceof Error ? caught.message : "Error de transcripció.");
    }
  }

  async function createCategory() {
    const name = window.prompt("Nom de la nova categoria:")?.trim();
    if (!name) return;
    const colors = ["#4777c7", "#3e8a68", "#b36148", "#7f5daa", "#b48424", "#3b858d"];
    const category: Category = {
      id: newId(),
      name,
      accent: colors[categories.length % colors.length],
      order: Math.max(50, ...categories.map((item) => item.order)) + 10
    };
    await db.categories.add(category);
    setSelectedCategory(category.id);
  }

  async function downloadBackup() {
    const blob = await exportBackup();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `idearium-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function restoreBackup(file: File) {
    if (!window.confirm("La importació substituirà totes les dades locals actuals. Vols continuar?")) return;
    try {
      await importBackup(file);
      setSelectedCategory("all");
      setSelectedNoteId(undefined);
    } catch (caught) {
      window.alert(caught instanceof Error ? caught.message : "No s'ha pogut importar la còpia.");
    }
  }

  async function installApp() {
    if (!installPrompt) return;
    await installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
  }

  return (
    <div className="app-shell">
      <Sidebar
        categories={categories}
        selectedCategory={selectedCategory}
        search={search}
        theme={theme}
        installAvailable={Boolean(installPrompt)}
        onSelectCategory={setSelectedCategory}
        onSearch={setSearch}
        onNewNote={() => createNote()}
        onVoiceNote={() => setVoiceOpen(true)}
        onNewCategory={createCategory}
        onExport={downloadBackup}
        onImport={() => importInputRef.current?.click()}
        onToggleTheme={() => setTheme((value) => value === "dark" ? "light" : "dark")}
        onInstall={installApp}
      />
      <input
        ref={importInputRef}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) restoreBackup(file);
          event.target.value = "";
        }}
      />
      <NoteList
        notes={filteredNotes}
        categories={categories}
        selectedNoteId={selectedNoteId}
        attachmentCounts={attachmentCounts}
        onSelect={setSelectedNoteId}
        onNewNote={() => createNote()}
      />
      <NoteEditor
        note={selectedNote}
        categories={categories}
        attachments={selectedAttachments}
        onUpdate={updateNote}
        onAddFiles={addFiles}
        onAddLink={addLink}
        onDeleteAttachment={(id) => db.attachments.delete(id)}
        onDeleteNote={deleteNote}
        onRetryTranscription={retryTranscription}
      />
      {voiceOpen && (
        <VoiceRecorder
          onClose={() => setVoiceOpen(false)}
          onComplete={createVoiceNote}
          onFailure={createFailedVoiceNote}
        />
      )}
    </div>
  );
}
