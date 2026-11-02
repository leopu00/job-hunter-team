import type { ComponentType } from "react";
import AgentsPanel from "../pages/agents/AgentsPanel";
import ExistingTeamStatusPage from "../pages/existing-team";
import ExistingTeamProfilePage from "../pages/existing-team/profile";
import ExistingTeamOfficePage from "../pages/office/readonly";
import DashboardPage from "../pages/dashboard";
import MailPage from "../pages/mail";
import BudgetPage from "../pages/budget";
import MapPage from "../pages/map";
import MessagesPage from "../pages/messages";
import OfficePage from "../pages/office";
import PositionPage from "../pages/position";
import PositionsPage from "../pages/positions";
import ProfilePage from "../pages/profile";
import HelpPage from "../pages/help";
import SettingsPage from "../pages/settings";
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
  /** the page fills the window under the navbar, edge to edge, without the web's MainChrome (the office's scene, the chat) */
  fullBleed?: boolean;
};

export const HOME = "/dashboard";

/**
 * Reading an existing team's VPS (lib/existing-team-readonly.ts): the pages
 * that read it, and no other. The rest of the shell reads the cloud or the box.
 * It lands on the dashboard, as the web does.
 */
export const READ_ONLY_HOME = "/dashboard";

export const ROUTES: Route[] = [
  { path: "/dashboard", page: DashboardPage },
  { path: "/map", page: MapPage },
  { path: "/positions", page: PositionsPage },
  { path: "/positions/:id", page: PositionPage },
  // The deck fills the window under the navbar (a full-bleed page), so a bar above it never pushes it past the window.
  { path: "/swipe", page: SwipePage, fullBleed: true },
  { path: "/team", page: TeamPage },
  { path: "/team/log", page: TeamLogPage },
  { path: "/team/scout", page: TeamScoutPage },
  { path: "/team/analista", page: TeamAnalistaPage },
  { path: "/team/scorer", page: TeamScorerPage },
  { path: "/team/scrittore", page: TeamScrittorePage },
  { path: "/team/critico", page: TeamCriticoPage },
  // The chat fills the window under the navbar (a full-bleed page): a small window never scrolls the page away from the navbar and the list of agents.
  { path: "/messages", page: MessagesPage, fullBleed: true },
  { path: "/profile", page: ProfilePage },
  // The desktop's own pages, with no web counterpart (DESKTOP_LINKS in desktop-links.ts).
  // The agents' control panel, on this computer or on the linked VPS (agent_control).
  { path: "/agents", page: AgentsPanel },
  { path: "/office", page: OfficePage, fullBleed: true },
  { path: "/mail", page: MailPage },
  // How the team's weekly budget is going (the native team_budget_read): only reads, so the read-only view has it too.
  { path: "/budget", page: BudgetPage },
  // The technical pages are the sections of one Settings page (pages/settings); the addresses they had are
  // redirected there (redirects.ts), so they are not routes.
  { path: "/settings/:section", page: SettingsPage },
  { path: "/help", page: HelpPage },
];

export const READ_ONLY_ROUTES: Route[] = [
  // The map reads the team's positions from its VPS when this view is on. The office is not
  // in this list: the full shell's one reads the cloud (see the route below).
  ...ROUTES.filter((route) => ["/dashboard", "/map", "/positions", "/positions/:id", "/budget"].includes(route.path)),
  // Not the web's cloud Team page: the state the existing team's VPS reports about itself.
  { path: "/team", page: ExistingTeamStatusPage },
  // Not the web's cloud Profile page: the profile the existing team's VPS holds.
  { path: "/profile", page: ExistingTeamProfilePage },
  // Not the cloud's Realtime office: the same office, drawn from what the team's VPS reports.
  { path: "/office", page: ExistingTeamOfficePage, fullBleed: true },
  // The same agents' panel: here it reads, and the native side refuses every action.
  { path: "/agents", page: AgentsPanel },
  // Where «Chat with <agent>» of the Agents page leads: history and answers only, the composer is locked (MessagesPage).
  { path: "/messages", page: MessagesPage, fullBleed: true },
  // The app's own language and currency, and the sections of the team on the linked VPS (the Team section
  // says why the hours and the models do not open on the read-only link); backup and export only read.
  { path: "/settings/:section", page: SettingsPage },
  // What the read-only view does: it says only that.
  { path: "/help", page: HelpPage },
];
