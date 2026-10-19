import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  AlertTriangle,
  ArrowLeft,
  BarChart3,
  Check,
  FileText,
  Loader2,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  UserX,
  X,
} from "lucide-react";
import { useChecklists } from "@/hooks/useChecklists";
import {
  fetchInvestigations,
  fetchMaintenanceTickets,
  fetchSubmissions,
  updateInvestigation,
  type Investigation,
  type MaintenanceTicket,
  type Submission,
} from "@/lib/api";
import { WALK_LINES_PER_SHIFT, shiftOf, submissionTime } from "@/lib/followups";
import ShiftReport from "@/pages/ShiftReport";

// Everything in one place for a date range: walk-round compliance (2 lines per
// shift), investigations incl. fake logs (closable here), who did what, and a
// timeline of every checklist, ticket and investigation.

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fmt = (t: number | string | undefined) =>
  t === undefined
    ? ""
    : new Date(t).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

const KIND_LABEL: Record<string, string> = {
  line: "Line checklist",
  safety: "Safety guards",
  supervisor: "Supervisor walk-round",
};

interface Person {
  name: string;
  roles: Set<string>;
  line: number;
  safety: number;
  walks: number;
  issues: number;
  ticketsRaised: number;
  ticketsFixed: number;
  flagged: number; // fake-log flags against them
}

interface Event {
  at: number;
  who: string;
  what: string;
  where: string;
  tone: "neutral" | "warn" | "bad" | "good";
}

