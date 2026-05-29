import { Link } from "react-router-dom";
import { Camera, ClipboardList, ImagePlus, Inbox, Pencil } from "lucide-react";
import { useChecklists } from "@/hooks/useChecklists";
import { useGuardPhotoBadges } from "@/hooks/useGuardPhotoBadges";

const Index = () => {
  const { lines } = useChecklists();
  const { total: newPhotos } = useGuardPhotoBadges();
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-10 border-b border-border bg-card/80 backdrop-blur">
        <div className="container flex h-14 items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <span className="flex h-7 w-7 flex-none items-center justify-center rounded-md bg-primary text-primary-foreground">
              <ClipboardList className="h-4 w-4" />
            </span>
            <h1 className="truncate text-base font-semibold tracking-tight">Lines Checklist</h1>
          </div>
          {/* Icon-only on phones to avoid overflow; full labels return at sm+. */}
          <div className="flex flex-none items-center gap-1.5 sm:gap-2">
            {/* Edit mode is desktop-only — hidden on phones/tablets. */}
            <Link
              to="/edit"
              className="hidden items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-sm font-medium text-muted-foreground shadow-sm transition-colors hover:bg-accent hover:text-foreground xl:flex"
            >
              <Pencil className="h-3.5 w-3.5" /> Edit
            </Link>
            <Link
              to="/guard-photos"
              aria-label="Guard Photos"
              className="relative flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-sm font-medium text-muted-foreground shadow-sm transition-colors hover:bg-accent hover:text-foreground sm:px-3"
            >
              <Camera className="h-3.5 w-3.5 flex-none" />{" "}
              <span className="hidden sm:inline">Guard Photos</span>
              {newPhotos > 0 && (
                <span
                  title={`${newPhotos} new`}
                  className="absolute -right-1.5 -top-1.5 inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold leading-none text-white shadow"
                >
                  {newPhotos}
                </span>
              )}
            </Link>
            <Link
              to="/assign-photos"
              aria-label="Assign Photos"
              className="flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-sm font-medium text-muted-foreground shadow-sm transition-colors hover:bg-accent hover:text-foreground sm:px-3"
            >
              <ImagePlus className="h-3.5 w-3.5 flex-none" />{" "}
              <span className="hidden sm:inline">Assign Photos</span>
            </Link>
            <Link
              to="/submissions"
              aria-label="Submissions"
              className="flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-sm font-medium text-muted-foreground shadow-sm transition-colors hover:bg-accent hover:text-foreground sm:px-3"
            >
              <Inbox className="h-3.5 w-3.5 flex-none" />{" "}
              <span className="hidden sm:inline">Submissions</span>
            </Link>
          </div>
        </div>
      </header>

      <main className="container py-6">
        <h2 className="mb-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Select a line
        </h2>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {lines.map((line) => (
            <Link
              key={line.id}
              to={`/line/${line.id}`}
              className="group flex flex-col items-center justify-center rounded-2xl border border-border bg-card p-5 text-center shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-md"
            >
              <span className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                Line
              </span>
              <span className="my-1.5 flex h-14 w-14 items-center justify-center rounded-xl bg-secondary text-3xl font-bold leading-none text-foreground transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                {line.id}
              </span>
              <span className="text-xs text-muted-foreground">
                {line.data.items.length} checks
              </span>
            </Link>
          ))}
        </div>
      </main>
    </div>
  );
};

export default Index;
