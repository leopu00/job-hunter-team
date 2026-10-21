/**
 * Stopping the whole team, from the agents' panel: the same request the Team
 * page's card sent (web/app/api/team-state/emergency-stop, answered in the
 * desktop by pages/team/team-api.ts with the user's session). It only asks the
 * cloud for should_run=false; the team's own device applies it with its fixed
 * `jht team stop`. No command, no target and no argument leave the page; in
 * the read-only view the shell's bridge refuses it (shellApi).
 */
export type TeamStopOutcome = { ok: true } | { ok: false; status: number | null };

export async function requestTeamStop(): Promise<TeamStopOutcome> {
  try {
    const response = await fetch("/api/team-state/emergency-stop", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirm: "STOP" }),
    });
    return response.ok ? { ok: true } : { ok: false, status: response.status };
  } catch {
    return { ok: false, status: null };
  }
}