const Summary = () => {
  const { lines } = useChecklists();
  // Tabs: Overview (this page) | Daily report (the one-page 07:00 → 07:00 report).
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "report" ? "report" : "overview";
  const today = new Date();
  const weekAgo = new Date(today);
  weekAgo.setDate(weekAgo.getDate() - 6);
  const [from, setFrom] = useState(ymd(weekAgo));
  const [to, setTo] = useState(ymd(today));
  const [lineId, setLineId] = useState("");
  const [subs, setSubs] = useState<Submission[]>([]);
  const [tickets, setTickets] = useState<MaintenanceTicket[]>([]);
  const [invs, setInvs] = useState<Investigation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [closingId, setClosingId] = useState<string | null>(null);
  const [closedBy, setClosedBy] = useState("");
  const [outcome, setOutcome] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [eventLimit, setEventLimit] = useState(100);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [s, t, i] = await Promise.all([fetchSubmissions(), fetchMaintenanceTickets(), fetchInvestigations()]);
      setSubs(s);
      setTickets(t);
      setInvs(i);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const start = Date.parse(`${from}T00:00`);
  const end = Date.parse(`${to}T23:59:59`);
  const inRange = (t: number) => t >= start && t <= end;
  const onLine = (line: string) => !lineId || String(line).split(",").includes(lineId);

  const S = useMemo(() => subs.filter((s) => inRange(submissionTime(s)) && onLine(s.line)), [subs, from, to, lineId]); // eslint-disable-line react-hooks/exhaustive-deps
  const T = useMemo(() => tickets.filter((t) => inRange(Date.parse(t.createdAt)) && onLine(t.line)), [tickets, from, to, lineId]); // eslint-disable-line react-hooks/exhaustive-deps
  const I = useMemo(() => invs.filter((i) => inRange(Date.parse(i.createdAt)) && onLine(i.line)), [invs, from, to, lineId]); // eslint-disable-line react-hooks/exhaustive-deps

  const count = (k: string) => S.filter((s) => (s.kind || "line") === k).length;
  const fakeLogs = I.filter((i) => i.type === "fake-log");

  // --- walk-round compliance per shift -----------------------------------------------
  const compliance = useMemo(() => {
    const walked: Record<string, Set<string>> = {};
    const who: Record<string, Set<string>> = {};
    for (const s of subs) {
      if (s.kind !== "supervisor") continue;
      const k = shiftOf(submissionTime(s)).key;
      walked[k] ??= new Set();
      who[k] ??= new Set();
      String(s.line).split(",").forEach((id) => walked[k].add(id));
      who[k].add(s.operator);
    }
    const rows: { day: string; shift: "day" | "night"; lines: string[]; who: string[]; future: boolean; current: boolean }[] = [];
    const nowKey = shiftOf(Date.now());
    for (let d = new Date(`${to}T12:00`); d >= new Date(`${from}T12:00`); d.setDate(d.getDate() - 1)) {
      const day = ymd(d);
      for (const shift of ["night", "day"] as const) {
        const k = `${day}|${shift}`;
        const future = day > nowKey.day || (day === nowKey.day && shift === "night" && nowKey.shift === "day");
        rows.push({
          day,
          shift,
          lines: [...(walked[k] ?? [])].map((id) => lines.find((l) => l.id === id)?.name ?? `Line ${id}`),
          who: [...(who[k] ?? [])],
          future,
          current: k === nowKey.key,
        });
      }
    }
    return rows;
  }, [subs, from, to, lines]);
  const missedShifts = compliance.filter((r) => !r.future && !r.current && r.lines.length < WALK_LINES_PER_SHIFT).length;

  // --- people ------------------------------------------------------------------------
  const people = useMemo(() => {
    const map = new Map<string, Person>();
    const get = (name: string) => {
      const key = name.trim().toLowerCase();
      if (!key) return null;
      if (!map.has(key))
        map.set(key, {
          name: name.trim(),
          roles: new Set(),
          line: 0,
          safety: 0,
          walks: 0,
          issues: 0,
          ticketsRaised: 0,
          ticketsFixed: 0,
          flagged: 0,
        });
      return map.get(key)!;
    };
    for (const s of S) {
      const p = get(s.operator);
      if (!p) continue;
      const k = s.kind || "line";
      if (k === "supervisor") {
        p.walks++;
        p.roles.add("Supervisor");
      } else {
        if (k === "line") p.line++;
        else p.safety++;
        p.roles.add("Operator");
      }
      p.issues += s.issues || 0;
    }
    for (const t of T) {
      const p = get(t.operator);
      if (p) p.ticketsRaised++;
    }
    for (const t of tickets) {
      if (t.status === "closed" && t.closedBy && t.closedAt && inRange(Date.parse(t.closedAt)) && onLine(t.line)) {
        const p = get(t.closedBy);
        if (p) {
          p.ticketsFixed++;
          p.roles.add("Maintenance");
        }
      }
    }
    for (const i of fakeLogs) {
      const p = i.operator ? get(i.operator) : null;
      if (p) p.flagged++;
    }
    return [...map.values()].sort((a, b) => b.flagged - a.flagged || a.name.localeCompare(b.name));
  }, [S, T, tickets, fakeLogs]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- timeline ---------------------------------------------------------------------
  const events = useMemo(() => {
    const ev: Event[] = [];
    for (const s of S)
      ev.push({
        at: submissionTime(s),
        who: s.operator,
        what: `${KIND_LABEL[s.kind || "line"]} submitted · ${s.completed}/${s.total} marked${
          s.issues ? ` · ${s.issues} issue${s.issues > 1 ? "s" : ""}` : ""
        }`,
        where: s.lineName,
        tone: s.issues ? "warn" : "neutral",
      });
    for (const t of T)
      ev.push({
        at: Date.parse(t.createdAt),
        who: t.operator,
        what: `Maintenance ticket: ${t.issue}${t.location ? ` — ${t.location}` : ""}`,
        where: t.lineName,
        tone: "warn",
      });
    for (const t of tickets)
      if (t.closedAt && inRange(Date.parse(t.closedAt)) && onLine(t.line))
        ev.push({
          at: Date.parse(t.closedAt),
          who: t.closedBy || "",
          what: `Fixed: ${t.issue}${t.location ? ` — ${t.location}` : ""}${t.closeNote ? ` (${t.closeNote})` : ""}`,
          where: t.lineName,
          tone: "good",
        });
    for (const i of I)
      ev.push({
        at: Date.parse(i.createdAt),
        who: i.foundBy,
        what:
          i.type === "fake-log"
            ? `Possible fake log by ${i.operator}: ${i.location} ticked Good, found ${i.finding}`
            : `Investigation: ${i.location} ${i.finding}, not corrected`,
        where: i.lineName,
        tone: "bad",
      });
    for (const i of invs)
      if (i.closedAt && inRange(Date.parse(i.closedAt)) && onLine(i.line))
        ev.push({
          at: Date.parse(i.closedAt),
          who: i.closedBy || "",
          what: `Investigation closed: ${i.location}${i.outcome ? ` — ${i.outcome}` : ""}`,
          where: i.lineName,
          tone: "good",
        });
    return ev.sort((a, b) => b.at - a.at);
  }, [S, T, I, tickets, invs]); // eslint-disable-line react-hooks/exhaustive-deps

  const closeInv = async (id: string) => {
    if (!closedBy.trim()) {
      setError("Enter who investigated it.");
      return;
    }
    setBusyId(id);
    try {
      await updateInvestigation(id, { status: "closed", closedBy: closedBy.trim(), outcome: outcome.trim() });
      setClosingId(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not close.");
    } finally {
      setBusyId(null);
    }
  };
  const reopenInv = async (id: string) => {
    setBusyId(id);
    try {
      await updateInvestigation(id, { status: "open" });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not reopen.");
    } finally {
      setBusyId(null);
    }
  };

  const tile = (label: string, value: number, tone: "neutral" | "bad" = "neutral") => (
    <div
      className={`rounded-lg border p-3 shadow-sm ${
        tone === "bad" && value > 0 ? "border-red-300 bg-red-50" : "border-border bg-card"
      }`}
    >
      <div className={`text-2xl font-bold tabular-nums ${tone === "bad" && value > 0 ? "text-red-700" : ""}`}>{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
  const ctl =
    "h-9 rounded-md border border-input bg-card px-2.5 text-sm shadow-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20";
  const openInvs = I.filter((i) => i.status === "open");

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-10 border-b border-border bg-card/90 backdrop-blur print:hidden">
        <div className="container flex h-14 items-center gap-2">
          <Link
            to="/"
            className="-ml-2 rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label="Back to lines"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <h1 className="flex items-center gap-1.5 text-base font-semibold tracking-tight">
            <BarChart3 className="h-4 w-4" /> Summary
          </h1>
        </div>
        <div className="container flex gap-1">
          {([
            { id: "overview", label: "Overview", icon: BarChart3 },
            { id: "report", label: "Daily report", icon: FileText },
          ] as const).map((t) => (
            <button
              key={t.id}
              onClick={() => setParams(t.id === "overview" ? {} : { tab: t.id })}
              className={`flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
                tab === t.id ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <t.icon className="h-3.5 w-3.5" /> {t.label}
            </button>
          ))}
        </div>
      </header>

      {tab === "report" ? (
        <ShiftReport embedded />
      ) : (

      <main className="container space-y-6 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            From <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className={ctl} />
          </label>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            To <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className={ctl} />
          </label>
          <select aria-label="Line" value={lineId} onChange={(e) => setLineId(e.target.value)} className={ctl}>
            <option value="">All lines</option>
            {lines.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
          <button
            onClick={() => void load()}
            className="ml-auto flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-sm font-medium shadow-sm hover:bg-accent"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </button>
        </div>

        {error && <p className="text-sm font-medium text-destructive">{error}</p>}
        {loading ? (
          <div className="flex justify-center py-12 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : (
          <>
            <section className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              {tile("Line checklists", count("line"))}
              {tile("Safety guard checks", count("safety"))}
              {tile("Supervisor walk-rounds", count("supervisor"))}
              {tile("Walk-round shifts missed", missedShifts, "bad")}
              {tile("Open investigations", openInvs.length, "bad")}
              {tile("Possible fake logs", fakeLogs.length, "bad")}
            </section>

            {/* Investigations */}
            <section>
              <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
                <ShieldAlert className="h-4 w-4 text-red-600" /> Investigations
                <span className="font-normal text-muted-foreground">
                  ({openInvs.length} open · {I.length - openInvs.length} closed)
                </span>
              </h2>
              {I.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing flagged in this period.</p>
              ) : (
                <ul className="space-y-2">
                  {I.map((i) => (
                    <li
                      key={i.id}
                      className={`overflow-hidden rounded-lg border bg-card shadow-sm ${
                        i.status === "open" ? "border-red-400/60" : "border-border opacity-80"
                      }`}
                    >
                      <div className="flex gap-3 p-3">
                        {i.photoUrl && (
                          <a href={i.photoUrl} target="_blank" rel="noreferrer" className="flex-none">
                            <img src={i.photoUrl} alt="" className="h-16 w-16 rounded-md border border-border object-cover" />
                          </a>
                        )}
                        <div className="min-w-0 flex-1 text-sm">
                          <div className="flex flex-wrap items-center gap-2">
                            <span
                              className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-bold ${
                                i.type === "fake-log" ? "bg-red-600 text-white" : "bg-amber-100 text-amber-800"
                              }`}
                            >
                              {i.type === "fake-log" ? <UserX className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
                              {i.type === "fake-log" ? "Possible fake log" : "Not corrected"}
                            </span>
                            <span className="rounded-full bg-secondary px-2 py-0.5 text-xs text-muted-foreground">
                              {i.lineName}
                            </span>
                            <span className="text-xs text-muted-foreground">{fmt(i.createdAt)}</span>
                          </div>
                          <p className="mt-1 font-medium uppercase">{i.location}</p>
                          {i.type === "fake-log" ? (
                            <p className="text-xs">
                              Operator <span className="font-semibold">{i.operator}</span> ticked it{" "}
                              <span className="font-semibold text-emerald-700">Good</span> at {fmt(i.operatorAt)} — supervisor{" "}
                              <span className="font-semibold">{i.foundBy}</span> found it{" "}
                              <span className="font-semibold text-red-700">{i.finding}</span> at {fmt(i.createdAt)}.
                            </p>
                          ) : (
                            <p className="text-xs">
                              Found <span className="font-semibold text-red-700">{i.finding}</span> by {i.foundBy} (
                              {i.foundByRole}) and not corrected.
                            </p>
                          )}
                          {i.note && <p className="text-xs italic text-muted-foreground">“{i.note}”</p>}
                          {i.status === "closed" && (
                            <p className="mt-1 flex items-start gap-1 text-xs text-emerald-700">
                              <Check className="h-3.5 w-3.5 flex-none" /> Closed by {i.closedBy} · {fmt(i.closedAt)}
                              {i.outcome ? ` — ${i.outcome}` : ""}
                            </p>
                          )}
                        </div>
                        <div className="flex-none">
                          {i.status === "open" ? (
                            closingId !== i.id && (
                              <button
                                onClick={() => {
                                  setClosingId(i.id);
                                  setClosedBy("");
                                  setOutcome("");
                                }}
                                className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
                              >
                                Close
                              </button>
                            )
                          ) : (
                            <button
                              onClick={() => void reopenInv(i.id)}
                              disabled={busyId === i.id}
                              className="flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-accent disabled:opacity-50"
                            >
                              <RotateCcw className="h-3.5 w-3.5" /> Reopen
                            </button>
                          )}
                        </div>
                      </div>
                      {closingId === i.id && (
                        <div className="flex flex-col gap-2 border-t border-border bg-muted/30 p-3 sm:flex-row sm:items-center">
                          <input
                            autoFocus
                            value={closedBy}
                            onChange={(e) => setClosedBy(e.target.value)}
                            placeholder="Investigated by *"
                            className={`${ctl} sm:w-48`}
                          />
                          <input
                            value={outcome}
                            onChange={(e) => setOutcome(e.target.value)}
                            placeholder="Outcome / action taken"
                            className={`${ctl} flex-1`}
                          />
                          <div className="flex gap-2">
                            <button onClick={() => setClosingId(null)} className="rounded-md border border-border px-3 py-2 text-sm hover:bg-accent">
                              <X className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => void closeInv(i.id)}
                              disabled={busyId === i.id}
                              className="flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                            >
                              {busyId === i.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                              Close
                            </button>
                          </div>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Walk-round compliance */}
            <section>
              <h2 className="mb-2 text-sm font-semibold">
                Supervisor walk-rounds{" "}
                <span className="font-normal text-muted-foreground">
                  ({WALK_LINES_PER_SHIFT} lines per shift · day 07–19, night 19–07)
                </span>
              </h2>
              <div className="overflow-x-auto rounded-lg border border-border bg-card shadow-sm">
                <table className="w-full text-xs">
                  <thead className="bg-secondary/60 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2">Date</th>
                      <th className="px-3 py-2">Shift</th>
                      <th className="px-3 py-2">Lines walked</th>
                      <th className="px-3 py-2">Supervisor</th>
                      <th className="px-3 py-2 text-right">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {compliance.map((r) => {
                      const ok = r.lines.length >= WALK_LINES_PER_SHIFT;
                      return (
                        <tr key={`${r.day}|${r.shift}`} className={!ok && !r.future && !r.current ? "bg-red-50/60" : ""}>
                          <td className="px-3 py-1.5 tabular-nums">{r.day}</td>
                          <td className="px-3 py-1.5 capitalize">{r.shift}</td>
                          <td className="px-3 py-1.5">{r.lines.join(", ") || "—"}</td>
                          <td className="px-3 py-1.5">{r.who.join(", ") || "—"}</td>
                          <td className="px-3 py-1.5 text-right">
                            {r.future ? (
                              <span className="text-muted-foreground">upcoming</span>
                            ) : ok ? (
                              <span className="font-semibold text-emerald-700">✓ done</span>
                            ) : r.current ? (
                              <span className="font-semibold text-amber-700">
                                in progress · {r.lines.length}/{WALK_LINES_PER_SHIFT}
                              </span>
                            ) : (
                              <span className="font-semibold text-red-700">
                                ✗ {r.lines.length}/{WALK_LINES_PER_SHIFT}
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>

            {/* People */}
            <section>
              <h2 className="mb-2 text-sm font-semibold">Who did what</h2>
              {people.length === 0 ? (
                <p className="text-sm text-muted-foreground">No activity in this period.</p>
              ) : (
                <div className="overflow-x-auto rounded-lg border border-border bg-card shadow-sm">
                  <table className="w-full text-xs">
                    <thead className="bg-secondary/60 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2">Name</th>
                        <th className="px-3 py-2">Role</th>
                        <th className="px-3 py-2 text-right">Line</th>
                        <th className="px-3 py-2 text-right">Safety</th>
                        <th className="px-3 py-2 text-right">Walk-rounds</th>
                        <th className="px-3 py-2 text-right">Issues found</th>
                        <th className="px-3 py-2 text-right">Tickets raised</th>
                        <th className="px-3 py-2 text-right">Tickets fixed</th>
                        <th className="px-3 py-2 text-right">Fake-log flags</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {people.map((p) => (
                        <tr key={p.name} className={p.flagged ? "bg-red-50/60" : ""}>
                          <td className="px-3 py-1.5 font-medium">{p.name}</td>
                          <td className="px-3 py-1.5 text-muted-foreground">{[...p.roles].join(", ") || "—"}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{p.line}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{p.safety}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{p.walks}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{p.issues}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{p.ticketsRaised}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{p.ticketsFixed}</td>
                          <td className={`px-3 py-1.5 text-right font-semibold tabular-nums ${p.flagged ? "text-red-700" : ""}`}>
                            {p.flagged}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {/* Timeline */}
            <section>
              <h2 className="mb-2 text-sm font-semibold">
                Activity <span className="font-normal text-muted-foreground">({events.length})</span>
              </h2>
              <ul className="divide-y divide-border rounded-lg border border-border bg-card shadow-sm">
                {events.slice(0, eventLimit).map((e, idx) => (
                  <li key={idx} className="flex items-start gap-3 px-3 py-1.5 text-xs">
                    <span className="w-28 flex-none tabular-nums text-muted-foreground">{fmt(e.at)}</span>
                    <span
                      className={`mt-1 h-2 w-2 flex-none rounded-full ${
                        { neutral: "bg-slate-300", warn: "bg-amber-500", bad: "bg-red-600", good: "bg-emerald-500" }[e.tone]
                      }`}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="font-semibold">{e.who || "—"}</span> · {e.what}
                    </span>
                    <span className="hidden flex-none text-muted-foreground sm:inline">{e.where}</span>
                  </li>
                ))}
              </ul>
              {events.length > eventLimit && (
                <button
                  onClick={() => setEventLimit((l) => l + 100)}
                  className="mt-2 text-xs font-medium text-primary underline underline-offset-2"
                >
                  Show more
                </button>
              )}
            </section>
          </>
        )}
      </main>
      )}
    </div>
  );
};

export default Summary;
