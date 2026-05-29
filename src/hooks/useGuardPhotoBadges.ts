import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchGuardPhotos } from "@/lib/api";

// Per-photo "new" notifications, shared by the Guard Photos page (badges + a
// dot on each new thumbnail) and the home screen (one count on the button).
// A photo is "new" until the user actually opens it once; we remember the ids
// they've opened in localStorage, so opening a tab does NOT clear anything —
// only clicking the image does.
export type GuardTab = "defected" | "reference";
const SEEN_KEY = "lines-checklist:guardphotos:seenIds";

const readSeen = (): Set<string> => {
  try {
    return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || "[]"));
  } catch {
    return new Set();
  }
};

export function useGuardPhotoBadges() {
  const [refIds, setRefIds] = useState<string[]>([]);
  const [defIds, setDefIds] = useState<string[]>([]); // X defects only (what the tab shows)
  const [seen, setSeen] = useState<Set<string>>(() => readSeen());

  const refresh = useCallback(async () => {
    try {
      const [refs, defs] = await Promise.all([
        fetchGuardPhotos({ kind: "reference" }),
        fetchGuardPhotos({ kind: "defect" }),
      ]);
      setRefIds(refs.map((r) => r.id));
      setDefIds(defs.filter((r) => (r.status || "").toUpperCase() === "X").map((r) => r.id));
    } catch {
      /* badges are best-effort */
    }
  }, []);
  useEffect(() => {
    refresh();
  }, [refresh]);

  // Keep in sync if another tab/page marks a photo seen (localStorage change).
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === SEEN_KEY) setSeen(readSeen());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const counts = useMemo(
    () => ({
      reference: refIds.filter((id) => !seen.has(id)).length,
      defected: defIds.filter((id) => !seen.has(id)).length,
    }),
    [refIds, defIds, seen]
  );

  const markPhotoSeen = useCallback((id: string) => {
    setSeen((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev).add(id);
      try {
        localStorage.setItem(SEEN_KEY, JSON.stringify([...next]));
      } catch {
        /* ignore quota errors */
      }
      return next;
    });
  }, []);

  // Clear notifications at once. Pass a tab to clear only that kind ("reference"
  // or "defected"); omit it to clear both.
  const markAllSeen = useCallback(
    (which?: GuardTab) => {
      setSeen((prev) => {
        const next = new Set(prev);
        if (which !== "defected") for (const id of refIds) next.add(id);
        if (which !== "reference") for (const id of defIds) next.add(id);
        try {
          localStorage.setItem(SEEN_KEY, JSON.stringify([...next]));
        } catch {
          /* ignore quota errors */
        }
        return next;
      });
    },
    [refIds, defIds]
  );

  const isNew = useCallback((id: string) => !seen.has(id), [seen]);

  return { counts, total: counts.reference + counts.defected, refresh, markPhotoSeen, markAllSeen, isNew };
}
