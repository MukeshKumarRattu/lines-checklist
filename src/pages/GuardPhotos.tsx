import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, BellOff, Camera, RefreshCw, Trash2, X } from "lucide-react";
import { useChecklists } from "@/hooks/useChecklists";
import { useGuardPhotoBadges, type GuardTab } from "@/hooks/useGuardPhotoBadges";
import { deleteGuardPhoto, fetchGuardPhotos, type GuardPhoto } from "@/lib/api";
import ConfirmDialog from "@/components/ConfirmDialog";

const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

type TabId = GuardTab;

// Two views of safety-guard photos, grouped per guard:
//  - Defected Guards: photos operators take after marking a guard X or R.
//  - Reference Photos: the expected look for each guard (set in Edit mode).
const GuardPhotos = () => {
  const { lines } = useChecklists();
  const [tab, setTab] = useState<TabId>("reference");
  const { counts: newCounts, refresh: refreshBadges, markPhotoSeen, markAllSeen, isNew } =
    useGuardPhotoBadges();
  const [lineId, setLineId] = useState("");
  const [rows, setRows] = useState<GuardPhoto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<GuardPhoto | null>(null);
  const [pendingDelete, setPendingDelete] = useState<GuardPhoto | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [delErr, setDelErr] = useState<string | null>(null);

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    setDelErr(null);
    try {
      await deleteGuardPhoto(pendingDelete.id);
      setRows((rs) => rs.filter((r) => r.id !== pendingDelete.id));
      if (lightbox?.id === pendingDelete.id) setLightbox(null);
      setPendingDelete(null);
      refreshBadges(); // keep tab/home counts in sync after a deletion
    } catch (e) {
      setDelErr(e instanceof Error ? e.message : "Delete failed.");
    } finally {
      setDeleting(false);
    }
  };

  const isDefected = tab === "defected";

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchGuardPhotos({
        line: lineId || undefined, // "" = all lines (Defected only)
        kind: tab === "reference" ? "reference" : "defect",
      });
      // Defected Guards only surfaces X (broken) photos; R photos live on the
      // submission instead, and M never has a photo.
      setRows(tab === "defected" ? data.filter((r) => (r.status || "").toUpperCase() === "X") : data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load photos.");
    } finally {
      setLoading(false);
    }
  }, [lineId, tab]);
  useEffect(() => {
    load();
  }, [load]);

  // Reference has no "All lines" option, so it needs a concrete line selected.
  useEffect(() => {
    if (!isDefected && !lineId && lines.length) setLineId(lines[0].id);
  }, [isDefected, lineId, lines]);

  // Opening a photo (lightbox) is what clears its "new" mark — not opening a tab.
  const openPhoto = (p: GuardPhoto) => {
    setLightbox(p);
    markPhotoSeen(p.id);
  };

  // Group by guard; show each guard's photos oldest → newest (before → now).
  const groups = useMemo(() => {
    const map = new Map<string, { line: string; itemId: string; itemText: string; photos: GuardPhoto[] }>();
    for (const r of rows) {
      const key = `${r.line}:${r.itemId}`;
      if (!map.has(key))
        map.set(key, { line: r.line, itemId: r.itemId, itemText: r.itemText || r.itemId, photos: [] });
      map.get(key)!.photos.push(r);
    }
    const arr = Array.from(map.values());
    arr.forEach((g) => g.photos.reverse()); // rows arrive newest-first
    arr.sort(
      (a, b) =>
        a.line.localeCompare(b.line, undefined, { numeric: true }) ||
        a.itemText.localeCompare(b.itemText)
    );
    return arr;
  }, [rows]);

  const lineNameOf = (id: string) => lines.find((l) => l.id === id)?.name ?? `Line ${id}`;
  const lineName = lineId ? lineNameOf(lineId) : "all lines";

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
            <Camera className="h-4 w-4" /> Guard Photos
          </h1>
        </div>
        <div className="container flex gap-1">
          {([
            { id: "reference" as const, label: "Reference Photos" },
            { id: "defected" as const, label: "Defected Guards" },
          ]).map((t) => (
            <button
              key={t.id}
              onClick={() => {
                setTab(t.id);
                // Defected defaults to "All lines"; Reference's effect picks a line.
                if (t.id === "defected") setLineId("");
              }}
              className={`flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
                tab === t.id
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {t.label}
              {newCounts[t.id] > 0 && (
                <span
                  title={`${newCounts[t.id]} new`}
                  className="inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold leading-none text-white"
                >
                  {newCounts[t.id]}
                </span>
              )}
            </button>
          ))}
        </div>
      </header>

      <main className="container py-4">
        {/* Filter bar */}
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <select
            aria-label="Line"
            value={lineId}
            onChange={(e) => setLineId(e.target.value)}
            className="h-9 rounded-md border border-input bg-card px-2.5 text-sm shadow-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
          >
            {/* "All lines" only on Defected Guards; Reference picks a specific line. */}
            {isDefected && <option value="">All lines</option>}
            {lines.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
          <span className="text-sm text-muted-foreground">
            {rows.length} photo{rows.length === 1 ? "" : "s"} · {groups.length} guard
            {groups.length === 1 ? "" : "s"}
          </span>
          <button
            onClick={() => {
              markAllSeen(tab); // clear only the tab you're looking at
              load();
              refreshBadges();
            }}
            disabled={newCounts[tab] === 0}
            title={
              newCounts[tab] === 0
                ? `No new ${isDefected ? "defect" : "reference"} notifications`
                : `Clear ${newCounts[tab]} new ${isDefected ? "defect" : "reference"} notification${
                    newCounts[tab] === 1 ? "" : "s"
                  }`
            }
            className="ml-auto flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-xs font-medium shadow-sm hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
          >
            <BellOff className="h-3.5 w-3.5" /> Clear {isDefected ? "Defects" : "Reference"}
            {newCounts[tab] > 0 ? ` (${newCounts[tab]})` : ""}
          </button>
          <button
            onClick={() => {
              load();
              refreshBadges();
            }}
            className="flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-xs font-medium shadow-sm hover:bg-accent"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </button>
        </div>

        {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {error && <p className="text-sm font-medium text-destructive">{error}</p>}
        {!loading && !error && rows.length === 0 && (
          <p className="text-sm text-muted-foreground">
            {isDefected
              ? `No defect photos for ${lineName} yet. Photos operators take after marking a guard X or R appear here.`
              : `No reference photos for ${lineName} yet. Set them per guard in Edit mode → Safety Guards.`}
          </p>
        )}

        <div className="space-y-5">
          {groups.map((g) => (
            <section key={`${g.line}:${g.itemId}`} className="rounded-xl border border-border bg-card p-3 shadow-sm">
              <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold uppercase tracking-tight">
                <span className="flex-none rounded bg-secondary px-1.5 py-0.5 text-[11px] font-medium normal-case text-muted-foreground">
                  {lineNameOf(g.line)}
                </span>
                {g.itemText}
              </h2>
              <div className="flex gap-3 overflow-x-auto pb-1">
                {g.photos.map((p, i) => (
                  <div key={p.id} className="relative w-28 flex-none">
                    <button
                      onClick={() => openPhoto(p)}
                      className={`group flex w-full flex-col overflow-hidden rounded-lg border bg-background text-left shadow-sm transition-colors hover:border-primary/50 ${
                        isNew(p.id) ? "border-red-400 ring-2 ring-red-400/40" : "border-border"
                      }`}
                    >
                      <div className="relative">
                        <img
                          src={p.url}
                          alt={g.itemText}
                          loading="lazy"
                          className="h-28 w-full object-cover"
                        />
                        {isDefected && p.status && (
                          <span className="absolute left-1 top-1 flex h-5 min-w-[1.25rem] items-center justify-center rounded bg-amber-500 px-1 text-[11px] font-bold text-white shadow">
                            {p.status}
                          </span>
                        )}
                        {isNew(p.id) && (
                          <span className="absolute bottom-1 left-1 rounded bg-red-500 px-1 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white shadow">
                            New
                          </span>
                        )}
                      </div>
                      <div className="px-2 py-1.5">
                        <div className="text-[10px] font-medium text-muted-foreground">
                          {isDefected ? `Defect${g.photos.length > 1 ? ` #${i + 1}` : ""}` : "Reference"}
                        </div>
                        <div className="mt-0.5 text-[11px] font-medium leading-tight">
                          {fmtDateTime(p.uploadedAt)}
                        </div>
                        <div className="truncate text-[11px] text-muted-foreground">
                          {p.operator || "—"}
                        </div>
                      </div>
                    </button>
                    {isDefected && (
                      <button
                        onClick={() => {
                          setDelErr(null);
                          setPendingDelete(p);
                        }}
                        title="Delete photo"
                        className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-md bg-card/90 text-muted-foreground shadow hover:bg-red-50 hover:text-red-600"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      </main>

      {lightbox && (
        <div
          className="fixed inset-0 z-[70] flex flex-col items-center justify-center gap-3 bg-black/70 p-4"
          onClick={() => setLightbox(null)}
        >
          <img
            src={lightbox.url}
            alt=""
            className="max-h-[80vh] w-auto rounded-lg object-contain shadow-xl"
            onClick={(e) => e.stopPropagation()}
          />
          <div
            className="flex flex-col items-center gap-2 rounded-md bg-card px-3 py-2 text-center text-xs shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div>
              <div className="font-semibold uppercase">
                {isDefected && lightbox.status ? (
                  <span className="mr-1.5 rounded bg-amber-500 px-1.5 py-0.5 text-[11px] text-white">
                    {lightbox.status}
                  </span>
                ) : null}
                {lightbox.itemText}
              </div>
              <div className="text-muted-foreground">
                {isDefected ? "Defect" : "Reference"} · {lineNameOf(lightbox.line)} ·{" "}
                {fmtDateTime(lightbox.uploadedAt)} · {lightbox.operator || "—"}
              </div>
            </div>
            {isDefected && (
              <button
                onClick={() => {
                  const p = lightbox;
                  setLightbox(null);
                  setDelErr(null);
                  setPendingDelete(p);
                }}
                className="inline-flex items-center gap-1.5 rounded-md bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700"
              >
                <Trash2 className="h-3.5 w-3.5" /> Delete photo
              </button>
            )}
          </div>
          <button
            onClick={() => setLightbox(null)}
            className="absolute right-4 top-4 rounded-full bg-card/90 p-2 text-foreground shadow-lg hover:bg-card"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      )}

      {pendingDelete && (
        <ConfirmDialog
          title="Delete this photo?"
          message={`This permanently removes the ${fmtDateTime(pendingDelete.uploadedAt)} photo of “${
            pendingDelete.itemText || "this guard"
          }”${pendingDelete.operator ? ` (by ${pendingDelete.operator})` : ""}. This cannot be undone.`}
          confirmLabel="Delete"
          busy={deleting}
          error={delErr}
          onCancel={() => setPendingDelete(null)}
          onConfirm={confirmDelete}
        />
      )}
    </div>
  );
};

export default GuardPhotos;
