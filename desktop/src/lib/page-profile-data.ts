import { readExistingTeamProfile, type ExistingTeamProfileRead } from "./existing-team-profile";
import { usePageData } from "./use-page-data";

export async function loadPageProfile(): Promise<ExistingTeamProfileRead> {
  const reading = await readExistingTeamProfile();
  if (reading.kind !== "read") throw { code: reading.kind === "error" ? reading.code : "existing_team_unavailable" };
  return reading.read;
}

export function usePageProfile() {
  const kept = usePageData("profile", "profile", {}, loadPageProfile, true);
  const reading = kept.data !== undefined ? { kind: "read" as const, at: kept.at!, read: kept.data }
    : kept.error ? { kind: "error" as const, at: kept.errorAt!, code: kept.error.code }
      : { kind: "unknown" as const };
  return { reading, busy: kept.refreshing, read: kept.refresh, error: kept.error, at: kept.at, failedAt: kept.errorAt };
}
