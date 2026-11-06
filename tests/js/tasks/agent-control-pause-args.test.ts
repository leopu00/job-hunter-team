import { describe, expect, it } from "vitest";
// @ts-expect-error plain JavaScript module of the CLI
import { agentControlArgv } from "../../../cli/src/lib/agent-control-args.js";

// JHT-T181: the pause that waits for the person's word, and the pause of one agent.
describe("agent-control: the real pause", () => {
  it("passes on a pause until the person resumes, with no other word", () => {
    expect(agentControlArgv(["pause", "--until-resumed"])).toEqual(["pause", "--until-resumed"]);
    for (const args of [
      ["pause", "--until-resumed", "--for-hours", "2"],
      ["pause", "--until-resumed", "extra"],
      ["pause", "--from-assistant"],
      ["pause", "--until-resumed", "--from-assistant"],
      ["pause", "--until_resumed"],
    ]) {
      expect(agentControlArgv(args), JSON.stringify(args)).toBeNull();
    }
  });

  it("keeps the old pauses as they were", () => {
    expect(agentControlArgv(["pause", "--wake-on-weekly"])).toEqual(["pause", "--wake-on-weekly"]);
    expect(agentControlArgv(["pause", "--for-hours", "4"])).toEqual(["pause", "--for-hours", "4"]);
    expect(agentControlArgv(["pause"])).toBeNull();
  });

  it("passes on the pause of one agent only for a session of the grammar", () => {
    expect(agentControlArgv(["pause-agent", "SCOUT-1"])).toEqual(["pause-agent", "SCOUT-1"]);
    expect(agentControlArgv(["resume-agent", "CRITICO-S2"])).toEqual(["resume-agent", "CRITICO-S2"]);
    expect(agentControlArgv(["resume-agent", "CAPITANO"])).toEqual(["resume-agent", "CAPITANO"]);
    for (const args of [
      ["pause-agent"],
      ["pause-agent", "scout-1"],
      ["pause-agent", "SCOUT-1;rm"],
      ["pause-agent", "HQ-MASTER"],
      ["pause-agent", "SCOUT-1", "SCOUT-2"],
      ["pause-agent", "SCOUT-1", "--for-hours", "2"],
      ["resume-agent", ""],
    ]) {
      expect(agentControlArgv(args), JSON.stringify(args)).toBeNull();
    }
  });
});
