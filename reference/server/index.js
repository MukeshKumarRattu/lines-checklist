import express from "express";
import cors from "cors";
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync, copyFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import nodemailer from "nodemailer";
import { MAX_EMAIL_IMAGES, buildDailyReport, dayRange, previousReportDay } from "./report.js";

// ---------------------------------------------------------------------------
// Tiny JSON-file data store. This is the "separate database" for local testing
// — completely independent of the production_system DB. When this app moves to
// Lovable, replace these two helpers + the routes with Supabase calls; the
// frontend talks to /api/* so its code does not change.
// ---------------------------------------------------------------------------
const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "data");
const DB_FILE = join(DATA_DIR, "submissions.json");
const CL_FILE = join(DATA_DIR, "checklists.json"); // editable checklist definitions
// Guard photos: a central, per-guard timeline (line + itemId), independent of
// submissions. Files live in PHOTO_DIR; PHOTO_INDEX is the metadata timeline.
const PHOTO_DIR = join(DATA_DIR, "guard-photos");
const PHOTO_INDEX = join(DATA_DIR, "guard-photos.json");
// Submission-owned photo copies. A defect photo taken on the form is copied here
// when the report is submitted, so the submission keeps its image even if the
// original is later deleted from the Defected Guards gallery. These are only
// removed by editing the submission (or deleting it) in Edit mode.
const SUB_PHOTO_DIR = join(DATA_DIR, "submission-photos");
// Maintenance tickets (raised from the line checklist, e.g. water on floor not
// fixed). Each ticket keeps its own photo copy, like submissions do.
const MAINT_FILE = join(DATA_DIR, "maintenance.json");
const MAINT_PHOTO_DIR = join(DATA_DIR, "maintenance-photos");
// Investigations: guards found missing / not installed properly and NOT
// corrected, and "fake logs" (operator ticked Good, supervisor walk-round found
// it wrong). Photos share the maintenance photo dir.
const INV_FILE = join(DATA_DIR, "investigations.json");
// Daily-report email: recipients (each can be switched on/off), SMTP account,
// auto-send once a day at 07:05 for the 07:00 → 07:00 day just ended. Holds the SMTP password — keep private.
const EMAIL_FILE = join(DATA_DIR, "email.json");

if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
if (!existsSync(DB_FILE)) writeFileSync(DB_FILE, "[]");
if (!existsSync(PHOTO_DIR)) mkdirSync(PHOTO_DIR, { recursive: true });
if (!existsSync(PHOTO_INDEX)) writeFileSync(PHOTO_INDEX, "[]");
if (!existsSync(SUB_PHOTO_DIR)) mkdirSync(SUB_PHOTO_DIR, { recursive: true });
if (!existsSync(MAINT_FILE)) writeFileSync(MAINT_FILE, "[]");
if (!existsSync(MAINT_PHOTO_DIR)) mkdirSync(MAINT_PHOTO_DIR, { recursive: true });
if (!existsSync(INV_FILE)) writeFileSync(INV_FILE, "[]");

const readAll = () => {
  try {
    return JSON.parse(readFileSync(DB_FILE, "utf-8"));
  } catch {
    return [];
  }
};
const writeAll = (rows) => writeFileSync(DB_FILE, JSON.stringify(rows, null, 2));

const readChecklists = () => {
  try {
    return JSON.parse(readFileSync(CL_FILE, "utf-8"));
  } catch {
    return [];
  }
};
const writeChecklists = (data) => writeFileSync(CL_FILE, JSON.stringify(data, null, 2));

const readPhotos = () => {
  try {
    return JSON.parse(readFileSync(PHOTO_INDEX, "utf-8"));
  } catch {
    return [];
  }
};
const writePhotos = (rows) => writeFileSync(PHOTO_INDEX, JSON.stringify(rows, null, 2));

const readTickets = () => {
  try {
    return JSON.parse(readFileSync(MAINT_FILE, "utf-8"));
  } catch {
    return [];
  }
};
const writeTickets = (rows) => writeFileSync(MAINT_FILE, JSON.stringify(rows, null, 2));

const readInvestigations = () => {
  try {
    return JSON.parse(readFileSync(INV_FILE, "utf-8"));
  } catch {
    return [];
  }
};
const writeInvestigations = (rows) => writeFileSync(INV_FILE, JSON.stringify(rows, null, 2));

// --- Submission-owned photo copies -----------------------------------------
const GUARD_PHOTO_PREFIX = "/api/guard-photo-files/";
const SUB_PHOTO_PREFIX = "/api/submission-photo-files/";

