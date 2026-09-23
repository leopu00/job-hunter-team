/**
 * Who a role is allowed to write to (T37).
 *
 * In the TUI every agent reaches every other one the same way — one shell
 * wrapper, any session name — so "talk only to the Capitano" is a sentence in
 * a prompt and nothing else. It held because the roles that carry that rule
 * are the ones that read their prompt carefully; that is not a guarantee, it
 * is a habit.
 *
 * The SENTINELLA is where the habit is worth turning into a fence. It is the
 * team's budget watcher: it is woken by a bridge, it advises the CAPITANO,
 * and its own prompt opens with RULE #0 — "DO NOT talk to other agents except
 * the Capitano" — with one exception written in its `spawn-doctor` skill: the
 * DOTTORE it may spawn when an agent stops consuming mid-window, which it
 * then has to brief. A watcher that can type into any pane is a watcher that
 * can order the team around while claiming to be reporting, and its advice
 * carries numbers nobody else has: it would be believed.
 *
 * So the allow-list lives here, next to the other least-privilege table
 * (`DELIVERABLE_OWNERS`), and a role that is not in it keeps the team's
 * default — anyone. A refusal here is a sentence the agent can read and
 * report, not a silent drop: the model must be able to tell the CAPITANO
 * "I could not reach X", which is itself information.
 */

import { roleOf } from "../db/role-policy.ts";

/**
 * The roles each listed role may send to. Absent from the table = no limit,
 * which is what every other role has had since T13.
 */
export const PEER_POLICY: Readonly<Record<string, readonly string[]>> = {
  // sentinella.md RULE #0 + the `spawn-doctor` skill: the CAPITANO it advises,
  // and the DOTTORE it escalates a suspected zombie to.
  sentinella: ["capitano", "dottore"],
  // T40, mentor.md: "Inter-agent (rare — escalation to Capitano if needed)" and
  // the same `spawn-doctor` exception. The MENTOR reads the person's judgements
  // (Pattern F) and speaks to the PERSON about them, "never to the Scout": a
  // mentor that could write to the workers would turn a reflection into a
  // search instruction, which its skill forbids in so many words.
  mentor: ["capitano", "dottore"],
  // T41, mantenitore.md: single-writer — it repairs the infra and PROPOSES every
  // destructive action to the CAPITANO, who decides. Its `skills.list` names no
  // other correspondent, and M-01 keeps it away from the agents themselves.
  mantenitore: ["capitano"],
};

/** Where each fenced role's rule is written, for the refusal to cite it. */
const PEER_RULE: Readonly<Record<string, string>> = {
  sentinella: "sentinella.md RULE #0",
  mentor: "mentor.md, skill index: escalation goes to the Capitano",
  mantenitore: "mantenitore.md: you propose, the Capitano decides",
};

/** The roles `agent` may write to, or `null` when it may write to anyone. */
export function allowedPeers(agent: string): readonly string[] | null {
  return PEER_POLICY[roleOf(agent)] ?? null;
}

/**
 * The refusal, or `null` when the message may go. Named for what the rule is,
 * not for the check: what comes back is read by a model that has to decide
 * what to do next.
 */
export function peerRefusal(agent: string, target: string): string | null {
  const allowed = allowedPeers(agent);
  if (allowed === null || allowed.includes(roleOf(target))) return null;
  const role = roleOf(agent);
  const names = allowed.map((r) => r.toUpperCase()).join(" and the ");
  return (
    `Error: the ${role.toUpperCase()} writes to the ${names}, and ${target} is neither ` +
    `(${PEER_RULE[role] ?? `${role}.md`}). Nothing was sent. If this has to reach ${target}, it goes through the CAPITANO, ` +
    `who decides — you advise.`
  );
}
