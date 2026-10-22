import { describe, expect, it } from "vitest";
// @ts-expect-error plain JavaScript module of the CLI
import { agentControlArgv } from "../../../cli/src/lib/agent-control-args.js";

// JHT-T43: the previous sessions of the agents are one read with no argument in `jht agent-control`.
describe("agent-control: history", () => {
  it("passes on the bare read", () => {
    expect(agentControlArgv(["history"])).toEqual(["history"]);
  });

  it("refuses an argument, a session or a flag after it", () => {
    for (const args of [["history", "SCOUT-1"], ["history", "--days", "30"], ["history", ""], ["histories"], ["History"]]) {
      expect(agentControlArgv(args), JSON.stringify(args)).toBeNull();
    }
  });
});