// Copy a guard-photo file into a submission-owned file and return its new URL.
// Returns null if it can't make an independent copy — the caller then drops the
// photo rather than letting the submission share the deletable guard-photo file.
const copyGuardPhotoToSubmission = (photoUrl) => {
  if (typeof photoUrl !== "string") return null;
  if (photoUrl.startsWith(SUB_PHOTO_PREFIX)) return photoUrl; // already submission-owned
  if (!photoUrl.startsWith(GUARD_PHOTO_PREFIX)) return null;
  const fname = photoUrl.slice(GUARD_PHOTO_PREFIX.length);
  const src = join(PHOTO_DIR, fname);
  if (!existsSync(src)) return null;
  const ext = fname.includes(".") ? fname.split(".").pop() : "jpg";
  const dest = `${randomUUID()}.${ext}`;
  try {
    copyFileSync(src, join(SUB_PHOTO_DIR, dest));
    return `${SUB_PHOTO_PREFIX}${dest}`;
  } catch {
    return null;
  }
};

const deleteSubmissionPhotoByUrl = (photoUrl) => {
  if (typeof photoUrl !== "string" || !photoUrl.startsWith(SUB_PHOTO_PREFIX)) return;
  try {
    const fp = join(SUB_PHOTO_DIR, photoUrl.slice(SUB_PHOTO_PREFIX.length));
    if (existsSync(fp)) unlinkSync(fp);
  } catch {
    /* ignore */
  }
};

const itemPhotoUrls = (items) =>
  (Array.isArray(items) ? items : []).map((it) => it && it.photoUrl).filter(Boolean);

const app = express();
app.use(cors());
// Limit is generous because client-compressed photos arrive as base64 in the body.
app.use(express.json({ limit: "12mb" }));
// Serve the stored photo files under /api/* so the frontend's existing proxy reaches them.
app.use("/api/guard-photo-files", express.static(PHOTO_DIR));
app.use("/api/submission-photo-files", express.static(SUB_PHOTO_DIR));
app.use("/api/maintenance-photo-files", express.static(MAINT_PHOTO_DIR));

app.get("/api/health", (_req, res) => res.json({ ok: true }));

// List submissions, newest first, with optional filters.
app.get("/api/submissions", (req, res) => {
  let rows = readAll();
  const { line, operator, date, kind } = req.query;
  if (line) rows = rows.filter((r) => String(r.line) === String(line));
  if (kind) rows = rows.filter((r) => (r.kind || "line") === kind);
  if (operator)
    rows = rows.filter((r) =>
      (r.operator || "").toLowerCase().includes(String(operator).toLowerCase())
    );
  if (date) rows = rows.filter((r) => r.date === date);
  rows.sort((a, b) => (b.submittedAt || "").localeCompare(a.submittedAt || ""));
  res.json(rows);
});

// Save one completed checklist, keyed by date / time / operator / line.
app.post("/api/submissions", (req, res) => {
  const body = req.body || {};
  if (!body.operator || !String(body.operator).trim())
    return res.status(400).json({ error: "Operator is required" });
  if (!body.line) return res.status(400).json({ error: "Line is required" });

  const now = new Date();
  // Give the submission its own copy of any defect photo, so deleting the
  // original from Defected Guards never breaks the report. If the copy can't be
  // made, drop the photo rather than reference the deletable guard-photo file.
  const items = (Array.isArray(body.items) ? body.items : []).map((it) => {
    if (!it || !it.photoUrl) return it;
    const copied = copyGuardPhotoToSubmission(it.photoUrl);
    if (copied) return { ...it, photoUrl: copied };
    const { photoUrl, ...rest } = it;
    return rest;
  });
  const record = {
    id: randomUUID(),
    submittedAt: now.toISOString(),
    kind: body.kind === "safety" || body.kind === "supervisor" ? body.kind : "line",
    date: body.date || now.toISOString().slice(0, 10),
    time: body.time || now.toTimeString().slice(0, 5),
    line: String(body.line),
    lineName: body.lineName || `Line ${body.line}`,
    title: body.title || "",
    revision: body.revision || "",
    operator: String(body.operator).trim(),
    fields: body.fields || {},
    items,
    completed: Number(body.completed) || 0,
    total: Number(body.total) || 0,
    issues: Number(body.issues) || 0,
  };

  const rows = readAll();
  rows.push(record);
  writeAll(rows);
  res.status(201).json(record);
});

