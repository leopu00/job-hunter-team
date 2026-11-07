// Desktop replacement for web/lib/desktop-vps-positions.ts. The bridge is
// deliberately the only code that can ask native for existing-team data.
export {
  readDesktopVpsPosition,
  readDesktopVpsTeamActivity,
  readDesktopVpsTeamActivityLog,
} from "../../lib/existing-team-positions";
export { readDesktopVpsPositionFacets, readDesktopVpsPositions, readDesktopVpsPositionsWindow } from "../../lib/page-position-data";
export type {
  DesktopVpsPositionsWindow,
  DesktopVpsRead,
} from "../../lib/existing-team-positions";
