import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  ArrowLeft,
  Camera,
  Check,
  ChevronDown,
  GripVertical,
  Loader2,
  MessageSquarePlus,
  Monitor,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  X,
} from "lucide-react";
import {
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useChecklists, useSaveChecklists } from "@/hooks/useChecklists";
import type { ChecklistData, ChecklistItem, LineCard } from "@/data/lines";
import {
  deleteGuardPhoto,
  deleteSubmission,
  fetchGuardPhotos,
  fetchSubmissions,
  updateSubmission,
  uploadGuardPhoto,
  type GuardPhoto,
  type Submission,
  type SubmissionFilters,
} from "@/lib/api";
import { compressImage } from "@/lib/image";
import DatePicker from "@/components/DatePicker";
import ConfirmDialog from "@/components/ConfirmDialog";

type Tab = "checklists" | "submissions";

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const newId = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;

// Compact control used in the submissions filter bar.
const filterCls =
  "h-8 rounded-md border border-input bg-card px-2.5 text-xs shadow-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20";

// Status options for editing an operator's marks, per checklist kind.
type Tint = "green" | "amber" | "red";
const STATUS_OPTS: Record<"line" | "safety", { key: string; label: string; tint: Tint }[]> = {
  line: [
    { key: "ok", label: "✓", tint: "green" },
    { key: "fail", label: "✗", tint: "red" },
  ],
  safety: [
    { key: "good", label: "✓", tint: "green" },
    { key: "X", label: "X", tint: "amber" },
    { key: "R", label: "R", tint: "amber" },
    { key: "M", label: "M", tint: "red" },
  ],
};
const ACTIVE_BTN: Record<Tint, string> = {
  green: "border-emerald-500 bg-emerald-500 text-white",
  amber: "border-amber-500 bg-amber-500 text-white",
  red: "border-red-500 bg-red-500 text-white",
};
const ROW_TINT: Record<Tint, string> = {
  green: "bg-emerald-50",
  amber: "bg-amber-50",
  red: "bg-red-50",
};

// Compact row layout for the submission manager — mirrors the standalone list,
// with an extra trailing cell for the expand chevron + delete action.
const GRID_MGR =
  "grid grid-cols-[auto_1fr_auto_auto_auto] sm:grid-cols-[auto_1fr_auto_1fr_auto_auto] items-center gap-2 sm:gap-3";

// Shared in-app image popup (overlay) — used for reference + defect photos so a
// thumbnail click opens here rather than a new browser tab.
const PhotoPopup = ({ src, onClose }: { src: string; onClose: () => void }) => (
  <div
    className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-4"
    onClick={onClose}
  >
    <img
      src={src}
      alt="Photo"
      className="max-h-[85vh] w-auto rounded-lg object-contain shadow-xl"
      onClick={(e) => e.stopPropagation()}
    />
    <button
      onClick={onClose}
      className="absolute right-4 top-4 rounded-full bg-card/90 p-2 text-foreground shadow-lg hover:bg-card"
      aria-label="Close"
    >
      <X className="h-5 w-5" />
    </button>
  </div>
);

const Edit = () => {
  const [tab, setTab] = useState<Tab>("checklists");
  const TABS: { id: Tab; label: string }[] = [
    { id: "checklists", label: "Checklists" },
    { id: "submissions", label: "Submissions" },
  ];

  // Edit mode is desktop-only — it needs the screen width and isn't touch-friendly.
  const [isDesktop, setIsDesktop] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(min-width: 1280px)").matches
  );
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1280px)");
    const onChange = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-20 border-b border-border bg-card/90 backdrop-blur">
        <div className="container flex h-12 items-center gap-2">
          <Link
            to="/"
            className="-ml-2 rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label="Back to lines"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <h1 className="flex items-center gap-1.5 text-sm font-semibold tracking-tight">
            <Pencil className="h-4 w-4" /> Edit
          </h1>
        </div>
        {isDesktop && (
          <div className="container flex gap-1">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
                  tab === t.id
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}
      </header>

      {isDesktop ? (
        tab === "checklists" ? (
          <ChecklistEditor />
        ) : (
          <SubmissionManager />
        )
      ) : (
        <div className="container flex flex-col items-center justify-center gap-3 py-20 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-secondary text-muted-foreground">
            <Monitor className="h-6 w-6" />
          </span>
          <h2 className="text-base font-semibold">Edit mode is desktop-only</h2>
          <p className="max-w-sm text-sm text-muted-foreground">
            Editing checklists and submissions needs a larger screen. Please open this page on a
            desktop computer.
          </p>
          <Link
            to="/"
            className="mt-1 rounded-md border border-border bg-card px-4 py-2 text-sm font-medium shadow-sm hover:bg-accent"
          >
            Back to lines
          </Link>
        </div>
      )}
    </div>
  );
};

