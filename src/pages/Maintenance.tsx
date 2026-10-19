import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Check, Droplets, Loader2, RefreshCw, RotateCcw, ShieldAlert, Wrench, X } from "lucide-react";
import { useChecklists } from "@/hooks/useChecklists";
import {
  fetchMaintenanceTickets,
  updateMaintenanceTicket,
  type MaintenanceTicket,
  type TicketStatus,
} from "@/lib/api";

const when = (iso?: string) =>
  iso
    ? new Date(iso).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "";

// Maintenance tickets raised from the checklists: water on floor not fixed,
// broken guards and guards that need replacing (with the guard as location).
// Maintenance closes a ticket once it's fixed, saying who fixed it.
const Maintenance = () => {
  const { lines } = useChecklists();
  const [tab, setTab] = useState<TicketStatus>("open");
  const [lineId, setLineId] = useState("");
  const [rows, setRows] = useState<MaintenanceTicket[]>([]);
  const [counts, setCounts] = useState<Record<TicketStatus, number>>({ open: 0, closed: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const [closingId, setClosingId] = useState<string | null>(null);
  const [closedBy, setClosedBy] = useState("");
  const [closeNote, setCloseNote] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const all = await fetchMaintenanceTickets(lineId ? { line: lineId } : {});
      setCounts({
        open: all.filter((t) => t.status === "open").length,
        closed: all.filter((t) => t.status === "closed").length,
      });
      setRows(all.filter((t) => t.status === tab));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load tickets.");
    } finally {
      setLoading(false);
    }
  }, [tab, lineId]);
  useEffect(() => {
    load();
  }, [load]);

  const startClose = (id: string) => {
    setClosingId(id);
    setClosedBy("");
    setCloseNote("");
    setError(null);
  };
  const close = async (id: string) => {
    if (!closedBy.trim()) {
      setError("Enter who fixed it.");
      return;
    }
    setBusyId(id);
    try {
      await updateMaintenanceTicket(id, { status: "closed", closedBy: closedBy.trim(), closeNote: closeNote.trim() });
      setClosingId(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not close the ticket.");
    } finally {
      setBusyId(null);
    }
  };
  const reopen = async (id: string) => {
    setBusyId(id);
    try {
      await updateMaintenanceTicket(id, { status: "open" });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not reopen the ticket.");
    } finally {
      setBusyId(null);
    }
  };

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
            <Wrench className="h-4 w-4" /> Maintenance
          </h1>
        </div>
        <div className="container flex gap-1">
          {([
            { id: "open" as const, label: "Open" },
            { id: "closed" as const, label: "Fixed" },
          ]).map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
                tab === t.id
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {t.label}
              {counts[t.id] > 0 && (
                <span
                  className={`inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full px-1 text-[10px] font-bold leading-none ${
                    t.id === "open" ? "bg-red-500 text-white" : "bg-secondary text-muted-foreground"
                  }`}
                >
                  {counts[t.id]}
                </span>
              )}
            </button>
          ))}
        </div>
      </header>

      <main className="container py-4">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <select
            aria-label="Line"
            value={lineId}
            onChange={(e) => setLineId(e.target.value)}
            className="h-9 rounded-md border border-input bg-card px-2.5 text-sm shadow-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
          >
            <option value="">All lines</option>
            {lines.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
          <span className="text-sm text-muted-foreground">
            {rows.length} ticket{rows.length === 1 ? "" : "s"}
          </span>
          <button
            onClick={load}
            className="ml-auto flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-sm font-medium shadow-sm hover:bg-accent"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </button>
        </div>

        {error && <p className="mb-3 text-sm font-medium text-destructive">{error}</p>}

        {loading ? (
          <div className="flex justify-center py-12 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : rows.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            {tab === "open" ? "No open tickets." : "No fixed tickets yet."}
          </p>
        ) : (
          <ul className="space-y-2">
            {rows.map((t) => (
              <li
                key={t.id}
                className={`overflow-hidden rounded-lg border shadow-sm ${
                  t.status === "open" ? "border-red-500/40 bg-card" : "border-border bg-card"
                }`}
              >
                <div className="flex gap-3 p-3">
                  {t.photoUrl && (
                    <button onClick={() => setPhoto(t.photoUrl!)} className="flex-none" title="View photo">
                      <img
                        src={t.photoUrl}
                        alt={t.issue}
                        className="h-20 w-20 rounded-md border border-border object-cover"
                      />
                    </button>
                  )}
                  <div className="min-w-0 flex-1 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="flex items-center gap-1 font-semibold">
                        {t.location ? (
                          <ShieldAlert className="h-4 w-4 text-amber-600" />
                        ) : (
                          <Droplets className="h-4 w-4 text-sky-600" />
                        )}{" "}
                        {t.issue || "Issue"}
                      </span>
                      <span className="rounded-full bg-secondary px-2 py-0.5 text-xs text-muted-foreground">
                        {t.lineName}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {when(t.createdAt)} · {t.operator}
                      </span>
                    </div>
                    {t.location && (
                      <p className="mt-1">
                        <span className="font-semibold">Location:</span> {t.lineName} · {t.location}
                      </p>
                    )}
                    {t.source && (
                      <p className="mt-1">
                        <span className="font-semibold">Source:</span> {t.source}
                      </p>
                    )}
                    {t.attempted && (
                      <p>
                        <span className="font-semibold">{t.location ? "Note:" : "Attempted / by whom:"}</span> {t.attempted}
                      </p>
                    )}
                    {t.status === "closed" && (
                      <p className="mt-1 flex items-start gap-1.5 text-emerald-700">
                        <Check className="mt-0.5 h-4 w-4 flex-none" />
                        <span>
                          Fixed by <span className="font-semibold">{t.closedBy}</span> · {when(t.closedAt)}
                          {t.closeNote ? ` — ${t.closeNote}` : ""}
                        </span>
                      </p>
                    )}
                  </div>
                  <div className="flex flex-none items-start">
                    {t.status === "open" ? (
                      closingId !== t.id && (
                        <button
                          onClick={() => startClose(t.id)}
                          className="flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-emerald-700"
                        >
                          <Check className="h-3.5 w-3.5" /> Mark fixed
                        </button>
                      )
                    ) : (
                      <button
                        onClick={() => reopen(t.id)}
                        disabled={busyId === t.id}
                        className="flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium hover:bg-accent disabled:opacity-50"
                      >
                        <RotateCcw className="h-3.5 w-3.5" /> Reopen
                      </button>
                    )}
                  </div>
                </div>
                {closingId === t.id && (
                  <div className="flex flex-col gap-2 border-t border-border bg-muted/30 p-3 sm:flex-row sm:items-center">
                    <input
                      autoFocus
                      value={closedBy}
                      onChange={(e) => setClosedBy(e.target.value)}
                      placeholder="Fixed by (name) *"
                      className="h-9 rounded-md border border-input bg-card px-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 sm:w-48"
                    />
                    <input
                      value={closeNote}
                      onChange={(e) => setCloseNote(e.target.value)}
                      placeholder="What was done (optional)"
                      className="h-9 flex-1 rounded-md border border-input bg-card px-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => setClosingId(null)}
                        className="rounded-md border border-border bg-card px-3 py-2 text-sm font-medium hover:bg-accent"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => close(t.id)}
                        disabled={busyId === t.id}
                        className="flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                      >
                        {busyId === t.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                        Save
                      </button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </main>

      {photo && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4" onClick={() => setPhoto(null)}>
          <img src={photo} alt="Ticket photo" className="max-h-[90vh] max-w-full rounded-lg object-contain" />
          <button
            onClick={() => setPhoto(null)}
            className="absolute right-4 top-4 rounded-full bg-black/60 p-2 text-white"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      )}
    </div>
  );
};

export default Maintenance;
