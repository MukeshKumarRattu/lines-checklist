// All server access goes through here. For local testing this calls the
// Express backend in /server via the Vite proxy. To move to Lovable, swap the
// bodies of these functions for Supabase calls — callers stay the same.

import type { LineCard } from "@/data/lines";

export type ChecklistKind = "line" | "safety";

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
