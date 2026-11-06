// @vitest-environment node
/**
 * On Windows the release app is a window program. Built as a console program
 * (no `windows_subsystem`) it opened a black console window behind the app on
 * every start; as a window program, every console program it starts (ssh,
 * PowerShell) would open its own window unless it is started hidden. Both
 * halves are read from the sources: the real thing runs in the Windows test.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SRC = new URL("../../src-tauri/src/", import.meta.url);
const read = (name: string) => readFileSync(new URL(name, SRC), "utf8");

describe("the Windows app opens no console of its own", () => {
  it("is built as a window program in release, and a console one in debug (the dev log stays visible)", () => {
    expect(read("main.rs")).toMatch(/^#!\[cfg_attr\(not\(debug_assertions\), windows_subsystem = "windows"\)\]$/m);
  });

  it("hides the console of the programs it starts, in one place", () => {
    const hide = read("runtime_host.rs");
    expect(hide).toMatch(/pub\(crate\) fn hide_console\(command: &mut Command\) \{[\s\S]*?CREATE_NO_WINDOW: u32 = 0x0800_0000;[\s\S]*?creation_flags\(CREATE_NO_WINDOW\)/);
    // outside Windows the same function cleans the AppImage's environment off the child: one place for both
    expect(hide).toMatch(/#\[cfg\(not\(windows\)\)\]\s*pub\(crate\) fn hide_console\(command: &mut Command\) \{\s*clean_appimage_env\(command\);\s*\}/);
    // and still ONE place: one function per platform, and one cleaner they share
    expect(hide.match(/fn hide_console\(/g)).toHaveLength(2);
    expect(hide.match(/pub\(crate\) fn clean_appimage_env\(/g)).toHaveLength(1);
  });

  // The spawns that did not go through runtime_host's own helper: the provider login (PowerShell on this
  // computer, ssh on a VPS), the LinkedIn view's tunnel and the direct chat's tunnel.
  it.each([
    ["onboarding.rs", /hide_console\(&mut command\);\s*let mut child = command\s*\.spawn\(\)\s*\.map_err\(\|_\| failure\("provider_login_start_failed"\)\)/],
    ["broker_view.rs", /hide_console\(&mut command\);\s*let mut child = command\.spawn\(\)\.map_err\(\|_\| "tunnel_start_failed"\)/],
    ["direct_chat/ssh_link.rs", /hide_console\(&mut command\);\s*let child = (?:command\.spawn\(\)|crate::runtime_host::spawn_retrying_busy\(&mut command\))\.map_err\(\|_\| failure\("tunnel_start_failed"\)\)/],
  ])("%s: the console program it spawns is hidden right before it starts", (file, pattern) => {
    expect(read(file)).toMatch(pattern);
    expect(read(file)).toContain("crate::runtime_host::hide_console(&mut command);");
  });
});
