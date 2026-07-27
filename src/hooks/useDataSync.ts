import { useCallback, useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import type { IdeariumDatabase } from "../lib/db";
import { synchronizeUserData, type SyncResult } from "../lib/sync";

export type DataSyncState =
  | "idle"
  | "syncing"
  | "synced"
  | "offline"
  | "error";

interface UseDataSyncOptions {
  database: IdeariumDatabase;
  userId: string;
  enabled: boolean;
}

interface UseDataSyncResult {
  state: DataSyncState;
  pendingCount: number;
  error: string;
  lastResult?: SyncResult;
  lastSyncedAt?: number;
  syncNow: () => Promise<void>;
}

export function useDataSync({
  database,
  userId,
  enabled
}: UseDataSyncOptions): UseDataSyncResult {
  const [state, setState] = useState<DataSyncState>(() =>
    navigator.onLine ? "idle" : "offline"
  );
  const [error, setError] = useState("");
  const [lastResult, setLastResult] = useState<SyncResult>();
  const [lastSyncedAt, setLastSyncedAt] = useState<number>();

  const pendingCount =
    useLiveQuery(
      async () => {
        if (!enabled) return 0;

        const [categories, notes, attachments] = await Promise.all([
          database.categories
            .where("syncStatus")
            .anyOf("pending", "error", "syncing")
            .count(),
          database.notes
            .where("syncStatus")
            .anyOf("pending", "error", "syncing")
            .count(),
          database.attachments
            .where("syncStatus")
            .anyOf("pending", "error", "syncing")
            .count()
        ]);

        return categories + notes + attachments;
      },
      [database, enabled],
      0
    ) ?? 0;

  const syncNow = useCallback(async () => {
    if (!enabled) return;

    if (!navigator.onLine) {
      setState("offline");
      return;
    }

    setState("syncing");
    setError("");

    try {
      const result = await synchronizeUserData(database, userId);
      setLastResult(result);
      setLastSyncedAt(Date.now());
      setState("synced");
    } catch (caught) {
      const message =
        caught instanceof Error
          ? caught.message
          : "No s'ha pogut sincronitzar Idearium.";

      setError(message);
      setState(navigator.onLine ? "error" : "offline");
    }
  }, [database, enabled, userId]);

  useEffect(() => {
    if (!enabled) return;

    const timeout = window.setTimeout(() => {
      void syncNow();
    }, 250);

    return () => window.clearTimeout(timeout);
  }, [enabled, syncNow]);

  useEffect(() => {
    if (!enabled || pendingCount === 0) return;

    const timeout = window.setTimeout(() => {
      void syncNow();
    }, 1200);

    return () => window.clearTimeout(timeout);
  }, [enabled, pendingCount, syncNow]);

  useEffect(() => {
    if (!enabled) return;

    const handleOnline = () => {
      void syncNow();
    };

    const handleOffline = () => {
      setState("offline");
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [enabled, syncNow]);

  useEffect(() => {
    if (!enabled) return;

    const interval = window.setInterval(() => {
      void syncNow();
    }, 60_000);

    return () => window.clearInterval(interval);
  }, [enabled, syncNow]);

  return {
    state,
    pendingCount,
    error,
    lastResult,
    lastSyncedAt,
    syncNow
  };
}
