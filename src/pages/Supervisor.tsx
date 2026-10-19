import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  ArrowLeft,
  Camera,
  Check,
  Droplets,
  ListChecks,
  Loader2,
  MessageSquarePlus,
  RotateCcw,
  Send,
  ShieldCheck,
} from "lucide-react";
import { useChecklists } from "@/hooks/useChecklists";
import type { LineCard } from "@/data/lines";
import {
  createInvestigation,
  createMaintenanceTicket,
  deleteGuardPhoto,
  fetchSubmissions,
  submitChecklist,
  uploadGuardPhoto,
  type GuardPhoto,
  type Submission,
} from "@/lib/api";
import { compressImage } from "@/lib/image";
import ConfirmDialog from "@/components/ConfirmDialog";
import { BTN_ACTIVE, STATUS, WATER_ITEM, WaterDialog } from "@/components/ChecklistForm";
import GuardFollowUp from "@/components/GuardFollowUp";
import {
  FINDING,
  WALK_LINES_PER_SHIFT,
  followUpMissing,
  followUpText,
  joinComment,
  latestOperatorCheck,
  raiseGuardFollowUps,
  shiftOf,
  submissionTime,
} from "@/lib/followups";

// Supervisor walk-round: 2 lines per shift, every day. The supervisor picks the
// lines (the two longest since their last walk-round are suggested), then every
// guard on them must be marked AND photographed, plus Water on floor per line
// (same popup + maintenance ticket as the operators'). Photos live in the draft
// so a refresh doesn't lose them. Saved as one submission of kind "supervisor"
// with line = "<id>,<id>"; item ids are "<lineId>:<itemId>".
// After saving: guard follow-ups (maintenance / investigation) and the fake-log
// check — a guard the operator ticked Good in the 6 h before, found wrong here.

interface ItemState {
  status?: string;
  value?: string; // water: source
  comment?: string; // guards: note · water: attempted resolutions / by whom
  fixed?: "yes" | "no"; // water only
  photo?: { id: string; url: string }; // guards: the supervisor's photo (required)
  newGuard?: "yes" | "no"; // Missing: needs a new guard → maintenance
  corrected?: "yes" | "no"; // Missing / not installed: "no" → investigation
}
interface DraftState {
  supervisor: string;
  lineIds?: string[]; // lines walked this shift
  items: Record<string, ItemState>;
}
const emptyDraft: DraftState = { supervisor: "", lineIds: [], items: {} };
const DRAFT_KEY = "lines-checklist:draft:supervisor";

const defs = STATUS.supervisor;
const defByKey = (k?: string) => defs.find((d) => d.key === k);

const pad = (n: number) => String(n).padStart(2, "0");
const localDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const localTime = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

const key = (lineId: string, itemId: string) => `${lineId}:${itemId}`;
const waterKey = (lineId: string) => key(lineId, WATER_ITEM.id);

