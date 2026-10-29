import { describe, expect, it } from "vitest";
import { parseExitState } from "./app-exit";

describe("the state the native side gives before the exit question", () => {
  it("is where the team is and how many containers that are not the team's share its machine", () => {
    expect(parseExitState({ team: "local", otherContainers: 2 })).toEqual({ team: "local", otherContainers: 2 });
    expect(parseExitState({ team: "vps", otherContainers: 0 })).toEqual({ team: "vps", otherContainers: 0 });
  });

  it("counts none when the number is missing or is not a count", () => {
    for (const others of [undefined, null, "3", -1, 1.5, Number.NaN, {}]) {
      expect(parseExitState({ team: "local", otherContainers: others })).toEqual({ team: "local", otherContainers: 0 });
    }
  });

  it("is nothing when the team is not told", () => {
    for (const value of [null, undefined, "local", {}, { team: "elsewhere", otherContainers: 1 }]) expect(parseExitState(value)).toBeNull();
  });
});
