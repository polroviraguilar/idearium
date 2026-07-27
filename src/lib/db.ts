import Dexie, { type EntityTable } from "dexie";
import type {
  Attachment,
  Category,
  Note,
  SyncMetadata,
  SyncStatus
} from "./types";

const LEGACY_DATABASE_NAME = "idearium";
const USER_DATABASE_PREFIX = "idearium-user-";
const BACKUP_FORMAT = "idearium-backup";
const BACKUP_VERSION = 2;

interface LegacyCategory {
  id: string;
  name: string;
  accent: string;
  order: number;
  system?: boolean;
}

interface LegacyNote {
  id: string;
  title: string;
  body: string;
  categoryId: string;
  tags: string[];
  pinned: boolean;
  status: Note["status"];
  source: Note["source"];
  transcriptionStatus: Note["transcriptionStatus"];
  transcriptionLanguage?: string;
  createdAt: number;
  updatedAt: number;
}

interface LegacyAttachment {
  id: string;
  noteId: string;
  kind: Attachment["kind"];
  name: string;
  mimeType?: string;
  size?: number;
  blob?: Blob;
  url?: string;
  createdAt: number;
}

class LegacyIdeariumDatabase extends Dexie {
  notes!: EntityTable<LegacyNote, "id">;
  categories!: EntityTable<LegacyCategory, "id">;
  attachments!: EntityTable<LegacyAttachment, "id">;

  constructor() {
    super(LEGACY_DATABASE_NAME);
    this.version(1).stores({
      notes: "id, categoryId, status, pinned, updatedAt, createdAt, *tags",
      categories: "id, order, name",
      attachments: "id, noteId, kind, createdAt"
    });
  }
}

export class IdeariumDatabase extends Dexie {
  notes!: EntityTable<Note, "id">;
  categories!: EntityTable<Category, "id">;
  attachments!: EntityTable<Attachment, "id">;

  readonly userId: string;

  constructor(userId: string) {
    super(`${USER_DATABASE_PREFIX}${userId}`);
    this.userId = userId;

    this.version(1).stores({
      notes:
        "id, userId, categoryId, status, pinned, syncStatus, deletedAt, updatedAt, createdAt, *tags",
      categories:
        "id, userId, order, name, syncStatus, deletedAt",
      attachments:
        "id, userId, noteId, kind, syncStatus, deletedAt, createdAt"
    });
  }
}

const databaseCache = new Map<string, IdeariumDatabase>();
const preparationCache = new Map<string, Promise<DatabasePreparationResult>>();

export function getUserDatabase(userId: string): IdeariumDatabase {
  const existing = databaseCache.get(userId);
  if (existing) return existing;

  const database = new IdeariumDatabase(userId);
  databaseCache.set(userId, database);
  return database;
}

interface DefaultCategoryTemplate {
  id: string;
  name: string;
  accent: string;
  order: number;
  system?: boolean;
}

const DEFAULT_CATEGORY_TEMPLATES: DefaultCategoryTemplate[] = [
  {
    id: "inbox",
    name: "Safata d'entrada",
    accent: "#cf5b3f",
    order: 10,
    system: true
  },
  {
    id: "pending-review",
    name: "Pendent de revisió",
    accent: "#d28b20",
    order: 20,
    system: true
  },
  {
    id: "ideas",
    name: "Idees",
    accent: "#4d74c9",
    order: 30
  },
  {
    id: "projects",
    name: "Projectes",
    accent: "#3f8a62",
    order: 40
  },
  {
    id: "references",
    name: "Referències",
    accent: "#7856a8",
    order: 50
  },
  {
    id: "archive",
    name: "Arxiu",
    accent: "#77736b",
    order: 90,
    system: true
  }
];

export function createSyncMetadata(
  userId: string,
  syncStatus: SyncStatus = "pending"
): SyncMetadata {
  return {
    userId,
    syncStatus,
    version: 1
  };
}

function migratedRecordMetadata(userId: string): SyncMetadata {
  return {
    userId,
    syncStatus: "pending",
    version: 1
  };
}

function migrationMarker(userId: string): string {
  return `idearium-legacy-migrated:${userId}`;
}

export interface DatabasePreparationResult {
  migratedLegacyData: boolean;
  migratedNotes: number;
  migratedCategories: number;
  migratedAttachments: number;
}

