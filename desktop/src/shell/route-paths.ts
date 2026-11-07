/** Route templates shared by the shell and its closed page-timing keys. */
export const ROUTE_PATHS = {
  dashboard: "/dashboard",
  map: "/map",
  positions: "/positions",
  position: "/positions/:id",
  swipe: "/swipe",
  team: "/team",
  team_log: "/team/log",
  team_scout: "/team/scout",
  team_analista: "/team/analista",
  team_scorer: "/team/scorer",
  team_scrittore: "/team/scrittore",
  team_critico: "/team/critico",
  messages: "/messages",
  profile: "/profile",
  agents: "/agents",
  agent: "/agents/:name",
  office: "/office",
  mail: "/mail",
  budget: "/budget",
  settings: "/settings/:section",
  help: "/help",
} as const;

export type PageKey = keyof typeof ROUTE_PATHS;
export const LOAD_PAGES = Object.keys(ROUTE_PATHS) as PageKey[];
export const PAGE_ROUTES = LOAD_PAGES.map((key) => ({ key, path: ROUTE_PATHS[key] }));
