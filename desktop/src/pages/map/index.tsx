import MapLoading from "@/app/(protected)/map/loading";
import WebMapPage from "@/app/(protected)/map/page";
import ServerPage from "../../shell/server-page";
import type { PageProps } from "../types";

/**
 * web/app/(protected)/map, run as it is: the globe with the positions, the
 * location, score and type cards. Its data routes (/api/positions/coords,
 * /no-coords, /locations) are answered by pages/map/map-api.ts.
 */
export default function MapPage(_props: PageProps) {
  return <ServerPage render={() => WebMapPage()} fallback={<MapLoading />} />;
}
