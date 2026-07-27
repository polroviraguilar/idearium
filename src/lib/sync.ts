import type { Tables, TablesInsert } from "./database.types";
import type { IdeariumDatabase } from "./db";
import { newId } from "./db";
import { supabase } from "./supabase";
import type {
  Category,
  Note,
  NoteSource,
  NoteStatus,
  SyncMetadata,
  TranscriptionStatus
} from "./types";

type RemoteCategory = Tables<"categories">;
type RemoteNote = Tables<"notes">;
type CategoryInsert = TablesInsert<"categories">;
type NoteInsert = TablesInsert<"notes">;

const PAGE_SIZE = 500;

export interface SyncResult {
  pulledCategories: number;
  pulledNotes: number;
  pushedCategories: number;
  pushedNotes: number;
  deletedCategories: number;
  deletedNotes: number;
  conflictsCreated: number;
}

interface MergeResult {
  pulledCategories: number;
  pulledNotes: number;
  conflictsCreated: number;
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
      const [localCategories, localNotes] = await Promise.all([
        database.categories.toArray(),
        database.notes.toArray()
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
              attachment.deletedAt ??= remoteDeletionTime;
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

  const [remoteCategories, remoteNotes] = await Promise.all([
    fetchRemoteCategories(userId),
    fetchRemoteNotes(userId)
  ]);

  const merged = await mergeRemoteData(
    database,
    userId,
    remoteCategories,
    remoteNotes
  );

  const pushedCategories = await pushCategoryUpserts(database);
  const deletedNotes = await pushNoteDeletions(database, userId);
  const pushedNotes = await pushNoteUpserts(database);
  const deletedCategories = await pushCategoryDeletions(database, userId);

  return {
    ...merged,
    pushedCategories,
    pushedNotes,
    deletedCategories,
    deletedNotes
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