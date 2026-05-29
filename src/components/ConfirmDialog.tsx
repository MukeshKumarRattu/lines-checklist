import { AlertTriangle, Loader2, Trash2, type LucideIcon } from "lucide-react";

// A styled warning/confirmation modal. Click the backdrop or Cancel to dismiss.
// The confirm button is destructive-styled (red); pass `confirmIcon` to change
// the icon (defaults to a trash can for delete actions).
interface Props {
  title: string;
  message: string;
  confirmLabel: string;
  confirmIcon?: LucideIcon;
  busy?: boolean;
  error?: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}

const ConfirmDialog = ({
  title,
  message,
  confirmLabel,
  confirmIcon: ConfirmIcon = Trash2,
  busy,
  error,
  onCancel,
  onConfirm,
}: Props) => (
  <div
    className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4"
    onClick={onCancel}
  >
    <div
      className="w-full max-w-sm rounded-2xl border border-border bg-card p-5 shadow-xl"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-red-100 text-red-600">
          <AlertTriangle className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">{title}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{message}</p>
        </div>
      </div>
      {error && <p className="mt-3 text-sm font-medium text-destructive">{error}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <button
          onClick={onCancel}
          disabled={busy}
          className="rounded-md border border-border bg-card px-3 py-2 text-sm font-medium hover:bg-accent disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          onClick={onConfirm}
          disabled={busy}
          className="flex items-center gap-2 rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-red-700 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ConfirmIcon className="h-4 w-4" />}
          {confirmLabel}
        </button>
      </div>
    </div>
  </div>
);

export default ConfirmDialog;
