import { describe, expect, it } from "vitest";

import { buildScoutPrompt } from "../src/role/scout.js";
import { fixtureInput } from "./helpers.js";

describe("Scout catalog prompt", () => {
  it("pins the first deterministic lane and full candidate limit", async () => {
    const input = await fixtureInput();
    const prompt = buildScoutPrompt(input, "catalog");

    expect(prompt).toContain(
      `targetRole=${JSON.stringify(input.search.targetRoles[0])}`,
    );
    expect(prompt).toContain(
      `location=${JSON.stringify(input.search.locations[0])}`,
    );
    expect(prompt).toContain(`limit=${input.search.maxCandidates}`);
    expect(prompt).toContain("Read every returned sourceId");
  });
});
