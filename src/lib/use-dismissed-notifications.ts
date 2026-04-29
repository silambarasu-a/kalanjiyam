"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Per-user, per-browser dismissal of notification items. Backed by
 * localStorage. Keys are `${id}|${dueDate}` so a dismissal naturally
 * "expires" when the underlying entity's dueDate advances (e.g. a loan EMI
 * dismissed for January will resurface when February's nextDueDate ticks
 * over).
 *
 * Pure client state — no server round-trip. The bell is informational, not
 * a system of record; what matters is that the underlying loan/reminder/
 * lease still exists in its own page.
 */
const STORAGE_KEY = "kalanjiyam:notifications:dismissed";

type DismissedMap = Record<string, true>;

function readStore(): DismissedMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as DismissedMap) : {};
  } catch {
    return {};
  }
}

function writeStore(next: DismissedMap) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // ignore quota / private-mode failures
  }
}

export function dismissalKey(id: string, dueDate: string): string {
  return `${id}|${dueDate}`;
}

export function useDismissedNotifications() {
  const [store, setStore] = useState<DismissedMap>({});

  // Hydrate from localStorage after mount to avoid SSR mismatch.
  useEffect(() => {
    setStore(readStore());
  }, []);

  // Stay in sync with other tabs.
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key !== STORAGE_KEY) return;
      setStore(readStore());
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const isDismissed = useCallback(
    (id: string, dueDate: string) => store[dismissalKey(id, dueDate)] === true,
    [store],
  );

  const dismiss = useCallback((id: string, dueDate: string) => {
    setStore((prev) => {
      const next = { ...prev, [dismissalKey(id, dueDate)]: true as const };
      writeStore(next);
      return next;
    });
  }, []);

  const dismissMany = useCallback(
    (entries: { id: string; dueDate: string }[]) => {
      setStore((prev) => {
        const next: DismissedMap = { ...prev };
        for (const e of entries) next[dismissalKey(e.id, e.dueDate)] = true;
        writeStore(next);
        return next;
      });
    },
    [],
  );

  const undismiss = useCallback((id: string, dueDate: string) => {
    setStore((prev) => {
      const next = { ...prev };
      delete next[dismissalKey(id, dueDate)];
      writeStore(next);
      return next;
    });
  }, []);

  const clearAll = useCallback(() => {
    setStore({});
    writeStore({});
  }, []);

  return { isDismissed, dismiss, dismissMany, undismiss, clearAll };
}
