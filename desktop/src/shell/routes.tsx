import type { ComponentType } from "react";
import DashboardPage from "../pages/dashboard";
import MapPage from "../pages/map";
import MessagesPage from "../pages/messages";
import PositionPage from "../pages/position";
import PositionsPage from "../pages/positions";
import ProfilePage from "../pages/profile";
import SwipePage from "../pages/swipe";
import TeamPage from "../pages/team";
import type { PageProps } from "../pages/types";

/**
 * Every page of the shell, with the same paths as the web
 * (web/app/(protected)/<name>), so the web components' links land here
 * unchanged. A page is the default export of desktop/src/pages/<name>/index.tsx.
 */
export type Route = { path: string; page: ComponentType<PageProps> };

export const HOME = "/dashboard";

export const ROUTES: Route[] = [
  { path: "/dashboard", page: DashboardPage },
  { path: "/map", page: MapPage },
  { path: "/positions", page: PositionsPage },
  { path: "/positions/:id", page: PositionPage },
  { path: "/swipe", page: SwipePage },
  { path: "/team", page: TeamPage },
  { path: "/messages", page: MessagesPage },
  { path: "/profile", page: ProfilePage },
];
