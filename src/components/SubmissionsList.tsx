import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Camera, ChevronLeft, ChevronRight, RefreshCw, X } from "lucide-react";
import { useChecklists } from "@/hooks/useChecklists";
import { fetchSubmissions, type ChecklistKind, type Submission } from "@/lib/api";
import DatePicker from "@/components/DatePicker";

interface Props {
  /** When set, the list is locked to one line and the line filter is hidden. */
  lineId?: string;
}

// How each saved status renders in the detail view.
const STATUS_VIEW: Record<string, { sym: string; cls: string }> = {
  ok: { sym: "✓", cls: "text-emerald-600" },
  good: { sym: "✓", cls: "text-emerald-600" },
  fail: { sym: "✗", cls: "text-red-600 font-bold" },
  X: { sym: "X", cls: "text-amber-600 font-bold" },
  R: { sym: "R", cls: "text-amber-600 font-bold" },
  M: { sym: "M", cls: "text-red-600 font-bold" },
};
const noStatus = { sym: "○", cls: "text-muted-foreground" };

// Shared grid template. On phones: Date/Time · Operator · Faults · Type-pill (the
// count and Line cells are hidden, so the operator name gets room). From sm up the
// Status cell also shows the count and the Line column appears.
const GRID =
  "grid grid-cols-[auto_1fr_auto_auto] sm:grid-cols-[auto_1fr_auto_1fr_auto] items-center gap-2 sm:gap-3";

const PAGE_SIZE = 20;

