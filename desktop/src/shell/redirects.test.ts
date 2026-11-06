import { afterEach, describe, expect, it } from "vitest";
import { redirectFor } from "./redirects";
import { matchRoute } from "./router";
import { READ_ONLY_ROUTES, ROUTES } from "./routes";

afterEach(() => localStorage.removeItem("jht-settings-section"));

describe("the old addresses of the pages that are now sections of Settings", () => {
  it.each([
    ["/settings/hours", "", "/settings/team?at=hours"],
    ["/settings/vps-connection", "", "/settings/where?at=vps"],
    ["/export", "", "/settings/data?at=export"],
    ["/backup", "", "/settings/data?at=backup"],
    ["/computer", "", "/settings/data?at=uninstall"],
  ])("%s goes on to its section", (path, search, target) => {
    expect(redirectFor(path, search)).toBe(target);
    // and the target is a page, in the full shell and in the view of a team on a VPS
    const [targetPath] = target.split("?");
    expect(matchRoute(ROUTES, targetPath)).not.toBeNull();
    expect(matchRoute(READ_ONLY_ROUTES, targetPath)).not.toBeNull();
  });

  it("is not a route any more: the shell sends it on before it draws anything", () => {
    for (const path of ["/settings/hours", "/settings/vps-connection", "/export", "/backup", "/computer"]) {
      expect(ROUTES.some((route) => route.path === path), path).toBe(false);
    }
    // the sections themselves are one route, and /settings/team (the models' old address) is the Team section
    expect(matchRoute(ROUTES, "/settings/team")?.route.path).toBe("/settings/:section");
    expect(redirectFor("/settings/team", "")).toBeNull();
  });

  it("keeps a query the old address came with", () => {
    expect(redirectFor("/export", "?x=1")).toBe("/settings/data?at=export&x=1");
  });

  it("opens /settings on the section the person was last in, else on Appearance", () => {
    expect(redirectFor("/settings", "")).toBe("/settings/appearance");
    localStorage.setItem("jht-settings-section", "data");
    expect(redirectFor("/settings", "")).toBe("/settings/data");
    localStorage.setItem("jht-settings-section", "nonsense");
    expect(redirectFor("/settings", "")).toBe("/settings/appearance");
  });

  it("leaves every other address alone", () => {
    for (const path of ["/dashboard", "/mail", "/profile", "/help", "/office", "/messages", "/settings/appearance"]) {
      expect(redirectFor(path, ""), path).toBeNull();
    }
  });

  it("sends the Agents page and the page of one agent to the Team page, with the agent and the tab", () => {
    expect(redirectFor("/agents", "")).toBe("/messages?tab=squad");
    expect(redirectFor("/agents", "?agent=SCOUT-1")).toBe("/messages?agent=scout&tab=info");
    expect(redirectFor("/agents", "?agent=capitano")).toBe("/messages?agent=capitano&tab=info");
    expect(redirectFor("/agents/ANALISTA-2", "")).toBe("/messages?agent=analista-2&tab=info");
    expect(redirectFor("/agents/scout-1", "")).toBe("/messages?agent=scout&tab=info");
    // a session without a chat is a row of its own
    expect(redirectFor("/agents/DOTTORE", "")).toBe("/messages?session=DOTTORE&tab=info");
    expect(redirectFor("/agents/CRITICO-S2", "")).toBe("/messages?session=CRITICO-S2&tab=info");
    expect(redirectFor("/agents/a/b", "")).toBeNull();
  });
});
