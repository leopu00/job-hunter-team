import { describe, expect, it } from "vitest";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

// helpers/sandbox-jht-home.ts runs before every test file: a test that reaches a module of the CLI which works out
// its paths when it is imported finds JHT_HOME in a temporary folder and never in the real ~/.jht.
describe("the home of the tests", () => {
  it("is a temporary folder, not the ~/.jht of whoever runs them", async () => {
    const home = process.env.JHT_HOME ?? "";
    expect(home.startsWith(join(tmpdir(), "jht-home-sandbox-")) || home.includes("jht-home-sandbox-")).toBe(true);
    expect(home).not.toBe(join(homedir(), ".jht"));
    const { JHT_HOME } = await import("../../../cli/src/jht-paths.js");
    expect(JHT_HOME).toBe(home);
  });
});