const SubmissionsList = ({ lineId }: Props) => {
  const { lines } = useChecklists();
  const [rows, setRows] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [photo, setPhoto] = useState<string | null>(null); // defect-photo popup

  // Filters
  const [kind, setKind] = useState<"" | ChecklistKind>("");
  const [operator, setOperator] = useState("");
  const [date, setDate] = useState("");
  const [lineFilter, setLineFilter] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(
        await fetchSubmissions({
          line: lineId ?? (lineFilter || undefined),
          kind: kind || undefined,
          operator: operator.trim() || undefined,
          date: date || undefined,
        })
      );
      setPage(0); // back to the first page whenever the result set changes
    } catch (e) {
      setError(
        e instanceof Error
          ? `${e.message}. Is the backend running? (cd server && npm start)`
          : "Could not load."
      );
    } finally {
      setLoading(false);
    }
  }, [lineId, lineFilter, kind, operator, date]);

  useEffect(() => {
    load();
  }, [load]);

  const controlCls =
    "h-8 rounded-md border border-input bg-card px-2.5 text-xs shadow-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20";

  const clearFilters = () => {
    setKind("");
    setOperator("");
    setDate("");
    setLineFilter("");
  };
  const hasFilters = Boolean(kind || operator.trim() || date || (!lineId && lineFilter));

  // Pagination (20 rows per page).
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const start = safePage * PAGE_SIZE;
  const pageRows = rows.slice(start, start + PAGE_SIZE);

  return (
    <div className="container py-4">
      {/* Filter bar — single compact row */}
      <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-2 shadow-sm">
        {!lineId && (
          <select
            aria-label="Line"
            value={lineFilter}
            onChange={(e) => setLineFilter(e.target.value)}
            className={controlCls}
          >
            <option value="">All lines</option>
            {lines.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        )}
        <select
          aria-label="Type"
          value={kind}
          onChange={(e) => setKind(e.target.value as "" | ChecklistKind)}
          className={controlCls}
        >
          <option value="">All types</option>
          <option value="line">Line checklist</option>
          <option value="safety">Safety guards</option>
        </select>
        <input
          aria-label="Operator"
          value={operator}
          onChange={(e) => setOperator(e.target.value)}
          placeholder="Operator…"
          className={`${controlCls} min-w-0 flex-1 sm:w-40 sm:flex-none`}
        />
        {/* Date: custom calendar popup */}
        <DatePicker value={date} onChange={setDate} />
        <div className="ml-auto flex items-center gap-1.5">
          {hasFilters && (
            <button
              onClick={clearFilters}
              className="flex h-8 items-center gap-1 rounded-md px-2 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" /> Clear
            </button>
          )}
          <button
            onClick={load}
            title="Refresh"
            className="flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-xs font-medium shadow-sm hover:bg-accent"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Refresh</span>
          </button>
        </div>
      </div>

      {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {error && <p className="text-sm font-medium text-destructive">{error}</p>}
      {!loading && !error && rows.length === 0 && (
        <p className="text-sm text-muted-foreground">No matching reports.</p>
      )}

      {/* Excel-style sheet */}
      {!loading && !error && rows.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
          <div className="overflow-x-auto">
            <div className="min-w-[320px]">
          {/* Column headers */}
          <div
            className={`${GRID} border-b border-border bg-secondary/60 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground`}
          >
            <span>Date / Time</span>
            <span>Operator</span>
            <span className="justify-self-center">Faults</span>
            <span className="justify-self-end">Type</span>
            <span className="hidden justify-self-end sm:block">Line</span>
          </div>

          <ul className="divide-y divide-border">
            {pageRows.map((r) => {
              const open = openId === r.id;
              const isSafety = (r.kind || "line") === "safety";
              return (
                <li key={r.id} className={open ? "bg-accent" : "even:bg-muted/40"}>
                  <button
                    onClick={() => setOpenId(open ? null : r.id ?? null)}
                    className={`${GRID} w-full px-3 py-1.5 text-left text-xs transition-colors hover:bg-accent`}
                  >
                    {/* Date / Time — highlighted (wraps to 2 lines on narrow screens) */}
                    <span className="font-medium tabular-nums leading-tight text-foreground">
                      {r.date} <span className="text-muted-foreground">{r.time}</span>
                    </span>
                    {/* Operator — highlighted */}
                    <span className="min-w-0 truncate font-medium text-foreground">{r.operator}</span>
                    {/* Faults — distinct red pill, centered; dash when clean */}
                    <span className="justify-self-center">
                      {r.issues > 0 ? (
                        <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-700">
                          <AlertTriangle className="h-3 w-3 flex-none" />
                          {r.issues}
                        </span>
                      ) : (
                        <span className="text-muted-foreground/40">—</span>
                      )}
                    </span>
                    {/* Type pill (always) + count (sm+ only) */}
                    <span className="flex items-center justify-end gap-2 whitespace-nowrap text-xs text-muted-foreground">
                      <span
                        className={`whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-medium ${
                          isSafety ? "bg-amber-100 text-amber-700" : "bg-indigo-100 text-indigo-700"
                        }`}
                      >
                        <span className="sm:hidden">{isSafety ? "Safety" : "Line"}</span>
                        <span className="hidden sm:inline">
                          {isSafety ? "Safety guards" : "Line checklist"}
                        </span>
                      </span>
                      <span className="hidden tabular-nums sm:inline">
                        {r.completed}/{r.total}
                      </span>
                    </span>
                    {/* Line — faded pill, right — hidden on mobile */}
                    <span className="hidden justify-self-end whitespace-nowrap rounded-full bg-secondary px-2 py-0.5 text-xs text-muted-foreground sm:block">
                      {r.lineName}
                    </span>
                  </button>

                  {open && (
                    <div className="border-t border-border bg-card px-3 py-2.5">
                      {r.fields?.PRODUCT && (
                        <div className="mb-2 text-xs text-muted-foreground">
                          Product: <span className="font-medium text-foreground">{r.fields.PRODUCT}</span>
                        </div>
                      )}
                      <ul className="divide-y divide-border/70">
                        {r.items.map((it) => {
                          const sv = STATUS_VIEW[it.status] ?? noStatus;
                          return (
                            <li
                              key={it.id}
                              className="flex items-start justify-between gap-3 py-1 text-xs"
                            >
                              <span className="flex min-w-0 items-start gap-2">
                                <span className={`w-4 flex-none text-center ${sv.cls}`}>{sv.sym}</span>
                                <span className="min-w-0">
                                  <span className={`uppercase ${it.status ? "" : "text-muted-foreground"}`}>
                                    {it.text}
                                  </span>
                                  {it.comment ? (
                                    <span className="mt-0.5 block text-xs italic text-muted-foreground">
                                      “{it.comment}”
                                    </span>
                                  ) : null}
                                </span>
                              </span>
                              <span className="flex flex-none items-center gap-2">
                                {(it.status === "X" || it.status === "R") && it.photoUrl && (
                                  <button
                                    onClick={() => setPhoto(it.photoUrl!)}
                                    title="View defect photo"
                                    className="flex h-6 w-6 items-center justify-center rounded-md border border-amber-300 bg-amber-50 text-amber-600 hover:bg-amber-100"
                                  >
                                    <Camera className="h-3.5 w-3.5" />
                                  </button>
                                )}
                                {it.value ? (
                                  <span className="rounded-md bg-secondary px-2 py-0.5 text-xs font-semibold tabular-nums text-foreground">
                                    {it.value}
                                  </span>
                                ) : null}
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
            </div>
          </div>
        </div>
      )}

      {!loading && !error && rows.length > PAGE_SIZE && (
        <div className="mt-3 flex items-center justify-between gap-3 text-sm">
          <span className="text-muted-foreground">
            {start + 1}–{Math.min(start + PAGE_SIZE, rows.length)} of {rows.length}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={safePage === 0}
              className="flex items-center gap-1 rounded-md border border-border bg-card px-3 py-1.5 font-medium shadow-sm hover:bg-accent disabled:opacity-40"
            >
              <ChevronLeft className="h-4 w-4" /> Previous
            </button>
            <span className="whitespace-nowrap text-muted-foreground">
              Page {safePage + 1} of {pageCount}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
              disabled={safePage >= pageCount - 1}
              className="flex items-center gap-1 rounded-md border border-border bg-card px-3 py-1.5 font-medium shadow-sm hover:bg-accent disabled:opacity-40"
            >
              Next <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {photo && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-4"
          onClick={() => setPhoto(null)}
        >
          <img
            src={photo}
            alt="Defect photo"
            className="max-h-[85vh] w-auto rounded-lg object-contain shadow-xl"
            onClick={(e) => e.stopPropagation()}
          />
          <button
            onClick={() => setPhoto(null)}
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

export default SubmissionsList;
