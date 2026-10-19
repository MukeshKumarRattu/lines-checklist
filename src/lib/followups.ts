// What happens to a guard after it's marked. Shared by the operator Safety
// Guards checklist and the supervisor walk-round.
//   Broken (X)                     -> maintenance ticket
//   Missing (M), needs a new guard -> maintenance ticket
//   Missing (M), not corrected     -> investigation
//   Replaced (R) = was not installed properly, not corrected -> investigation
import {
  createInvestigation,
  createMaintenanceTicket,
  type Submission,
} from "@/lib/api";

export type YesNo = "yes" | "no";

export interface GuardFollowUpState {
  status?: string;
  newGuard?: YesNo; // Missing only
  corrected?: YesNo; // Missing / Replaced
}

export const FINDING: Record<string, string> = {
  X: "Broken",
  R: "Not installed properly",
  M: "Missing",
};

/** Which follow-up questions a status needs. */
export const followUpsFor = (status?: string) => ({
  newGuard: status === "M",
  corrected: status === "M" || status === "R",
});

/** True when a marked guard still has an unanswered follow-up question. */
export const followUpMissing = (st: GuardFollowUpState) => {
  const f = followUpsFor(st.status);
  return (f.newGuard && !st.newGuard) || (f.corrected && !st.corrected);
};

/** Follow-up answers as text, appended to the item comment in the submission. */
export const followUpText = (st: GuardFollowUpState) => {
  const f = followUpsFor(st.status);
  const parts: string[] = [];
  if (st.status === "X") parts.push("Sent to maintenance");
  if (f.newGuard && st.newGuard) parts.push(`Needs new guard: ${st.newGuard === "yes" ? "Yes — sent to maintenance" : "No"}`);
  if (f.corrected && st.corrected) parts.push(`Corrected now: ${st.corrected === "yes" ? "Yes" : "No — flagged for investigation"}`);
  return parts.join(" · ");
};

export const joinComment = (...parts: (string | undefined)[]) =>
  parts.map((p) => p?.trim()).filter(Boolean).join(" · ") || undefined;

export interface GuardResult extends GuardFollowUpState {
  itemId: string;
  text: string;
  note?: string;
  photoUrl?: string; // guard-store URL; the server copies it
}

/**
 * Raise the maintenance tickets and investigations for one line's guards.
 * Returns how many were sent and which guards failed (so the caller can warn).
 */
export async function raiseGuardFollowUps(opts: {
  line: string;
  lineName: string;
  by: string;
  role: "operator" | "supervisor";
  submissionId?: string;
  guards: GuardResult[];
}) {
  let tickets = 0;
  let investigations = 0;
  const failed: string[] = [];
  for (const g of opts.guards) {
    const finding = FINDING[g.status ?? ""];
    if (!finding) continue;
    const needsTicket = g.status === "X" || (g.status === "M" && g.newGuard === "yes");
    const needsInvestigation = (g.status === "M" || g.status === "R") && g.corrected === "no";
    try {
      if (needsTicket) {
        await createMaintenanceTicket({
          line: opts.line,
          lineName: opts.lineName,
          issue: g.status === "X" ? "Broken guard" : "New guard needed",
          location: g.text,
          itemId: g.itemId,
          source: "",
          attempted: g.note || "",
          operator: opts.by,
          photoUrl: g.photoUrl,
          submissionId: opts.submissionId,
        });
        tickets++;
      }
      if (needsInvestigation) {
        await createInvestigation({
          type: "not-corrected",
          line: opts.line,
          lineName: opts.lineName,
          itemId: g.itemId,
          location: g.text,
          finding,
          foundBy: opts.by,
          foundByRole: opts.role,
          note: g.note || "",
          photoUrl: g.photoUrl,
          submissionId: opts.submissionId,
        });
        investigations++;
      }
    } catch {
      failed.push(g.text);
    }
  }
  return { tickets, investigations, failed };
}

/** Window before a walk-round in which an operator's Good tick is compared. */
export const FAKE_LOG_WINDOW_MS = 6 * 60 * 60 * 1000;

const stamp = (s: Submission) =>
  s.submittedAt ? Date.parse(s.submittedAt) : Date.parse(`${s.date}T${s.time || "00:00"}`);

/** The operator's latest Safety Guards submission for a line within the window before `at`. */
export const latestOperatorCheck = (subs: Submission[], line: string, at: number) =>
  subs
    .filter((s) => (s.kind || "line") === "safety" && String(s.line) === String(line))
    .filter((s) => {
      const t = stamp(s);
      return t <= at && at - t <= FAKE_LOG_WINDOW_MS;
    })
    .sort((a, b) => stamp(b) - stamp(a))[0];

export const submissionTime = stamp;

// --- Shifts ----------------------------------------------------------------------
// 12-hour shifts: day 07:00–19:00, night 19:00–07:00 (night belongs to the day it starts).
// Keep in step with server/report.js (SHIFT_START).
export const SHIFT_START_HOURS = { day: 7, night: 19 };
export const WALK_LINES_PER_SHIFT = 2;

export const shiftOf = (t: number) => {
  const d = new Date(t);
  const h = d.getHours();
  const base = new Date(d);
  if (h < SHIFT_START_HOURS.day) base.setDate(base.getDate() - 1); // early hours = previous night
  const pad = (n: number) => String(n).padStart(2, "0");
  const day = `${base.getFullYear()}-${pad(base.getMonth() + 1)}-${pad(base.getDate())}`;
  const shift: "day" | "night" = h >= SHIFT_START_HOURS.day && h < SHIFT_START_HOURS.night ? "day" : "night";
  return { day, shift, key: `${day}|${shift}` };
};

/** Start/end (ms) of a shift: day = <day> 07:00–19:00, night = <day> 19:00 → next day 07:00. */
export const shiftRange = (day: string, shift: "day" | "night") => {
  const d = new Date(`${day}T00:00`);
  const start = new Date(d);
  start.setHours(shift === "day" ? SHIFT_START_HOURS.day : SHIFT_START_HOURS.night, 0, 0, 0);
  const end = new Date(start);
  end.setHours(end.getHours() + 12);
  return { start: start.getTime(), end: end.getTime() };
};
