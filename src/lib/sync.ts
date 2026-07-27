import type { Tables, TablesInsert } from "./database.types";
import type { IdeariumDatabase } from "./db";
import { newId } from "./db";
import { supabase } from "./supabase";
import type {
  Attachment,
  AttachmentKind,
  Category,
  Note,
  NoteSource,
  NoteStatus,
  SyncMetadata,
  TranscriptionStatus
} from "./types";

type RemoteAttachment = Tables<"attachments">;
type RemoteCategory = Tables<"categories">;
type RemoteNote = Tables<"notes">;
type AttachmentInsert = TablesInsert<"attachments">;
type CategoryInsert = TablesInsert<"categories">;
type NoteInsert = TablesInsert<"notes">;

const PAGE_SIZE = 500;
const STORAGE_BUCKET = "idearium-attachments";

export interface SyncResult {
  pulledCategories: number;
  pulledNotes: number;
  pulledAttachments: number;
  pushedCategories: number;
  pushedNotes: number;
  pushedAttachments: number;
  deletedCategories: number;
  deletedNotes: number;
  deletedAttachments: number;
  conflictsCreated: number;
}

interface MergeResult {
  pulledCategories: number;
  pulledNotes: number;
  conflictsCreated: number;
}

interface AttachmentMergeResult {
  pulledAttachments: number;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;

  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }

  return "Error desconegut de sincronització.";
}

function timestampToNumber(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function isUnsynced(record: SyncMetadata): boolean {
  return (
    record.syncStatus === "pending" ||
    record.syncStatus === "error" ||
    record.syncStatus === "syncing"
  );
}

function remoteChangedSinceLocalBase(
  local: SyncMetadata,
  remoteUpdatedAt: string
): boolean {
  return Boolean(
    local.remoteUpdatedAt && local.remoteUpdatedAt !== remoteUpdatedAt
  );
}

function asAttachmentKind(value: string): AttachmentKind {
  if (
    value === "image" ||
    value === "audio" ||
    value === "video" ||
    value === "link"
  ) {
    return value;
  }

  return "file";
}

function asNoteStatus(value: string): NoteStatus {
  if (value === "pending-review" || value === "archived") return value;
  return "active";
}

function asNoteSource(value: string): NoteSource {
  return value === "voice" ? "voice" : "text";
}

function asTranscriptionStatus(value: string): TranscriptionStatus {
  if (
    value === "processing" ||
    value === "complete" ||
    value === "failed"
  ) {
    return value;
  }

  return "none";
}

function remoteCategoryToLocal(
  remote: RemoteCategory,
  userId: string
): Category {
  return {
    id: remote.id,
    userId,
    name: remote.name,
    accent: remote.accent,
    order: remote.sort_order,
    system: remote.is_system,
    createdAt: timestampToNumber(remote.created_at),
    updatedAt: timestampToNumber(remote.updated_at),
    syncStatus: "synced",
    version: 1,
    remoteUpdatedAt: remote.updated_at,
    deletedAt: undefined,
    syncError: undefined
  };
}

function remoteNoteToLocal(remote: RemoteNote, userId: string): Note {
  return {
    id: remote.id,
    userId,
    title: remote.title,
    body: remote.body,
    categoryId: remote.category_id,
    tags: remote.tags ?? [],
    pinned: remote.pinned,
    status: asNoteStatus(remote.status),
    source: asNoteSource(remote.source),
    transcriptionStatus: asTranscriptionStatus(
      remote.transcription_status
    ),
    transcriptionLanguage: remote.transcription_language ?? undefined,
    createdAt: timestampToNumber(remote.created_at),
    updatedAt: timestampToNumber(remote.updated_at),
    syncStatus: "synced",
    version: 1,
    remoteUpdatedAt: remote.updated_at,
    deletedAt: undefined,
    syncError: undefined
  };
}

function remoteAttachmentToLocal(
  remote: RemoteAttachment,
  userId: string,
  blob?: Blob
): Attachment {
  return {
    id: remote.id,
    userId,
    noteId: remote.note_id,
    kind: asAttachmentKind(remote.kind),
    name: remote.name,
    mimeType: remote.mime_type ?? undefined,
    size: remote.size_bytes ?? undefined,
    blob,
    url: remote.external_url ?? undefined,
    storagePath: remote.storage_path ?? undefined,
    createdAt: timestampToNumber(remote.created_at),
    syncStatus: "synced",
    version: 1,
    remoteUpdatedAt: remote.created_at,
    deletedAt: undefined,
    syncError: undefined
  };
}

function categoryToRemote(category: Category): CategoryInsert {
  return {
    id: category.id,
    user_id: category.userId,
    name: category.name,
    accent: category.accent,
    sort_order: category.order,
    is_system: Boolean(category.system),
    created_at: new Date(category.createdAt).toISOString(),
    updated_at: new Date(category.updatedAt).toISOString()
  };
}

function noteToRemote(note: Note): NoteInsert {
  return {
    id: note.id,
    user_id: note.userId,
    title: note.title,
    body: note.body,
    category_id: note.categoryId,
    tags: note.tags,
    pinned: note.pinned,
    status: note.status,
    source: note.source,
    transcription_status: note.transcriptionStatus,
    transcription_language: note.transcriptionLanguage ?? null,
    created_at: new Date(note.createdAt).toISOString(),
    updated_at: new Date(note.updatedAt).toISOString()
  };
}

function attachmentToRemote(
  attachment: Attachment,
  storagePath?: string
): AttachmentInsert {
  return {
    id: attachment.id,
    user_id: attachment.userId,
    note_id: attachment.noteId,
    kind: attachment.kind,
    name: attachment.name,
    mime_type: attachment.mimeType ?? null,
    size_bytes: attachment.size ?? attachment.blob?.size ?? null,
    external_url: attachment.kind === "link" ? attachment.url ?? null : null,
    storage_path: attachment.kind === "link" ? null : storagePath ?? null,
    created_at: new Date(attachment.createdAt).toISOString()
  };
}

function storagePathForAttachment(attachment: Attachment): string {
  return `${attachment.userId}/${attachment.noteId}/${attachment.id}`;
}

async function fetchRemoteCategories(userId: string): Promise<RemoteCategory[]> {
  const rows: RemoteCategory[] = [];

  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("categories")
      .select("*")
      .eq("user_id", userId)
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (error) throw new Error(error.message);

    const page = (data ?? []) as RemoteCategory[];
    rows.push(...page);

    if (page.length < PAGE_SIZE) break;
  }

  return rows;
}

