// All server access goes through here. For local testing this calls the
// Express backend in /server via the Vite proxy. To move to Lovable, swap the
// bodies of these functions for Supabase calls — callers stay the same.

import type { LineCard } from "@/data/lines";

// "supervisor" = one walk-round over every line's safety guards (+ water on floor).
export type ChecklistKind = "line" | "safety" | "supervisor";

// status: "" (none) | line: "ok" | "fail" | safety: "good" | "X" | "R" | "M"
export interface SubmissionItem {
  id: string;
  text: string;
  status: string;
  value?: string;
  comment?: string;
  /** Defect photo captured at fill time for an X/R guard (URL into guard-photo-files). */
  photoUrl?: string;
}

export interface Submission {
  id?: string;
  submittedAt?: string;
  kind: ChecklistKind;
  date: string;
  time: string;
  line: string;
  lineName: string;
  title: string;
  revision: string;
  operator: string;
  fields: Record<string, string>;
  items: SubmissionItem[];
  completed: number;
  total: number;
  issues: number;
}

export interface SubmissionFilters {
  line?: string;
  kind?: ChecklistKind;
  operator?: string;
  date?: string;
}

export async function submitChecklist(payload: Submission): Promise<Submission> {
  const res = await fetch("/api/submissions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const msg = await res.json().catch(() => ({}));
    throw new Error(msg.error || `Save failed (HTTP ${res.status})`);
  }
  return res.json();
}

export async function fetchSubmissions(
  filters: SubmissionFilters = {}
): Promise<Submission[]> {
  const qs = new URLSearchParams();
  if (filters.line) qs.set("line", filters.line);
  if (filters.kind) qs.set("kind", filters.kind);
  if (filters.operator) qs.set("operator", filters.operator);
  if (filters.date) qs.set("date", filters.date);
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  const res = await fetch(`/api/submissions${suffix}`);
  if (!res.ok) throw new Error(`Failed to load submissions (HTTP ${res.status})`);
  return res.json();
}

export async function updateSubmission(
  id: string,
  payload: Partial<Submission>
): Promise<Submission> {
  const res = await fetch(`/api/submissions/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const msg = await res.json().catch(() => ({}));
    throw new Error(msg.error || `Update failed (HTTP ${res.status})`);
  }
  return res.json();
}

export async function deleteSubmission(id: string): Promise<void> {
  const res = await fetch(`/api/submissions/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`Delete failed (HTTP ${res.status})`);
}

// --- Checklist definitions (editable, backend-stored) -----------------------

export async function fetchChecklists(): Promise<LineCard[]> {
  const res = await fetch("/api/checklists");
  if (!res.ok) throw new Error(`Failed to load checklists (HTTP ${res.status})`);
  return res.json();
}

export async function saveChecklists(lines: LineCard[]): Promise<LineCard[]> {
  const res = await fetch("/api/checklists", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(lines),
  });
  if (!res.ok) throw new Error(`Failed to save checklists (HTTP ${res.status})`);
  return res.json();
}

// --- Guard photos (central per-guard timeline, not tied to a submission) ----

// "reference" — the expected look for a guard, set in Edit mode (one per guard).
// "defect" — an operator's photo of something wrong (only when X/R is marked).
export type GuardPhotoKind = "reference" | "defect";

export interface GuardPhoto {
  id: string;
  line: string;
  itemId: string;
  itemText: string;
  kind: GuardPhotoKind;
  /** For defect photos only: the mark that triggered it ("X" | "R"). */
  status?: string;
  operator: string;
  uploadedAt: string;
  url: string;
}

export async function fetchGuardPhotos(
  params: { line?: string; itemId?: string; kind?: GuardPhotoKind } = {}
): Promise<GuardPhoto[]> {
  const qs = new URLSearchParams();
  if (params.line) qs.set("line", params.line);
  if (params.itemId) qs.set("itemId", params.itemId);
  if (params.kind) qs.set("kind", params.kind);
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  const res = await fetch(`/api/guard-photos${suffix}`);
  if (!res.ok) throw new Error(`Failed to load guard photos (HTTP ${res.status})`);
  return res.json();
}

export async function uploadGuardPhoto(payload: {
  line: string;
  itemId: string;
  itemText?: string;
  operator?: string;
  image: string; // base64 data URL (client-compressed)
  kind?: GuardPhotoKind; // defaults to "defect" server-side
  status?: string; // defect photos: "X" | "R"
}): Promise<GuardPhoto> {
  const res = await fetch("/api/guard-photos", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const msg = await res.json().catch(() => ({}));
    throw new Error(msg.error || `Upload failed (HTTP ${res.status})`);
  }
  return res.json();
}

