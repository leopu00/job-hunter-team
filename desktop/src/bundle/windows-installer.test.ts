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

  it("are UTF-8 with BOM, as NSIS reads a file with texts in Unicode", () => {
    expect([...readFileSync(hooksPath!).subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
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
    // Tauri copies a language file next to the installer script and writes
    // its own UTF-8 BOM in front: one of ours too, and makensis reads the
    // second as part of the first command («Invalid command: ";"»). The hooks
    // file is included where it is, so it keeps its BOM (test above).
    expect([...file.subarray(0, 3)], "no UTF-8 BOM: Tauri adds it").not.toEqual([0xef, 0xbb, 0xbf]);
    expect(() => new TextDecoder("utf-8", { fatal: true }).decode(file), "valid UTF-8").not.toThrow();
    const lines = file.toString("utf8").split(/\r?\n/).filter((line) => line.startsWith("LangString "));
    const strings = lines.map((line) => /^LangString (\w+) \$\{LANG_HUNGARIAN\} "(.+)"$/.exec(line));
    expect(strings.every(Boolean), "every LangString is Hungarian and has a text").toBe(true);
    expect(strings.map((match) => match![1]).sort()).toEqual([...TAURI_STRINGS].sort());
    for (const match of strings) expect(match![2]).not.toMatch(/\{\{|\}\}/);
  });
});

describe("the Windows installer and the v0.3.9 game", () => {
  const hooks = readFileSync(new URL(nsis.installerHooks!, TAURI), "utf8");
  const preInstall = hook(hooks, "NSIS_HOOK_PREINSTALL") ?? "";
  const postInstall = hook(hooks, "NSIS_HOOK_POSTINSTALL") ?? "";
  const postUninstall = hook(hooks, "NSIS_HOOK_POSTUNINSTALL") ?? "";
  const define = (name: string) => new RegExp(`^!define ${name} "([^"]+)"$`, "m").exec(hooks)?.[1];

  it("recognises the game by the uninstall entry its own installer writes", () => {
    const game = readFileSync(new URL("../../../game/installer/windows.nsi", import.meta.url), "utf8");
    const gameKey = /^!define UNINST_KEY "([^"]+)"$/m.exec(game)?.[1];
    expect(gameKey).toBe("Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\JobHunterTeam");
    expect(define("JHT_GAME_UNINSTKEY")).toBe(gameKey);
    expect(preInstall).toContain('ReadRegStr $R0 HKCU "${JHT_GAME_UNINSTKEY}" "UninstallString"');
  });

  it("asks only with the wizard, and removes the game only with its own uninstaller after a yes", () => {
    expect(preInstall).toMatch(/\$\{If\} \$PassiveMode <> 1\s+\$\{AndIfNot\} \$\{Silent\}[\s\S]*MessageBox MB_YESNO\|MB_ICONQUESTION "\$R9" IDYES/);
    expect(preInstall).toContain(`ExecWait '"$R1\\Uninstall.exe" /S _?=$R1' $R2`);
    // A game still there after its uninstaller stops the installation.
    expect(preInstall).toMatch(/MessageBox MB_OK\|MB_ICONSTOP "\$R9"\s+Abort/);
  });

  it("never writes or deletes the game's files: kept, this app's shortcuts take another name", () => {
    expect(define("JHT_SIDE_BY_SIDE_NAME")).toBe("Job Hunter Team App");
    // The template's own shortcuts are "${PRODUCTNAME}.lnk", the game's names.
    expect(preInstall).toMatch(/\$\{If\} \$JhtGameKept = 1\s+;[^\n]*\n\s+StrCpy \$NoShortcutMode 1/);
    for (const where of ["$SMPROGRAMS", "$DESKTOP"]) {
      expect(postInstall).toContain(`CreateShortcut "${where}\\\${JHT_SIDE_BY_SIDE_NAME}.lnk"`);
      expect(postUninstall).toContain(`Delete "${where}\\\${JHT_SIDE_BY_SIDE_NAME}.lnk"`);
    }
    const touched = [...hooks.matchAll(/^\s*(Delete|RMDir|CreateShortcut|WriteRegStr|DeleteRegKey)\b(.*)$/gm)].map((m) => `${m[1]}${m[2]}`.trim());
    expect(touched).not.toEqual(expect.arrayContaining([expect.stringMatching(/Job Hunter Team\.lnk|\$\{PRODUCTNAME\}\.lnk|JHT_GAME_UNINSTKEY|DeleteRegKey/)]));
    // Only what the person agreed to remove: the game's uninstaller and folder, after its own uninstall.
    expect(touched.filter((line) => line.includes("$R1"))).toEqual(['Delete "$R1\\Uninstall.exe"', 'RMDir "$R1"']);
  });

  it("says it in the 7 languages, each text its own", () => {
    const calls = [...hooks.matchAll(/!insertmacro JHT_TEXT((?: \\\r?\n\s+"[^"\n]*")+)/g)].map((m) => [...m[1].matchAll(/"([^"\n]*)"/g)].map((t) => t[1]));
    expect(calls).toHaveLength(3);
    for (const texts of calls) {
      expect(texts).toHaveLength(7);
      for (const text of texts) expect(text.trim()).not.toBe("");
      expect(new Set(texts).size).toBe(7);
    }
    expect(hooks).toMatch(/!macro JHT_TEXT IT EN DE ES FR HU PT/);
    for (const language of ["ITALIAN", "GERMAN", "SPANISH", "FRENCH", "HUNGARIAN", "PORTUGUESE"]) {
      expect(hooks).toContain(`$LANGUAGE = \${LANG_${language}}`);
    }
  });
});

