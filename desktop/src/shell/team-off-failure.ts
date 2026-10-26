import type { Locale } from "@/i18n/config";
import type { TeamOff } from "../lib/team-off";
import { TEAM_OFF_TEXT } from "./team-off.i18n";

/** The codes a page gets when the chat channel to the container is not there: the container is off, or not connected yet. */
const CONTAINER_OFF_CODES = new Set(["local_team_not_running", "disconnected", "container_unavailable"]);

/**
 * What a page that reads the team's container says when it cannot, in the app opened without the team: the
 * catalog's «start the team» is not the way (the container is what is off, and the banner above turns it on
 * without starting any agent). Null: say the catalog's own sentence.
 */
export function teamOffFailure(code: string, teamOff: TeamOff | null, locale: Locale): string | null {
  if (!teamOff || !CONTAINER_OFF_CODES.has(code)) return null;
  return TEAM_OFF_TEXT[locale].needsRuntime;
}
