export type NoteStatus = "active" | "pending-review" | "archived";
export type NoteSource = "text" | "voice";
export type TranscriptionStatus = "none" | "processing" | "complete" | "failed";
export type AttachmentKind = "image" | "audio" | "video" | "file" | "link";

export interface Category {
  id: string;
  name: string;
  accent: string;
  order: number;
  system?: boolean;
}

export interface Note {
  id: string;
  title: string;
  body: string;
  categoryId: string;
  tags: string[];
  pinned: boolean;
  status: NoteStatus;
  source: NoteSource;
  transcriptionStatus: TranscriptionStatus;
  transcriptionLanguage?: string;
  createdAt: number;
  updatedAt: number;
}

export interface Attachment {
  id: string;
  noteId: string;
  kind: AttachmentKind;
  name: string;
  mimeType?: string;
  size?: number;
  blob?: Blob;
  url?: string;
  createdAt: number;
}
