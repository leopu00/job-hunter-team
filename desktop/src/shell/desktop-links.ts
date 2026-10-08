/**
 * The desktop's own pages, after the web's links: they have no web
 * counterpart, so NavLinks (a web file) does not list them. A module of its
 * own, not an export of Shell.tsx: a component file that also exports data
 * cannot be Fast Refreshed, and every edit of Shell.tsx reloaded the page.
 */
export const DESKTOP_LINKS = [
  { href: "/agents", label: "Agenti" },
  { href: "/office", label: "Ufficio" },
  { href: "/mail", label: "Posta" },
];
