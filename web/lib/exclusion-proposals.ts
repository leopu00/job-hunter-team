import {
  PROPOSAL_MIN_POSITIONS,
  exclusionProposals,
  type ExclusionProposal,
  type FeedbackEventLike,
} from "@/lib/feedback-reasons";

/**
 * Una decisione già presa dall'utente su una proposta (riga di
 * `profile_exclusions`, mig 094).
 */
export type ExclusionDecision = {
  reason: string;
  status: "accepted" | "dismissed";
  positions_at_decision: number;
};

/**
 * Le proposte che vale la pena mostrare adesso: quelle sopra soglia (la regola
 * è `exclusionProposals`) meno quelle già decise. Una proposta accettata non
 * torna; una rifiutata torna solo quando si sono aggiunte altre
 * `PROPOSAL_MIN_POSITIONS` posizioni con quel motivo.
 */
export function visibleProposals(
  events: readonly FeedbackEventLike[],
  decisions: readonly ExclusionDecision[],
): ExclusionProposal[] {
  const byReason = new Map(decisions.map((d) => [d.reason, d]));
  return exclusionProposals(events).filter((proposal) => {
    const decided = byReason.get(proposal.reason);
    if (!decided) return true;
    if (decided.status === "accepted") return false;
    return (
      proposal.positions >=
      decided.positions_at_decision + PROPOSAL_MIN_POSITIONS
    );
  });
}
