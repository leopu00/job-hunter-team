import type { ComponentType } from "react";
import AgentsPage from "../pages/agents";
import DashboardPage from "../pages/dashboard";
import MapPage from "../pages/map";
import MessagesPage from "../pages/messages";
import OfficePage from "../pages/office";
import PositionPage from "../pages/position";
import PositionsPage from "../pages/positions";
import ProfilePage from "../pages/profile";
import SwipePage from "../pages/swipe";
import TeamPage from "../pages/team";
import {
  TeamAnalistaPage,
  TeamCriticoPage,
  TeamLogPage,
  TeamScorerPage,
  TeamScoutPage,
  TeamScrittorePage,
} from "../pages/team/agents";
import type { PageProps } from "../pages/types";

/**
 * Every page of the shell, with the same paths as the web
 * (web/app/(protected)/<name>), so the web components' links land here
 * unchanged. A page is the default export of desktop/src/pages/<name>/index.tsx.
 */
export type Route = {
  path: string;
  page: ComponentType<PageProps>;
  /** the page fills the window under the navbar, edge to edge, without the web's MainChrome (the office's scene) */
  fullBleed?: boolean;
};

export const HOME = "/dashboard";

export const ROUTES: Route[] = [
  { path: "/dashboard", page: DashboardPage },
  { path: "/map", page: MapPage },
  { path: "/positions", page: PositionsPage },
  { path: "/positions/:id", page: PositionPage },
  { path: "/swipe", page: SwipePage },
  { path: "/team", page: TeamPage },
  { path: "/team/log", page: TeamLogPage },
  { path: "/team/scout", page: TeamScoutPage },
  { path: "/team/analista", page: TeamAnalistaPage },
  { path: "/team/scorer", page: TeamScorerPage },
  { path: "/team/scrittore", page: TeamScrittorePage },
  { path: "/team/critico", page: TeamCriticoPage },
  { path: "/messages", page: MessagesPage },
  { path: "/profile", page: ProfilePage },
  // The desktop's own pages, with no web counterpart (DESKTOP_LINKS in desktop-links.ts).
  { path: "/agents", page: AgentsPage },
  { path: "/office", page: OfficePage, fullBleed: true },
];