export async function deleteGuardPhoto(id: string): Promise<void> {
  const res = await fetch(`/api/guard-photos/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`Delete failed (HTTP ${res.status})`);
}

// --- Maintenance tickets (raised from the line checklist) --------------------

export type TicketStatus = "open" | "closed";

export interface MaintenanceTicket {
  id: string;
  createdAt: string;
  status: TicketStatus;
  line: string;
  lineName: string;
  issue: string; // e.g. "Water on floor", "Broken guard", "New guard needed"
  location?: string; // guard tickets: the guard
  itemId?: string;
  source: string;
  attempted: string; // attempted resolutions, and by whom
  operator: string;
  photoUrl?: string;
  submissionId?: string;
  closedAt?: string;
  closedBy?: string;
  closeNote?: string;
}

export async function fetchMaintenanceTickets(
  params: { status?: TicketStatus; line?: string } = {}
): Promise<MaintenanceTicket[]> {
  const qs = new URLSearchParams();
  if (params.status) qs.set("status", params.status);
  if (params.line) qs.set("line", params.line);
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  const res = await fetch(`/api/maintenance${suffix}`);
  if (!res.ok) throw new Error(`Failed to load maintenance tickets (HTTP ${res.status})`);
  return res.json();
}

export async function createMaintenanceTicket(payload: {
  line: string;
  lineName: string;
  issue: string;
  location?: string;
  itemId?: string;
  source: string;
  attempted: string;
  operator: string;
  photoUrl?: string; // guard-photo URL; the server keeps its own copy
  submissionId?: string;
}): Promise<MaintenanceTicket> {
  const res = await fetch("/api/maintenance", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const msg = await res.json().catch(() => ({}));
    throw new Error(msg.error || `Ticket failed (HTTP ${res.status})`);
  }
  return res.json();
}

export async function updateMaintenanceTicket(
  id: string,
  payload: { status: TicketStatus; closedBy?: string; closeNote?: string }
): Promise<MaintenanceTicket> {
  const res = await fetch(`/api/maintenance/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const msg = await res.json().catch(() => ({}));
    throw new Error(msg.error || `Update failed (HTTP ${res.status})`);
  }
  return res.json();
}

// --- Investigations ------------------------------------------------------------
// "not-corrected": a guard found Missing / not installed properly and not fixed.
// "fake-log": the operator ticked a guard Good, then the supervisor walk-round
// (within 6 h) found it Broken / Missing / not installed.

export type InvestigationType = "not-corrected" | "fake-log";

export interface Investigation {
  id: string;
  createdAt: string;
  status: TicketStatus;
  type: InvestigationType;
  line: string;
  lineName: string;
  itemId?: string;
  location: string; // the guard
  finding: string; // "Missing" | "Not installed properly" | "Broken"
  foundBy: string;
  foundByRole: "operator" | "supervisor";
  note: string;
  photoUrl?: string;
  submissionId?: string;
  operator?: string; // fake-log: who ticked it Good
  operatorSubmissionId?: string;
  operatorAt?: string;
  closedAt?: string;
  closedBy?: string;
  outcome?: string;
}

export async function fetchInvestigations(
  params: { status?: TicketStatus; line?: string; type?: InvestigationType } = {}
): Promise<Investigation[]> {
  const qs = new URLSearchParams();
  if (params.status) qs.set("status", params.status);
  if (params.line) qs.set("line", params.line);
  if (params.type) qs.set("type", params.type);
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  const res = await fetch(`/api/investigations${suffix}`);
  if (!res.ok) throw new Error(`Failed to load investigations (HTTP ${res.status})`);
  return res.json();
}

export async function createInvestigation(
  payload: Omit<Investigation, "id" | "createdAt" | "status" | "closedAt" | "closedBy" | "outcome">
): Promise<Investigation> {
  const res = await fetch("/api/investigations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const msg = await res.json().catch(() => ({}));
    throw new Error(msg.error || `Investigation failed (HTTP ${res.status})`);
  }
  return res.json();
}

export async function updateInvestigation(
  id: string,
  payload: { status: TicketStatus; closedBy?: string; outcome?: string }
): Promise<Investigation> {
  const res = await fetch(`/api/investigations/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const msg = await res.json().catch(() => ({}));
    throw new Error(msg.error || `Update failed (HTTP ${res.status})`);
  }
  return res.json();
}

// --- Shift-report email ------------------------------------------------------------

export interface EmailRecipient {
  email: string;
  name?: string;
  active: boolean;
}

export interface EmailSettings {
  recipients: EmailRecipient[];
  auto: boolean; // email the daily (07:00 → 07:00) report at 07:05
  smtp: { host?: string; port?: number; user?: string; pass?: string; from?: string; passSet?: boolean };
  lastSentKey?: string;
  lastSentAt?: number;
  lastError?: string | null;
}

export async function fetchEmailSettings(): Promise<EmailSettings> {
  const res = await fetch("/api/email-settings");
  if (!res.ok) throw new Error(`Failed to load email settings (HTTP ${res.status})`);
  return res.json();
}

export async function saveEmailSettings(cfg: EmailSettings): Promise<EmailSettings> {
  const res = await fetch("/api/email-settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(cfg),
  });
  if (!res.ok) throw new Error(`Failed to save email settings (HTTP ${res.status})`);
  return res.json();
}

/** The daily report (07:00 → 07:00 of `day`) as email-ready HTML — the page shows the same. */
export async function fetchDailyReport(day: string): Promise<{ subject: string; html: string }> {
  const res = await fetch(`/api/shift-report?day=${encodeURIComponent(day)}`);
  if (!res.ok) throw new Error(`Failed to load the report (HTTP ${res.status})`);
  return res.json();
}

/** Email the daily report to the active recipients, or only to `testTo`. */
export async function emailShiftReport(day: string, testTo?: string): Promise<string[]> {
  const res = await fetch("/api/email-report", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ day, testTo }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Send failed (HTTP ${res.status})`);
  return body.sent;
}
