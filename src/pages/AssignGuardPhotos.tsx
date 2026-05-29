import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Camera, Check, ImagePlus, Loader2, RefreshCw, Trash2, X } from "lucide-react";
import { useChecklists } from "@/hooks/useChecklists";
import { compressImage } from "@/lib/image";
import {
  deleteGuardPhoto,
  fetchGuardPhotos,
  uploadGuardPhoto,
  type GuardPhoto,
} from "@/lib/api";
import type { ChecklistItem } from "@/data/lines";

// Mobile-friendly reference-photo assignment. Edit mode does this too, but it's
// desktop-only (≥1280px); this page lets someone on the line set the expected
// "reference" photo for each safety guard straight from a phone camera.
const AssignGuardPhotos = () => {
  const { lines } = useChecklists();
  const [lineId, setLineId] = useState("");
  const [operator, setOperator] = useState("");
  const [refPhotos, setRefPhotos] = useState<Record<string, GuardPhoto>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowErr, setRowErr] = useState<{ id: string; msg: string } | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [viewUrl, setViewUrl] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const pickItem = useRef<ChecklistItem | null>(null);

  // Phones (< 768px) capture straight from the camera; tablets/desktop pick a
  // file. Forcing capture everywhere can open a non-existent camera and silently
  // do nothing — this mirrors the operator defect-photo flow in ChecklistForm.
  const [isPhone, setIsPhone] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches
  );
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const onChange = (e: MediaQueryListEvent) => setIsPhone(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  // Default to the first available line so the list isn't empty on open.
  useEffect(() => {
    if (!lineId && lines.length) setLineId(lines[0].id);
  }, [lines, lineId]);

  const line = lines.find((l) => l.id === lineId);
  const items = line?.safety.items ?? [];

  // Pull the current reference photo for each guard on this line (one per guard).
  const load = useCallback(async () => {
    if (!lineId) {
      setRefPhotos({});
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const rows = await fetchGuardPhotos({ line: lineId, kind: "reference" });
      const byItem: Record<string, GuardPhoto> = {};
      for (const r of rows) if (!byItem[r.itemId]) byItem[r.itemId] = r;
      setRefPhotos(byItem);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load photos.");
    } finally {
      setLoading(false);
    }
  }, [lineId]);
  useEffect(() => {
    load();
  }, [load]);

  const pick = (item: ChecklistItem) => {
    setError(null);
    setRowErr(null);
    setSavedId(null);
    pickItem.current = item;
    fileRef.current?.click();
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file
    const item = pickItem.current;
    if (!file || !item || !line) return;
    setBusyId(item.id);
    setRowErr(null);
    setSavedId(null);
    try {
      const image = await compressImage(file);
      // Server keeps at most one reference per guard — this replaces any existing.
      const rec = await uploadGuardPhoto({
        line: line.id,
        itemId: item.id,
        itemText: item.text,
        operator: operator.trim() || "mobile",
        image,
        kind: "reference",
      });
      setRefPhotos((m) => ({ ...m, [item.id]: rec }));
      setSavedId(item.id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not set the reference photo.";
      setRowErr({ id: item.id, msg });
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (item: ChecklistItem) => {
    const cur = refPhotos[item.id];
    if (!cur) return;
    setBusyId(item.id);
    setError(null);
    try {
      await deleteGuardPhoto(cur.id);
      setRefPhotos((m) => {
        const next = { ...m };
        delete next[item.id];
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove the reference photo.");
    } finally {
      setBusyId(null);
    }
  };

  const doneCount = items.filter((it) => refPhotos[it.id]).length;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-10 border-b border-border bg-card/90 backdrop-blur">
        <div className="container flex h-14 items-center gap-2">
          <Link
            to="/"
            className="-ml-2 rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label="Back to lines"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <h1 className="flex items-center gap-1.5 text-base font-semibold tracking-tight">
            <ImagePlus className="h-4 w-4" /> Assign Guard Photos
          </h1>
        </div>
      </header>

      {/* Hidden picker shared by every row. capture= only on phones (rear camera);
          tablets/desktop get a normal file picker. */}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        {...(isPhone ? { capture: "environment" as const } : {})}
        className="hidden"
        onChange={onFile}
      />

      <main className="container py-4">
        <p className="mb-3 text-sm text-muted-foreground">
          Pick a line, then take or choose a <span className="font-medium">reference photo</span> for
          each safety guard. Operators see it read-only when filling the Safety Guards checklist.
        </p>

        {/* Controls */}
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <select
            aria-label="Line"
            value={lineId}
            onChange={(e) => setLineId(e.target.value)}
            className="h-9 rounded-md border border-input bg-card px-2.5 text-sm shadow-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
          >
            {lines.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
          <input
            aria-label="Your name"
            value={operator}
            onChange={(e) => setOperator(e.target.value)}
            placeholder="Your name (optional)"
            className="h-9 w-40 rounded-md border border-input bg-card px-2.5 text-sm shadow-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
          <span className="text-sm text-muted-foreground">
            {doneCount}/{items.length} set
          </span>
          <button
            onClick={load}
            className="ml-auto flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-xs font-medium shadow-sm hover:bg-accent"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </button>
        </div>

        {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {error && <p className="mb-3 text-sm font-medium text-destructive">{error}</p>}
        {!loading && items.length === 0 && (
          <p className="text-sm text-muted-foreground">This line has no safety guards.</p>
        )}

        <div className="space-y-2">
          {items.map((item) => {
            const photo = refPhotos[item.id];
            const busy = busyId === item.id;
            return (
              <section
                key={item.id}
                className="rounded-xl border border-border bg-card p-3 shadow-sm"
              >
              <div className="flex items-center gap-3">
                {/* Thumbnail / placeholder */}
                <button
                  onClick={() => photo && setViewUrl(photo.url)}
                  disabled={!photo}
                  className={`relative flex h-16 w-16 flex-none items-center justify-center overflow-hidden rounded-lg border ${
                    photo ? "border-border" : "border-dashed border-border bg-muted/40"
                  }`}
                  title={photo ? "View reference photo" : "No reference photo yet"}
                >
                  {photo ? (
                    <img src={photo.url} alt={item.text} className="h-full w-full object-cover" />
                  ) : (
                    <Camera className="h-5 w-5 text-muted-foreground" />
                  )}
                </button>

                {/* Label */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 text-sm font-medium leading-tight">
                    {photo && <Check className="h-3.5 w-3.5 flex-none text-green-600" />}
                    <span className="truncate">{item.text}</span>
                  </div>
                  {item.badge && (
                    <span className="mt-1 inline-block rounded bg-secondary px-1.5 py-0.5 text-[10px] font-medium uppercase text-muted-foreground">
                      {item.badge}
                    </span>
                  )}
                </div>

                {/* Actions */}
                <div className="flex flex-none items-center gap-1.5">
                  <button
                    onClick={() => pick(item)}
                    disabled={busy}
                    className="flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground shadow-sm hover:bg-primary/90 disabled:opacity-60"
                  >
                    {busy ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Camera className="h-3.5 w-3.5" />
                    )}
                    {photo ? "Replace" : "Add"}
                  </button>
                  {photo && (
                    <button
                      onClick={() => remove(item)}
                      disabled={busy}
                      title="Remove reference photo"
                      className="flex h-9 w-9 items-center justify-center rounded-md border border-border bg-card text-muted-foreground shadow-sm hover:bg-red-50 hover:text-red-600 disabled:opacity-60"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
              {rowErr?.id === item.id && (
                <p className="mt-2 text-xs font-medium text-destructive">{rowErr.msg}</p>
              )}
              {savedId === item.id && !rowErr && (
                <p className="mt-2 flex items-center gap-1 text-xs font-medium text-green-600">
                  <Check className="h-3.5 w-3.5" /> Saved
                </p>
              )}
              </section>
            );
          })}
        </div>
      </main>

      {viewUrl && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4"
          onClick={() => setViewUrl(null)}
        >
          <img
            src={viewUrl}
            alt=""
            className="max-h-[85vh] w-auto rounded-lg object-contain shadow-xl"
            onClick={(e) => e.stopPropagation()}
          />
          <button
            onClick={() => setViewUrl(null)}
            className="absolute right-4 top-4 rounded-full bg-card/90 p-2 text-foreground shadow-lg hover:bg-card"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      )}
    </div>
  );
};

export default AssignGuardPhotos;