// One editable checklist item row. Drag handle on the left (mouse/touch/keyboard),
// then number, item text, the "Needs value" checkbox and (safety) Badge field all
// on a single line, with delete on the right.
const SortableItemRow = ({
  item,
  index,
  kind,
  changed,
  refPhoto,
  photoBusy,
  onChange,
  onRemove,
  onPickPhoto,
  onRemovePhoto,
  onViewPhoto,
}: {
  item: ChecklistItem;
  index: number;
  kind: "line" | "safety";
  changed?: boolean;
  refPhoto?: GuardPhoto | null;
  photoBusy?: boolean;
  onChange: (patch: Partial<ChecklistItem>) => void;
  onRemove: () => void;
  onPickPhoto?: () => void;
  onRemovePhoto?: () => void;
  onViewPhoto?: (url: string) => void;
}) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: item.id });
  const style = { transform: CSS.Transform.toString(transform), transition };

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-1.5 rounded-md border px-2 py-0.5 shadow-sm ${
        changed ? "border-blue-400 bg-blue-50" : "border-border bg-card"
      } ${isDragging ? "relative z-10 opacity-70 shadow-md" : ""}`}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-label="Drag to reorder"
        title="Drag to reorder"
        className="flex-none cursor-grab touch-none rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground active:cursor-grabbing"
      >
        <GripVertical className="h-4 w-4" />
      </button>

      <span className="w-5 flex-none text-center text-[11px] text-muted-foreground">
        {index + 1}
      </span>

      <textarea
        value={item.text}
        onChange={(e) => onChange({ text: e.target.value })}
        rows={1}
        placeholder="Item text"
        className="min-w-0 flex-1 resize-y rounded bg-transparent px-1.5 py-0.5 text-xs uppercase leading-tight outline-none transition-colors placeholder:normal-case placeholder:text-muted-foreground/60 focus:bg-accent/40"
      />

      <label className="flex flex-none cursor-pointer items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground">
        <input
          type="checkbox"
          checked={!!item.needsValue}
          onChange={(e) => onChange({ needsValue: e.target.checked || undefined })}
          className="h-3.5 w-3.5 accent-[hsl(var(--primary))]"
        />
        Needs value
      </label>

      {kind === "safety" && (
        <input
          value={item.badge ?? ""}
          onChange={(e) => onChange({ badge: e.target.value || undefined })}
          placeholder="Badge"
          className="h-6 w-24 flex-none rounded bg-muted/60 px-2 text-xs uppercase outline-none transition-colors placeholder:text-muted-foreground/60 focus:bg-accent"
        />
      )}

      {/* Reference photo — the expected look for this guard. Admin-only (Edit mode);
          shown read-only to operators on the Safety Guards form. */}
      {kind === "safety" && (
        <div className="flex flex-none items-center gap-1">
          {refPhoto && (
            <button
              type="button"
              onClick={() => onViewPhoto?.(refPhoto.url)}
              title="View reference photo"
              className="flex-none"
            >
              <img
                src={refPhoto.url}
                alt="Reference"
                className="h-8 w-8 rounded border border-border object-cover"
              />
            </button>
          )}
          <button
            type="button"
            onClick={onPickPhoto}
            disabled={photoBusy}
            title={refPhoto ? "Replace reference photo" : "Set reference photo"}
            className="flex h-7 items-center gap-1 rounded-md border border-border bg-card px-2 text-[11px] font-medium shadow-sm hover:bg-accent disabled:opacity-50"
          >
            {photoBusy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Camera className="h-3.5 w-3.5" />
            )}
            {refPhoto ? "Replace" : "Photo"}
          </button>
          {refPhoto && (
            <button
              type="button"
              onClick={onRemovePhoto}
              disabled={photoBusy}
              title="Remove reference photo"
              className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}

      <button
        onClick={onRemove}
        className="flex-none rounded-md p-1 text-muted-foreground hover:bg-red-50 hover:text-red-600"
        aria-label="Delete item"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </li>
  );
};

// ---------------------------------------------------------------------------
// Checklist editor — add / edit / delete / reorder items, edit title & revision.
// ---------------------------------------------------------------------------
const ChecklistEditor = () => {
  const { data, isSuccess } = useChecklists();
  const save = useSaveChecklists();

  const [draft, setDraft] = useState<LineCard[] | null>(null);
  // Last-saved snapshot — rows that differ from it are highlighted as "changed".
  const [baseline, setBaseline] = useState<LineCard[] | null>(null);
  const [lineId, setLineId] = useState("");
  const [kind, setKind] = useState<"line" | "safety">("line");
  // Index of the item awaiting a delete confirmation (null = none).
  const [pendingDelete, setPendingDelete] = useState<number | null>(null);

  // Reference photos for the selected line, keyed by item id (safety only).
  // These are stored on the server immediately (independent of "Save changes").
  const [refPhotos, setRefPhotos] = useState<Record<string, GuardPhoto>>({});
  const [photoBusyId, setPhotoBusyId] = useState<string | null>(null);
  const [photoErr, setPhotoErr] = useState<string | null>(null);
  const [viewPhoto, setViewPhoto] = useState<string | null>(null); // reference-photo popup
  const photoFileRef = useRef<HTMLInputElement>(null);
  const pickPhotoItem = useRef<ChecklistItem | null>(null);

  // Drag-to-reorder: mouse on desktop, touch (hold ~150ms) on phones, keyboard for a11y.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  // Initialise the working copy once the backend data has loaded (or been seeded).
  useEffect(() => {
    if (isSuccess && data && !draft) {
      setDraft(clone(data));
      setBaseline(clone(data));
    }
  }, [isSuccess, data, draft]);
  useEffect(() => {
    if (draft && !lineId) setLineId(draft[0]?.id ?? "");
  }, [draft, lineId]);

  // Reference photos follow the selected line + kind (safety only).
  const loadRefPhotos = useCallback(async () => {
    if (kind !== "safety" || !lineId) {
      setRefPhotos({});
      return;
    }
    try {
      const rows = await fetchGuardPhotos({ line: lineId, kind: "reference" });
      const byItem: Record<string, GuardPhoto> = {};
      for (const r of rows) if (!byItem[r.itemId]) byItem[r.itemId] = r; // one per guard
      setRefPhotos(byItem);
    } catch {
      setRefPhotos({});
    }
  }, [kind, lineId]);
  useEffect(() => {
    loadRefPhotos();
  }, [loadRefPhotos]);

  if (!draft) {
    return (
      <div className="container flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading checklists…
      </div>
    );
  }

  const line = draft.find((l) => l.id === lineId);
  const cd: ChecklistData | undefined = line && (kind === "safety" ? line.safety : line.data);

  // --- Reference photo actions (safety, admin-only by virtue of Edit mode) ---
  const pickPhoto = (item: ChecklistItem) => {
    setPhotoErr(null);
    pickPhotoItem.current = item;
    photoFileRef.current?.click();
  };
  const onPhotoFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file
    const item = pickPhotoItem.current;
    if (!file || !item || !line) return;
    setPhotoBusyId(item.id);
    setPhotoErr(null);
    try {
      const url = await compressImage(file);
      const rec = await uploadGuardPhoto({
        line: line.id,
        itemId: item.id,
        itemText: item.text,
        operator: "admin",
        image: url,
        kind: "reference",
      });
      setRefPhotos((m) => ({ ...m, [item.id]: rec }));
    } catch (err) {
      setPhotoErr(err instanceof Error ? err.message : "Could not set the reference photo.");
    } finally {
      setPhotoBusyId(null);
    }
  };
  const removePhoto = async (item: ChecklistItem) => {
    const cur = refPhotos[item.id];
    if (!cur) return;
    setPhotoBusyId(item.id);
    setPhotoErr(null);
    try {
      await deleteGuardPhoto(cur.id);
      setRefPhotos((m) => {
        const next = { ...m };
        delete next[item.id];
        return next;
      });
    } catch (err) {
      setPhotoErr(err instanceof Error ? err.message : "Could not remove the reference photo.");
    } finally {
      setPhotoBusyId(null);
    }
  };

  // A row is "changed" (vs the last-saved baseline) if it's new or its content differs.
  const baseLine = baseline?.find((l) => l.id === lineId);
  const baseItems = baseLine ? (kind === "safety" ? baseLine.safety.items : baseLine.data.items) : [];
  const baseById = new Map(baseItems.map((it) => [it.id, it] as const));
  const isChanged = (it: ChecklistItem) => {
    const b = baseById.get(it.id);
    return (
      !b ||
      b.text !== it.text ||
      !!b.needsValue !== !!it.needsValue ||
      (b.badge ?? "") !== (it.badge ?? "")
    );
  };

  const update = (updater: (cd: ChecklistData) => ChecklistData) =>
    setDraft((prev) =>
      prev!.map((l) =>
        l.id !== lineId
          ? l
          : kind === "safety"
            ? { ...l, safety: updater(l.safety) }
            : { ...l, data: updater(l.data) }
      )
    );

  const setItem = (i: number, patch: Partial<ChecklistData["items"][number]>) =>
    update((c) => ({ ...c, items: c.items.map((it, idx) => (idx === i ? { ...it, ...patch } : it)) }));
  const removeItem = (i: number) =>
    update((c) => ({ ...c, items: c.items.filter((_, idx) => idx !== i) }));
  const addItem = () =>
    update((c) => ({ ...c, items: [...c.items, { id: newId(), text: "" }] }));
  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    update((c) => {
      const from = c.items.findIndex((it) => it.id === active.id);
      const to = c.items.findIndex((it) => it.id === over.id);
      if (from === -1 || to === -1) return c;
      return { ...c, items: arrayMove(c.items, from, to) };
    });
  };

  return (
    <div className="pb-24">
      <div className="container py-4">
        {/* Selector */}
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <select
            value={lineId}
            onChange={(e) => setLineId(e.target.value)}
            className="h-9 rounded-md border border-input bg-card px-2.5 text-sm shadow-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
          >
            {draft.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
          <div className="flex rounded-md border border-border bg-card p-0.5 shadow-sm">
            {(["line", "safety"] as const).map((k) => (
              <button
                key={k}
                onClick={() => setKind(k)}
                className={`rounded px-3 py-1.5 text-sm font-medium transition-colors ${
                  kind === k ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {k === "line" ? "Line Checklist" : "Safety Guards"}
              </button>
            ))}
          </div>
        </div>

        {cd && (
          <>
            {/* Items */}
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold">Items ({cd.items.length})</h2>
              <button
                onClick={addItem}
                className="flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs font-medium shadow-sm hover:bg-accent"
              >
                <Plus className="h-3.5 w-3.5" /> Add item
              </button>
            </div>

            {kind === "safety" && (
              <p className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                <Camera className="h-3.5 w-3.5 flex-none" />
                Set a <span className="font-medium">reference photo</span> per guard — operators see it
                read-only on the form. Saved instantly (no need to press Save changes).
              </p>
            )}
            {photoErr && (
              <p className="mb-2 text-xs font-medium text-destructive">{photoErr}</p>
            )}

            {/* Hidden picker shared by every row's reference-photo button. */}
            <input
              ref={photoFileRef}
              type="file"
              accept="image/*"
              onChange={onPhotoFile}
              className="hidden"
            />

            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={onDragEnd}
            >
              <SortableContext
                items={cd.items.map((it) => it.id)}
                strategy={verticalListSortingStrategy}
              >
                <ul className="space-y-1">
                  {cd.items.map((item, i) => (
                    <SortableItemRow
                      key={item.id}
                      item={item}
                      index={i}
                      kind={kind}
                      changed={isChanged(item)}
                      refPhoto={kind === "safety" ? refPhotos[item.id] ?? null : null}
                      photoBusy={photoBusyId === item.id}
                      onChange={(patch) => setItem(i, patch)}
                      onRemove={() => setPendingDelete(i)}
                      onPickPhoto={() => pickPhoto(item)}
                      onRemovePhoto={() => removePhoto(item)}
                      onViewPhoto={(url) => setViewPhoto(url)}
                    />
                  ))}
                </ul>
              </SortableContext>
            </DndContext>

            {cd.items.length === 0 && (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No items. Use “Add item” to create the first one.
              </p>
            )}
          </>
        )}
      </div>

      {pendingDelete !== null && (
        <ConfirmDialog
          title="Delete this item?"
          message={
            cd?.items[pendingDelete]?.text?.trim()
              ? `“${cd.items[pendingDelete].text.trim()}” will be removed from the checklist. The change applies after you Save.`
              : "This item will be removed from the checklist. The change applies after you Save."
          }
          confirmLabel="Delete"
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => {
            removeItem(pendingDelete);
            setPendingDelete(null);
          }}
        />
      )}

      {viewPhoto && <PhotoPopup src={viewPhoto} onClose={() => setViewPhoto(null)} />}

      {/* Save bar */}
      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-border bg-card/95 backdrop-blur">
        <div className="container flex items-center justify-between gap-4 py-2.5">
          <span className="min-w-0 truncate text-xs text-muted-foreground sm:text-sm">
            {save.isError ? (
              <span className="font-medium text-destructive">
                {(save.error as Error)?.message || "Save failed"}
              </span>
            ) : save.isSuccess ? (
              <span className="flex items-center gap-1.5 font-medium text-emerald-600">
                <Check className="h-4 w-4" /> Saved — live on all devices
              </span>
            ) : (
              "Changes apply to every device after saving."
            )}
          </span>
          <button
            onClick={() => {
              const snapshot = draft;
              save.mutate(snapshot, { onSuccess: () => setBaseline(clone(snapshot)) });
            }}
            disabled={save.isPending}
            className="flex flex-none items-center gap-2 rounded-md bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {save.isPending ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Submission manager — edit (operator / date / time / product) and delete.