// Edit one submission (operator / date / time / product fields, and items if sent).
app.put("/api/submissions/:id", (req, res) => {
  const rows = readAll();
  const i = rows.findIndex((r) => r.id === req.params.id);
  if (i === -1) return res.status(404).json({ error: "Submission not found" });

  const body = req.body || {};
  const cur = rows[i];
  const updated = {
    ...cur,
    operator: body.operator !== undefined ? String(body.operator).trim() : cur.operator,
    date: body.date ?? cur.date,
    time: body.time ?? cur.time,
    fields: body.fields ?? cur.fields,
    items: Array.isArray(body.items) ? body.items : cur.items,
  };
  // Recompute the summary counts whenever the items change.
  if (Array.isArray(body.items)) {
    // A photo dropped during this edit is deleted from disk (Edit-mode only).
    const newUrls = new Set(itemPhotoUrls(body.items));
    for (const u of itemPhotoUrls(cur.items)) if (!newUrls.has(u)) deleteSubmissionPhotoByUrl(u);
    updated.total = updated.items.length;
    updated.completed = updated.items.filter((it) => it.status).length;
    updated.issues = updated.items.filter(
      (it) => it.status && it.status !== "ok" && it.status !== "good"
    ).length;
  }
  rows[i] = updated;
  writeAll(rows);
  res.json(updated);
});

