import type { PageProps } from "../types";
import { OfficeLoader } from "./index";

/**
 * /office in the read-only view of an existing team: the same office, fed by
 * the team's VPS through the probe behind the Squadra page instead of the
 * cloud. No Realtime, no panels (see OfficeSource in ./index.tsx).
 */
export default function ExistingTeamOfficePage(_props: PageProps) {
  return <OfficeLoader source="team-probe" />;
}
