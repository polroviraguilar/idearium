export type NoteStatus = "active" | "pending-review" | "archived";
export type NoteSource = "text" | "voice";
export type TranscriptionStatus = "none" | "processing" | "complete" | "failed";
export type AttachmentKind = "image" | "audio" | "video" | "file" | "link";
export type SyncStatus = "pending" | "syncing" | "synced" | "error";

export interface SyncMetadata {
  userId: string;
  syncStatus: SyncStatus;
  version: number;
  remoteUpdatedAt?: string;
  deletedAt?: number;
  syncError?: string;
}

export interface Category extends SyncMetadata {
  id: string;
  name: string;
  accent: string;
  order: number;
  system?: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface Note extends SyncMetadata {
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

export interface Attachment extends SyncMetadata {
  id: string;
  noteId: string;
  kind: AttachmentKind;
  name: string;
  mimeType?: string;
  size?: number;
  blob?: Blob;
  url?: string;
  storagePath?: string;
  createdAt: number;
}