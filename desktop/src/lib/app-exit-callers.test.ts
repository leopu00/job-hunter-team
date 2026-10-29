// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

function sources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.(ts|tsx)$/.test(entry.name) && !/\.test\./.test(entry.name) ? [path] : [];
  });
}

const found = sources(SRC).map((path) => ({ path: relative(SRC, path).split(sep).join("/"), text: readFileSync(path, "utf8") }));
const filesUsing = (pattern: RegExp) => found.filter((file) => pattern.test(file.text)).map((file) => file.path).sort();

describe("the exit's native commands are reachable only from the exit dialog", () => {
  it("names app_exit_order, app_exit_poll, app_exit_finish and app_exit_state in one file only: the exit's own calls", () => {
    expect(filesUsing(/app_exit_(?:order|poll|finish|state)\b/)).toEqual(["lib/app-exit.ts"]);
  });

  it("calls those wrappers from the dialog and from nowhere else", () => {
    expect(filesUsing(/\b(?:exitOrder|exitPoll|exitFinish|exitState)\b/)).toEqual(["components/AppExitDialog.tsx", "lib/app-exit.ts"]);
  });

  it("calls them inside the dialog only from the paths a choice opens (the three ways and the wait of the ordered one)", () => {
    const dialog = found.find((file) => file.path === "components/AppExitDialog.tsx")!.text;
    // exitFinish: `leave` alone; exitOrder and exitPoll: `stopInOrder` alone
    expect(dialog.match(/\bexitFinish\(/g)).toHaveLength(1);
    expect(dialog.match(/\bexitOrder\(/g)).toHaveLength(1);
    expect(dialog.match(/\bexitPoll\(/g)).toHaveLength(1);
    const leave = dialog.slice(dialog.indexOf("const leave = "), dialog.indexOf("const stopInOrder = "));
    expect(leave).toContain("exitFinish(mode)");
    const stop = dialog.slice(dialog.indexOf("const stopInOrder = "), dialog.indexOf("const run = "));
    expect(stop).toContain("exitOrder()");
    expect(stop).toContain("exitPoll()");
    // and those two are reached only from `run` (the choice, or the one remembered), never on opening
    const rest = dialog.slice(dialog.indexOf("const run = "));
    expect(rest).toContain("stopInOrder(id)");
    expect(rest).toContain("leave(mode, id, quiet)");
  });
});
