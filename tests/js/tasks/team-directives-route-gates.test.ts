import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "../../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("team directive route deployment and identity gates", () => {
  it("mounts the writable panel on the web team page", () => {
    const page = read("web/app/(protected)/team/page.tsx");
    expect(page).toContain("<DirectivesPanel />");
    expect(page).not.toContain("<DirectivesPanel readOnly />");
  });

  it("never opens a coincidental SQLite file in a cloud deployment", () => {
    const route = read("web/app/api/team-directives/route.ts");
    expect(route).toContain(
      'import { isCloudDeploy } from "@/lib/deploy-mode"',
    );
    expect(route).toContain(
      "if (isCloudDeploy() || !fs.existsSync(JHT_DB_PATH))",
    );
  });

  it.each([
    "web/app/api/team-directives/route.ts",
    "desktop/app-payload/web/app/api/team-directives/route.ts",
  ])("requires a client request_id in %s", (path) => {
    const route = read(path);
    expect(route).toContain("function requireRequestId(value: unknown)");
    expect(route).not.toContain("randomUUID");
    expect(route).not.toContain("if (value === undefined)");
  });

  it("keeps the desktop directive API on the authenticated loopback boundary", () => {
    const route = read(
      "desktop/app-payload/web/app/api/team-directives/route.ts",
    );
    expect(route).toContain("authorizeDesktopRequest(req)");
    expect(route.match(/authorizeDesktopRequest\(req\)/g)).toHaveLength(3);
    expect(route).toContain("DESKTOP_DB_PATH");
    expect(route).not.toContain('"databases", "jobs.db"');

    const desktopPackage = JSON.parse(
      read("desktop/app-payload/web/package.json"),
    );
    expect(desktopPackage.scripts.dev).toContain("-H 127.0.0.1");
    expect(desktopPackage.scripts.start).toContain("-H 127.0.0.1");

    for (const launcher of [
      "desktop/app-payload/scripts/launchers/start-mac.sh",
      "desktop/app-payload/scripts/launchers/start-linux.sh",
      "desktop/app-payload/scripts/launchers/start-windows.ps1",
      "desktop/app-payload/scripts/launchers/start-windows.bat",
      "desktop/app-payload/cli/src/commands/dashboard.js",
    ]) {
      expect(read(launcher), launcher).toContain("127.0.0.1");
    }
  });

  it.each([
    "web/app/api/team-directives/route.ts",
    "desktop/app-payload/web/app/api/team-directives/route.ts",
  ])("returns only allowlisted errors from %s", (path) => {
    const route = read(path);
    expect(route).toContain("publicDirectiveError(error)");
    expect(route).not.toContain("detail:");
    expect(route).not.toContain("error instanceof Error");
  });

  it("never renders a server-provided error string in the web panel", () => {
    const panel = read("web/app/(protected)/team/DirectivesPanel.tsx");
    expect(panel).toContain("directiveErrorTranslationKey(data)");
    expect(panel).not.toContain("toast(data.error");
  });
});