async function migrateLegacyDatabase(
  database: IdeariumDatabase,
  userId: string
): Promise<DatabasePreparationResult> {
  const emptyResult: DatabasePreparationResult = {
    migratedLegacyData: false,
    migratedNotes: 0,
    migratedCategories: 0,
    migratedAttachments: 0
  };

  if (localStorage.getItem(migrationMarker(userId)) === "1") {
    return emptyResult;
  }

  const legacyExists = await Dexie.exists(LEGACY_DATABASE_NAME);
  if (!legacyExists) {
    localStorage.setItem(migrationMarker(userId), "1");
    return emptyResult;
  }

  const [targetNotes, targetCategories, targetAttachments] = await Promise.all([
    database.notes.count(),
    database.categories.toArray(),
    database.attachments.count()
  ]);

  const defaultCategoryIds = new Set(
    DEFAULT_CATEGORY_TEMPLATES.map((category) => category.id)
  );

  const hasCustomTargetCategories = targetCategories.some(
    (category) => !defaultCategoryIds.has(category.id)
  );

  if (targetNotes > 0 || hasCustomTargetCategories || targetAttachments > 0) {
    return emptyResult;
  }

  const legacy = new LegacyIdeariumDatabase();

  try {
    await legacy.open();

    const [legacyNotes, legacyCategories, legacyAttachments] =
      await Promise.all([
        legacy.notes.toArray(),
        legacy.categories.toArray(),
        legacy.attachments.toArray()
      ]);

    if (
      legacyNotes.length === 0 &&
      legacyCategories.length === 0 &&
      legacyAttachments.length === 0
    ) {
      localStorage.setItem(migrationMarker(userId), "1");
      return emptyResult;
    }

    const categories: Category[] = legacyCategories.map((category) => ({
      ...category,
      ...migratedRecordMetadata(userId)
    }));

    const notes: Note[] = legacyNotes.map((note) => ({
      ...note,
      ...migratedRecordMetadata(userId)
    }));

    const attachments: Attachment[] = legacyAttachments.map((attachment) => ({
      ...attachment,
      ...migratedRecordMetadata(userId)
    }));

    await database.transaction(
      "rw",
      database.categories,
      database.notes,
      database.attachments,
      async () => {
        if (categories.length > 0) {
          await database.categories.bulkPut(categories);
        }

        if (notes.length > 0) {
          await database.notes.bulkPut(notes);
        }

        if (attachments.length > 0) {
          await database.attachments.bulkPut(attachments);
        }
      }
    );

    localStorage.setItem(migrationMarker(userId), "1");

    return {
      migratedLegacyData: true,
      migratedNotes: notes.length,
      migratedCategories: categories.length,
      migratedAttachments: attachments.length
    };
  } finally {
    legacy.close();
  }
}

export async function seedDatabase(
  database: IdeariumDatabase,
  userId: string
): Promise<void> {
  const existingCategories = await database.categories.toArray();
  const existingIds = new Set(existingCategories.map((category) => category.id));

  const missingCategories: Category[] = DEFAULT_CATEGORY_TEMPLATES
    .filter((category) => !existingIds.has(category.id))
    .map((category) => ({
      ...category,
      ...createSyncMetadata(userId)
    }));

  if (missingCategories.length > 0) {
    await database.categories.bulkAdd(missingCategories);
  }
}

export function prepareUserDatabase(
  database: IdeariumDatabase,
  userId: string
): Promise<DatabasePreparationResult> {
  if (database.userId !== userId) {
    return Promise.reject(
      new Error("La base local no correspon a l'usuari autenticat.")
    );
  }

  const existingPreparation = preparationCache.get(userId);
  if (existingPreparation) return existingPreparation;

  const preparation = (async () => {
    await database.open();
    const migration = await migrateLegacyDatabase(database, userId);
    await seedDatabase(database, userId);
    return migration;
  })().catch((error) => {
    preparationCache.delete(userId);
    throw error;
  });

  preparationCache.set(userId, preparation);
  return preparation;
}

export function newId(): string {
  return crypto.randomUUID();
}

export async function updateLocalNote(
  database: IdeariumDatabase,
  id: string,
  changes: Partial<Note>
): Promise<void> {
  const current = await database.notes.get(id);
  if (!current) return;

  await database.notes.update(id, {
    ...changes,
    id: current.id,
    userId: current.userId,
    version: current.version + 1,
    syncStatus: "pending",
    syncError: undefined,
    updatedAt: changes.updatedAt ?? Date.now()
  });
}

export async function touchLocalNote(
  database: IdeariumDatabase,
  id: string
): Promise<void> {
  await updateLocalNote(database, id, { updatedAt: Date.now() });
}

