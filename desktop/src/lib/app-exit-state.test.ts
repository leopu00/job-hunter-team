import { describe, expect, it } from "vitest";
import { parseExitState } from "./app-exit";

const quiet = { machine: "none", teamContainers: 0 };

describe("the state the native side gives before the exit question", () => {
  it("is where the team is and how many containers that are not the team's share its machine", () => {
    expect(parseExitState({ team: "local", otherContainers: 2 })).toEqual({ team: "local", otherContainers: 2, ...quiet });
    expect(parseExitState({ team: "vps", otherContainers: 0 })).toEqual({ team: "vps", otherContainers: 0, ...quiet });
  });

  it("counts none when the number is missing or is not a count", () => {
    for (const others of [undefined, null, "3", -1, 1.5, Number.NaN, {}]) {
      expect(parseExitState({ team: "local", otherContainers: others })).toEqual({ team: "local", otherContainers: 0, ...quiet });
      expect(parseExitState({ team: "none", machine: "on", teamContainers: others })?.teamContainers).toBe(0);
    }
  });

  it("says, during the setup, whether the machine is on and how many of the team's containers run on it", () => {
    expect(parseExitState({ team: "none", otherContainers: 0, machine: "on", teamContainers: 1 }))
      .toEqual({ team: "none", otherContainers: 0, machine: "on", teamContainers: 1 });
    for (const machine of ["off", "unknown", "none"]) expect(parseExitState({ team: "local", machine })?.machine).toBe(machine);
  });

  it("takes a machine it does not know for one not asked about, never for one that is off", () => {
    for (const machine of [undefined, null, "On", "running", 1, {}]) expect(parseExitState({ team: "local", machine })?.machine).toBe("none");
  });

  it("is nothing when the team is not told", () => {
    for (const value of [null, undefined, "local", {}, { team: "elsewhere", otherContainers: 1 }]) expect(parseExitState(value)).toBeNull();
  });
});