// Delete one submission.
app.delete("/api/submissions/:id", (req, res) => {
  const rows = readAll();
  const rec = rows.find((r) => r.id === req.params.id);
  if (!rec) return res.status(404).json({ error: "Submission not found" });
  // Remove this report's own photo copies from disk.
  itemPhotoUrls(rec.items).forEach(deleteSubmissionPhotoByUrl);
  writeAll(rows.filter((r) => r.id !== req.params.id));
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Checklist definitions. Seeded from the frontend's bundled JSON on first save
// (PUT). The Edit screen reads these, edits them, and writes the whole set back.
// ---------------------------------------------------------------------------
app.get("/api/checklists", (_req, res) => res.json(readChecklists()));

app.put("/api/checklists", (req, res) => {
  const data = Array.isArray(req.body) ? req.body : [];
  writeChecklists(data);
  pruneOrphanReferencePhotos(data); // drop reference photos for deleted guards
  res.json(data);
});

// ---------------------------------------------------------------------------
// Guard photos. A central, per-guard timeline keyed by line + itemId — NOT
// attached to individual submissions. A new upload appends to that guard's
// history so you can compare the guard "before vs now" over time.
// ---------------------------------------------------------------------------
// Two kinds of guard photo share this store:
//  - "reference": the expected/correct image for a guard. At most ONE per
//    (line, itemId); only set from Edit mode. Shown read-only on the form.
//  - "defect": captured by an operator when they mark a guard X or R. A
//    timeline (many per guard); shown only on the Defected Guards tab.
// Records written before this split have no `kind` — treat them as reference.
const photoKind = (r) => (r.kind === "defect" ? "defect" : "reference");

app.get("/api/guard-photos", (req, res) => {
  let rows = readPhotos();
  const { line, itemId, kind } = req.query;
  if (line) rows = rows.filter((r) => String(r.line) === String(line));
  if (itemId) rows = rows.filter((r) => r.itemId === itemId);
  if (kind) rows = rows.filter((r) => photoKind(r) === kind);
  rows.sort((a, b) => (b.uploadedAt || "").localeCompare(a.uploadedAt || "")); // newest first
  res.json(rows);
});

const deletePhotoFile = (rec) => {
  try {
    const fname = (rec.url || "").split("/").pop();
    if (fname) {
      const fp = join(PHOTO_DIR, fname);
      if (existsSync(fp)) unlinkSync(fp);
    }
  } catch {
    /* ignore file removal errors */
  }
};

// Remove REFERENCE photos whose guard (line + itemId) no longer exists in the
// saved safety checklists. Defect photos are a timeline and are never pruned.
// Skips entirely if the saved set has no guards, so a bad/empty PUT can't wipe
// every reference photo.
const pruneOrphanReferencePhotos = (lines) => {
  const valid = new Set();
  for (const l of Array.isArray(lines) ? lines : []) {
    const items = l && l.safety && l.safety.items;
    if (Array.isArray(items)) for (const it of items) if (it && it.id) valid.add(`${l.id}:${it.id}`);
  }
  if (!valid.size) return;
  const rows = readPhotos();
  const keep = [];
  let removed = 0;
  for (const r of rows) {
    if (photoKind(r) === "reference" && !valid.has(`${r.line}:${r.itemId}`)) {
      deletePhotoFile(r);
      removed++;
    } else {
      keep.push(r);
    }
  }
  if (removed) {
    writePhotos(keep);
    console.log(`[lines-checklist] pruned ${removed} orphan reference photo(s)`);
  }
};

app.post("/api/guard-photos", (req, res) => {
  const { line, itemId, itemText, operator, image, status } = req.body || {};
  if (!line || !itemId) return res.status(400).json({ error: "line and itemId are required" });
  const kind = req.body?.kind === "reference" ? "reference" : "defect";
  const m = /^data:image\/(png|jpe?g|webp);base64,(.+)$/i.exec(String(image || ""));
  if (!m) return res.status(400).json({ error: "image must be a base64 data URL" });
  const ext = m[1].toLowerCase() === "png" ? "png" : m[1].toLowerCase() === "webp" ? "webp" : "jpg";
  const id = randomUUID();
  writeFileSync(join(PHOTO_DIR, `${id}.${ext}`), Buffer.from(m[2], "base64"));
  const record = {
    id,
    line: String(line),
    itemId: String(itemId),
    itemText: itemText || "",
    kind,
    // Only meaningful for defect photos: which mark triggered it ("X" / "R").
    status: kind === "defect" ? String(status || "") : "",
    operator: (operator || "").trim(),
    uploadedAt: new Date().toISOString(),
    url: `/api/guard-photo-files/${id}.${ext}`,
  };
  let rows = readPhotos();
  // A guard keeps at most one reference photo — replace any existing one.
  if (kind === "reference") {
    const isSameRef = (r) =>
      photoKind(r) === "reference" && String(r.line) === String(line) && r.itemId === String(itemId);
    rows.filter(isSameRef).forEach(deletePhotoFile);
    rows = rows.filter((r) => !isSameRef(r));
  }
  rows.push(record);
  writePhotos(rows);
  res.status(201).json(record);
});

app.delete("/api/guard-photos/:id", (req, res) => {
  const rows = readPhotos();
  const rec = rows.find((r) => r.id === req.params.id);
  if (!rec) return res.status(404).json({ error: "Photo not found" });
  deletePhotoFile(rec);
  writePhotos(rows.filter((r) => r.id !== req.params.id));
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Maintenance tickets. Raised by the operator from the line checklist (water on
// floor that wasn't fixed); maintenance closes them from the Maintenance page.
// ---------------------------------------------------------------------------
const MAINT_PHOTO_PREFIX = "/api/maintenance-photo-files/";

// Give the ticket its own copy of the operator's photo (the guard-store original
// is cleaned up by the form after submit).
const copyGuardPhotoToTicket = (photoUrl) => {
  if (typeof photoUrl !== "string" || !photoUrl.startsWith(GUARD_PHOTO_PREFIX)) return undefined;
  const fname = photoUrl.slice(GUARD_PHOTO_PREFIX.length);
  const src = join(PHOTO_DIR, fname);
  if (!existsSync(src)) return undefined;
  const ext = fname.includes(".") ? fname.split(".").pop() : "jpg";
  const dest = `${randomUUID()}.${ext}`;
  try {
    copyFileSync(src, join(MAINT_PHOTO_DIR, dest));
    return `${MAINT_PHOTO_PREFIX}${dest}`;
  } catch {
    return undefined;
  }
};

app.get("/api/maintenance", (req, res) => {
  let rows = readTickets();
  const { status, line } = req.query;
  if (status) rows = rows.filter((r) => r.status === status);
  if (line) rows = rows.filter((r) => String(r.line) === String(line));
  rows.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  res.json(rows);
});

app.post("/api/maintenance", (req, res) => {
  const b = req.body || {};
  if (!b.line) return res.status(400).json({ error: "Line is required" });
  if (!b.operator || !String(b.operator).trim())
    return res.status(400).json({ error: "Operator is required" });
  const record = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    status: "open",
    line: String(b.line),
    lineName: b.lineName || `Line ${b.line}`,
    issue: String(b.issue || "").trim(),
    location: b.location ? String(b.location).trim() : undefined, // guard tickets: which guard
    itemId: b.itemId || undefined,
    source: String(b.source || "").trim(),
    attempted: String(b.attempted || "").trim(),
    operator: String(b.operator).trim(),
    photoUrl: copyGuardPhotoToTicket(b.photoUrl),
    submissionId: b.submissionId || undefined,
  };
  const rows = readTickets();
  rows.push(record);
  writeTickets(rows);
  res.status(201).json(record);
});

// Close (fixed) or reopen a ticket.
app.put("/api/maintenance/:id", (req, res) => {
  const rows = readTickets();
  const i = rows.findIndex((r) => r.id === req.params.id);
  if (i === -1) return res.status(404).json({ error: "Ticket not found" });
  const b = req.body || {};
  const cur = rows[i];
  if (b.status === "closed") {
    if (!b.closedBy || !String(b.closedBy).trim())
      return res.status(400).json({ error: "Enter who fixed it" });
    rows[i] = {
      ...cur,
      status: "closed",
      closedAt: new Date().toISOString(),
      closedBy: String(b.closedBy).trim(),
      closeNote: String(b.closeNote || "").trim(),
    };
  } else if (b.status === "open") {
    const { closedAt, closedBy, closeNote, ...rest } = cur;
    rows[i] = { ...rest, status: "open" };
  }
  writeTickets(rows);
  res.json(rows[i]);
});

// ---------------------------------------------------------------------------
// Investigations (see INV_FILE). type: "not-corrected" | "fake-log".
// ---------------------------------------------------------------------------
app.get("/api/investigations", (req, res) => {
  let rows = readInvestigations();
  const { status, line, type } = req.query;
  if (status) rows = rows.filter((r) => r.status === status);
  if (line) rows = rows.filter((r) => String(r.line) === String(line));
  if (type) rows = rows.filter((r) => r.type === type);
  rows.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  res.json(rows);
});

app.post("/api/investigations", (req, res) => {
  const b = req.body || {};
  if (!b.line) return res.status(400).json({ error: "Line is required" });
  if (b.type !== "not-corrected" && b.type !== "fake-log")
    return res.status(400).json({ error: "type must be not-corrected or fake-log" });
  const record = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    status: "open",
    type: b.type,
    line: String(b.line),
    lineName: b.lineName || `Line ${b.line}`,
    itemId: b.itemId || undefined,
    location: String(b.location || "").trim(),
    finding: String(b.finding || "").trim(),
    foundBy: String(b.foundBy || "").trim(),
    foundByRole: b.foundByRole === "supervisor" ? "supervisor" : "operator",
    note: String(b.note || "").trim(),
    photoUrl: copyGuardPhotoToTicket(b.photoUrl),
    submissionId: b.submissionId || undefined,
    // fake-log only: the operator checklist that ticked the guard Good
    operator: b.operator ? String(b.operator).trim() : undefined,
    operatorSubmissionId: b.operatorSubmissionId || undefined,
    operatorAt: b.operatorAt || undefined,
  };
  const rows = readInvestigations();
  rows.push(record);
  writeInvestigations(rows);
  res.status(201).json(record);
});

app.put("/api/investigations/:id", (req, res) => {
  const rows = readInvestigations();
  const i = rows.findIndex((r) => r.id === req.params.id);
  if (i === -1) return res.status(404).json({ error: "Investigation not found" });
  const b = req.body || {};
  const cur = rows[i];
  if (b.status === "closed") {
    if (!b.closedBy || !String(b.closedBy).trim())
      return res.status(400).json({ error: "Enter who investigated it" });
    rows[i] = {
      ...cur,
      status: "closed",
      closedAt: new Date().toISOString(),
      closedBy: String(b.closedBy).trim(),
      outcome: String(b.outcome || "").trim(),
    };
  } else if (b.status === "open") {
    const { closedAt, closedBy, outcome, ...rest } = cur;
    rows[i] = { ...rest, status: "open" };
  }
  writeInvestigations(rows);
  res.json(rows[i]);
});

// ---------------------------------------------------------------------------
// One-page shift report + email
// ---------------------------------------------------------------------------
const readEmail = () => {
  try {
    return JSON.parse(readFileSync(EMAIL_FILE, "utf-8"));
  } catch {
    return { recipients: [], auto: false, smtp: {} };
  }
};
const writeEmail = (cfg) => writeFileSync(EMAIL_FILE, JSON.stringify(cfg, null, 2));
// Never send the password back to the browser.
const publicEmail = (cfg) => {
  const { pass, ...smtp } = cfg.smtp || {};
  return { ...cfg, smtp: { ...smtp, passSet: !!pass } };
};

const reportFor = (day, img) =>
  buildDailyReport({
    day,
    img,
    lines: readChecklists(),
    submissions: readAll(),
    tickets: readTickets(),
    investigations: readInvestigations(),
  });

const sendReport = async (day, to) => {
  const cfg = readEmail();
  const smtp = cfg.smtp || {};
  if (!smtp.host || !smtp.from) throw new Error("Email is not set up — fill in the mail server and From address.");
  const recipients = to ? [to] : (cfg.recipients || []).filter((r) => r.active).map((r) => r.email);
  if (!recipients.length) throw new Error("No active recipients.");
  const transport = nodemailer.createTransport({
    host: smtp.host,
    port: Number(smtp.port) || 587,
    secure: Number(smtp.port) === 465,
    auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
  });
  // Photos go inside the email (cid: attachments) so they show outside the plant network.
  const dirs = [
    [GUARD_PHOTO_PREFIX, PHOTO_DIR],
    [SUB_PHOTO_PREFIX, SUB_PHOTO_DIR],
    [MAINT_PHOTO_PREFIX, MAINT_PHOTO_DIR],
  ];
  const attachments = [];
  const cids = new Map();
  const img = (url) => {
    if (cids.has(url)) return cids.get(url);
    const hit = dirs.find(([prefix]) => url.startsWith(prefix));
    const fp = hit && join(hit[1], basename(url.slice(hit[0].length)));
    if (!fp || !existsSync(fp) || attachments.length >= MAX_EMAIL_IMAGES) return null;
    const cid = `photo${attachments.length}@lines-checklist`;
    attachments.push({ filename: basename(fp), path: fp, cid });
    cids.set(url, `cid:${cid}`);
    return `cid:${cid}`;
  };
  const { subject, html } = reportFor(day, img);
  await transport.sendMail({
    from: smtp.from,
    to: recipients.join(", "),
    subject: to ? `[TEST] ${subject}` : subject,
    html,
    attachments,
  });
  return recipients;
};

app.get("/api/shift-report", (req, res) => {
  const { day } = req.query;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(day || ""))) return res.status(400).json({ error: "day (YYYY-MM-DD) required" });
  res.json(reportFor(String(day)));
});

app.get("/api/email-settings", (_req, res) => res.json(publicEmail(readEmail())));

app.put("/api/email-settings", (req, res) => {
  const b = req.body || {};
  const cur = readEmail();
  const recipients = (Array.isArray(b.recipients) ? b.recipients : [])
    .map((r) => ({ email: String(r.email || "").trim(), name: String(r.name || "").trim(), active: r.active !== false }))
    .filter((r) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(r.email));
  const smtp = { ...(cur.smtp || {}), ...(b.smtp || {}) };
  delete smtp.passSet;
  if (!b.smtp?.pass) smtp.pass = cur.smtp?.pass; // blank = keep the saved password
  const next = { ...cur, recipients, auto: !!b.auto, smtp };
  writeEmail(next);
  res.json(publicEmail(next));
});

app.post("/api/email-report", async (req, res) => {
  const { day, testTo } = req.body || {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(day || ""))) return res.status(400).json({ error: "day (YYYY-MM-DD) required" });
  try {
    const sent = await sendReport(String(day), testTo ? String(testTo).trim() : undefined);
    res.json({ ok: true, sent });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// Auto-send: at 07:05 email the report of the 07:00 → 07:00 day just ended,
// once. A failure is retried every 15 minutes until the next day's is due.
setInterval(async () => {
  const cfg = readEmail();
  if (!cfg.auto) return;
  const now = Date.now();
  const day = previousReportDay(now);
  if (cfg.lastSentKey === day) return;
  if (now < dayRange(day).end + 5 * 60 * 1000) return;
  if (cfg.lastAttemptKey === day && now - (cfg.lastAttemptAt || 0) < 15 * 60 * 1000) return;
  try {
    const sent = await sendReport(day);
    writeEmail({ ...readEmail(), lastSentKey: day, lastSentAt: now, lastError: null });
    console.log(`[lines-checklist] daily report ${day} emailed to ${sent.length}`);
  } catch (e) {
    writeEmail({ ...readEmail(), lastAttemptKey: day, lastAttemptAt: now, lastError: String(e?.message || e) });
    console.log(`[lines-checklist] daily report ${day} email failed: ${e?.message || e}`);
  }
}, 60 * 1000);

const PORT = process.env.PORT || 3001;
app.listen(PORT, () =>
  console.log(`[lines-checklist] API listening on http://localhost:${PORT}`)
);
