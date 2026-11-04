import { describeError } from "./error-catalog";

/** What a person types in the Terminal to update the team: the host's own command (`jht upgrade`). */
export const TEAM_UPDATE_COMMAND = "jht upgrade";

/**
 * True for every error whose catalog action is «Update the team…»: the team runs an older image than the app. It is read from
 * the catalog itself, so a new message that asks for the update gets the guide with no second list to keep in step.
 */
export function wantsTeamUpdate(code: string | null | undefined): boolean {
  if (typeof code !== "string") return false;
  const described = describeError(code, { locale: "en" });
  return described.known && /^Update the team\b/i.test(described.action);
}
