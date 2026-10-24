import type { ComponentType } from "react";
import AgentsPanel from "../pages/agents/AgentsPanel";
import ExistingTeamStatusPage from "../pages/existing-team";
import ExistingTeamProfilePage from "../pages/existing-team/profile";
import ExistingTeamOfficePage from "../pages/office/readonly";
import DashboardPage from "../pages/dashboard";
import MailPage from "../pages/mail";
import BackupPage from "../pages/backup";
import ComputerPage from "../pages/computer";
import ExportPage from "../pages/export";
import MapPage from "../pages/map";
import MessagesPage from "../pages/messages";
import OfficePage from "../pages/office";
import PositionPage from "../pages/position";
import PositionsPage from "../pages/positions";
import ProfilePage from "../pages/profile";
import HelpPage from "../pages/help";
import SettingsPage from "../pages/settings";
import TeamSettingsPage from "../pages/team-settings";
import VpsConnectionPage from "../pages/vps-connection";
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
  // The agents' control panel, on this computer or on the linked VPS (agent_control).
  { path: "/agents", page: AgentsPanel },
  { path: "/office", page: OfficePage, fullBleed: true },
  { path: "/mail", page: MailPage },
  { path: "/settings", page: SettingsPage },
  { path: "/settings/vps-connection", page: VpsConnectionPage },
  // When the agents work and the model and effort of each role (the web's /settings/team).
  { path: "/settings/team", page: TeamSettingsPage },
  // The team's data and the account's in a file (the web's /export): only reads, so the read-only view has it too.
  { path: "/export", page: ExportPage },
  // A backup of the team's data on this computer (the web's /backup): making one only reads, so the read-only view has it too.
  { path: "/backup", page: BackupPage },
  { path: "/help", page: HelpPage },
  // «Remove JHT from this computer» (Windows): linked only where it can run.
  { path: "/computer", page: ComputerPage },
];

export const READ_ONLY_ROUTES: Route[] = [
  // The map reads the team's positions from its VPS when this view is on. The office is not
  // in this list: the full shell's one reads the cloud (see the route below).
  ...ROUTES.filter((route) => ["/dashboard", "/map", "/positions", "/positions/:id", "/export", "/backup"].includes(route.path)),
  // Not the web's cloud Team page: the state the existing team's VPS reports about itself.
  { path: "/team", page: ExistingTeamStatusPage },
  // Not the web's cloud Profile page: the profile the existing team's VPS holds.
  { path: "/profile", page: ExistingTeamProfilePage },
  // Not the cloud's Realtime office: the same office, drawn from what the team's VPS reports.
  { path: "/office", page: ExistingTeamOfficePage, fullBleed: true },
  // The same agents' panel: here it reads, and the native side refuses every action.
  { path: "/agents", page: AgentsPanel },
  // The app's own language and currency: local choices, nothing reaches the team.
  { path: "/settings", page: SettingsPage },
  { path: "/settings/vps-connection", page: VpsConnectionPage },
  // What the read-only view does: it says only that.
  { path: "/help", page: HelpPage },
];

/** The navigation of that view, in the order of the web's own bar. */
export const READ_ONLY_NAV = [
  { href: "/dashboard", label: "nav_dashboard" },
  { href: "/map", label: "nav_map" },
  { href: "/positions", label: "nav_positions" },
  { href: "/team", label: "own:team" },
  { href: "/profile", label: "own:profile" },
  // A desktop page, after the web's ones as in the full shell (DESKTOP_LINKS).
  { href: "/office", label: "own:office" },
  { href: "/agents", label: "own:agents" },
  { href: "/settings", label: "own:settings" },
  { href: "/help", label: "own:help" },
] as const;
