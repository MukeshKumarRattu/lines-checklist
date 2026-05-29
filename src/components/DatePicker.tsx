import { useEffect, useRef, useState } from "react";
import { Calendar, ChevronLeft, ChevronRight } from "lucide-react";

// A small, dependency-free calendar popup styled to match the app's indigo theme.
// `value` is an ISO date string ("YYYY-MM-DD") or "" when no date is selected.

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const pad = (n: number) => String(n).padStart(2, "0");
const toISO = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromISO = (s: string) => (s ? new Date(`${s}T00:00:00`) : null);
const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

interface Props {
  value: string;
  onChange: (v: string) => void;
}

const DatePicker = ({ value, onChange }: Props) => {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState(() => {
    const base = fromISO(value) ?? new Date();
    return new Date(base.getFullYear(), base.getMonth(), 1);
  });
  const containerRef = useRef<HTMLDivElement>(null);

  const selected = fromISO(value);
  const today = new Date();

  // Jump the visible month to the selected date (or today) each time we open.
  useEffect(() => {
    if (!open) return;
    const base = fromISO(value) ?? new Date();
    setView(new Date(base.getFullYear(), base.getMonth(), 1));
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Close on outside click or Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const year = view.getFullYear();
  const month = view.getMonth();
  const leading = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = [
    ...Array.from({ length: leading }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  const pick = (day: number) => {
    onChange(toISO(new Date(year, month, day)));
    setOpen(false);
  };

  const label = selected
    ? selected.toLocaleDateString(undefined, { month: "short", day: "numeric" })
    : "Date";

  return (
    <div ref={containerRef} className="relative flex-none">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`flex h-8 items-center gap-1.5 rounded-md border bg-card px-2 text-[13px] shadow-sm transition-colors hover:bg-accent ${
          value ? "border-primary text-primary" : "border-input text-muted-foreground"
        }`}
      >
        <Calendar className="h-4 w-4 flex-none" />
        <span className="hidden whitespace-nowrap sm:inline">{label}</span>
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-64 origin-top-right rounded-xl border border-border bg-popover p-3 text-popover-foreground shadow-xl">
          {/* Month navigation */}
          <div className="mb-2 flex items-center justify-between">
            <button
              type="button"
              onClick={() => setView(new Date(year, month - 1, 1))}
              className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              aria-label="Previous month"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-sm font-semibold tracking-tight">
              {MONTHS[month]} {year}
            </span>
            <button
              type="button"
              onClick={() => setView(new Date(year, month + 1, 1))}
              className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              aria-label="Next month"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          {/* Weekday labels */}
          <div className="mb-1 grid grid-cols-7 text-center text-[11px] font-medium text-muted-foreground">
            {WEEKDAYS.map((d, i) => (
              <span key={i} className="py-1">
                {d}
              </span>
            ))}
          </div>

          {/* Day grid */}
          <div className="grid grid-cols-7 gap-0.5">
            {cells.map((day, i) =>
              day === null ? (
                <span key={i} />
              ) : (
                (() => {
                  const d = new Date(year, month, day);
                  const isSel = selected && sameDay(d, selected);
                  const isToday = sameDay(d, today);
                  return (
                    <button
                      key={i}
                      type="button"
                      onClick={() => pick(day)}
                      className={`flex h-8 w-8 items-center justify-center rounded-md text-[13px] tabular-nums transition-colors ${
                        isSel
                          ? "bg-primary font-semibold text-primary-foreground shadow-sm"
                          : isToday
                            ? "font-semibold text-primary ring-1 ring-inset ring-primary/40 hover:bg-accent"
                            : "text-foreground hover:bg-accent"
                      }`}
                    >
                      {day}
                    </button>
                  );
                })()
              )
            )}
          </div>

          {/* Quick actions */}
          <div className="mt-2 flex items-center justify-between border-t border-border pt-2 text-xs">
            <button
              type="button"
              onClick={() => {
                onChange(toISO(today));
                setOpen(false);
              }}
              className="rounded-md px-2 py-1 font-medium text-primary transition-colors hover:bg-accent"
            >
              Today
            </button>
            <button
              type="button"
              onClick={() => {
                onChange("");
                setOpen(false);
              }}
              className="rounded-md px-2 py-1 font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              Clear
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default DatePicker;
