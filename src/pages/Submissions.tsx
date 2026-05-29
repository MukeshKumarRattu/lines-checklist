import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import SubmissionsList from "@/components/SubmissionsList";

const Submissions = () => {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-10 border-b border-border bg-card/90 backdrop-blur">
        <div className="container flex h-14 items-center gap-2">
          <Link
            to="/"
            className="-ml-2 rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label="Back to lines"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <h1 className="text-base font-semibold tracking-tight">All Submissions</h1>
        </div>
      </header>
      <SubmissionsList />
    </div>
  );
};

export default Submissions;
