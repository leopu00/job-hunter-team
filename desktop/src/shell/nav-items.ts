import type { NavText } from "./nav.i18n";

/**
 * The destinations of the navbar and of the account menu: ONE list, so a page that wants a place in the bar
 * adds a line here and touches nothing else. A label is either a key of the web's dictionary (`web`, the
 * words the dashboard already speaks) or one of the desktop's own (`own`, shell/nav.i18n.ts).
 */
export type NavLabel = { web: "nav_dashboard" | "nav_positions" | "nav_swipe" | "nav_map" | "nav_team" | "nav_messages" | "nav_profile" } | { own: keyof NavText };

export type NavItem = {
  href: string;
  label: NavLabel;
  /** The guided tour looks for the link by this (data-tour). */
  tour?: string;
  /** The setup that is still pending (sessionStorage, pending-setup.ts) puts the «!» on this link. */
  pending?: "team" | "profile";
  /** Other addresses that keep the link lit: the pages that belong to it. */
  also?: string[];
};

/** The main bar: the positions and the team. Budget is lit only when its page exists (MainNav). */
export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: { web: "nav_dashboard" }, tour: "dashboard" },
  { href: "/positions", label: { web: "nav_positions" }, tour: "positions" },
  { href: "/swipe", label: { web: "nav_swipe" } },
  { href: "/map", label: { web: "nav_map" } },
  // Team opens the agents' panel (turn each agent on or off); the team's activity page stays one address away and keeps the link lit.
  { href: "/agents", label: { web: "nav_team" }, tour: "team", pending: "team", also: ["/team"] },
  { href: "/office", label: { own: "office" } },
  { href: "/budget", label: { own: "budget" } },
  { href: "/messages", label: { web: "nav_messages" } },
];

/** The bar of the read-only view of a team on a VPS: only what that view reads. */
export const READ_ONLY_NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: { web: "nav_dashboard" } },
  { href: "/positions", label: { web: "nav_positions" } },
  { href: "/map", label: { web: "nav_map" } },
  { href: "/team", label: { own: "team" }, also: ["/agents"] },
  { href: "/office", label: { own: "office" } },
];

/** The account menu: what is about the person and the app, not the positions. */
export const ACCOUNT_MENU_ITEMS: NavItem[] = [
  { href: "/profile", label: { web: "nav_profile" }, pending: "profile" },
  { href: "/mail", label: { own: "mail" } },
  { href: "/settings", label: { own: "settings" } },
  { href: "/help", label: { own: "help" } },
];

/** The read-only view has no mailbox of its own to show. */
export const READ_ONLY_ACCOUNT_MENU_ITEMS: NavItem[] = ACCOUNT_MENU_ITEMS.filter((item) => item.href !== "/mail");

export function isItemActive(path: string, item: NavItem): boolean {
  return [item.href, ...(item.also ?? [])].some((href) => path === href || path.startsWith(href + "/"));
}
