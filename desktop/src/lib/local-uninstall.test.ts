import { expect, it } from "vitest";
import { parseOutcome } from "./local-uninstall";

it("accepts only the removal's own outcomes", () => {
  expect(parseOutcome({ complete: true, left: [] })).toEqual({ complete: true, left: [] });
  expect(parseOutcome({ complete: false, left: ["machine", "runtime"] })).toEqual({ complete: false, left: ["machine", "runtime"] });
  for (const bad of [
    null, {}, { complete: "yes", left: [] }, { complete: true, left: ["machine"] },
    { complete: false, left: [] }, { complete: false, left: ["data"] }, { complete: false, left: "machine" },
  ]) {
    expect(() => parseOutcome(bad), JSON.stringify(bad)).toThrow();
  }
});
