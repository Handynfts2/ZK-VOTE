/**
 * Proposal templates (issue #383)
 *
 * Reusable starting configs for CreateProposalForm — picking one prefills
 * the title/body scaffold, vote mode, and deadline, which the DAO member
 * can still edit before submitting. This deliberately only covers the two
 * vote modes CreateProposalForm actually supports as a per-proposal
 * `voteMode` — "fixed" and "trailing" (see VoteModeSelector).
 *
 * Quadratic voting (QV) is NOT included here even though the original
 * issue mentions it: in this codebase QV is a budget-allocation mechanism
 * spread across a DAO's whole proposal set (see backend/src/routes/quadratic.ts),
 * not a per-proposal creation-time mode. There's no "QV proposal" for a
 * template to prefill — a member allocates quadratic voice credits across
 * proposals that already exist, so a QV template doesn't map onto this form.
 */

export type ProposalVoteMode = "fixed" | "trailing";

export interface ProposalTemplate {
  id: string;
  name: string;
  description: string;
  titlePlaceholder: string;
  bodyScaffold: string;
  voteMode: ProposalVoteMode;
  deadlineSeconds: number;
}

const DAY = 24 * 60 * 60;

export const PROPOSAL_TEMPLATES: ProposalTemplate[] = [
  {
    id: "quick-poll",
    name: "Quick Poll",
    description: "Fixed 3-day window for a simple yes/no decision.",
    titlePlaceholder: "Should we ...?",
    bodyScaffold: "## Question\n\n## Context\n\n## Options\n",
    voteMode: "fixed",
    deadlineSeconds: 3 * DAY,
  },
  {
    id: "standard-proposal",
    name: "Standard Proposal",
    description: "Fixed 7-day window for a typical governance decision.",
    titlePlaceholder: "Proposal: ...",
    bodyScaffold:
      "## Summary\n\n## Motivation\n\n## Specification\n\n## Rationale\n",
    voteMode: "fixed",
    deadlineSeconds: 7 * DAY,
  },
  {
    id: "extended-discussion",
    name: "Extended Discussion",
    description:
      "Trailing deadline that extends while votes keep coming in — for proposals needing more debate time.",
    titlePlaceholder: "Discussion: ...",
    bodyScaffold: "## Summary\n\n## Background\n\n## Open Questions\n",
    voteMode: "trailing",
    deadlineSeconds: 7 * DAY,
  },
  {
    id: "treasury-spend",
    name: "Treasury Spend",
    description:
      "Trailing 14-day window for higher-stakes financial decisions.",
    titlePlaceholder: "Treasury Spend: ...",
    bodyScaffold:
      "## Requested Amount\n\n## Purpose\n\n## Recipient\n\n## Justification\n",
    voteMode: "trailing",
    deadlineSeconds: 14 * DAY,
  },
];

export function getProposalTemplate(id: string): ProposalTemplate | undefined {
  return PROPOSAL_TEMPLATES.find((t) => t.id === id);
}
