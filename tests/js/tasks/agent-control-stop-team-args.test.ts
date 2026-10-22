import { describe, expect, it } from "vitest";
// @ts-expect-error plain JavaScript module of the CLI
import { agentControlArgv } from "../../../cli/src/lib/agent-control-args.js";

// JHT-T54: «Ferma la squadra» of the agents panel is one action with no argument in `jht agent-control`.
describe("agent-control: stop-team", () => {
  it("passes on the bare action", () => {
    expect(agentControlArgv(["stop-team"])).toEqual(["stop-team"]);
  });

  it("refuses an argument, a session or a flag after it", () => {
    for (const args of [["stop-team", "SCOUT-1"], ["stop-team", "--all"], ["stop-team", ""], ["stopteam"], ["Stop-Team"]]) {
      expect(agentControlArgv(args), JSON.stringify(args)).toBeNull();
    }
  });
});
