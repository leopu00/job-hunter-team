import { describe, expect, it } from "vitest";
// @ts-expect-error plain JavaScript module of the CLI
import { agentControlArgv } from "../../../cli/src/lib/agent-control-args.js";

// JHT-T171: what each agent worked on is one read with ONE argument in `jht agent-control`: a window of the page's six.
describe("agent-control: activity", () => {
  it("passes on each of the page's six windows", () => {
    for (const window of ["5m", "15m", "1h", "5h", "24h", "7d"]) {
      expect(agentControlArgv(["activity", window])).toEqual(["activity", window]);
    }
  });

  it("refuses no window, another window, a flag, a second argument and a different spelling", () => {
    for (const args of [
      ["activity"], ["activity", ""], ["activity", "2h"], ["activity", "30d"], ["activity", "1H"], ["activity", "1h "],
      ["activity", "-1h"], ["activity", "--window", "1h"], ["activity", "1h", "SCOUT-1"], ["activity", "1h;ls"],
      ["Activity", "1h"], ["activities", "1h"],
    ]) {
      expect(agentControlArgv(args), JSON.stringify(args)).toBeNull();
    }
  });
});
