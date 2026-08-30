import { memo } from "react";
import { CheckCircle, XCircle, ShieldCheck } from "lucide-react";

interface VoteResultsProps {
  yesVotes: number;
  noVotes: number;
  isOpen: boolean;
  tallyProofVerified?: boolean | null;
}

const VoteResults = memo(function VoteResults({
  yesVotes,
  noVotes,
  tallyProofVerified,
}: VoteResultsProps) {
  const totalVotes = yesVotes + noVotes;
  const yesPercentage = totalVotes > 0 ? (yesVotes / totalVotes) * 100 : 0;
  const noPercentage = totalVotes > 0 ? (noVotes / totalVotes) * 100 : 0;

  return (
    <div className="space-y-3 pt-4 border-t border-border">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Results</h3>
        {/* #94: tally proof verification status */}
        {tallyProofVerified !== undefined && tallyProofVerified !== null ? (
          <span
            className={`flex items-center gap-1 text-xs font-medium ${tallyProofVerified ? "text-green-600 dark:text-green-500" : "text-muted-foreground"}`}
            aria-label={
              tallyProofVerified
                ? "Tally cryptographically verified"
                : "Tally proof not yet available"
            }
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            {tallyProofVerified ? "Tally verified" : "Proof pending"}
          </span>
        ) : null}
      </div>

      <div
        className="flex items-center justify-between text-sm"
        role="group"
        aria-label="Vote counts"
      >
        <div className="flex items-center gap-4">
          <span
            className="flex items-center gap-1.5 font-medium text-green-600 dark:text-green-500"
            aria-label={`${yesVotes} yes votes`}
          >
            <CheckCircle className="w-4 h-4" aria-hidden="true" />
            {yesVotes} Yes
          </span>
          <span
            className="flex items-center gap-1.5 font-medium text-red-600 dark:text-red-500"
            aria-label={`${noVotes} no votes`}
          >
            <XCircle className="w-4 h-4" aria-hidden="true" />
            {noVotes} No
          </span>
        </div>
        <span className="text-muted-foreground">{totalVotes} votes total</span>
      </div>

      <div
        className="h-3 w-full rounded-full bg-secondary overflow-hidden flex"
        role="meter"
        aria-valuenow={Math.round(yesPercentage)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${yesPercentage.toFixed(1)}% yes, ${noPercentage.toFixed(1)}% no`}
      >
        <div
          className="bg-green-500 transition-all duration-500"
          style={{ width: `${yesPercentage}%` }}
        />
        <div
          className="bg-red-500 transition-all duration-500"
          style={{ width: `${noPercentage}%` }}
        />
      </div>

      {totalVotes > 0 && (
        <div
          className="flex justify-between text-xs text-muted-foreground"
          aria-hidden="true"
        >
          <span>{yesPercentage.toFixed(1)}% Yes</span>
          <span>{noPercentage.toFixed(1)}% No</span>
        </div>
      )}
    </div>
  );
});

export default VoteResults;
