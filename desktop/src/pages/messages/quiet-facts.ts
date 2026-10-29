import { readTeamSettings } from "../../lib/team-settings-native";
import type { QuietFacts } from "./team-quiet";

/**
 * What the team says about itself, to explain its silence: the hours and the burst come with the team's settings. A team that does
 * not answer gives nothing (never «no reason»).
 */
export async function loadQuietFacts(): Promise<QuietFacts | null> {
  const reply = await readTeamSettings();
  if (!reply.ok) return null;
  return { hours: reply.settings.workingHours, burstActive: reply.settings.burst?.active === true };
}
