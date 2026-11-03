import MapLoading from "@/app/(protected)/map/loading";
import WebMapPage from "@/app/(protected)/map/page";
import { DESKTOP_RAIL_MAX_WIDTH, setMapRailMaxWidth } from "@/lib/map-panels-layout";
import ServerPage from "../../shell/server-page";
import type { PageProps } from "../types";

/**
 * web/app/(protected)/map, run as it is: the globe with the positions, the
 * location, score and type cards. Its data routes (/api/positions/coords,
 * /no-coords, /locations) are answered by pages/map/map-api.ts.
 */
// The four panels sit in the four corners from 1500 px (the web: from 1600), see lib/map-panels-layout.ts.
setMapRailMaxWidth(DESKTOP_RAIL_MAX_WIDTH);

export default function MapPage(_props: PageProps) {
  return <ServerPage render={() => WebMapPage()} fallback={<MapLoading />} />;
}
