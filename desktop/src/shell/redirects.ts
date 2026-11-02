import { lastSection } from "../pages/settings/sections";

/**
 * The old addresses of the pages that now live in the sections of Settings: they still open, on the section
 * that holds them, so a bookmark, a link in a text or a button of an older page lands in the right place.
 * `at` is the piece of the section the old page was (it scrolls there). The map is the whole truth: a path
 * that is here is not a route (routes.tsx), the shell sends it on before it draws anything.
 */
const MOVED: Record<string, string> = {
  "/settings/hours": "/settings/team?at=hours",
  "/settings/vps-connection": "/settings/where?at=vps",
  "/export": "/settings/data?at=export",
  "/backup": "/settings/data?at=backup",
  "/computer": "/settings/data?at=uninstall",
};

/** Where an old address goes, with the query it came with kept; null when the address is not an old one. */
export function redirectFor(path: string, search: string): string | null {
  if (path === "/settings") return `/settings/${lastSection()}${search}`;
  const target = MOVED[path];
  if (!target) return null;
  // a query of the old address that the target does not set itself is kept
  if (!search) return target;
  const joined = target.includes("?") ? `${target}&${search.replace(/^\?/, "")}` : `${target}${search}`;
  return joined;
}
