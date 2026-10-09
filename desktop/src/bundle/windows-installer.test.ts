// @vitest-environment node
/**
 * The Windows installer's own changes to Tauri's NSIS template, read from
 * the files the bundler uses. The real install and uninstall run in the
 * Windows job of .github/workflows/game.yml.
 */
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { locales } from "@/i18n/config";

const TAURI = new URL("../../src-tauri/", import.meta.url);
const config = JSON.parse(readFileSync(new URL("tauri.conf.json", TAURI), "utf8")) as {
  bundle?: {
    windows?: {
      nsis?: {
        installerHooks?: string;
        languages?: string[];
        customLanguageFiles?: Record<string, string>;
        displayLanguageSelector?: boolean;
      };
    };
  };
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

describe("the Windows installer's languages", () => {
  // The NSIS name of each language of the app.
  const NSIS_LANGUAGE = { en: "English", it: "Italian", de: "German", es: "Spanish", fr: "French", pt: "Portuguese", hu: "Hungarian" };
  // The LangStrings of Tauri 2.11's NSIS template, as its English file has them.
  const TAURI_STRINGS = [
    "addOrReinstall", "alreadyInstalled", "alreadyInstalledLong", "appRunning", "appRunningOkKill",
    "chooseMaintenanceOption", "choowHowToInstall", "createDesktop", "dontUninstall", "dontUninstallDowngrade",
    "failedToKillApp", "installingWebview2", "newerVersionInstalled", "older", "olderOrUnknownVersionInstalled",
    "silentDowngrades", "unableToUninstall", "uninstallApp", "uninstallBeforeInstalling", "unknown",
    "webview2AbortError", "webview2DownloadError", "webview2DownloadSuccess", "webview2Downloading",
    "webview2InstallError", "webview2InstallSuccess", "deleteAppData",
  ];

  it("speaks the 7 languages of the app, in Windows' own language, English when it has none of them", () => {
    expect(nsis.languages?.[0]).toBe("English");
    expect([...(nsis.languages ?? [])].sort()).toEqual(locales.map((locale) => NSIS_LANGUAGE[locale]).sort());
    // No selector: NSIS picks the language of Windows by itself.
    expect(nsis.displayLanguageSelector).toBe(false);
  });

  it("brings Hungarian, which Tauri does not ship, with every string Tauri's template uses", () => {
    expect(Object.keys(nsis.customLanguageFiles ?? {})).toEqual(["Hungarian"]);
    const file = readFileSync(new URL(nsis.customLanguageFiles!.Hungarian, TAURI));
    expect([...file.subarray(0, 3)], "UTF-8 with BOM").toEqual([0xef, 0xbb, 0xbf]);
    const lines = file.toString("utf8").split(/\r?\n/).filter((line) => line.startsWith("LangString "));
    const strings = lines.map((line) => /^LangString (\w+) \$\{LANG_HUNGARIAN\} "(.+)"$/.exec(line));
    expect(strings.every(Boolean), "every LangString is Hungarian and has a text").toBe(true);
    expect(strings.map((match) => match![1]).sort()).toEqual([...TAURI_STRINGS].sort());
    for (const match of strings) expect(match![2]).not.toMatch(/\{\{|\}\}/);
  });
});

