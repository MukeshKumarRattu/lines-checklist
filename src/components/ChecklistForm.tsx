import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  Ban,
  Camera,
  Check,
  Clock,
  Loader2,
  Lock,
  MessageSquarePlus,
  Printer,
  RefreshCw,
  RotateCcw,
  Send,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { inputFields, type ChecklistData, type ChecklistItem, type LineCard } from "@/data/lines";
import {
  deleteGuardPhoto,
  fetchGuardPhotos,
  submitChecklist,
  uploadGuardPhoto,
  type ChecklistKind,
  type GuardPhoto,
  type Submission,
} from "@/lib/api";
import { compressImage } from "@/lib/image";
import ConfirmDialog from "@/components/ConfirmDialog";

type Tint = "green" | "yellow" | "red";
interface StatusDef {
  key: string;
  label: string;
  tint: Tint;
  primary?: boolean; // toggled by tapping the row
  title: string;
  wide?: boolean; // render as an icon + word pill instead of a single-letter square
  icon?: LucideIcon; // icon shown inside the wide pill
  boxLabel?: string; // short glyph shown in the left status box (defaults to label)
}

// Per-checklist status options. The primary status is set by tapping the row;
// the others render as small buttons after the value field.
const STATUS: Record<ChecklistKind, StatusDef[]> = {
  line: [
    { key: "ok", label: "✓", tint: "green", primary: true, title: "OK" },
    { key: "fail", label: "Issue", tint: "red", title: "Mark this item as an issue / not right", wide: true, icon: AlertTriangle, boxLabel: "✗" },
  ],
  safety: [
    { key: "good", label: "✓", tint: "green", primary: true, title: "Good / Bolted / In place" },
    { key: "X", label: "Broken", tint: "yellow", title: "Broken or needs repair", wide: true, icon: Wrench, boxLabel: "X" },
    { key: "R", label: "Replaced", tint: "yellow", title: "Replaced — previous operator did not install it", wide: true, icon: RefreshCw, boxLabel: "R" },
    { key: "M", label: "Missing", tint: "red", title: "Missing — not present", wide: true, icon: Ban, boxLabel: "M" },
  ],
};

const ROW_TINT: Record<Tint | "none", string> = {
  none: "border-border bg-card",
  green: "border-emerald-500/40 bg-emerald-50",
  yellow: "border-amber-500/50 bg-amber-50",
  red: "border-red-500/40 bg-red-50",
};
const BTN_ACTIVE: Record<Tint, string> = {
  green: "border-emerald-500 bg-emerald-500 text-white",
  yellow: "border-amber-500 bg-amber-500 text-white",
  red: "border-red-500 bg-red-500 text-white",
};

interface ItemState {
  status?: string;
  value?: string;
  comment?: string;
}
interface DraftState {
  operator: string;
  fields: Record<string, string>;
  items: Record<string, ItemState>;
}
const emptyDraft: DraftState = { operator: "", fields: {}, items: {} };

const pad = (n: number) => String(n).padStart(2, "0");
const localDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const localTime = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

interface Props {
  line: LineCard;
  data: ChecklistData;
  kind: ChecklistKind;
}

const photoDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });

// Inline panel that slides open under a guard row. It shows the read-only
// REFERENCE photo (the expected look, set by admins in Edit mode) for guidance.
// When the operator captures a DEFECT photo (only after marking X/R) it shows a
// not-yet-saved preview with Save/Discard — that photo is sent to the Defected
// Guards tab and is never shown back on the row.
const GuardPhotoPanel = ({
  item,
  reference,
  pending,
  busy,
  err,
  justSaved,
  onSubmit,
  onDiscard,
}: {
  item: ChecklistItem;
  reference: GuardPhoto | null;
  pending: string | null;
  busy: boolean;
  err: string | null;
  justSaved: boolean;
  onSubmit: () => void;
  onDiscard: () => void;
}) => {
  // Capturing a defect: show the preview + confirm bar.
  if (pending) {
    return (
      <div className="animate-in fade-in slide-in-from-top-1 border-t border-border bg-muted/30 p-3 duration-200">
        <div className="relative flex items-center justify-center overflow-hidden rounded-md bg-background">
          <img src={pending} alt="Defect photo preview" className="max-h-[45vh] w-auto object-contain" />
          <span className="absolute left-2 top-2 flex items-center gap-1 rounded bg-amber-500 px-2 py-0.5 text-[10px] font-semibold text-white">
            <AlertTriangle className="h-3 w-3" /> Defect photo — not saved
          </span>
        </div>
        <p className="pt-2 text-center text-xs text-muted-foreground">
          Saved to the <span className="font-medium">Defected Guards</span> tab — not shown on this form.
        </p>
        {err && <p className="pt-2 text-xs font-medium text-destructive">{err}</p>}
        <div className="mt-3 flex gap-2">
          <button
            onClick={onDiscard}
            disabled={busy}
            className="flex flex-1 items-center justify-center rounded-md border border-border bg-card px-4 py-2 text-sm font-medium hover:bg-accent disabled:opacity-50"
          >
            Discard
          </button>
          <button
            onClick={onSubmit}
            disabled={busy}
            className="flex flex-[1.4] items-center justify-center gap-2 rounded-md bg-amber-500 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:opacity-90 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            {busy ? "Saving…" : "Save defect photo"}
          </button>
        </div>
      </div>
    );
  }

  // Otherwise: read-only reference photo (or empty state).
  return (
    <div className="animate-in fade-in slide-in-from-top-1 border-t border-border bg-muted/30 p-3 duration-200">
      {justSaved && (
        <p className="mb-2 flex items-center justify-center gap-1.5 rounded-md border border-emerald-500/40 bg-emerald-50 py-1.5 text-xs font-medium text-emerald-700">
          <Check className="h-3.5 w-3.5" /> Defect photo saved to Defected Guards.
        </p>
      )}
      <div className="relative flex items-center justify-center overflow-hidden rounded-md bg-background">
        {reference ? (
          <>
            <img src={reference.url} alt={item.text} className="max-h-[45vh] w-auto object-contain" />
            <span className="absolute left-2 top-2 rounded bg-foreground/70 px-2 py-0.5 text-[10px] font-semibold text-background">
              Reference
            </span>
          </>
        ) : (
          <div className="flex flex-col items-center gap-2 py-8 text-muted-foreground">
            <Lock className="h-7 w-7" />
            <p className="text-center text-sm">No reference photo. An admin can set one in Edit mode.</p>
          </div>
        )}
      </div>
      {reference && (
        <p className="pt-2 text-center text-xs text-muted-foreground">
          Reference · expected condition{reference.uploadedAt ? ` · set ${photoDate(reference.uploadedAt)}` : ""}
        </p>
      )}
    </div>
  );
};

