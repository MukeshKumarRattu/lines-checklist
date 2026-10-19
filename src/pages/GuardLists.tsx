import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, ArrowDown, ArrowUp, Check, ListChecks, Loader2, Plus, Save, Trash2 } from "lucide-react";
import { useChecklists, useSaveChecklists } from "@/hooks/useChecklists";
import type { ChecklistItem, LineCard } from "@/data/lines";
import ConfirmDialog from "@/components/ConfirmDialog";

// Supervisor's guard-list manager (works on phones/tablets, unlike Edit mode):
// add / rename / reorder / delete the safety guards of any line, create a new
// safety-guard list (a new area). No whole-list delete (too easy to hit by
// accident) — guards are removed one at a time. Saves the whole checklist
// set like Edit mode does; removed guards drop their reference photo server-side.

const BADGES = ["", "BOLTED", "INPLACE"];

const GuardLists = () => {
  const { lines } = useChecklists();
  const save = useSaveChecklists();
  const [lineId, setLineId] = useState("");
  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmItem, setConfirmItem] = useState<number | null>(null);
  const [newName, setNewName] = useState("");
  const [showNew, setShowNew] = useState(false);

  const line = useMemo(() => lines.find((l) => l.id === lineId), [lines, lineId]);
  useEffect(() => {
    if (!lineId && lines.length) setLineId(lines[0].id);
  }, [lines, lineId]);
  useEffect(() => {
    setItems(line ? line.safety.items.map((it) => ({ ...it })) : []);
    setDirty(false);
  }, [line]);

  const change = (next: ChecklistItem[]) => {
    setItems(next);
    setDirty(true);
    setMsg(null);
  };
  const setItem = (i: number, patch: Partial<ChecklistItem>) =>
    change(items.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= items.length) return;
    const next = [...items];
    [next[i], next[j]] = [next[j], next[i]];
    change(next);
  };
  const add = () =>
    change([...items, { id: `${lineId}-g${Date.now().toString(36)}`, text: "", badge: "BOLTED" }]);

  const persist = async (next: LineCard[], ok: string) => {
    setError(null);
    try {
      await save.mutateAsync(next);
      setDirty(false);
      setMsg(ok);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed.");
    }
  };

  const saveList = () => {
    if (!line) return;
    if (items.some((it) => !it.text.trim())) {
      setError("Every guard needs a name — fill in or delete the empty ones.");
      return;
    }
    const cleaned = items.map((it) => ({ ...it, text: it.text.trim(), badge: it.badge || undefined }));
    void persist(
      lines.map((l) => (l.id === line.id ? { ...l, safety: { ...l.safety, items: cleaned } } : l)),
      `${line.name} guard list saved.`
    );
  };

  const createList = () => {
    const name = newName.trim();
    if (!name) return;
    if (lines.some((l) => l.name.toLowerCase() === name.toLowerCase())) {
      setError(`"${name}" already exists.`);
      return;
    }
    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || `area-${Date.now()}`;
    const card: LineCard = {
      id,
      name,
      available: true,
      // Safety-only: an empty line checklist hides that tab on the line page.
      data: { id: `line-${id}`, name, title: `${name} CHECKLIST`, revision: "", headerFields: ["DATE", "TIME"], items: [] },
      safety: {
        id: `safety-${id}`,
        name,
        title: `${name} SAFETY GUARDS`,
        revision: "",
        headerFields: ["DATE", "TIME"],
        items: [],
        note: "To be completed 2x per shift, 6 hours apart",
      },
    };
    void persist([...lines, card], `${name} created — add its guards below.`).then(() => {
      setLineId(id);
      setShowNew(false);
      setNewName("");
    });
  };

  return (
    <div className="min-h-screen bg-background pb-24 text-foreground">
      <header className="sticky top-0 z-10 border-b border-border bg-card/90 backdrop-blur">
        <div className="container flex h-14 items-center gap-2">
          <Link
            to="/supervisor"
            className="-ml-2 rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label="Back to walk-round"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <h1 className="flex items-center gap-1.5 text-base font-semibold tracking-tight">
            <ListChecks className="h-4 w-4" /> Guard lists
          </h1>
          <button
            onClick={() => setShowNew((v) => !v)}
            className="ml-auto flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs font-medium shadow-sm hover:bg-accent"
          >
            <Plus className="h-3.5 w-3.5" /> New list
          </button>
        </div>
      </header>

      <main className="container py-4">
        {showNew && (
          <div className="mb-4 flex flex-col gap-2 rounded-lg border border-border bg-card p-3 shadow-sm sm:flex-row sm:items-center">
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Name of the new list, e.g. Line 6 or Intermediate 1"
              className="h-9 flex-1 rounded-md border border-input bg-card px-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
            <button
              onClick={createList}
              disabled={!newName.trim() || save.isPending}
              className="flex items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
            >
              <Plus className="h-4 w-4" /> Create
            </button>
          </div>
        )}

        <div className="mb-3 flex flex-wrap items-center gap-2">
          <select
            aria-label="Line"
            value={lineId}
            onChange={(e) => {
              if (dirty && !window.confirm("Discard unsaved changes to this list?")) return;
              setLineId(e.target.value);
            }}
            className="h-9 rounded-md border border-input bg-card px-2.5 text-sm shadow-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
          >
            {lines.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
          <span className="text-sm text-muted-foreground">
            {items.length} guard{items.length === 1 ? "" : "s"}
          </span>
        </div>

        {msg && (
          <p className="mb-3 flex items-center gap-1.5 rounded-md border border-emerald-500/40 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            <Check className="h-4 w-4" /> {msg}
          </p>
        )}
        {error && <p className="mb-3 text-sm font-medium text-destructive">{error}</p>}

        <ul className="space-y-1.5">
          {items.map((it, i) => (
            <li key={it.id} className="flex items-center gap-1.5 rounded-md border border-border bg-card p-1.5 shadow-sm">
              <span className="w-5 flex-none text-center text-[11px] text-muted-foreground">{i + 1}</span>
              <input
                value={it.text}
                onChange={(e) => setItem(i, { text: e.target.value })}
                placeholder="Guard name / location"
                className={`h-8 min-w-0 flex-1 rounded-md border px-2 text-xs uppercase outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 ${
                  it.text.trim() ? "border-input" : "border-red-400 bg-red-50"
                }`}
              />
              <select
                aria-label="Expected"
                value={it.badge ?? ""}
                onChange={(e) => setItem(i, { badge: e.target.value || undefined })}
                className="h-8 flex-none rounded-md border border-input bg-card px-1.5 text-[11px] font-semibold"
              >
                {BADGES.map((b) => (
                  <option key={b} value={b}>
                    {b || "—"}
                  </option>
                ))}
              </select>
              <button onClick={() => move(i, -1)} disabled={i === 0} className="rounded p-1 text-muted-foreground hover:bg-accent disabled:opacity-30" aria-label="Move up">
                <ArrowUp className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => move(i, 1)}
                disabled={i === items.length - 1}
                className="rounded p-1 text-muted-foreground hover:bg-accent disabled:opacity-30"
                aria-label="Move down"
              >
                <ArrowDown className="h-3.5 w-3.5" />
              </button>
              <button onClick={() => setConfirmItem(i)} className="rounded p-1 text-red-600 hover:bg-red-50" aria-label="Delete guard">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
        <button
          onClick={add}
          disabled={!line}
          className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-input py-2 text-sm font-medium text-muted-foreground hover:bg-accent disabled:opacity-50"
        >
          <Plus className="h-4 w-4" /> Add guard
        </button>
      </main>

      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-border bg-card/95 backdrop-blur">
        <div className="container flex items-center justify-between gap-4 py-2.5">
          <span className="text-xs text-muted-foreground sm:text-sm">
            {dirty ? "Unsaved changes" : line ? `${line.name} · saved` : ""}
          </span>
          <button
            onClick={saveList}
            disabled={!dirty || save.isPending}
            className="flex items-center gap-2 rounded-md bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground shadow-sm hover:opacity-90 disabled:opacity-50"
          >
            {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save list
          </button>
        </div>
      </div>

      {confirmItem !== null && (
        <ConfirmDialog
          title="Delete this guard?"
          message={`"${items[confirmItem]?.text || "(no name)"}" is removed from ${line?.name} when you press Save list. Its reference photo is deleted then too.`}
          confirmLabel="Delete guard"
          onCancel={() => setConfirmItem(null)}
          onConfirm={() => {
            change(items.filter((_, idx) => idx !== confirmItem));
            setConfirmItem(null);
          }}
        />
      )}
    </div>
  );
};

export default GuardLists;
