import { DEPT_ORDER, type OfficeEvent, type OfficeSnapshot } from "../contract";

type Transition = OfficeSnapshot["transitions"][number];

const keyOf = (t: Transition) => `${t.ts}|${t.byAgent}|${t.position.legacyId}|${t.from ?? ""}|${t.to ?? ""}`;

/**
 * Two snapshots → what happened in between, for the engine. The first
 * snapshot (prev = null) seats everyone at once and sets the piles, as
 * Godot's first backend snapshot finds the agents already at work. After
 * it: who left walks out, who arrived walks in from the door, every new
 * transition of an agent in the office becomes its pipeline trip (oldest
 * first), and the piles' true counts follow when they changed.
 */
export function diffOfficeSnapshots(prev: OfficeSnapshot | null, next: OfficeSnapshot): OfficeEvent[] {
  const events: OfficeEvent[] = [];
  if (!prev) {
    for (const agent of next.roster) events.push({ type: "enter", agent, atOnce: true });
    events.push({ type: "piles", piles: { ...next.piles } });
    return events;
  }

  const before = new Set(prev.roster.map((a) => a.uid));
  const after = new Set(next.roster.map((a) => a.uid));
  for (const a of prev.roster) if (!after.has(a.uid)) events.push({ type: "leave", uid: a.uid });
  for (const a of next.roster) if (!before.has(a.uid)) events.push({ type: "enter", agent: a, atOnce: false });

  // A transition older than everything the previous read saw may be one it
  // left out past its limit, not a new one.
  const seen = new Set(prev.transitions.map(keyOf));
  const oldestSeen = prev.transitions.at(-1)?.ts;
  const fresh = next.transitions
    .filter((t) => t.to !== null && after.has(t.byAgent) && !seen.has(keyOf(t)))
    .filter((t) => oldestSeen === undefined || Date.parse(t.ts) >= Date.parse(oldestSeen))
    .sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
  for (const t of fresh) events.push({ type: "pipeline", uid: t.byAgent, toState: t.to!, position: t.position, ts: t.ts });

  if (DEPT_ORDER.some((d) => prev.piles[d] !== next.piles[d])) events.push({ type: "piles", piles: { ...next.piles } });
  return events;
}