const Supervisor = () => {
  const { lines: allLines } = useChecklists();
  const available = useMemo(() => allLines.filter((l) => l.available !== false), [allLines]);

  const [draft, setDraft] = useState<DraftState>(() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      return raw ? (JSON.parse(raw) as DraftState) : emptyDraft;
    } catch {
      return emptyDraft;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch {
      /* draft is a convenience only */
    }
  }, [draft]);

  const lineIds = draft.lineIds ?? [];
  const lines = useMemo(() => available.filter((l) => lineIds.includes(l.id)), [available, lineIds]);

  // Last walk-round per line + which lines this shift already covered.
  const [lastWalk, setLastWalk] = useState<Record<string, number>>({});
  const [shiftDone, setShiftDone] = useState<string[]>([]);
  const loadWalks = async () => {
    try {
      const subs = await fetchSubmissions({ kind: "supervisor" });
      const last: Record<string, number> = {};
      const cur = shiftOf(Date.now()).key;
      const done = new Set<string>();
      for (const sub of subs) {
        const t = submissionTime(sub);
        for (const id of String(sub.line).split(",")) {
          if (!last[id] || t > last[id]) last[id] = t;
          if (shiftOf(t).key === cur) done.add(id);
        }
      }
      setLastWalk(last);
      setShiftDone([...done]);
    } catch {
      /* suggestions are optional */
    }
  };
  useEffect(() => {
    void loadWalks();
  }, []);
  // Never-walked lines first, then the oldest walk-rounds.
  const suggested = useMemo(
    () =>
      [...available]
        .filter((l) => !shiftDone.includes(l.id))
        .sort((a, b) => (lastWalk[a.id] ?? 0) - (lastWalk[b.id] ?? 0))
        .slice(0, WALK_LINES_PER_SHIFT)
        .map((l) => l.id),
    [available, lastWalk, shiftDone]
  );
  const toggleLine = (id: string) =>
    setDraft((d) => {
      const cur = d.lineIds ?? [];
      return { ...d, lineIds: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] };
    });

  const [activeLine, setActiveLine] = useState<string | null>(null); // line tab shown
  const [filter, setFilter] = useState<"all" | "todo">("all");
  const [pickOpen, setPickOpen] = useState(false);
  const [openComments, setOpenComments] = useState<Record<string, boolean>>({});
  const [waterLine, setWaterLine] = useState<LineCard | null>(null); // line whose water popup is open
  // Water photos taken this session, keyed by line id → the uploaded record.
  const [photos, setPhotos] = useState<Record<string, GuardPhoto>>({});
  const [photoBusy, setPhotoBusy] = useState(false);
  const [guardBusy, setGuardBusy] = useState<string | null>(null); // guard key uploading a photo
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<{
    date: string;
    time: string;
    tickets: number;
    investigations: number;
    fakeLogs: number;
  } | null>(null);
  const [triedSubmit, setTriedSubmit] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // Phones (< 768px) capture from the camera; tablets/desktop pick a file.
  const isPhone = typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches;

  const allKeys = useMemo(
    () => lines.flatMap((l) => [...l.safety.items.map((it) => key(l.id, it.id)), waterKey(l.id)]),
    [lines]
  );
  const total = allKeys.length;
  const done = allKeys.filter((k) => draft.items[k]?.status).length;
  const issues = allKeys.filter((k) => {
    const st = draft.items[k]?.status;
    if (!st) return false;
    if (k.endsWith(WATER_ITEM.id)) return st === "fail";
    return defByKey(st)?.tint !== "green";
  }).length;
  const pct = total ? Math.round((done / total) * 100) : 0;

  const lineStats = (l: LineCard) => {
    const keys = [...l.safety.items.map((it) => key(l.id, it.id)), waterKey(l.id)];
    const d = keys.filter((k) => draft.items[k]?.status).length;
    const bad = keys.filter((k) => {
      const st = draft.items[k]?.status;
      return st && st !== "good" && st !== "ok";
    }).length;
    const shots = l.safety.items.filter((it) => draft.items[key(l.id, it.id)]?.photo).length;
    return { done: d, total: keys.length, bad, shots, guards: l.safety.items.length };
  };

  const setItem = (k: string, patch: ItemState | null) =>
    setDraft((d) => {
      const items = { ...d.items };
      if (patch === null) delete items[k];
      else items[k] = { ...items[k], ...patch };
      return { ...d, items };
    });
  // Follow-up answers belong to the old status — clear them on change.
  const toggleStatus = (k: string, s: string) =>
    setItem(k, { status: draft.items[k]?.status === s ? undefined : s, newGuard: undefined, corrected: undefined });

  // --- photos -------------------------------------------------------------------
  const pickImage = (onFile: (f: File) => void) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    if (isPhone) input.setAttribute("capture", "environment");
    input.onchange = () => {
      const file = input.files?.[0];
      if (file) onFile(file);
    };
    input.click();
  };

  const pickGuardPhoto = (l: LineCard, itemId: string, itemText: string) => {
    const k = key(l.id, itemId);
    pickImage(async (file) => {
      setGuardBusy(k);
      try {
        const rec = await uploadGuardPhoto({
          line: l.id,
          itemId,
          itemText,
          operator: draft.supervisor.trim(),
          image: await compressImage(file),
          kind: "defect",
          status: "S", // supervisor walk-round shot (the Defected Guards tab shows X only)
        });
        const old = draft.items[k]?.photo;
        if (old) void deleteGuardPhoto(old.id).catch(() => {});
        setItem(k, { photo: { id: rec.id, url: rec.url } });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Photo upload failed.");
      } finally {
        setGuardBusy(null);
      }
    });
  };
  const guardPhotoIds = () =>
    Object.values(draft.items)
      .map((st) => st.photo?.id)
      .filter((id): id is string => !!id);

  const pickWaterPhoto = (l: LineCard) =>
    pickImage(async (file) => {
      setPhotoBusy(true);
      try {
        const rec = await uploadGuardPhoto({
          line: l.id,
          itemId: WATER_ITEM.id,
          itemText: WATER_ITEM.text,
          operator: draft.supervisor.trim(),
          image: await compressImage(file),
          kind: "defect",
          status: "fail",
        });
        const old = photos[l.id];
        if (old) void deleteGuardPhoto(old.id).catch(() => {});
        setPhotos((p) => ({ ...p, [l.id]: rec }));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Photo upload failed.");
      } finally {
        setPhotoBusy(false);
      }
    });
  const removeWaterPhoto = (lineId: string) => {
    const rec = photos[lineId];
    if (rec) void deleteGuardPhoto(rec.id).catch(() => {});
    setPhotos(({ [lineId]: _, ...rest }) => rest);
  };

  // --- submit -------------------------------------------------------------------
  const reset = () => {
    Object.values(photos).forEach((rec) => void deleteGuardPhoto(rec.id).catch(() => {}));
    guardPhotoIds().forEach((id) => void deleteGuardPhoto(id).catch(() => {}));
    setPhotos({});
    setDraft(emptyDraft);
    setOpenComments({});
    setSaved(null);
    setError(null);
    setTriedSubmit(false);
    setConfirmReset(false);
  };

  const handleSubmit = () => {
    setError(null);
    setTriedSubmit(true);
    if (!draft.supervisor.trim()) {
      setError("Enter the supervisor name before submitting.");
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    if (lines.length < WALK_LINES_PER_SHIFT) {
      setError(`Pick ${WALK_LINES_PER_SHIFT} lines to walk this shift.`);
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    // Everything is compulsory on a walk-round: every guard marked, photographed
    // and its follow-ups answered.
    const jump = (l: LineCard, k: string) => {
      setActiveLine(l.id);
      setFilter("all");
      setPickOpen(false);
      setTimeout(
        () => document.getElementById(`sup-${k}`)?.scrollIntoView({ behavior: "smooth", block: "center" }),
        50
      );
    };
    const guardsOf = (pred: (st: ItemState) => boolean) =>
      lines.flatMap((l) =>
        l.safety.items.filter((it) => pred(draft.items[key(l.id, it.id)] ?? {})).map((it) => ({ l, k: key(l.id, it.id) }))
      );
    const unmarked = guardsOf((st) => !st.status);
    if (unmarked.length) {
      setError(`Mark every guard — ${unmarked.length} not marked (first: ${unmarked[0].l.name}).`);
      jump(unmarked[0].l, unmarked[0].k);
      return;
    }
    const noPhoto = guardsOf((st) => !st.photo);
    if (noPhoto.length) {
      setError(`A photo of every guard is compulsory — ${noPhoto.length} missing (first: ${noPhoto[0].l.name}).`);
      jump(noPhoto[0].l, noPhoto[0].k);
      return;
    }
    const unanswered = guardsOf((st) => followUpMissing(st));
    if (unanswered.length) {
      setError(`Answer the follow-up questions for ${unanswered.length} guard${unanswered.length === 1 ? "" : "s"}.`);
      jump(unanswered[0].l, unanswered[0].k);
      return;
    }
    const noWater = lines.find((l) => !draft.items[waterKey(l.id)]?.status);
    if (noWater) {
      setError(`${noWater.name}: answer Water on floor.`);
      jump(noWater, waterKey(noWater.id));
      return;
    }
    for (const l of lines) {
      const w = draft.items[waterKey(l.id)];
      if (w?.status === "fail" && (!w.value?.trim() || !w.comment?.trim() || !w.fixed)) {
        setError(`${l.name} water on floor: enter the source, the attempted resolutions and whether it is fixed.`);
        setActiveLine(l.id);
      setFilter("all");
      setPickOpen(false);
        setWaterLine(l);
        return;
      }
    }
    void doSubmit();
  };

  const doSubmit = async () => {
    const stamp = new Date();
    const items = lines.flatMap((l) => {
      const guards = l.safety.items.map((it) => {
        const st = draft.items[key(l.id, it.id)] ?? {};
        return {
          id: key(l.id, it.id),
          text: `${l.name} · ${it.text}`,
          status: st.status || "",
          comment: joinComment(st.comment, followUpText(st)),
          photoUrl: st.photo?.url,
        };
      });
      const w = draft.items[waterKey(l.id)] ?? {};
      const water = {
        id: waterKey(l.id),
        text: `${l.name} · ${WATER_ITEM.text}`,
        status: w.status || "",
        photoUrl: w.status === "fail" ? photos[l.id]?.url : undefined,
        comment:
          w.status === "fail"
            ? `Source: ${w.value?.trim()} · Attempted resolutions / by whom: ${w.comment?.trim()} · Fixed: ${
                w.fixed === "no" ? "No — maintenance ticket sent" : "Yes"
              }`
            : undefined,
      };
      return [...guards, water];
    });
    const payload: Submission = {
      kind: "supervisor",
      date: localDate(stamp),
      time: localTime(stamp),
      line: lines.map((l) => l.id).join(","),
      lineName: lines.map((l) => l.name).join(" + "),
      title: "Supervisor Safety Walk-round",
      revision: "",
      operator: draft.supervisor.trim(),
      fields: {},
      items,
      completed: done,
      total,
      issues,
    };
    setSubmitting(true);
    try {
      const rec = await submitChecklist(payload);
      // Not-fixed water → one maintenance ticket per line, before the photo cleanup.
      const failed: string[] = [];
      let tickets = 0;
      for (const l of lines) {
        const w = draft.items[waterKey(l.id)];
        if (w?.status !== "fail" || w.fixed !== "no") continue;
        try {
          await createMaintenanceTicket({
            line: l.id,
            lineName: l.name,
            issue: "Water on floor",
            source: w.value?.trim() || "",
            attempted: w.comment?.trim() || "",
            operator: draft.supervisor.trim(),
            photoUrl: photos[l.id]?.url,
            submissionId: rec.id,
          });
          tickets++;
        } catch {
          failed.push(l.name);
        }
      }
      // Guards: Broken / new guard → maintenance; not corrected → investigation.
      let investigations = 0;
      for (const l of lines) {
        const r = await raiseGuardFollowUps({
          line: l.id,
          lineName: l.name,
          by: draft.supervisor.trim(),
          role: "supervisor",
          submissionId: rec.id,
          guards: l.safety.items.map((it) => {
            const st = draft.items[key(l.id, it.id)] ?? {};
            return {
              itemId: it.id,
              text: it.text,
              status: st.status,
              newGuard: st.newGuard,
              corrected: st.corrected,
              note: st.comment?.trim(),
              photoUrl: st.photo?.url,
            };
          }),
        });
        tickets += r.tickets;
        investigations += r.investigations;
        if (r.failed.length) failed.push(`${l.name} (${r.failed.join(", ")})`);
      }
      // Fake-log check: the operator's latest Safety Guards check on the line in
      // the 6 h before ticked a guard Good that this walk-round found wrong.
      let fakeLogs = 0;
      try {
        const opSubs = await fetchSubmissions({ kind: "safety" });
        const at = rec.submittedAt ? Date.parse(rec.submittedAt) : Date.now();
        for (const l of lines) {
          const op = latestOperatorCheck(opSubs, l.id, at);
          if (!op) continue;
          for (const it of l.safety.items) {
            const st = draft.items[key(l.id, it.id)] ?? {};
            if (!FINDING[st.status ?? ""]) continue;
            if (op.items.find((x) => x.id === it.id)?.status !== "good") continue;
            await createInvestigation({
              type: "fake-log",
              line: l.id,
              lineName: l.name,
              itemId: it.id,
              location: it.text,
              finding: FINDING[st.status!],
              foundBy: draft.supervisor.trim(),
              foundByRole: "supervisor",
              note: st.comment?.trim() || "",
              photoUrl: st.photo?.url,
              submissionId: rec.id,
              operator: op.operator,
              operatorSubmissionId: op.id,
              operatorAt: op.submittedAt ?? `${op.date}T${op.time}`,
            });
            fakeLogs++;
          }
        }
      } catch {
        failed.push("fake-log check");
      }
      // The submission (and tickets) hold their own photo copies now.
      Object.values(photos).forEach((p) => void deleteGuardPhoto(p.id).catch(() => {}));
      guardPhotoIds().forEach((id) => void deleteGuardPhoto(id).catch(() => {}));
      setPhotos({});
      setDraft(emptyDraft);
      setOpenComments({});
      setTriedSubmit(false);
      setSaved({ date: rec.date, time: rec.time, tickets, investigations, fakeLogs });
      void loadWalks();
      if (failed.length)
        setError(`Walk-round saved, but sending failed for ${failed.join(", ")}. Tell maintenance directly.`);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      setError(e instanceof Error ? `${e.message}. Is the backend running?` : "Could not save.");
    } finally {
      setSubmitting(false);
    }
  };

  const wl = waterLine;
  const wst = wl ? draft.items[waterKey(wl.id)] ?? {} : {};

  // Layout state: one line shown at a time (tabs), optional "to do only" filter,
  // and the line picker folds away once the shift's lines are chosen.
  const active = lines.find((l) => l.id === activeLine) ?? lines[0];
  const guardDone = (st: ItemState) => !!st.status && !!st.photo && !followUpMissing(st);
  const allGuards = lines.reduce((n, l) => n + l.safety.items.length, 0);
  const allShots = lines.reduce((n, l) => n + l.safety.items.filter((it) => draft.items[key(l.id, it.id)]?.photo).length, 0);
  const showPicker = pickOpen || lines.length < WALK_LINES_PER_SHIFT;
  const lineDone = (l: LineCard) =>
    l.safety.items.every((it) => guardDone(draft.items[key(l.id, it.id)] ?? {})) && !!draft.items[waterKey(l.id)]?.status;
  const bar = (n: number, of: number, cls: string) => (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
      <div className={`h-full rounded-full transition-all ${cls}`} style={{ width: `${of ? Math.round((n / of) * 100) : 0}%` }} />
    </div>
  );

  return (
    <div className="min-h-screen bg-muted/30 pb-28 text-foreground">
      <header className="sticky top-0 z-20 border-b border-border bg-card/95 backdrop-blur">
        <div className="container flex h-12 items-center gap-2">
          <Link to="/" className="-ml-2 rounded-md p-2 text-muted-foreground hover:bg-accent" aria-label="Back to lines">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <h1 className="flex min-w-0 flex-1 items-center gap-1.5 truncate text-base font-semibold">
            <ShieldCheck className="h-4 w-4 flex-none text-primary" /> Safety walk-round
          </h1>
          <Link
            to="/supervisor/guards"
            className="flex flex-none items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs font-medium hover:bg-accent"
            aria-label="Guard lists"
          >
            <ListChecks className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Guard lists</span>
          </Link>
          <button
            onClick={() => setConfirmReset(true)}
            className="flex flex-none items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs font-medium hover:bg-accent"
            aria-label="Reset"
          >
            <RotateCcw className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Reset</span>
          </button>
        </div>

        {/* Line tabs — one line at a time */}
        {lines.length > 0 && !showPicker && (
          <div className="container flex gap-1 overflow-x-auto pb-0">
            {lines.map((l) => {
              const s = lineStats(l);
              const on = active?.id === l.id;
              const complete = lineDone(l);
              return (
                <button
                  key={l.id}
                  onClick={() => setActiveLine(l.id)}
                  className={`flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-semibold transition-colors ${
                    on ? "border-primary text-primary" : "border-transparent text-muted-foreground"
                  }`}
                >
                  {complete ? <Check className="h-4 w-4 text-emerald-600" /> : null}
                  {l.name}
                  <span className="rounded-full bg-secondary px-1.5 text-[11px] font-medium tabular-nums text-muted-foreground">
                    {s.shots}/{s.guards}
                  </span>
                  {s.bad > 0 && <span className="h-2 w-2 rounded-full bg-red-500" title={`${s.bad} problem(s)`} />}
                </button>
              );
            })}
          </div>
        )}
      </header>

      <main className="container space-y-3 py-3">
        {/* Who / when / overall progress */}
        <section className="rounded-xl border border-border bg-card p-3 shadow-sm">
          <div className="flex items-center gap-2">
            <input
              value={draft.supervisor}
              onChange={(e) => setDraft((d) => ({ ...d, supervisor: e.target.value }))}
              placeholder="Supervisor name *"
              aria-label="Supervisor"
              className={`h-10 min-w-0 flex-1 rounded-md border bg-card px-3 text-sm font-medium outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 ${
                triedSubmit && !draft.supervisor.trim() ? "border-red-500 bg-red-50" : "border-input"
              }`}
            />
            <div className="flex-none text-right text-xs leading-tight text-muted-foreground">
              <div className="font-medium text-foreground">
                {now.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}
              </div>
              <div>
                {now.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })} ·{" "}
                {shiftOf(now.getTime()).shift === "day" ? "Day" : "Night"} shift
              </div>
            </div>
          </div>
          {lines.length > 0 && (
            <div className="mt-3 grid grid-cols-2 gap-3 text-[11px] text-muted-foreground">
              <div>
                <div className="mb-1 flex justify-between">
                  <span>Marked</span>
                  <span className="font-semibold tabular-nums text-foreground">
                    {done}/{total}
                  </span>
                </div>
                {bar(done, total, "bg-primary")}
              </div>
              <div>
                <div className="mb-1 flex justify-between">
                  <span className="flex items-center gap-1">
                    <Camera className="h-3 w-3" /> Photos
                  </span>
                  <span className="font-semibold tabular-nums text-foreground">
                    {allShots}/{allGuards}
                  </span>
                </div>
                {bar(allShots, allGuards, "bg-sky-500")}
              </div>
            </div>
          )}
        </section>

        {/* Line picker — folds to a one-line summary once lines are picked */}
        {showPicker ? (
          <section className="rounded-xl border border-border bg-card p-3 shadow-sm">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">
                Pick {WALK_LINES_PER_SHIFT} lines for this shift{" "}
                <span className={lines.length >= WALK_LINES_PER_SHIFT ? "text-emerald-600" : "text-muted-foreground"}>
                  ({lines.length}/{WALK_LINES_PER_SHIFT})
                </span>
              </h2>
              {lineIds.length === 0 && suggested.length > 0 ? (
                <button
                  onClick={() => {
                    setDraft((d) => ({ ...d, lineIds: suggested }));
                    setPickOpen(false);
                  }}
                  className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground"
                >
                  Use suggested: {suggested.map((id) => available.find((l) => l.id === id)?.name).join(" + ")}
                </button>
              ) : (
                lines.length >= WALK_LINES_PER_SHIFT && (
                  <button onClick={() => setPickOpen(false)} className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground">
                    Done
                  </button>
                )
              )}
            </div>
            <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6">
              {available.map((l) => {
                const on = lineIds.includes(l.id);
                const last = lastWalk[l.id];
                const doneThisShift = shiftDone.includes(l.id);
                return (
                  <button
                    key={l.id}
                    onClick={() => toggleLine(l.id)}
                    className={`rounded-md border px-2 py-1.5 text-left transition-colors ${
                      on ? "border-primary bg-primary text-primary-foreground" : "border-input bg-card hover:bg-accent"
                    }`}
                  >
                    <span className="block text-xs font-semibold">
                      {l.name}
                      {suggested.includes(l.id) && !on && <span className="ml-1 text-[10px] font-medium text-amber-600">★</span>}
                    </span>
                    <span className={`block text-[10px] ${on ? "text-primary-foreground/80" : "text-muted-foreground"}`}>
                      {doneThisShift
                        ? "done this shift"
                        : last
                          ? `last ${new Date(last).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`
                          : "never walked"}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        ) : (
          <div className="flex items-center justify-between gap-2 px-1 text-xs text-muted-foreground">
            <span>
              Walking <span className="font-semibold text-foreground">{lines.map((l) => l.name).join(" + ")}</span> this shift
            </span>
            <button onClick={() => setPickOpen(true)} className="font-medium text-primary underline underline-offset-2">
              Change lines
            </button>
          </div>
        )}

        {saved && (
          <div className="flex items-start gap-2.5 rounded-lg border border-emerald-500/40 bg-emerald-50 p-3 text-sm text-emerald-800">
            <Check className="mt-0.5 h-4 w-4 flex-none text-emerald-600" />
            <span>
              Walk-round saved for {saved.date} at {saved.time}.
              {saved.tickets > 0 && ` ${saved.tickets} maintenance ticket${saved.tickets > 1 ? "s" : ""} sent.`}
              {saved.investigations > 0 && ` ${saved.investigations} guard${saved.investigations > 1 ? "s" : ""} flagged for investigation.`}
              {saved.fakeLogs > 0 && ` ${saved.fakeLogs} possible fake log${saved.fakeLogs > 1 ? "s" : ""} flagged.`}{" "}
              <Link to="/submissions" className="font-medium underline underline-offset-2">
                View submissions
              </Link>
            </span>
          </div>
        )}

        {lines.length === 0 && !saved && (
          <p className="py-6 text-center text-sm text-muted-foreground">Pick the lines above to start.</p>
        )}

        {active && !showPicker && (
          <>
            {/* All / To do filter */}
            <div className="flex items-center justify-between">
              <div className="inline-flex rounded-lg border border-border bg-card p-0.5 text-xs font-medium">
                {(["all", "todo"] as const).map((f) => (
                  <button
                    key={f}
                    onClick={() => setFilter(f)}
                    className={`rounded-md px-3 py-1.5 ${filter === f ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
                  >
                    {f === "all"
                      ? `All ${active.safety.items.length}`
                      : `To do ${active.safety.items.filter((it) => !guardDone(draft.items[key(active.id, it.id)] ?? {})).length}`}
                  </button>
                ))}
              </div>
              <span className="text-[11px] text-muted-foreground">Mark each guard + take its photo</span>
            </div>

            <ul className="space-y-2 xl:grid xl:grid-cols-2 xl:gap-2 xl:space-y-0">
              {active.safety.items.map((item, idx) => {
                const k = key(active.id, item.id);
                const st = draft.items[k] ?? {};
                if (filter === "todo" && guardDone(st)) return null;
                const def = defByKey(st.status);
                const showComment = openComments[k] || !!st.comment;
                const photoMissing = triedSubmit && !st.photo;
                const complete = guardDone(st);
                const border = complete
                  ? def?.tint === "green"
                    ? "border-emerald-400"
                    : def?.tint === "red"
                      ? "border-red-400"
                      : "border-amber-400"
                  : st.status || st.photo
                    ? "border-sky-300"
                    : triedSubmit
                      ? "border-red-300"
                      : "border-border";
                return (
                  <li key={k} id={`sup-${k}`} className={`rounded-xl border-2 bg-card p-2.5 shadow-sm transition-colors ${border}`}>
                    <div className="flex gap-3">
                      {/* Photo tile — compulsory; tap to take / retake */}
                      <button
                        type="button"
                        onClick={() => pickGuardPhoto(active, item.id, item.text)}
                        disabled={guardBusy === k}
                        className={`relative flex h-16 w-16 flex-none flex-col items-center justify-center overflow-hidden rounded-lg border-2 text-[10px] font-semibold ${
                          st.photo
                            ? "border-emerald-500"
                            : photoMissing
                              ? "border-dashed border-red-500 bg-red-50 text-red-600"
                              : "border-dashed border-sky-400 bg-sky-50 text-sky-700"
                        }`}
                        aria-label={st.photo ? "Retake photo" : "Take photo"}
                      >
                        {guardBusy === k ? (
                          <Loader2 className="h-5 w-5 animate-spin" />
                        ) : st.photo ? (
                          <>
                            <img src={st.photo.url} alt="" className="h-full w-full object-cover" />
                            <span className="absolute bottom-0.5 right-0.5 rounded-full bg-emerald-500 p-0.5 text-white">
                              <Check className="h-3 w-3" />
                            </span>
                          </>
                        ) : (
                          <>
                            <Camera className="mb-0.5 h-5 w-5" />
                            Photo
                          </>
                        )}
                      </button>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-start gap-2">
                          <p className="min-w-0 flex-1 text-[13px] font-semibold uppercase leading-snug">
                            <span className="mr-1 font-normal text-muted-foreground">{idx + 1}.</span>
                            {item.text}
                          </p>
                          <button
                            onClick={() => setOpenComments((o) => ({ ...o, [k]: !showComment }))}
                            className={`flex-none rounded-md p-1 ${st.comment ? "bg-amber-500 text-white" : "text-amber-600 hover:bg-amber-50"}`}
                            aria-label="Note"
                            title="Add a note"
                          >
                            <MessageSquarePlus className="h-4 w-4" />
                          </button>
                        </div>
                        {item.badge && (
                          <span className="mt-0.5 inline-block rounded bg-secondary px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                            Should be {item.badge}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Status — one segmented control, full width */}
                    <div className="mt-2 grid grid-cols-4 gap-1">
                      {defs.map((sd) => {
                        const on = st.status === sd.key;
                        const Icon = sd.primary ? Check : sd.icon ?? AlertTriangle;
                        return (
                          <button
                            key={sd.key}
                            onClick={() => toggleStatus(k, sd.key)}
                            title={sd.title}
                            className={`flex h-9 items-center justify-center gap-1 rounded-md border text-[11px] font-bold transition-colors sm:text-xs ${
                              on ? BTN_ACTIVE[sd.tint] : "border-input bg-card text-muted-foreground hover:bg-accent"
                            }`}
                          >
                            <Icon className="h-3.5 w-3.5 flex-none" />
                            <span className="truncate">{sd.primary ? "Good" : sd.label}</span>
                          </button>
                        );
                      })}
                    </div>

                    {showComment && (
                      <input
                        value={st.comment ?? ""}
                        onChange={(e) => setItem(k, { comment: e.target.value })}
                        placeholder="Note (optional)"
                        className="mt-2 w-full rounded-md border border-input bg-card px-3 py-1.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                      />
                    )}
                    <div className="-mx-2.5 mt-1 [&>div]:pl-2.5">
                      <GuardFollowUp st={st} invalid={triedSubmit} onChange={(patch) => setItem(k, patch)} />
                    </div>
                  </li>
                );
              })}
            </ul>

            {/* Water on floor — same popup + ticket as the operator checklist */}
            {(() => {
              const w = draft.items[waterKey(active.id)] ?? {};
              return (
                <div
                  id={`sup-${waterKey(active.id)}`}
                  className={`rounded-xl border-2 bg-card p-2.5 shadow-sm ${
                    w.status === "fail" ? "border-red-400" : w.status === "ok" ? "border-emerald-400" : triedSubmit ? "border-red-300" : "border-border"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="flex h-9 w-9 flex-none items-center justify-center rounded-lg bg-sky-100 text-sky-600">
                      <Droplets className="h-5 w-5" />
                    </span>
                    <span className="flex-1 text-[13px] font-semibold uppercase">Water on floor?</span>
                    <button
                      onClick={() => {
                        if (w.status === "ok") setItem(waterKey(active.id), null);
                        else {
                          removeWaterPhoto(active.id);
                          setDraft((d) => ({ ...d, items: { ...d.items, [waterKey(active.id)]: { status: "ok" } } }));
                        }
                      }}
                      className={`h-9 w-14 rounded-md border text-xs font-bold ${
                        w.status === "ok" ? BTN_ACTIVE.green : "border-input bg-card text-muted-foreground hover:bg-accent"
                      }`}
                    >
                      No
                    </button>
                    <button
                      onClick={() => setWaterLine(active)}
                      className={`h-9 w-14 rounded-md border text-xs font-bold ${
                        w.status === "fail" ? BTN_ACTIVE.red : "border-input bg-card text-muted-foreground hover:bg-accent"
                      }`}
                    >
                      Yes
                    </button>
                  </div>
                  {w.status === "fail" && (
                    <button onClick={() => setWaterLine(active)} className="mt-2 flex w-full gap-3 rounded-lg bg-red-50 p-2 text-left text-xs">
                      {photos[active.id] && (
                        <img src={photos[active.id].url} alt="" className="h-14 w-14 flex-none rounded object-cover" />
                      )}
                      <span className="min-w-0 flex-1 space-y-0.5">
                        <span className="block">
                          <b>Source:</b> {w.value}
                        </span>
                        <span className="block">
                          <b>Tried:</b> {w.comment}
                        </span>
                        <span className="block">
                          <b>Fixed:</b>{" "}
                          {w.fixed === "no" ? <span className="font-semibold text-red-600">No — maintenance ticket on submit</span> : "Yes"}
                        </span>
                        <span className="block font-medium text-red-600 underline underline-offset-2">Edit</span>
                      </span>
                    </button>
                  )}
                </div>
              );
            })()}

            {/* Next line */}
            {lines.length > 1 && lines.findIndex((l) => l.id === active.id) < lines.length - 1 && (
              <button
                onClick={() => {
                  setActiveLine(lines[lines.findIndex((l) => l.id === active.id) + 1].id);
                  window.scrollTo({ top: 0, behavior: "smooth" });
                }}
                className={`w-full rounded-xl border-2 py-3 text-sm font-semibold ${
                  lineDone(active) ? "border-primary bg-primary text-primary-foreground" : "border-dashed border-border text-muted-foreground"
                }`}
              >
                Next: {lines[lines.findIndex((l) => l.id === active.id) + 1].name} →
              </button>
            )}
          </>
        )}
      </main>

      {/* Bottom bar */}
      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-border bg-card/95 backdrop-blur">
        <div className="container py-2.5">
          {error && <p className="mb-1.5 text-xs font-medium text-destructive">{error}</p>}
          <div className="flex items-center justify-between gap-3">
            <span className="min-w-0 truncate text-xs text-muted-foreground">
              {lines.length ? (
                <>
                  <b className="text-foreground">{done}</b>/{total} marked · <b className="text-foreground">{allShots}</b>/{allGuards} photos
                  {issues > 0 && <span className="text-red-600"> · {issues} problem{issues > 1 ? "s" : ""}</span>}
                </>
              ) : (
                "No lines picked"
              )}
            </span>
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="flex flex-none items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm hover:opacity-90 disabled:opacity-50"
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {submitting ? "Saving…" : "Submit"}
            </button>
          </div>
        </div>
      </div>

      {wl && (
        <WaterDialog
          source={wst.value ?? ""}
          resolution={wst.comment ?? ""}
          fixed={wst.fixed}
          photoUrl={photos[wl.id]?.url}
          photoBusy={photoBusy}
          onCapturePhoto={() => pickWaterPhoto(wl)}
          onRemovePhoto={() => removeWaterPhoto(wl.id)}
          onCancel={() => {
            if (wst.status !== "fail") removeWaterPhoto(wl.id);
            setWaterLine(null);
          }}
          onSave={(source, resolution, fixed) => {
            setDraft((d) => ({
              ...d,
              items: { ...d.items, [waterKey(wl.id)]: { status: "fail", value: source, comment: resolution, fixed } },
            }));
            setWaterLine(null);
            setError(null);
          }}
        />
      )}

      {confirmReset && (
        <ConfirmDialog
          title="Clear this walk-round?"
          message="This clears the supervisor name and every mark, photo, note and water entry on all lines. It can’t be undone."
          confirmLabel="Clear form"
          confirmIcon={RotateCcw}
          onCancel={() => setConfirmReset(false)}
          onConfirm={reset}
        />
      )}
    </div>
  );
};

export default Supervisor;
