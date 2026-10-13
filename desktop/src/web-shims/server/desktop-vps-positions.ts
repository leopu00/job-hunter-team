// Desktop replacement for web/lib/desktop-vps-positions.ts. The bridge is
// deliberately the only code that can ask native for existing-team data.
export {
  readDesktopVpsPosition,
  readDesktopVpsPositionFacets,
  readDesktopVpsPositions,
} from "../../lib/existing-team-positions";
export type { DesktopVpsRead } from "../../lib/existing-team-positions";
