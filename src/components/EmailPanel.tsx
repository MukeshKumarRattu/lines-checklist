import { useEffect, useState } from "react";
import { Check, Loader2, Mail, Plus, Send, Trash2, X } from "lucide-react";
import { emailShiftReport, fetchEmailSettings, saveEmailSettings, type EmailSettings } from "@/lib/api";

// Daily-report email settings: who gets it (switch each on/off), automatic
// sending at 07:05 for the 07:00 → 07:00 day just ended, the SMTP account it sends from, plus
// "send this report now" and a test send.

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const EmailPanel = ({ day, onClose }: { day: string; onClose: () => void }) => {
  const [cfg, setCfg] = useState<EmailSettings | null>(null);
  const [newEmail, setNewEmail] = useState("");
  const [newName, setNewName] = useState("");
  const [testTo, setTestTo] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showSmtp, setShowSmtp] = useState(false);

  useEffect(() => {
    fetchEmailSettings()
      .then((c) => {
        setCfg(c);
        setShowSmtp(!c.smtp?.host);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load."));
  }, []);

  const run = async (label: string, fn: () => Promise<string | void>) => {
    setBusy(label);
    setError(null);
    setMsg(null);
    try {
      const m = await fn();
      if (m) setMsg(m);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed.");
    } finally {
      setBusy(null);
    }
  };
  const save = (next: EmailSettings, note = "Saved.") =>
    run("save", async () => {
      setCfg(await saveEmailSettings(next));
      return note;
    });

  if (!cfg)
    return (
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40">
        {error ? <p className="rounded bg-card p-4 text-sm text-destructive">{error}</p> : <Loader2 className="h-6 w-6 animate-spin text-white" />}
      </div>
    );

  const smtp = cfg.smtp || {};
  const setSmtp = (patch: Partial<EmailSettings["smtp"]>) => setCfg({ ...cfg, smtp: { ...smtp, ...patch } });
  const active = cfg.recipients.filter((r) => r.active).length;
  const inp =
    "h-9 w-full rounded-md border border-input bg-card px-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/20";

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/40 p-4 print:hidden" onClick={onClose}>
      <div className="my-8 w-full max-w-lg rounded-2xl border border-border bg-card p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center gap-2">
          <Mail className="h-5 w-5 text-primary" />
          <h3 className="flex-1 font-semibold">Email the daily report</h3>
          <button onClick={onClose} className="rounded p-1 hover:bg-accent" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Recipients */}
        <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Recipients ({active} active)
        </h4>
        <ul className="mb-2 divide-y divide-border rounded-md border border-border">
          {cfg.recipients.length === 0 && <li className="px-3 py-2 text-sm text-muted-foreground">No one yet.</li>}
          {cfg.recipients.map((r, i) => (
            <li key={r.email} className="flex items-center gap-2 px-3 py-1.5 text-sm">
              <label className="flex flex-1 cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={r.active}
                  onChange={() =>
                    void save({
                      ...cfg,
                      recipients: cfg.recipients.map((x, j) => (j === i ? { ...x, active: !x.active } : x)),
                    })
                  }
                />
                <span className={r.active ? "" : "text-muted-foreground line-through"}>
                  {r.name ? `${r.name} · ` : ""}
                  {r.email}
                </span>
              </label>
              <button
                onClick={() => void save({ ...cfg, recipients: cfg.recipients.filter((_, j) => j !== i) }, "Removed.")}
                className="rounded p-1 text-red-600 hover:bg-red-50"
                aria-label="Remove"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
        <div className="mb-4 flex gap-2">
          <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Name" className={`${inp} w-32 flex-none`} />
          <input value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="email@pticables.com" className={inp} />
          <button
            disabled={!EMAIL_RE.test(newEmail.trim()) || cfg.recipients.some((r) => r.email.toLowerCase() === newEmail.trim().toLowerCase())}
            onClick={() => {
              void save(
                { ...cfg, recipients: [...cfg.recipients, { email: newEmail.trim(), name: newName.trim(), active: true }] },
                "Added."
              );
              setNewEmail("");
              setNewName("");
            }}
            className="flex flex-none items-center gap-1 rounded-md bg-primary px-3 text-sm font-semibold text-primary-foreground disabled:opacity-40"
          >
            <Plus className="h-4 w-4" /> Add
          </button>
        </div>

        {/* Auto */}
        <label className="mb-1 flex cursor-pointer items-center gap-2 text-sm font-medium">
          <input type="checkbox" checked={cfg.auto} onChange={() => void save({ ...cfg, auto: !cfg.auto })} />
          Send automatically every day at 07:05 (the 24 h just ended: day + night shift)
        </label>
        <p className="mb-4 pl-6 text-xs text-muted-foreground">
          {cfg.lastSentAt ? `Last sent ${new Date(cfg.lastSentAt).toLocaleString()} (${cfg.lastSentKey}).` : "Not sent automatically yet."}
          {cfg.lastError && <span className="block text-destructive">Last attempt failed: {cfg.lastError}</span>}
        </p>

        {/* SMTP */}
        <button onClick={() => setShowSmtp((v) => !v)} className="mb-2 text-xs font-medium text-primary underline underline-offset-2">
          {showSmtp ? "Hide" : "Show"} mail server settings {smtp.host ? `(${smtp.host})` : "(not set up)"}
        </button>
        {showSmtp && (
          <div className="mb-4 grid grid-cols-2 gap-2 rounded-md border border-border bg-muted/30 p-3">
            <input value={smtp.host ?? ""} onChange={(e) => setSmtp({ host: e.target.value })} placeholder="Server e.g. smtp.office365.com" className={`${inp} col-span-2`} />
            <input value={smtp.port ?? ""} onChange={(e) => setSmtp({ port: Number(e.target.value) || undefined })} placeholder="Port 587" className={inp} />
            <input value={smtp.from ?? ""} onChange={(e) => setSmtp({ from: e.target.value })} placeholder="From address" className={inp} />
            <input value={smtp.user ?? ""} onChange={(e) => setSmtp({ user: e.target.value })} placeholder="Username" className={inp} />
            <input
              type="password"
              value={smtp.pass ?? ""}
              onChange={(e) => setSmtp({ pass: e.target.value })}
              placeholder={smtp.passSet ? "Password (saved — leave blank)" : "Password"}
              className={inp}
            />
            <button
              onClick={() => void save(cfg, "Mail server saved.")}
              className="col-span-2 rounded-md border border-border bg-card py-2 text-sm font-medium hover:bg-accent"
            >
              Save mail server
            </button>
          </div>
        )}

        {/* Send */}
        <div className="flex gap-2">
          <input value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="Test to (one address)" className={inp} />
          <button
            disabled={!EMAIL_RE.test(testTo.trim()) || !!busy}
            onClick={() =>
              void run("test", async () => {
                await emailShiftReport(day, testTo.trim());
                return `Test sent to ${testTo.trim()}.`;
              })
            }
            className="flex flex-none items-center gap-1 rounded-md border border-border px-3 text-sm font-medium hover:bg-accent disabled:opacity-40"
          >
            {busy === "test" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Test
          </button>
        </div>
        <button
          disabled={!active || !!busy}
          onClick={() =>
            void run("send", async () => {
              const sent = await emailShiftReport(day);
              return `Report sent to ${sent.length} recipient${sent.length === 1 ? "" : "s"}.`;
            })
          }
          className="mt-2 flex w-full items-center justify-center gap-2 rounded-md bg-primary py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-40"
        >
          {busy === "send" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          Send the {day} report now to {active} active
        </button>

        {msg && (
          <p className="mt-3 flex items-center gap-1.5 text-sm text-emerald-700">
            <Check className="h-4 w-4" /> {msg}
          </p>
        )}
        {error && <p className="mt-3 text-sm font-medium text-destructive">{error}</p>}
      </div>
    </div>
  );
};

export default EmailPanel;