export async function softDeleteNote(
  database: IdeariumDatabase,
  id: string
): Promise<void> {
  const now = Date.now();

  await database.transaction(
    "rw",
    database.notes,
    database.attachments,
    async () => {
      const note = await database.notes.get(id);

      if (note) {
        await database.notes.update(id, {
          deletedAt: now,
          updatedAt: now,
          syncStatus: "pending",
          syncError: undefined,
          version: note.version + 1
        });
      }

      await database.attachments
        .where("noteId")
        .equals(id)
        .modify((attachment) => {
          if (attachment.deletedAt) return;

          attachment.deletedAt = now;
          attachment.syncStatus = "pending";
          attachment.syncError = undefined;
          attachment.version += 1;
        });
    }
  );
}

export async function softDeleteAttachment(
  database: IdeariumDatabase,
  id: string
): Promise<void> {
  const attachment = await database.attachments.get(id);
  if (!attachment) return;

  await database.attachments.update(id, {
    deletedAt: Date.now(),
    syncStatus: "pending",
    syncError: undefined,
    version: attachment.version + 1
  });

  await touchLocalNote(database, attachment.noteId);
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

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return new Blob([bytes], { type: mime });
}

type SerializedAttachment = Omit<Attachment, "blob"> & {
  blobDataUrl?: string;
};

interface BackupPayload {
  format: string;
  version: number;
  exportedAt: string;
  userId?: string;
  notes: Array<Partial<Note> & LegacyNote>;
  categories: Array<Partial<Category> & LegacyCategory>;
  attachments: Array<
    Partial<SerializedAttachment> &
      Omit<LegacyAttachment, "blob"> & {
        blobDataUrl?: string;
      }
  >;
}

function normalizedMetadata(
  record: Partial<SyncMetadata>,
  userId: string
): SyncMetadata {
  return {
    userId,
    syncStatus: "pending",
    version: Math.max(1, record.version ?? 1),
    remoteUpdatedAt: record.remoteUpdatedAt,
    deletedAt: record.deletedAt,
    syncError: undefined
  };
}

export async function exportBackup(
  database: IdeariumDatabase,
  userId: string
): Promise<Blob> {
  const [notes, categories, attachments] = await Promise.all([
    database.notes.toArray(),
    database.categories.toArray(),
    database.attachments.toArray()
  ]);

  const serializedAttachments = await Promise.all(
    attachments.map(async ({ blob, ...attachment }) => ({
      ...attachment,
      blobDataUrl: blob ? await blobToDataUrl(blob) : undefined
    }))
  );

  const payload = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    userId,
    notes,
    categories,
    attachments: serializedAttachments
  };

  return new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json"
  });
}

export async function importBackup(
  database: IdeariumDatabase,
  file: File,
  userId: string
): Promise<void> {
  const payload = JSON.parse(await file.text()) as BackupPayload;

  if (
    payload.format !== BACKUP_FORMAT ||
    ![1, BACKUP_VERSION].includes(payload.version)
  ) {
    throw new Error("El fitxer no és una còpia d'Idearium compatible.");
  }

  const categories: Category[] = payload.categories.map((category) => ({
    id: category.id,
    name: category.name,
    accent: category.accent,
    order: category.order,
    system: category.system,
    ...normalizedMetadata(category, userId)
  }));

  const notes: Note[] = payload.notes.map((note) => ({
    id: note.id,
    title: note.title,
    body: note.body,
    categoryId: note.categoryId,
    tags: note.tags,
    pinned: note.pinned,
    status: note.status,
    source: note.source,
    transcriptionStatus: note.transcriptionStatus,
    transcriptionLanguage: note.transcriptionLanguage,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
    ...normalizedMetadata(note, userId)
  }));

  const attachments: Attachment[] = payload.attachments.map(
    ({ blobDataUrl, ...attachment }) => ({
      id: attachment.id,
      noteId: attachment.noteId,
      kind: attachment.kind,
      name: attachment.name,
      mimeType: attachment.mimeType,
      size: attachment.size,
      url: attachment.url,
      storagePath: attachment.storagePath,
      createdAt: attachment.createdAt,
      blob: blobDataUrl ? dataUrlToBlob(blobDataUrl) : undefined,
      ...normalizedMetadata(attachment, userId)
    })
  );

  await database.transaction(
    "rw",
    database.notes,
    database.categories,
    database.attachments,
    async () => {
      await Promise.all([
        database.notes.clear(),
        database.categories.clear(),
        database.attachments.clear()
      ]);

      if (categories.length > 0) {
        await database.categories.bulkPut(categories);
      }

      if (notes.length > 0) {
        await database.notes.bulkPut(notes);
      }

      if (attachments.length > 0) {
        await database.attachments.bulkPut(attachments);
      }
    }
  );

  await seedDatabase(database, userId);
}