const ChecklistForm = ({ line, data, kind }: Props) => {
  const draftKey = `lines-checklist:draft:${kind}-${line.id}`;
  const defs = STATUS[kind];
  const primaryKey = defs.find((d) => d.primary)!.key;
  const defByKey = (k?: string) => defs.find((d) => d.key === k);
  const secondary = defs.filter((d) => !d.primary);

  const [draft, setDraft] = useState<DraftState>(emptyDraft);
  const [openComments, setOpenComments] = useState<Record<string, boolean>>({});
  const [now, setNow] = useState(new Date());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedInfo, setSavedInfo] = useState<{ date: string; time: string } | null>(null);
  // Set true after a submit attempt so unfilled required value boxes light up red.
  const [triedSubmit, setTriedSubmit] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmIncomplete, setConfirmIncomplete] = useState(false);
  const navigate = useNavigate();

  // Guard photos (safety only). The form only ever READS reference photos (the
  // expected look, set in Edit mode) — one per guard, keyed by item id. Defect
  // photos the operator captures are written but never read back here.
  const [refPhotos, setRefPhotos] = useState<Record<string, GuardPhoto>>({});
  const [expandedId, setExpandedId] = useState<string | null>(null); // row whose photo panel is open
  const [pendingId, setPendingId] = useState<string | null>(null); // item with an unsaved defect preview
  const [pendingUrl, setPendingUrl] = useState<string | null>(null); // compressed preview data URL
  const [justSavedId, setJustSavedId] = useState<string | null>(null); // item that just saved a defect photo
  // Defect photos captured this session, keyed by item id → the uploaded record.
  // Attached to the submission at submit time so X/R rows carry their photo. On
  // submit/reset, any whose guard isn't ultimately marked X is deleted from the
  // guard store so abandoned captures don't pile up in Defected Guards.
  const [capturedPhotos, setCapturedPhotos] = useState<Record<string, GuardPhoto>>({});
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoErr, setPhotoErr] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pickItemRef = useRef<string | null>(null);
  // Phones (< 768px) capture from the camera; tablets/desktop pick a file.
  const [isPhone, setIsPhone] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches
  );
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const onChange = (e: MediaQueryListEvent) => setIsPhone(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const loadPhotos = useCallback(async () => {
    if (kind !== "safety") return;
    try {
      const rows = await fetchGuardPhotos({ line: line.id, kind: "reference" }); // newest first
      const byItem: Record<string, GuardPhoto> = {};
      for (const r of rows) if (!byItem[r.itemId]) byItem[r.itemId] = r; // one reference per guard
      setRefPhotos(byItem);
    } catch {
      /* photos are optional — ignore load failures */
    }
  }, [kind, line.id]);
  useEffect(() => {
    loadPhotos();
  }, [loadPhotos]);

  // Tap a guard row → slide its reference-photo panel open/closed (drops any unsaved preview).
  const togglePhotoRow = (id: string) => {
    setPhotoErr(null);
    setPendingId(null);
    setPendingUrl(null);
    setJustSavedId(null);
    setExpandedId((cur) => (cur === id ? null : id));
  };
  // Camera icon (enabled only when X/R is marked) → capture a defect photo.
  const capturePhoto = (id: string) => {
    setPhotoErr(null);
    setPendingId(null);
    setPendingUrl(null);
    setJustSavedId(null);
    setExpandedId(id);
    pickItemRef.current = id;
    fileInputRef.current?.click();
  };
  const onFilePicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file
    const id = pickItemRef.current;
    if (!file || !id) return;
    setPhotoErr(null);
    try {
      const url = await compressImage(file);
      setPendingId(id);
      setPendingUrl(url);
      setExpandedId(id);
    } catch {
      setPhotoErr("Could not read that image.");
    }
  };
  const submitPhoto = async () => {
    if (!pendingId || !pendingUrl) return;
    const id = pendingId;
    const it = data.items.find((x) => x.id === id);
    const status = draft.items[id]?.status; // "X" | "R" — the defect that triggered this
    setPhotoBusy(true);
    setPhotoErr(null);
    try {
      const rec = await uploadGuardPhoto({
        line: line.id,
        itemId: id,
        itemText: it?.text,
        operator: draft.operator.trim(),
        image: pendingUrl,
        kind: "defect",
        status,
      });
      // Defect photos are never shown back on the form — just confirm and clear.
      // Remember the record so it rides along on the submission for this X/R row.
      setCapturedPhotos((c) => ({ ...c, [id]: rec }));
      setPendingId(null);
      setPendingUrl(null);
      setJustSavedId(id);
    } catch (e) {
      setPhotoErr(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setPhotoBusy(false);
    }
  };
  const discardPending = () => {
    setPendingId(null);
    setPendingUrl(null);
    setPhotoErr(null);
  };

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(draftKey);
      setDraft(raw ? (JSON.parse(raw) as DraftState) : emptyDraft);
    } catch {
      setDraft(emptyDraft);
    }
    setCapturedPhotos({});
    setSavedInfo(null);
    setError(null);
    setOpenComments({});
    setTriedSubmit(false);
  }, [draftKey]);

  useEffect(() => {
    localStorage.setItem(draftKey, JSON.stringify(draft));
  }, [draftKey, draft]);

  const total = data.items.length;
  const done = useMemo(
    () => data.items.filter((i) => draft.items[i.id]?.status).length,
    [data.items, draft.items]
  );
  const issues = useMemo(
    () =>
      data.items.filter((i) => {
        const def = defByKey(draft.items[i.id]?.status);
        return def && def.tint !== "green";
      }).length,
    [data.items, draft.items] // eslint-disable-line react-hooks/exhaustive-deps
  );
  const productFields = inputFields(data);
  const pct = total ? Math.round((done / total) * 100) : 0;
  // Every checklist is run twice a shift; safety sheets carry this in their
  // data, line sheets don't — so default it for lines.
  const note = data.note || "To be completed 2x per shift, 6 hours apart";
  // Clean, derived heading instead of the raw paper-form title ("Line #1 CHECKLIST").
  // Combined with data.name this reads "Line 1 Checklist" / "Line 1 Safety Guards".
  const kindLabel = kind === "safety" ? "Safety Guards" : "Checklist";
  const friendlyDate = now.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  const friendlyTime = now.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

  const setStatus = (id: string, key: string) =>
    setDraft((d) => {
      const cur = d.items[id]?.status;
      return {
        ...d,
        items: { ...d.items, [id]: { ...d.items[id], status: cur === key ? undefined : key } },
      };
    });

  const setItemField = (id: string, key: "value" | "comment", value: string) =>
    setDraft((d) => ({ ...d, items: { ...d.items, [id]: { ...d.items[id], [key]: value } } }));

  const setHeaderField = (name: string, value: string) =>
    setDraft((d) => ({ ...d, fields: { ...d.fields, [name]: value } }));

  const reset = () => {
    // Nothing was submitted, so drop every defect photo captured this session
    // from the guard store (fire-and-forget — best effort).
    Object.values(capturedPhotos).forEach((rec) => void deleteGuardPhoto(rec.id).catch(() => {}));
    setDraft(emptyDraft);
    setCapturedPhotos({});
    setOpenComments({});
    setSavedInfo(null);
    setError(null);
    setTriedSubmit(false);
    setConfirmReset(false);
  };

  // Build a blank A4 sheet matching the original Excel forms: items as rows with
  // several blank entry columns across. The font auto-shrinks so the whole sheet
  // always fits on a single A4 page (no near-empty extra sheet).
  const handlePrint = () => {
    const isSafety = kind === "safety";
    const ENTRY = isSafety ? 12 : 10; // blank check columns per sheet (more = thinner)
    const leftCols = isSafety ? 3 : 1; // safety: # | item | expected ; line: item
    const totalCols = leftCols + ENTRY;
    const titleText = data.title || `${data.name} ${kindLabel}`;
    const headerLabels = ["DATE", "TIME", ...productFields.map((f) => f.toUpperCase())];
    const blanks = () => Array.from({ length: ENTRY }, () => `<td class="entry"></td>`).join("");

    const colgroup = isSafety
      ? `<col style="width:4%"><col style="width:34%"><col style="width:9%">` +
        Array.from({ length: ENTRY }, () => `<col style="width:${(53 / ENTRY).toFixed(2)}%">`).join("")
      : `<col style="width:30%">` +
        Array.from({ length: ENTRY }, () => `<col style="width:${(70 / ENTRY).toFixed(2)}%">`).join("");

    const labelRows = headerLabels
      .map((l) => `<tr><td class="hlabel" colspan="${leftCols}">${esc(l)}</td>${blanks()}</tr>`)
      .join("");

    const itemRows = data.items
      .map((it, i) =>
        isSafety
          ? `<tr><td class="num">${i + 1}</td><td class="item">${esc(it.text)}</td><td class="exp">${
              it.badge ? esc(it.badge) : ""
            }</td>${blanks()}</tr>`
          : `<tr><td class="item">${esc(it.text)}</td>${blanks()}</tr>`
      )
      .join("");

    const footRows = isSafety
      ? `<tr><td class="flabel" colspan="${leftCols}">INFRACTIONS BY PREVIOUS SHIFT (#)</td>${blanks()}</tr>` +
        `<tr><td class="flabel" colspan="${leftCols}">COMMENTS</td>${blanks()}</tr>` +
        `<tr><td class="flabel" colspan="${leftCols}">INITIALS</td>${blanks()}</tr>`
      : `<tr><td class="flabel">OPERATOR INITIALS</td>${blanks()}</tr>`;

    const legend =
      data.legend && data.legend.length
        ? `<div class="legend"><b>LEGEND</b><ul>${data.legend
            .map((l) => `<li>${esc(l)}</li>`)
            .join("")}</ul></div>`
        : "";

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(titleText)}</title><style>
      @page { size: A4 portrait; margin: 0; }
      * { box-sizing: border-box; }
      html, body { margin:0; }
      body { width:210mm; padding:8mm; font-family: Arial, Helvetica, sans-serif; color:#111; font-size:9px; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
      table { width:100%; border-collapse:collapse; table-layout:fixed; }
      th,td { border:1px solid #777; padding:0.22em 0.35em; overflow:hidden; }
      .title { background:#e6e6e6; text-align:center; font-size:1.5em; font-weight:bold; padding:0.4em; }
      .subtitle { text-align:center; background:#fff8e1; }
      .hlabel, .flabel { background:#f2f2f2; font-weight:bold; }
      .num { text-align:center; color:#555; }
      .item { text-transform:uppercase; word-wrap:break-word; line-height:1.12; }
      .exp { text-transform:uppercase; font-weight:bold; font-size:0.85em; text-align:center; }
      tr { break-inside:avoid; }
      .legend { margin-top:0.6em; }
      .legend ul { margin:0.2em 0 0; padding-left:1.2em; }
      .legend li { margin:0.5px 0; }
    </style></head><body>
      <div id="sheet">
        <table>
          <colgroup>${colgroup}</colgroup>
          <tbody>
            <tr><td class="title" colspan="${totalCols}">${esc(titleText)}</td></tr>
            ${data.note ? `<tr><td class="subtitle" colspan="${totalCols}">${esc(data.note)}</td></tr>` : ""}
            ${labelRows}
            ${itemRows}
            ${footRows}
          </tbody>
        </table>
        ${legend}
      </div>
      <script>
        window.onload = function () {
          try {
            var MM = 96 / 25.4;
            // One A4 page minus the 8mm top/bottom body padding, with a small safety buffer.
            var target = (297 - 16) * MM * 0.97;
            var el = document.getElementById('sheet');
            // Largest font size whose content still fits one page (also grows small lists to fill it).
            var lo = 4, hi = 60, best = 4;
            for (var i = 0; i < 26; i++) {
              var mid = (lo + hi) / 2;
              document.body.style.fontSize = mid + 'px';
              if (el.scrollHeight <= target) { best = mid; lo = mid; } else { hi = mid; }
            }
            document.body.style.fontSize = best + 'px';
          } catch (e) {}
          window.focus();
          window.print();
        };
        window.onafterprint = function () { window.close(); };
      </script>
    </body></html>`;

    const w = window.open("", "_blank", "width=1000,height=1000");
    if (!w) {
      setError("Allow pop-ups for this site to print the checklist.");
      return;
    }
    w.document.open();
    w.document.write(html);
    w.document.close();
  };

  const handleSubmit = async () => {
    setError(null);
    setTriedSubmit(true);
    if (!draft.operator.trim()) {
      setError("Enter the operator name before submitting.");
      return;
    }
    // A row that needs a value must have one once it's been marked.
    const missingValues = data.items.filter(
      (it) => it.needsValue && draft.items[it.id]?.status && !draft.items[it.id]?.value?.trim()
    );
    if (missingValues.length > 0) {
      setError(
        `Enter a value for ${missingValues.length} marked ${
          missingValues.length === 1 ? "item" : "items"
        } (highlighted in red).`
      );
      document
        .getElementById(`item-${missingValues[0].id}`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    // Any item flagged as an Issue must carry a comment explaining it.
    const missingComments = data.items.filter(
      (it) => draft.items[it.id]?.status === "fail" && !draft.items[it.id]?.comment?.trim()
    );
    if (missingComments.length > 0) {
      setError(
        `Add a comment for ${missingComments.length} item${
          missingComments.length === 1 ? "" : "s"
        } marked Issue (highlighted in red).`
      );
      // Open the comment box for the first offender and scroll to it.
      setOpenComments((o) => ({ ...o, [missingComments[0].id]: true }));
      document
        .getElementById(`item-${missingComments[0].id}`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    // Soft warning: not every item is marked. Allow submit, but confirm first.
    if (done < total) {
      setConfirmIncomplete(true);
      return;
    }
    await doSubmit();
  };

  // Builds the payload and saves — runs after validation passes (and after the
  // operator confirms submitting an incomplete checklist).
  const doSubmit = async () => {
    const stamp = new Date();
    const payload: Submission = {
      kind,
      date: localDate(stamp),
      time: localTime(stamp),
      line: line.id,
      lineName: data.name,
      title: data.title,
      revision: data.revision,
      operator: draft.operator.trim(),
      fields: draft.fields,
      items: data.items.map((it) => {
        const status = draft.items[it.id]?.status || "";
        return {
          id: it.id,
          text: it.text,
          status,
          value: draft.items[it.id]?.value?.trim() || undefined,
          comment: draft.items[it.id]?.comment?.trim() || undefined,
          // Carry the defect photo only for X/R guards that captured one.
          photoUrl: status === "X" || status === "R" ? capturedPhotos[it.id]?.url : undefined,
        };
      }),
      completed: done,
      total,
      issues,
    };
    setSubmitting(true);
    try {
      const saved = await submitChecklist(payload);
      // The server has now copied each X/R photo into the submission's own files.
      // Keep only X defects in the Defected Guards gallery; delete the rest (R
      // rides on the submission copy, anything else is an abandoned capture).
      const finalStatus = Object.fromEntries(payload.items.map((it) => [it.id, it.status]));
      Object.entries(capturedPhotos).forEach(([id, rec]) => {
        if (finalStatus[id] !== "X") void deleteGuardPhoto(rec.id).catch(() => {});
      });
      setSavedInfo({ date: saved.date, time: saved.time });
      setDraft(emptyDraft);
      setCapturedPhotos({});
      setOpenComments({});
      setTriedSubmit(false);
      window.scrollTo({ top: 0, behavior: "smooth" });
      // After a Line Checklist is submitted, move the operator straight to the
      // Safety Guards tab for the same line (next step in the workflow).
      if (kind === "line") {
        navigate(`/line/${line.id}?tab=safety`);
      }
    } catch (e) {
      setError(
        e instanceof Error
          ? `${e.message}. Is the backend running? (cd server && npm start)`
          : "Could not save."
      );
    } finally {
      setSubmitting(false);
    }
  };

  const fieldCls =
    "h-8 w-full rounded-md border border-input bg-card px-2.5 text-[13px] shadow-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20";

  return (
    <div className="pb-24">
      <div className="container py-4">
        {/* Header panel — identity, shift note, entry fields and progress in one card */}
        <section className="mb-4 overflow-hidden rounded-xl border border-border bg-card shadow-sm">
          {/* Title bar */}
          <div className="flex items-start justify-between gap-3 px-4 pt-3.5 pb-3">
            <div className="min-w-0">
              <h2 className="truncate text-xl font-bold leading-tight tracking-tight">
                {data.name}{" "}
                <span className="font-semibold text-muted-foreground">{kindLabel}</span>
              </h2>
              {data.revision && (
                <p className="mt-0.5 text-xs text-muted-foreground">{data.revision}</p>
              )}
            </div>
            <div className="flex flex-none items-center gap-2">
              {/* Print a blank A4 hardcopy — desktop only. */}
              <button
                onClick={handlePrint}
                className="hidden items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs font-medium shadow-sm hover:bg-accent xl:flex"
              >
                <Printer className="h-3.5 w-3.5" /> Print
              </button>
              <button
                onClick={() => setConfirmReset(true)}
                className="flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs font-medium shadow-sm hover:bg-accent"
              >
                <RotateCcw className="h-3.5 w-3.5" /> Reset
              </button>
            </div>
          </div>

          {/* Shift note strip */}
          {note && (
            <div className="flex items-center gap-1.5 border-y border-amber-200 bg-amber-50 px-4 py-1.5 text-xs font-medium text-amber-700">
              <Clock className="h-3.5 w-3.5 flex-none" />
              {note}
            </div>
          )}

          {/* Entry fields — operator, product (if any), auto date/time */}
          <div className="grid grid-cols-1 gap-2.5 px-4 py-2.5 sm:grid-cols-3">
            <label className="block">
              <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Operator <span className="text-destructive">*</span>
              </span>
              <input
                value={draft.operator}
                onChange={(e) => setDraft((d) => ({ ...d, operator: e.target.value }))}
                placeholder="Name or initials"
                className={fieldCls}
              />
            </label>
            {productFields.map((f) => (
              <label key={f} className="block">
                <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {f}
                </span>
                <input
                  value={draft.fields[f] ?? ""}
                  onChange={(e) => setHeaderField(f, e.target.value)}
                  placeholder={`Enter ${f.toLowerCase()}`}
                  className={fieldCls}
                />
              </label>
            ))}
            <div className="block">
              <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Date / Time
              </span>
              <div className="flex h-8 items-center rounded-md border border-dashed border-input bg-muted/40 px-2.5 text-[13px] text-muted-foreground">
                {friendlyDate} · {friendlyTime}
              </div>
            </div>
          </div>

          {/* Progress footer */}
          <div className="border-t border-border bg-muted/40 px-4 py-2.5">
            <div className="mb-1.5 flex items-center justify-between text-xs">
              <span className="text-muted-foreground">
                <span className="font-semibold text-foreground">{done}</span> of {total} marked
                {issues > 0 && (
                  <span className="font-medium text-red-500">
                    {" "}· {issues} issue{issues > 1 ? "s" : ""}
                  </span>
                )}
              </span>
              <span className="font-semibold tabular-nums">{pct}%</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        </section>

        {savedInfo && (
          <div className="mb-4 flex items-center gap-2.5 rounded-lg border border-emerald-500/40 bg-emerald-50 p-3 text-sm text-emerald-800">
            <Check className="h-4 w-4 flex-none text-emerald-600" />
            <span>
              Saved for {savedInfo.date} at {savedInfo.time} — form cleared.{" "}
              <Link to={`/line/${line.id}?tab=submissions`} className="font-medium underline underline-offset-2">
                View submissions
              </Link>
            </span>
          </div>
        )}

        {/* Items — single column on tablet/mobile, two columns on desktop (xl+) */}
        <ul className={kind === "safety" ? "" : "xl:columns-2 xl:gap-3"}>
          {data.items.map((item, idx) => {
            const st = draft.items[item.id] ?? {};
            const def = defByKey(st.status);
            // An "Issue" row requires a comment — auto-open the box so it's obvious.
            const commentRequired = st.status === "fail";
            const showComment = openComments[item.id] || !!st.comment || commentRequired;
            const commentInvalid = triedSubmit && commentRequired && !st.comment?.trim();
            const valueInvalid =
              triedSubmit && !!item.needsValue && !!st.status && !st.value?.trim();
            return (
              <li
                key={item.id}
                id={`item-${item.id}`}
                className={`mb-1 break-inside-avoid rounded-md border shadow-sm transition-colors ${
                  def ? ROW_TINT[def.tint] : ROW_TINT.none
                }`}
              >
                <div className="flex flex-col gap-1 px-2.5 py-1 sm:flex-row sm:items-center sm:gap-1.5">
                  {/* Head: status + item text — full width on phones so the text
                      isn't squeezed; shares the row from sm up. */}
                  {kind === "safety" ? (
                    <div className="flex min-w-0 items-center gap-1.5 sm:flex-1">
                      {/* status box marks "good"; the text area slides the photo panel open */}
                      <button
                        onClick={() => setStatus(item.id, primaryKey)}
                        title="Mark good"
                        className={`flex h-6 w-6 flex-none items-center justify-center rounded border text-[11px] font-bold ${
                          def ? BTN_ACTIVE[def.tint] : "border-input bg-card"
                        }`}
                      >
                        {def ? def.primary ? <Check className="h-3.5 w-3.5" /> : (def.boxLabel ?? def.label) : null}
                      </button>
                      <button
                        onClick={() => togglePhotoRow(item.id)}
                        className="flex min-w-0 flex-1 items-center gap-2 py-0.5 text-left"
                      >
                        <span className="w-4 flex-none text-[11px] text-muted-foreground">{idx + 1}</span>
                        <span className="text-xs uppercase leading-tight">{item.text}</span>
                        {item.badge && (
                          <span className="ml-1 flex-none rounded bg-secondary px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                            {item.badge}
                          </span>
                        )}
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setStatus(item.id, primaryKey)}
                      className="flex min-w-0 items-center gap-2 py-0.5 text-left sm:flex-1"
                    >
                      <span
                        className={`flex h-5 w-5 flex-none items-center justify-center rounded border text-[11px] font-bold ${
                          def ? BTN_ACTIVE[def.tint] : "border-input bg-card"
                        }`}
                      >
                        {def ? def.primary ? <Check className="h-3.5 w-3.5" /> : (def.boxLabel ?? def.label) : null}
                      </span>
                      <span className="w-4 flex-none text-[11px] text-muted-foreground">{idx + 1}</span>
                      <span className="text-xs uppercase leading-tight">{item.text}</span>
                      {item.badge && (
                        <span className="ml-1 flex-none rounded bg-secondary px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                          {item.badge}
                        </span>
                      )}
                    </button>
                  )}

                  {/* Controls: value, status buttons, camera, comment. On phones
                      they drop to their own line (right-aligned); inline from sm up. */}
                  <div className="flex flex-none items-center gap-1 self-end sm:self-auto">
                    {item.needsValue && (
                      <input
                        value={st.value ?? ""}
                        onChange={(e) => setItemField(item.id, "value", e.target.value)}
                        placeholder="value"
                        aria-label="Value"
                        aria-invalid={valueInvalid}
                        className={`h-7 w-16 flex-none rounded-md border-2 px-2 text-sm font-medium shadow-sm outline-none placeholder:font-normal sm:w-20 ${
                          valueInvalid
                            ? "border-red-500 bg-red-50 placeholder:text-red-400 focus:ring-2 focus:ring-red-500/30"
                            : "border-primary/40 bg-primary/5 placeholder:text-muted-foreground/60 focus:border-primary focus:ring-2 focus:ring-primary/20"
                        }`}
                      />
                    )}

                    {/* Defect photo — sits in front of the status pills; only shown
                        once the guard is marked Broken or Replaced. */}
                    {kind === "safety" && (st.status === "X" || st.status === "R") && (
                      <button
                        type="button"
                        onClick={() => capturePhoto(item.id)}
                        title="Take a photo of the defect (saved to Defected Guards)"
                        className="relative flex h-7 w-7 flex-none items-center justify-center rounded-md border border-amber-500 bg-amber-500 text-white transition-colors hover:opacity-90"
                      >
                        <Camera className="h-3.5 w-3.5" />
                      </button>
                    )}

                    {secondary.map((s) => {
                      const active = st.status === s.key;
                      // `wide` statuses (e.g. the line-checklist "Issue") render as an
                      // icon + word pill so the operator can read what it does, instead
                      // of a bare single-letter square.
                      if (s.wide) {
                        const PillIcon = s.icon ?? AlertTriangle;
                        return (
                          <button
                            key={s.key}
                            onClick={() => setStatus(item.id, s.key)}
                            title={s.title}
                            className={`flex h-7 flex-none items-center gap-1 rounded-md border px-2.5 text-xs font-bold transition-colors ${
                              active ? BTN_ACTIVE[s.tint] : "border-transparent bg-card text-muted-foreground hover:bg-accent"
                            }`}
                          >
                            <PillIcon className="h-3.5 w-3.5" />
                            {s.label}
                          </button>
                        );
                      }
                      return (
                        <button
                          key={s.key}
                          onClick={() => setStatus(item.id, s.key)}
                          title={s.title}
                          className={`h-7 w-7 flex-none rounded-md border text-xs font-bold transition-colors ${
                            active ? BTN_ACTIVE[s.tint] : "border-input bg-card text-muted-foreground hover:bg-accent"
                          }`}
                        >
                          {s.label}
                        </button>
                      );
                    })}

                    <button
                      onClick={() => setOpenComments((o) => ({ ...o, [item.id]: !showComment }))}
                      title={st.comment ? "Edit comment" : "Add a comment"}
                      className={`flex h-7 flex-none items-center gap-1 rounded-md border border-transparent px-2 text-xs font-bold transition-colors ${
                        st.comment
                          ? "bg-amber-500 text-white"
                          : "bg-amber-50 text-amber-700 hover:bg-amber-100"
                      }`}
                    >
                      <MessageSquarePlus className="h-3.5 w-3.5" />
                      Note
                    </button>
                  </div>
                </div>

                {showComment && (
                  <div className="px-2.5 pb-1.5 pl-[2.4rem]">
                    <input
                      value={st.comment ?? ""}
                      onChange={(e) => setItemField(item.id, "comment", e.target.value)}
                      placeholder={commentRequired ? "Comment required — describe the issue" : "Comment (optional)"}
                      aria-invalid={commentInvalid}
                      className={`w-full rounded-md border px-3 py-1 text-sm outline-none ${
                        commentInvalid
                          ? "border-red-500 bg-red-50 placeholder:text-red-400 focus:ring-2 focus:ring-red-500/30"
                          : "border-input bg-card focus:border-primary focus:ring-2 focus:ring-primary/20"
                      }`}
                    />
                  </div>
                )}

                {kind === "safety" && expandedId === item.id && (
                  <GuardPhotoPanel
                    item={item}
                    reference={refPhotos[item.id] ?? null}
                    pending={pendingId === item.id ? pendingUrl : null}
                    busy={photoBusy}
                    err={photoErr}
                    justSaved={justSavedId === item.id}
                    onSubmit={submitPhoto}
                    onDiscard={discardPending}
                  />
                )}
              </li>
            );
          })}
        </ul>
      </div>

      {/* Submit bar */}
      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-border bg-card/95 backdrop-blur">
        <div className="container flex items-center justify-between gap-4 py-2.5">
          {error ? (
            <span className="text-sm font-medium text-destructive">{error}</span>
          ) : (
            <span className="min-w-0 truncate text-xs text-muted-foreground sm:text-sm">
              {done}/{total} marked
              {issues > 0 ? ` · ${issues} issue${issues > 1 ? "s" : ""}` : ""} ·{" "}
              {draft.operator.trim() || "no operator"}
            </span>
          )}
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="flex flex-none items-center gap-2 rounded-md bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            <Send className="h-4 w-4" />
            {submitting ? "Saving…" : "Submit"}
          </button>
        </div>
      </div>

      {confirmReset && (
        <ConfirmDialog
          title="Clear this form?"
          message="This clears the operator name and every mark, value and comment on this checklist. It can’t be undone."
          confirmLabel="Clear form"
          confirmIcon={RotateCcw}
          onCancel={() => setConfirmReset(false)}
          onConfirm={reset}
        />
      )}

      {confirmIncomplete && (
        <ConfirmDialog
          title="Checklist not fully filled"
          message={`${total - done} of ${total} item${
            total - done === 1 ? " is" : "s are"
          } not marked yet. You can still submit — unmarked items will be recorded as blank.`}
          confirmLabel="Submit anyway"
          confirmIcon={Send}
          busy={submitting}
          onCancel={() => setConfirmIncomplete(false)}
          onConfirm={() => { setConfirmIncomplete(false); void doSubmit(); }}
        />
      )}

      {/* One shared picker; the row camera icon sets the target item then triggers it. */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        {...(isPhone ? { capture: "environment" as const } : {})}
        onChange={onFilePicked}
        className="hidden"
      />
    </div>
  );
};

export default ChecklistForm;
