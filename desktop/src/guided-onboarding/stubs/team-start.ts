/**
 * STAND-IN for desktop/src/lib/team-start.ts: `readTeamStart()` with the type of its contract. null = not
 * readable, which never counts as a started team. The real one replaces this by changing one import in ../deps.ts.
 */
export type TeamStart = { phase: "awaiting_profile" | "burst" | "steady" | null; workers: number; planDeclared: boolean };

export async function readTeamStart(): Promise<TeamStart | null> {
  return null;
}
