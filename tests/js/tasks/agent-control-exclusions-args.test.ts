import { describe, expect, it } from "vitest";
// @ts-expect-error plain JavaScript module of the CLI
import { agentControlArgv } from "../../../cli/src/lib/agent-control-args.js";

// JHT-T24-b: the closed forms of the exclusions of the profile in `jht agent-control`. A code is a
// lowercase word; anything else never reaches the container.
describe("agent-control: exclusions", () => {
  it("passes on the three forms", () => {
    expect(agentControlArgv(["exclusions"])).toEqual(["exclusions"]);
    expect(agentControlArgv(["exclusion-accept", "company"])).toEqual(["exclusion-accept", "company"]);
    expect(agentControlArgv(["exclusion-withdraw", "wrong_location"])).toEqual(["exclusion-withdraw", "wrong_location"]);
  });

  it("refuses every other shape", () => {
    const bad = [
      ["exclusions", "company"],
      ["exclusion-accept"],
      ["exclusion-accept", "company", "x"],
      ["exclusion-accept", "Company"],
      ["exclusion-accept", "company;ls"],
      ["exclusion-accept", "$(id)"],
      ["exclusion-accept", "../company"],
      ["exclusion-accept", ""],
      ["exclusion-accept", "x".repeat(33)],
      ["exclusion-accept", "company\n"],
      ["exclusion-withdraw", "--json"],
      ["exclusion-list", "company"],
    ];
    for (const args of bad) expect(agentControlArgv(args), JSON.stringify(args)).toBeNull();
  });
});