async function fetchRemoteNotes(userId: string): Promise<RemoteNote[]> {
  const rows: RemoteNote[] = [];

  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("notes")
      .select("*")
      .eq("user_id", userId)
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (error) throw new Error(error.message);

    const page = (data ?? []) as RemoteNote[];
    rows.push(...page);

    if (page.length < PAGE_SIZE) break;
  }

  return rows;
}

async function fetchRemoteAttachments(
  userId: string
): Promise<RemoteAttachment[]> {
  const rows: RemoteAttachment[] = [];

  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("attachments")
      .select("*")
      .eq("user_id", userId)
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (error) throw new Error(error.message);

    const page = (data ?? []) as RemoteAttachment[];
    rows.push(...page);

    if (page.length < PAGE_SIZE) break;
  }

  return rows;
}

function conflictTitle(title: string): string {
  const base = title.trim() || "Nota sense títol";
  return `${base} (còpia local en conflicte)`;
}

async function mergeRemoteData(
  database: IdeariumDatabase,
  userId: string,
  remoteCategories: RemoteCategory[],
  remoteNotes: RemoteNote[]
): Promise<MergeResult> {
  let pulledCategories = 0;
  let pulledNotes = 0;
  let conflictsCreated = 0;

  await database.transaction(
    "rw",
    database.categories,
    database.notes,
    database.attachments,
    async () => {
      const [localCategories, localNotes, localAttachments] = await Promise.all([
        database.categories.toArray(),
        database.notes.toArray(),
        database.attachments.toArray()
      ]);

      const localCategoryById = new Map(
        localCategories.map((category) => [category.id, category])
      );
      const remoteCategoryIds = new Set(
        remoteCategories.map((category) => category.id)
      );

      for (const remote of remoteCategories) {
        const local = localCategoryById.get(remote.id);
        const remoteLocal = remoteCategoryToLocal(remote, userId);

        if (!local) {
          await database.categories.put(remoteLocal);
          pulledCategories += 1;
          continue;
        }

        if (local.deletedAt && isUnsynced(local)) {
          continue;
        }

        if (isUnsynced(local)) {
          if (remoteChangedSinceLocalBase(local, remote.updated_at)) {
            await database.categories.put(remoteLocal);
            pulledCategories += 1;
          }

          continue;
        }

        await database.categories.put({
          ...remoteLocal,
          version: local.version
        });
        pulledCategories += 1;
      }

      const remoteDeletionTime = Date.now();

      for (const local of localCategories) {
        if (
          local.syncStatus === "synced" &&
          !local.deletedAt &&
          !remoteCategoryIds.has(local.id)
        ) {
          await database.categories.update(local.id, {
            deletedAt: remoteDeletionTime,
            syncStatus: "synced",
            syncError: undefined,
            remoteUpdatedAt: undefined
          });
        }
      }

      const localNoteById = new Map(localNotes.map((note) => [note.id, note]));
      const attachmentsByNoteId = new Map<string, Attachment[]>();

      for (const attachment of localAttachments) {
        const noteAttachments = attachmentsByNoteId.get(attachment.noteId) ?? [];
        noteAttachments.push(attachment);
        attachmentsByNoteId.set(attachment.noteId, noteAttachments);
      }

      const remoteNoteIds = new Set(remoteNotes.map((note) => note.id));

      for (const remote of remoteNotes) {
        const local = localNoteById.get(remote.id);
        const remoteLocal = remoteNoteToLocal(remote, userId);

        if (!local) {
          await database.notes.put(remoteLocal);
          pulledNotes += 1;
          continue;
        }

        if (local.deletedAt && isUnsynced(local)) {
          continue;
        }

        if (isUnsynced(local)) {
          if (remoteChangedSinceLocalBase(local, remote.updated_at)) {
            const now = Date.now();
            const conflictCopy: Note = {
              ...local,
              id: newId(),
              title: conflictTitle(local.title),
              createdAt: now,
              updatedAt: now,
              syncStatus: "pending",
              version: 1,
              remoteUpdatedAt: undefined,
              deletedAt: undefined,
              syncError: undefined
            };

            await database.notes.put(conflictCopy);

            const sourceAttachments =
              attachmentsByNoteId.get(local.id)?.filter(
                (attachment) => !attachment.deletedAt
              ) ?? [];

            for (const source of sourceAttachments) {
              const conflictAttachment: Attachment = {
                ...source,
                id: newId(),
                noteId: conflictCopy.id,
                syncStatus: "pending",
                version: 1,
                remoteUpdatedAt: undefined,
                deletedAt: undefined,
                syncError: undefined
              };

              await database.attachments.put(conflictAttachment);

              if (isUnsynced(source)) {
                await database.attachments.update(source.id, {
                  syncStatus: "synced",
                  syncError: undefined
                });
              }
            }

            await database.notes.put(remoteLocal);
            conflictsCreated += 1;
            pulledNotes += 1;
          }

          continue;
        }

        await database.notes.put({
          ...remoteLocal,
          version: local.version
        });
        pulledNotes += 1;
      }

      for (const local of localNotes) {
        if (
          local.syncStatus === "synced" &&
          !local.deletedAt &&
          !remoteNoteIds.has(local.id)
        ) {
          await database.notes.update(local.id, {
            deletedAt: remoteDeletionTime,
            syncStatus: "synced",
            syncError: undefined,
            remoteUpdatedAt: undefined
          });

          await database.attachments
            .where("noteId")
            .equals(local.id)
            .modify((attachment) => {
              if (attachment.deletedAt) return;

              attachment.deletedAt = remoteDeletionTime;
              attachment.syncStatus = "pending";
              attachment.syncError = undefined;
              attachment.version += 1;
            });
        }
      }
    }
  );

  return {
    pulledCategories,
    pulledNotes,
    conflictsCreated
  };
}

