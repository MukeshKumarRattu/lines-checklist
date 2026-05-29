import line1 from "./line-1.json";
import line2 from "./line-2.json";
import line3 from "./line-3.json";
import line4 from "./line-4.json";
import line5 from "./line-5.json";
import line7 from "./line-7.json";
import line8 from "./line-8.json";
import line9 from "./line-9.json";
import line10 from "./line-10.json";
import line11 from "./line-11.json";
import line12 from "./line-12.json";

import safety1 from "./safety-1.json";
import safety2 from "./safety-2.json";
import safety3 from "./safety-3.json";
import safety4 from "./safety-4.json";
import safety5 from "./safety-5.json";
import safety7 from "./safety-7.json";
import safety8 from "./safety-8.json";
import safety9 from "./safety-9.json";
import safety10 from "./safety-10.json";
import safety11 from "./safety-11.json";
import safety12 from "./safety-12.json";

export interface ChecklistItem {
  id: string;
  text: string;
  /** When true, the row shows an inline value box (e.g. "# OF WEIGHTS" -> 3). */
  needsValue?: boolean;
  /** Expected state shown as a pill (safety guards: BOLTED / INPLACE). */
  badge?: string;
}

export interface ChecklistData {
  id: string;
  name: string;
  title: string;
  revision: string;
  headerFields: string[];
  items: ChecklistItem[];
  /** Optional instruction line (safety guards: "complete 2x per shift"). */
  note?: string;
  /** Optional reference legend (safety guards mark meanings). */
  legend?: string[];
}

export interface LineCard {
  id: string; // route param, e.g. "1"
  name: string; // "Line 1"
  available: boolean;
  data: ChecklistData; // the line checklist
  safety: ChecklistData; // the safety guards checklist
}

// DATE / TIME are auto-detected at submit time, so they are never shown as inputs.
export const AUTO_FIELDS = ["DATE", "TIME"];

const lineById: Record<string, ChecklistData> = {
  "1": line1 as ChecklistData,
  "2": line2 as ChecklistData,
  "3": line3 as ChecklistData,
  "4": line4 as ChecklistData,
  "5": line5 as ChecklistData,
  "7": line7 as ChecklistData,
  "8": line8 as ChecklistData,
  "9": line9 as ChecklistData,
  "10": line10 as ChecklistData,
  "11": line11 as ChecklistData,
  "12": line12 as ChecklistData,
};

const safetyById: Record<string, ChecklistData> = {
  "1": safety1 as ChecklistData,
  "2": safety2 as ChecklistData,
  "3": safety3 as ChecklistData,
  "4": safety4 as ChecklistData,
  "5": safety5 as ChecklistData,
  "7": safety7 as ChecklistData,
  "8": safety8 as ChecklistData,
  "9": safety9 as ChecklistData,
  "10": safety10 as ChecklistData,
  "11": safety11 as ChecklistData,
  "12": safety12 as ChecklistData,
};

// Line 6 intentionally absent — no Line #6 main checklist exists in the source.
// These are the bundled DEFAULTS — used to seed the backend on first run and as
// a fallback while the editable backend copy is loading. The live app reads the
// backend copy via the useChecklists() hook.
export const DEFAULT_LINES: LineCard[] = [
  "1", "2", "3", "4", "5", "7", "8", "9", "10", "11", "12",
].map((id) => ({
  id,
  name: lineById[id].name,
  available: true,
  data: lineById[id],
  safety: safetyById[id],
}));

/** Bundled default checklists. Prefer the useChecklists() hook in components. */
export const lines: LineCard[] = DEFAULT_LINES;

export function getLine(id: string | undefined): LineCard | undefined {
  return id ? lines.find((l) => l.id === id) : undefined;
}

/** Header fields shown as inputs (everything except the auto date/time). */
export function inputFields(data: ChecklistData): string[] {
  return data.headerFields.filter((f) => !AUTO_FIELDS.includes(f.toUpperCase()));
}
