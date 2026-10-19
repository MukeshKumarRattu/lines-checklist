import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, FileText, Loader2, Mail, Printer, RefreshCw } from "lucide-react";
import { fetchDailyReport } from "@/lib/api";
import { shiftOf } from "@/lib/followups";
import EmailPanel from "@/components/EmailPanel";

// One-page daily report for the office: the 24 hours 07:00 → 07:00, split into
// the day shift (07–19) and night shift (19–07). The server renders it
// (server/report.js) and this page shows that exact HTML, so the screen, the
// printout and the email are always the same.

// `embedded`: rendered as the "Daily report" tab of the Summary page (no own header).
const ShiftReport = ({ embedded = false }: { embedded?: boolean }) => {
  // Default to the report day in progress (before 07:00 that's yesterday's).
  const [day, setDay] = useState(() => shiftOf(Date.now()).day);
  const [report, setReport] = useState<{ subject: string; html: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [emailOpen, setEmailOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setReport(await fetchDailyReport(day));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load.");
    } finally {
      setLoading(false);
    }
  }, [day]);
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className={`${embedded ? "" : "min-h-screen"} bg-slate-100 text-slate-900 print:bg-white`}>
      <style>{`@page { size: A4 portrait; margin: 10mm; } @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }`}</style>
      <header
        className={`${embedded ? "" : "sticky top-0 z-10 border-b bg-card/90 backdrop-blur"} border-border print:hidden`}
      >
        <div className={`container flex flex-wrap items-center gap-2 py-2 ${embedded ? "" : "min-h-14"}`}>
          {!embedded && (
            <>
              <Link to="/summary" className="-ml-2 rounded-md p-2 text-muted-foreground hover:bg-accent" aria-label="Back">
                <ArrowLeft className="h-4 w-4" />
              </Link>
              <h1 className="flex items-center gap-1.5 text-base font-semibold">
                <FileText className="h-4 w-4" /> Daily report
              </h1>
            </>
          )}
          <span className="hidden text-xs text-muted-foreground sm:inline">07:00 → 07:00 · day + night shift</span>
          <div className="ml-auto flex items-center gap-2">
            <input
              type="date"
              value={day}
              onChange={(e) => e.target.value && setDay(e.target.value)}
              className="h-9 rounded-md border border-input bg-card px-2 text-sm"
            />
            <button onClick={() => void load()} className="rounded-md border border-border bg-card p-2 hover:bg-accent" aria-label="Refresh">
              <RefreshCw className="h-4 w-4" />
            </button>
            <button
              onClick={() => setEmailOpen(true)}
              className="flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-2 text-sm font-medium hover:bg-accent"
            >
              <Mail className="h-4 w-4" /> Email
            </button>
            <button
              onClick={() => window.print()}
              className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground"
            >
              <Printer className="h-4 w-4" /> Print
            </button>
          </div>
        </div>
      </header>

      {error && <p className="container py-2 text-sm font-medium text-destructive print:hidden">{error}</p>}
      {emailOpen && <EmailPanel day={day} onClose={() => setEmailOpen(false)} />}
      {loading && !report ? (
        <div className="flex justify-center py-16 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : (
        report && (
          <article className="mx-auto my-4 max-w-[210mm] overflow-x-auto bg-white p-[8mm] shadow print:my-0 print:max-w-none print:p-0 print:shadow-none">
            {/* Server-built HTML: every value in it is escaped in server/report.js. */}
            <div dangerouslySetInnerHTML={{ __html: report.html }} />
          </article>
        )
      )}
    </div>
  );
};

export default ShiftReport;