function attachmentMatchesRemote(
  local: Attachment,
  remote: RemoteAttachment
): boolean {
  const remoteKind = asAttachmentKind(remote.kind);
  const needsBlob = remoteKind !== "link" && Boolean(remote.storage_path);

  return (
    local.noteId === remote.note_id &&
    local.kind === remoteKind &&
    local.name === remote.name &&
    (local.mimeType ?? null) === remote.mime_type &&
    (local.size ?? null) === remote.size_bytes &&
    (local.url ?? null) === remote.external_url &&
    (local.storagePath ?? null) === remote.storage_path &&
    (!needsBlob || Boolean(local.blob))
  );
}

async function downloadStorageBlob(storagePath: string): Promise<Blob> {
  const { data, error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .download(storagePath);

  if (error) {
    throw new Error(
      `No s'ha pogut baixar l'adjunt ${storagePath}: ${error.message}`
    );
  }

  return data;
}

async function mergeRemoteAttachments(
  database: IdeariumDatabase,
  userId: string,
  remoteAttachments: RemoteAttachment[]
): Promise<AttachmentMergeResult> {
  const [localAttachments, localNotes] = await Promise.all([
    database.attachments.toArray(),
    database.notes.toArray()
  ]);

  const localById = new Map(
    localAttachments.map((attachment) => [attachment.id, attachment])
  );
  const localNoteById = new Map(localNotes.map((note) => [note.id, note]));
  const remoteIds = new Set(remoteAttachments.map((attachment) => attachment.id));
  const prepared: Attachment[] = [];

  for (const remote of remoteAttachments) {
    const local = localById.get(remote.id);
    const parentNote = localNoteById.get(remote.note_id);

    if (parentNote?.deletedAt && isUnsynced(parentNote)) {
      continue;
    }

    if (local?.deletedAt && isUnsynced(local)) {
      continue;
    }

    if (local && isUnsynced(local)) {
      continue;
    }

    if (local && attachmentMatchesRemote(local, remote)) {
      continue;
    }

    const kind = asAttachmentKind(remote.kind);
    let blob = local?.blob;

    if (kind !== "link") {
      if (!remote.storage_path) {
        throw new Error(
          `L'adjunt remot ${remote.id} no té cap ruta de Storage.`
        );
      }

      if (!blob || local?.storagePath !== remote.storage_path) {
        blob = await downloadStorageBlob(remote.storage_path);
      }
    }

    prepared.push({
      ...remoteAttachmentToLocal(remote, userId, blob),
      version: local?.version ?? 1
    });
  }

  let pulledAttachments = 0;
  const remoteDeletionTime = Date.now();

  await database.transaction("rw", database.attachments, async () => {
    for (const attachment of prepared) {
      const current = await database.attachments.get(attachment.id);

      if (current && isUnsynced(current)) {
        continue;
      }

      await database.attachments.put({
        ...attachment,
        version: current?.version ?? attachment.version
      });
      pulledAttachments += 1;
    }

    const currentAttachments = await database.attachments.toArray();

    for (const local of currentAttachments) {
      if (
        local.syncStatus !== "synced" ||
        local.deletedAt ||
        remoteIds.has(local.id)
      ) {
        continue;
      }

      if (local.storagePath) {
        await database.attachments.update(local.id, {
          deletedAt: remoteDeletionTime,
          syncStatus: "pending",
          syncError: undefined,
          version: local.version + 1
        });
      } else {
        await database.attachments.delete(local.id);
      }
    }
  });

  return { pulledAttachments };
}

async function markCategoriesAsError(
  database: IdeariumDatabase,
  snapshots: Category[],
  message: string
): Promise<void> {
  await database.transaction("rw", database.categories, async () => {
    for (const snapshot of snapshots) {
      const current = await database.categories.get(snapshot.id);

      if (
        current &&
        current.version === snapshot.version &&
        current.syncStatus === "syncing"
      ) {
        await database.categories.update(snapshot.id, {
          syncStatus: "error",
          syncError: message
        });
      }
    }
  });
}

async function markNotesAsError(
  database: IdeariumDatabase,
  snapshots: Note[],
  message: string
): Promise<void> {
  await database.transaction("rw", database.notes, async () => {
    for (const snapshot of snapshots) {
      const current = await database.notes.get(snapshot.id);

      if (
        current &&
        current.version === snapshot.version &&
        current.syncStatus === "syncing"
      ) {
        await database.notes.update(snapshot.id, {
          syncStatus: "error",
          syncError: message
        });
      }
    }
  });
}

async function markAttachmentAsError(
  database: IdeariumDatabase,
  snapshot: Attachment,
  message: string
): Promise<void> {
  const current = await database.attachments.get(snapshot.id);

  if (
    current &&
    current.version === snapshot.version &&
    current.syncStatus === "syncing"
  ) {
    await database.attachments.update(snapshot.id, {
      syncStatus: "error",
      syncError: message
    });
  }
}

async function pushCategoryUpserts(
  database: IdeariumDatabase
): Promise<number> {
  const snapshots = (await database.categories.toArray()).filter(
    (category) => !category.deletedAt && isUnsynced(category)
  );

  if (snapshots.length === 0) return 0;

  await database.transaction("rw", database.categories, async () => {
    for (const snapshot of snapshots) {
      await database.categories.update(snapshot.id, {
        syncStatus: "syncing",
        syncError: undefined
      });
    }
  });

  const { data, error } = await supabase
    .from("categories")
    .upsert(snapshots.map(categoryToRemote), {
      onConflict: "user_id,id"
    })
    .select();

  if (error) {
    await markCategoriesAsError(database, snapshots, error.message);
    throw new Error(error.message);
  }

  const returnedRows = (data ?? []) as RemoteCategory[];
  const remoteById = new Map<string, RemoteCategory>(
    returnedRows.map((row) => [row.id, row])
  );
  let pushed = 0;

  await database.transaction("rw", database.categories, async () => {
    for (const snapshot of snapshots) {
      const current = await database.categories.get(snapshot.id);
      const remote = remoteById.get(snapshot.id);

      if (
        !current ||
        current.version !== snapshot.version ||
        current.syncStatus !== "syncing"
      ) {
        continue;
      }

      if (!remote) {
        await database.categories.update(snapshot.id, {
          syncStatus: "error",
          syncError: "Supabase no ha retornat la categoria sincronitzada."
        });
        continue;
      }

      await database.categories.update(snapshot.id, {
        syncStatus: "synced",
        syncError: undefined,
        remoteUpdatedAt: remote.updated_at,
        createdAt: timestampToNumber(remote.created_at),
        updatedAt: timestampToNumber(remote.updated_at)
      });
      pushed += 1;
    }
  });

  return pushed;
}

async function pushNoteUpserts(database: IdeariumDatabase): Promise<number> {
  const snapshots = (await database.notes.toArray()).filter(
    (note) => !note.deletedAt && isUnsynced(note)
  );

  if (snapshots.length === 0) return 0;

  await database.transaction("rw", database.notes, async () => {
    for (const snapshot of snapshots) {
      await database.notes.update(snapshot.id, {
        syncStatus: "syncing",
        syncError: undefined
      });
    }
  });

  const { data, error } = await supabase
    .from("notes")
    .upsert(snapshots.map(noteToRemote), {
      onConflict: "id"
    })
    .select();

  if (error) {
    await markNotesAsError(database, snapshots, error.message);
    throw new Error(error.message);
  }

  const returnedRows = (data ?? []) as RemoteNote[];
  const remoteById = new Map<string, RemoteNote>(
    returnedRows.map((row) => [row.id, row])
  );
  let pushed = 0;

  await database.transaction("rw", database.notes, async () => {
    for (const snapshot of snapshots) {
      const current = await database.notes.get(snapshot.id);
      const remote = remoteById.get(snapshot.id);

      if (
        !current ||
        current.version !== snapshot.version ||
        current.syncStatus !== "syncing"
      ) {
        continue;
      }

      if (!remote) {
        await database.notes.update(snapshot.id, {
          syncStatus: "error",
          syncError: "Supabase no ha retornat la nota sincronitzada."
        });
        continue;
      }

      await database.notes.update(snapshot.id, {
        syncStatus: "synced",
        syncError: undefined,
        remoteUpdatedAt: remote.updated_at,
        createdAt: timestampToNumber(remote.created_at),
        updatedAt: timestampToNumber(remote.updated_at)
      });
      pushed += 1;
    }
  });

  return pushed;
}

async function loadBlobForUpload(
  attachment: Attachment,
  desiredPath: string
): Promise<Blob> {
  if (attachment.blob) return attachment.blob;

  if (attachment.storagePath) {
    return await downloadStorageBlob(attachment.storagePath);
  }

  throw new Error(
    `L'adjunt «${attachment.name}» no conserva el fitxer local necessari per pujar-lo a ${desiredPath}.`
  );
}

async function pushAttachmentUpserts(
  database: IdeariumDatabase
): Promise<number> {
  const snapshots = (await database.attachments.toArray()).filter(
    (attachment) => !attachment.deletedAt && isUnsynced(attachment)
  );

  if (snapshots.length === 0) return 0;

  await database.transaction("rw", database.attachments, async () => {
    for (const snapshot of snapshots) {
      await database.attachments.update(snapshot.id, {
        syncStatus: "syncing",
        syncError: undefined
      });
    }
  });

  let pushed = 0;
  let firstError = "";

  for (const snapshot of snapshots) {
    try {
      let storagePath: string | undefined;
      let synchronizedBlob = snapshot.blob;

      if (snapshot.kind === "link") {
        if (!snapshot.url) {
          throw new Error(
            `L'enllaç «${snapshot.name}» no té cap URL vàlida.`
          );
        }
      } else {
        storagePath = storagePathForAttachment(snapshot);
        synchronizedBlob = await loadBlobForUpload(snapshot, storagePath);

        const { error: uploadError } = await supabase.storage
          .from(STORAGE_BUCKET)
          .upload(storagePath, synchronizedBlob, {
            cacheControl: "3600",
            contentType:
              snapshot.mimeType ||
              synchronizedBlob.type ||
              "application/octet-stream",
            upsert: true
          });

        if (uploadError) {
          throw new Error(uploadError.message);
        }
      }

      const { data, error } = await supabase
        .from("attachments")
        .upsert(attachmentToRemote(snapshot, storagePath), {
          onConflict: "id"
        })
        .select()
        .single();

      if (error) {
        throw new Error(error.message);
      }

      const remote = data as RemoteAttachment;
      const current = await database.attachments.get(snapshot.id);

      if (
        !current ||
        current.version !== snapshot.version ||
        current.syncStatus !== "syncing"
      ) {
        continue;
      }

      await database.attachments.update(snapshot.id, {
        syncStatus: "synced",
        syncError: undefined,
        remoteUpdatedAt: remote.created_at,
        storagePath: remote.storage_path ?? undefined,
        url: remote.external_url ?? undefined,
        mimeType: remote.mime_type ?? undefined,
        size: remote.size_bytes ?? synchronizedBlob?.size ?? undefined,
        blob: synchronizedBlob,
        createdAt: timestampToNumber(remote.created_at)
      });
      pushed += 1;
    } catch (caught) {
      const message = errorMessage(caught);
      firstError ||= message;
      await markAttachmentAsError(database, snapshot, message);
    }
  }

  if (firstError) {
    throw new Error(firstError);
  }

  return pushed;
}

async function pushAttachmentDeletions(
  database: IdeariumDatabase,
  userId: string
): Promise<number> {
  const snapshots = (await database.attachments.toArray()).filter(
    (attachment) => Boolean(attachment.deletedAt) && isUnsynced(attachment)
  );

  if (snapshots.length === 0) return 0;

  await database.transaction("rw", database.attachments, async () => {
    for (const snapshot of snapshots) {
      await database.attachments.update(snapshot.id, {
        syncStatus: "syncing",
        syncError: undefined
      });
    }
  });

  let deleted = 0;
  let firstError = "";

  for (const snapshot of snapshots) {
    try {
      if (snapshot.storagePath) {
        const { error: storageError } = await supabase.storage
          .from(STORAGE_BUCKET)
          .remove([snapshot.storagePath]);

        if (storageError) {
          throw new Error(storageError.message);
        }
      }

      const { error: metadataError } = await supabase
        .from("attachments")
        .delete()
        .eq("user_id", userId)
        .eq("id", snapshot.id);

      if (metadataError) {
        throw new Error(metadataError.message);
      }

      const current = await database.attachments.get(snapshot.id);

      if (
        !current ||
        current.version !== snapshot.version ||
        current.syncStatus !== "syncing"
      ) {
        continue;
      }

      await database.attachments.delete(snapshot.id);
      deleted += 1;
    } catch (caught) {
      const message = errorMessage(caught);
      firstError ||= message;
      await markAttachmentAsError(database, snapshot, message);
    }
  }

  if (firstError) {
    throw new Error(firstError);
  }

  return deleted;
}

async function pushNoteDeletions(
  database: IdeariumDatabase,
  userId: string
): Promise<number> {
  const snapshots = (await database.notes.toArray()).filter(
    (note) => Boolean(note.deletedAt) && isUnsynced(note)
  );

  if (snapshots.length === 0) return 0;

  await database.transaction("rw", database.notes, async () => {
    for (const snapshot of snapshots) {
      await database.notes.update(snapshot.id, {
        syncStatus: "syncing",
        syncError: undefined
      });
    }
  });

  const ids = snapshots.map((note) => note.id);
  const { error } = await supabase
    .from("notes")
    .delete()
    .eq("user_id", userId)
    .in("id", ids);

  if (error) {
    await markNotesAsError(database, snapshots, error.message);
    throw new Error(error.message);
  }

  let deleted = 0;

  await database.transaction(
    "rw",
    database.notes,
    database.attachments,
    async () => {
      for (const snapshot of snapshots) {
        const current = await database.notes.get(snapshot.id);

        if (
          !current ||
          current.version !== snapshot.version ||
          current.syncStatus !== "syncing"
        ) {
          continue;
        }

        await database.attachments
          .where("noteId")
          .equals(snapshot.id)
          .delete();
        await database.notes.delete(snapshot.id);
        deleted += 1;
      }
    }
  );

  return deleted;
}

async function pushCategoryDeletions(
  database: IdeariumDatabase,
  userId: string
): Promise<number> {
  const snapshots = (await database.categories.toArray()).filter(
    (category) => Boolean(category.deletedAt) && isUnsynced(category)
  );

  if (snapshots.length === 0) return 0;

  await database.transaction("rw", database.categories, async () => {
    for (const snapshot of snapshots) {
      await database.categories.update(snapshot.id, {
        syncStatus: "syncing",
        syncError: undefined
      });
    }
  });

  const ids = snapshots.map((category) => category.id);
  const { error } = await supabase
    .from("categories")
    .delete()
    .eq("user_id", userId)
    .in("id", ids);

  if (error) {
    await markCategoriesAsError(database, snapshots, error.message);
    throw new Error(error.message);
  }

  let deleted = 0;

  await database.transaction("rw", database.categories, async () => {
    for (const snapshot of snapshots) {
      const current = await database.categories.get(snapshot.id);

      if (
        !current ||
        current.version !== snapshot.version ||
        current.syncStatus !== "syncing"
      ) {
        continue;
      }

      await database.categories.delete(snapshot.id);
      deleted += 1;
    }
  });

  return deleted;
}

const syncLocks = new Map<string, Promise<SyncResult>>();

async function runSynchronization(
  database: IdeariumDatabase,
  userId: string
): Promise<SyncResult> {
  if (database.userId !== userId) {
    throw new Error("La base local no correspon a l'usuari autenticat.");
  }

  const {
    data: { session },
    error: sessionError
  } = await supabase.auth.getSession();

  if (sessionError) throw new Error(sessionError.message);

  if (!session || session.user.id !== userId) {
    throw new Error("La sessió de Supabase no correspon a l'usuari local.");
  }

  const [remoteCategories, remoteNotes, remoteAttachments] = await Promise.all([
    fetchRemoteCategories(userId),
    fetchRemoteNotes(userId),
    fetchRemoteAttachments(userId)
  ]);

  const merged = await mergeRemoteData(
    database,
    userId,
    remoteCategories,
    remoteNotes
  );

  const mergedAttachments = await mergeRemoteAttachments(
    database,
    userId,
    remoteAttachments
  );

  const pushedCategories = await pushCategoryUpserts(database);
  const pushedNotes = await pushNoteUpserts(database);
  const deletedAttachments = await pushAttachmentDeletions(database, userId);
  const pushedAttachments = await pushAttachmentUpserts(database);
  const deletedNotes = await pushNoteDeletions(database, userId);
  const deletedCategories = await pushCategoryDeletions(database, userId);

  return {
    ...merged,
    ...mergedAttachments,
    pushedCategories,
    pushedNotes,
    pushedAttachments,
    deletedCategories,
    deletedNotes,
    deletedAttachments
  };
}

export function synchronizeUserData(
  database: IdeariumDatabase,
  userId: string
): Promise<SyncResult> {
  const existing = syncLocks.get(userId);
  if (existing) return existing;

  const synchronization = runSynchronization(database, userId)
    .catch((error) => {
      throw new Error(errorMessage(error));
    })
    .finally(() => {
      syncLocks.delete(userId);
    });

  syncLocks.set(userId, synchronization);
  return synchronization;
}
