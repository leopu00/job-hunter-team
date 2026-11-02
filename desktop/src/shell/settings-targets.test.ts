// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { redirectFor } from "./redirects";
import { matchRoute } from "./router";
import { READ_ONLY_ROUTES, ROUTES } from "./routes";

// Every address the Settings page, its sections and its cards send the person to is a page, or an old address
// that goes on to one, in the full shell and in the view of a team on a VPS.
describe("the addresses the settings pages navigate to", () => {
  it("each has a route, or goes on to one", () => {
    const folder = fileURLToPath(new URL("../pages/settings/", import.meta.url));
    const sources = ["index.tsx", "SettingsSections.tsx", "TeamCard.tsx", "AccountCard.tsx"].map((file) => readFileSync(join(folder, file), "utf8"));
    const targets = new Set(sources.flatMap((source) => [...source.matchAll(/navigate\("([^"?]+)[^"]*"\)/g)].map((match) => match[1])));
    expect(targets.size).toBeGreaterThanOrEqual(2);
    for (const target of targets) {
      const goes = redirectFor(target, "")?.split("?")[0] ?? target;
      expect(matchRoute(ROUTES, goes), target).not.toBeNull();
      expect(matchRoute(READ_ONLY_ROUTES, goes), target).not.toBeNull();
    }
  });
});
