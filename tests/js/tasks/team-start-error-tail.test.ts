import { describe, expect, it } from "vitest";
import { spawnErrorTail } from "../../../cli/src/commands/team/start.js";


describe("team start — spawn diagnostics", () => {
  it("keeps the last five meaningful launcher lines", () => {
    const output = [
      "first detail",
      "",
      "second detail",
      "third detail",
      "fourth detail",
      "fifth detail",
      "sixth detail",
      "",
    ].join("\n");

    expect(spawnErrorTail(output)).toBe([
      "second detail",
      "third detail",
      "fourth detail",
      "fifth detail",
      "sixth detail",
    ].join("\n"));
  });

  it("normalizes whitespace-only output to the fallback diagnosis", () => {
    expect(spawnErrorTail(" \n\t\n")).toBe("unknown error");
  });
});