// ---------------------------------------------------------------------------
const SubmissionManager = () => {
  const { data: lineCards } = useChecklists();
  const [rows, setRows] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // openId = the expanded row; editing = whether that panel is the editor (vs read-only view).
  const [openId, setOpenId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [filters, setFilters] = useState<SubmissionFilters>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await fetchSubmissions(filters));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load submissions.");
    } finally {
      setLoading(false);
    }
  }, [filters]);
  // Refetch whenever a filter changes (and on mount).
  useEffect(() => {
    load();
  }, [load]);

  const setFilter = (patch: Partial<SubmissionFilters>) =>
    setFilters((f) => ({ ...f, ...patch }));
  const hasFilters =
    !!filters.line || !!filters.kind || !!filters.operator || !!filters.date;

  const [pendingDelete, setPendingDelete] = useState<Submission | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [delErr, setDelErr] = useState<string | null>(null);

  const confirmDelete = async () => {
    if (!pendingDelete?.id) return;
    setDeleting(true);
    setDelErr(null);
    try {
      await deleteSubmission(pendingDelete.id);
      setRows((rs) => rs.filter((x) => x.id !== pendingDelete.id));
      setPendingDelete(null);
    } catch (e) {
      setDelErr(e instanceof Error ? e.message : "Delete failed.");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="container py-4">
      {/* Filter bar — single compact row (mirrors the standalone list) */}
      <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-2 shadow-sm">
        <select
          aria-label="Line"
          value={filters.line ?? ""}
          onChange={(e) => setFilter({ line: e.target.value })}
          className={filterCls}
        >
          <option value="">All lines</option>
          {(lineCards ?? []).map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Type"
          value={filters.kind ?? ""}
          onChange={(e) =>
            setFilter({ kind: (e.target.value || undefined) as SubmissionFilters["kind"] })
          }
          className={filterCls}
        >
          <option value="">All types</option>
          <option value="line">Line checklist</option>
          <option value="safety">Safety guards</option>
        </select>
        <input
          aria-label="Operator"
          value={filters.operator ?? ""}
          onChange={(e) => setFilter({ operator: e.target.value })}
          placeholder="Operator…"
          className={`${filterCls} min-w-0 flex-1 sm:w-40 sm:flex-none`}
        />
        <DatePicker value={filters.date ?? ""} onChange={(v) => setFilter({ date: v })} />
        <div className="ml-auto flex items-center gap-1.5">
          {hasFilters && (
            <button
              onClick={() => setFilters({})}
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

      {loading && rows.length === 0 && <p className="text-sm text-muted-foreground">Loading…</p>}
      {error && <p className="text-sm font-medium text-destructive">{error}</p>}
      {!loading && !error && rows.length === 0 && (
        <p className="text-sm text-muted-foreground">
          {hasFilters ? "No submissions match these filters." : "No submissions yet."}
        </p>
      )}

      {/* Excel-style sheet — click a row to view, then Edit from there. */}
      {!error && rows.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
          <div className="overflow-x-auto">
            <div className="min-w-[480px]">
              {/* Column headers */}
              <div
                className={`${GRID_MGR} border-b border-border bg-secondary/60 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground`}
              >
                <span>Date / Time</span>
                <span>Operator</span>
                <span className="justify-self-center">Faults</span>
                <span className="justify-self-end">Type</span>
                <span className="hidden justify-self-end sm:block">Line</span>
                <span className="justify-self-end" aria-hidden />
              </div>

              <ul className="divide-y divide-border">
                {rows.map((r) => {
                  const isSafety = (r.kind || "line") === "safety";
                  const open = openId === r.id;
                  // closed → view ; view → closed ; editing → back to view
                  const toggle = () => {
                    if (!open) {
                      setOpenId(r.id ?? null);
                      setEditing(false);
                    } else if (editing) {
                      setEditing(false);
                    } else {
                      setOpenId(null);
                    }
                  };
                  return (
                    <li key={r.id} className={open ? "bg-accent" : "even:bg-muted/40"}>
                      <div
                        onClick={toggle}
                        className={`${GRID_MGR} w-full cursor-pointer px-3 py-1.5 text-xs transition-colors hover:bg-accent`}
                      >
                        {/* Date / Time */}
                        <span className="font-medium tabular-nums leading-tight text-foreground">
                          {r.date} <span className="text-muted-foreground">{r.time}</span>
                        </span>
                        {/* Operator */}
                        <span className="min-w-0 truncate font-medium text-foreground">
                          {r.operator || "—"}
                        </span>
                        {/* Faults — red pill, dash when clean */}
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
                        {/* Type pill (+ done count on sm) */}
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
                        {/* Line — faded pill, hidden on mobile */}
                        <span className="hidden justify-self-end whitespace-nowrap rounded-full bg-secondary px-2 py-0.5 text-xs text-muted-foreground sm:block">
                          {r.lineName}
                        </span>
                        {/* Actions — expand chevron + delete */}
                        <span className="flex items-center justify-end gap-1">
                          <ChevronDown
                            className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${
                              open ? "rotate-180" : ""
                            }`}
                          />
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setDelErr(null);
                              setPendingDelete(r);
                            }}
                            title="Delete"
                            className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-red-50 hover:text-red-600"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </span>
                      </div>

                      {open && (
                        <div
                          className="border-t border-border bg-muted/20 p-3"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {editing ? (
                            <SubmissionEditor
                              rec={r}
                              onCancel={() => setEditing(false)}
                              onSaved={(u) => {
                                setRows((rs) => rs.map((x) => (x.id === u.id ? u : x)));
                                setEditing(false);
                              }}
                            />
                          ) : (
                            <SubmissionView
                              rec={r}
                              onEdit={() => setEditing(true)}
                              onClose={() => {
                                setOpenId(null);
                                setEditing(false);
                              }}
                            />
                          )}
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

      {pendingDelete && (
        <ConfirmDialog
          title="Delete this submission?"
          message={`${pendingDelete.operator || "This report"} — ${pendingDelete.lineName} · ${pendingDelete.date} ${pendingDelete.time}. This permanently removes the report and cannot be undone.`}
          confirmLabel="Delete"
          busy={deleting}
          error={delErr}
          onCancel={() => setPendingDelete(null)}
          onConfirm={confirmDelete}
        />
      )}
    </div>
  );
};

// Read-only preview of a submission: shown when a row is expanded, before editing.
const SubmissionView = ({
  rec,
  onEdit,
  onClose,
}: {
  rec: Submission;
  onEdit: () => void;
  onClose: () => void;
}) => {
  const kind: "line" | "safety" = (rec.kind || "line") === "safety" ? "safety" : "line";
  const opts = STATUS_OPTS[kind];
  const optOf = (status: string) => opts.find((o) => o.key === status);
  const fieldKeys = Object.keys(rec.fields || {});
  const [photo, setPhoto] = useState<string | null>(null); // defect-photo popup

  return (
    <>
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <p className="min-w-0 truncate text-xs font-semibold">
          {rec.operator || "report"}
          <span className="font-normal text-muted-foreground">
            {" "}· {kind === "safety" ? "Safety Guards" : "Line Checklist"} · {rec.date} {rec.time} ·{" "}
            {rec.completed}/{rec.total} done
            {rec.issues > 0 ? ` · ${rec.issues} fault${rec.issues === 1 ? "" : "s"}` : ""}
          </span>
        </p>
        <div className="flex flex-none items-center gap-2">
          <button
            onClick={onEdit}
            className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground shadow-sm hover:opacity-90"
          >
            <Pencil className="h-3.5 w-3.5" /> Edit
          </button>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="space-y-3 p-3">
        {fieldKeys.length > 0 && (
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {fieldKeys.map((k) => (
              <span key={k}>
                <span className="font-medium uppercase">{k}:</span> {rec.fields[k] || "—"}
              </span>
            ))}
          </div>
        )}
        <ul className="space-y-1">
          {rec.items.map((it, i) => {
            const o = it.status ? optOf(it.status) : undefined;
            return (
              <li
                key={it.id}
                className={`flex items-center gap-2 rounded-md border border-border px-2 py-1 text-xs ${
                  o ? ROW_TINT[o.tint] : "bg-card"
                }`}
              >
                <span className="w-4 flex-none text-[11px] text-muted-foreground">{i + 1}</span>
                <span className="min-w-0 flex-1 uppercase leading-tight">{it.text}</span>
                {it.value ? (
                  <span className="flex-none rounded bg-background px-1.5 py-0.5 font-medium tabular-nums">
                    {it.value}
                  </span>
                ) : null}
                {it.comment ? (
                  <span
                    className="hidden max-w-[35%] flex-none truncate italic text-muted-foreground sm:inline"
                    title={it.comment}
                  >
                    “{it.comment}”
                  </span>
                ) : null}
                {(it.status === "X" || it.status === "R") && it.photoUrl && (
                  <button
                    onClick={() => setPhoto(it.photoUrl!)}
                    title="View defect photo"
                    className="flex h-6 w-6 flex-none items-center justify-center rounded-md border border-amber-300 bg-amber-50 text-amber-600 hover:bg-amber-100"
                  >
                    <Camera className="h-3.5 w-3.5" />
                  </button>
                )}
                <span
                  className={`flex h-6 min-w-[1.5rem] flex-none items-center justify-center rounded px-1 text-[11px] font-bold ${
                    o ? ACTIVE_BTN[o.tint] : "bg-muted text-muted-foreground/60"
                  }`}
                >
                  {o ? o.label : "—"}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
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
    </>
  );
};

const SubmissionEditor = ({
  rec,
  onCancel,
  onSaved,
}: {
  rec: Submission;
  onCancel: () => void;
  onSaved: (u: Submission) => void;
}) => {
  const [items, setItems] = useState(() => clone(rec.items));
  const [openComments, setOpenComments] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [photo, setPhoto] = useState<string | null>(null); // defect-photo popup

  const kind: "line" | "safety" = (rec.kind || "line") === "safety" ? "safety" : "line";
  const opts = STATUS_OPTS[kind];
  const tintOf = (status: string) => opts.find((o) => o.key === status)?.tint;

  const setStatus = (i: number, key: string) =>
    setItems((prev) =>
      prev.map((it, idx) => (idx === i ? { ...it, status: it.status === key ? "" : key } : it))
    );
  const setVal = (i: number, key: "value" | "comment", v: string) =>
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, [key]: v } : it)));
  // Drop a defect photo from this report. The file is removed on Save (server side).
  const removePhoto = (i: number) =>
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, photoUrl: undefined } : it)));

  const onSave = async () => {
    setSaving(true);
    setErr(null);
    try {
      const cleaned = items.map((it) => ({
        ...it,
        value: it.value?.trim() ? it.value.trim() : undefined,
        comment: it.comment?.trim() ? it.comment.trim() : undefined,
      }));
      const updated = await updateSubmission(rec.id!, { items: cleaned });
      onSaved(updated);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  };

  const marked = items.filter((it) => it.status).length;

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <p className="min-w-0 truncate text-xs font-semibold">
          Editing {rec.operator || "report"}
          <span className="font-normal text-muted-foreground">
            {" "}· {kind === "safety" ? "Safety Guards" : "Line Checklist"} · {marked}/{items.length} marked
          </span>
        </p>
        <button
          onClick={onCancel}
          className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label="Close editor"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Body */}
      <div className="space-y-4 p-3">
          {/* Item selections */}
          <div>
            <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Operator’s selections
            </h4>
            <ul className="space-y-1.5">
              {items.map((it, i) => {
                const tint = it.status ? tintOf(it.status) : undefined;
                const showComment = openComments[it.id] || !!it.comment;
                return (
                  <li
                    key={it.id}
                    className={`rounded-md border border-border px-2 py-1 ${tint ? ROW_TINT[tint] : "bg-card"}`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="w-4 flex-none text-[11px] text-muted-foreground">{i + 1}</span>
                      <span className="min-w-0 flex-1 text-xs uppercase leading-tight">{it.text}</span>
                      <div className="flex flex-none items-center gap-1">
                        {opts.map((o) => {
                          const active = it.status === o.key;
                          return (
                            <button
                              key={o.key}
                              onClick={() => setStatus(i, o.key)}
                              title={`${o.key}${active ? " (click to clear)" : ""}`}
                              className={`h-6 min-w-[1.75rem] rounded-md border px-1 text-xs font-bold transition-colors ${
                                active
                                  ? ACTIVE_BTN[o.tint]
                                  : "border-input bg-card text-muted-foreground hover:bg-accent"
                              }`}
                            >
                              {o.label}
                            </button>
                          );
                        })}
                      </div>
                      <input
                        value={it.value ?? ""}
                        onChange={(e) => setVal(i, "value", e.target.value)}
                        placeholder="val"
                        className="h-6 w-12 flex-none rounded border border-input bg-card px-1.5 text-xs outline-none focus:border-primary"
                      />
                      {it.photoUrl && (
                        <span className="flex flex-none items-center gap-1">
                          <button
                            type="button"
                            onClick={() => setPhoto(it.photoUrl!)}
                            title="View defect photo"
                          >
                            <img
                              src={it.photoUrl}
                              alt="Defect"
                              className="h-6 w-6 rounded border border-amber-300 object-cover"
                            />
                          </button>
                          <button
                            type="button"
                            onClick={() => removePhoto(i)}
                            title="Remove photo from this report"
                            className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-red-50 hover:text-red-600"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </span>
                      )}
                      <button
                        onClick={() => setOpenComments((o) => ({ ...o, [it.id]: !showComment }))}
                        title="Comment"
                        className={`flex h-6 w-6 flex-none items-center justify-center rounded-md hover:bg-accent ${
                          it.comment ? "text-primary" : "text-muted-foreground"
                        }`}
                      >
                        <MessageSquarePlus className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    {showComment && (
                      <input
                        value={it.comment ?? ""}
                        onChange={(e) => setVal(i, "comment", e.target.value)}
                        placeholder="Comment"
                        className="mt-1.5 w-full rounded border border-input bg-card px-2 py-1 text-xs outline-none focus:border-primary"
                      />
                    )}
                  </li>
                );
              })}
            </ul>
          </div>

          {err && <p className="text-sm font-medium text-destructive">{err}</p>}
        </div>

      {/* Footer */}
      <div className="flex justify-end gap-2 border-t border-border px-3 py-2.5">
        <button
          onClick={onCancel}
          className="rounded-md border border-border bg-card px-3 py-1.5 text-sm font-medium hover:bg-accent"
        >
          Cancel
        </button>
        <button
          onClick={onSave}
          disabled={saving}
          className="flex items-center gap-2 rounded-md bg-primary px-4 py-1.5 text-sm font-semibold text-primary-foreground shadow-sm hover:opacity-90 disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save
        </button>
      </div>

      {photo && <PhotoPopup src={photo} onClose={() => setPhoto(null)} />}
    </div>
  );
};

export default Edit;
