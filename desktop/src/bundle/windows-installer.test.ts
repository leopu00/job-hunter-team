// @vitest-environment node
/**
 * The Windows installer's own changes to Tauri's NSIS template, read from
 * the files the bundler uses. The real install and uninstall run in the
 * Windows job of .github/workflows/game.yml.
 */
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const TAURI = new URL("../../src-tauri/", import.meta.url);
const config = JSON.parse(readFileSync(new URL("tauri.conf.json", TAURI), "utf8")) as {
  bundle?: { windows?: { nsis?: { installerHooks?: string } } };
};
const nsis = config.bundle?.windows?.nsis ?? {};

/** The body of one hook macro, or null. */
function hook(source: string, name: string): string | null {
  return new RegExp(`^!macro ${name}\\r?\\n([\\s\\S]*?)^!macroend`, "m").exec(source)?.[1] ?? null;
}

describe("the Windows installer's hooks", () => {
  const hooksPath = nsis.installerHooks ? new URL(nsis.installerHooks, TAURI) : null;
  const hooks = hooksPath && existsSync(hooksPath) ? readFileSync(hooksPath, "utf8") : "";

  it("are wired in tauri.conf.json and exist", () => {
    expect(nsis.installerHooks).toBe("windows/installer-hooks.nsi");
    expect(hooks).not.toBe("");
  });

  it("write InstallLocation as the bare path, after the template wrote it in quotes", () => {
    const postInstall = hook(hooks, "NSIS_HOOK_POSTINSTALL");
    expect(postInstall, "NSIS_HOOK_POSTINSTALL").not.toBeNull();
    expect(postInstall).toContain('WriteRegStr SHCTX "${UNINSTKEY}" "InstallLocation" "$INSTDIR"');
  });
});
