import Dexie, { type EntityTable } from "dexie";
import type { Attachment, Category, Note } from "./types";

class IdeariumDatabase extends Dexie {
  notes!: EntityTable<Note, "id">;
  categories!: EntityTable<Category, "id">;
  attachments!: EntityTable<Attachment, "id">;

  constructor() {
    super("idearium");
    this.version(1).stores({
      notes: "id, categoryId, status, pinned, updatedAt, createdAt, *tags",
      categories: "id, order, name",
      attachments: "id, noteId, kind, createdAt"
    });
  }
}

export const db = new IdeariumDatabase();

export const DEFAULT_CATEGORIES: Category[] = [
  { id: "inbox", name: "Safata d'entrada", accent: "#cf5b3f", order: 10, system: true },
  { id: "pending-review", name: "Pendent de revisió", accent: "#d28b20", order: 20, system: true },
  { id: "ideas", name: "Idees", accent: "#4d74c9", order: 30 },
  { id: "projects", name: "Projectes", accent: "#3f8a62", order: 40 },
  { id: "references", name: "Referències", accent: "#7856a8", order: 50 },
  { id: "archive", name: "Arxiu", accent: "#77736b", order: 90, system: true }
];

export async function seedDatabase(): Promise<void> {
  const count = await db.categories.count();
  if (count === 0) {
    await db.categories.bulkAdd(DEFAULT_CATEGORIES);
  }
}

export function newId(): string {
  return crypto.randomUUID();
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [meta, encoded] = dataUrl.split(",");
  const mime = /data:(.*?);base64/.exec(meta)?.[1] ?? "application/octet-stream";
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

export async function exportBackup(): Promise<Blob> {
  const [notes, categories, attachments] = await Promise.all([
    db.notes.toArray(),
    db.categories.toArray(),
    db.attachments.toArray()
  ]);

  const serializedAttachments = await Promise.all(
    attachments.map(async ({ blob, ...attachment }) => ({
      ...attachment,
      blobDataUrl: blob ? await blobToDataUrl(blob) : undefined
    }))
  );

  const payload = {
    format: "idearium-backup",
    version: 1,
    exportedAt: new Date().toISOString(),
    notes,
    categories,
    attachments: serializedAttachments
  };

  return new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
}

export async function importBackup(file: File): Promise<void> {
  const payload = JSON.parse(await file.text()) as {
    format: string;
    version: number;
    notes: Note[];
    categories: Category[];
    attachments: Array<Omit<Attachment, "blob"> & { blobDataUrl?: string }>;
  };

  if (payload.format !== "idearium-backup" || payload.version !== 1) {
    throw new Error("El fitxer no és una còpia d'Idearium compatible.");
  }

  const attachments: Attachment[] = payload.attachments.map(({ blobDataUrl, ...attachment }) => ({
    ...attachment,
    blob: blobDataUrl ? dataUrlToBlob(blobDataUrl) : undefined
  }));

  await db.transaction("rw", db.notes, db.categories, db.attachments, async () => {
    await Promise.all([db.notes.clear(), db.categories.clear(), db.attachments.clear()]);
    await db.categories.bulkPut(payload.categories);
    await db.notes.bulkPut(payload.notes);
    await db.attachments.bulkPut(attachments);
  });
}
