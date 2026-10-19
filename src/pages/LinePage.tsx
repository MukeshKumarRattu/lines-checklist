import { Link, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { useChecklists } from "@/hooks/useChecklists";
import ChecklistForm from "@/components/ChecklistForm";
import SubmissionsList from "@/components/SubmissionsList";

type Tab = "checklist" | "safety" | "submissions";
const TABS: { id: Tab; label: string }[] = [
  { id: "checklist", label: "Line Checklist" },
  { id: "safety", label: "Safety Guards" },
  { id: "submissions", label: "Submissions" },
];

const LinePage = () => {
  const { lineId } = useParams();
  const { getLine } = useChecklists();
  const line = getLine(lineId);
  const [params, setParams] = useSearchParams();
  const safetyOnly = !!line && line.data.items.length === 0;
  const tab = (params.get("tab") as Tab) || (safetyOnly ? "safety" : "checklist");

  if (!line) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-foreground">
        <div className="text-center">
          <p className="mb-4 text-xl">This line isn&apos;t available.</p>
          <Link to="/" className="text-primary underline underline-offset-4">
            Back to lines
          </Link>
        </div>
      </div>
    );
  }

  const setTab = (t: Tab) => setParams(t === "checklist" ? {} : { tab: t });

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
          <h1 className="text-sm font-semibold tracking-tight">{line.name}</h1>
        </div>
        <div className="container flex gap-1 overflow-x-auto">
          {TABS.filter((t) => !(safetyOnly && t.id === "checklist")).map((t) => (
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
      </header>

      {tab === "checklist" && <ChecklistForm line={line} data={line.data} kind="line" />}
      {tab === "safety" && <ChecklistForm line={line} data={line.safety} kind="safety" />}
      {tab === "submissions" && <SubmissionsList lineId={line.id} />}
    </div>
  );
};

export default LinePage;
