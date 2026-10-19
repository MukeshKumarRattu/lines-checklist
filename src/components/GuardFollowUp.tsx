import { Wrench } from "lucide-react";
import { followUpsFor, type GuardFollowUpState, type YesNo } from "@/lib/followups";

// Inline questions under a guard row once it's marked Missing / Replaced, and a
// note that Broken goes to maintenance. `invalid` lights unanswered ones red.
const YesNoPair = ({
  label,
  value,
  invalid,
  onChange,
}: {
  label: string;
  value?: YesNo;
  invalid: boolean;
  onChange: (v: YesNo) => void;
}) => (
  <div className="flex items-center gap-1.5">
    <span className={`text-[11px] font-semibold ${invalid && !value ? "text-red-600" : "text-foreground"}`}>
      {label}
    </span>
    {(["yes", "no"] as const).map((v) => (
      <button
        key={v}
        type="button"
        onClick={() => onChange(v)}
        className={`h-6 rounded-md border px-2 text-[11px] font-bold transition-colors ${
          value === v
            ? v === "yes"
              ? "border-emerald-500 bg-emerald-500 text-white"
              : "border-red-500 bg-red-500 text-white"
            : invalid && !value
              ? "border-red-400 bg-red-50 text-red-600"
              : "border-input bg-card text-muted-foreground hover:bg-accent"
        }`}
      >
        {v === "yes" ? "Yes" : "No"}
      </button>
    ))}
  </div>
);

const GuardFollowUp = ({
  st,
  invalid,
  onChange,
}: {
  st: GuardFollowUpState;
  invalid: boolean;
  onChange: (patch: Partial<GuardFollowUpState>) => void;
}) => {
  const f = followUpsFor(st.status);
  if (st.status !== "X" && !f.newGuard && !f.corrected) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-2.5 pb-1.5 pl-[2.4rem]">
      {st.status === "X" && (
        <span className="flex items-center gap-1 text-[11px] font-medium text-amber-700">
          <Wrench className="h-3 w-3" /> Maintenance ticket will be sent on submit
        </span>
      )}
      {f.newGuard && (
        <YesNoPair label="Needs a new guard?" value={st.newGuard} invalid={invalid} onChange={(v) => onChange({ newGuard: v })} />
      )}
      {f.corrected && (
        <YesNoPair label="Corrected now?" value={st.corrected} invalid={invalid} onChange={(v) => onChange({ corrected: v })} />
      )}
      {st.corrected === "no" && (
        <span className="text-[11px] font-medium text-red-600">→ flagged for investigation</span>
      )}
      {st.newGuard === "yes" && (
        <span className="text-[11px] font-medium text-amber-700">→ maintenance ticket</span>
      )}
    </div>
  );
};

export default GuardFollowUp;
