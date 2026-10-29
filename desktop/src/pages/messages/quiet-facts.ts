import { readTeamSettings, type TeamSettingsResult } from "../../lib/team-settings-native";
import type { QuietFacts } from "./team-quiet";

/**
 * What the team says about itself, to explain its silence: the hours and the burst come with the team's settings, and with them the
 * provider's work window, a containment and the provider's login when the box says them. A team that does not answer gives nothing
 * (never «no reason»), and a fact the box leaves out is left out here.
 */
export async function loadQuietFacts(read: () => Promise<TeamSettingsResult> = readTeamSettings): Promise<QuietFacts | null> {
  const reply = await read();
  if (!reply.ok) return null;
  const { workingHours, burst, quiet } = reply.settings;
  return {
    hours: workingHours,
    burstActive: burst?.active === true,
    ...(quiet?.budget ? { budget: quiet.budget } : {}),
    ...(quiet?.containment !== undefined ? { containment: quiet.containment } : {}),
    ...(quiet?.providerReady !== undefined ? { providerReady: quiet.providerReady } : {}),
  };
}
