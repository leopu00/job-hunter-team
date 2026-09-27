import type { OfficeClick } from "../contract";

/** Where a click in the office leads: the agent's page, or the positions. */
export function routeForClick(click: OfficeClick): string {
  if (click.kind === "agent") return `/agents?agent=${encodeURIComponent(click.role)}`;
  return "/positions";
}
