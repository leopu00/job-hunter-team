import { describe, expect, it } from "vitest";

import {
  CriticRoleSpec,
  SentinelRoleSpec,
  WriterRoleSpec,
} from "../src/index.js";
import { ANALYST_SYSTEM_PROMPT } from "../src/role/analyst.js";

describe("live prompt contract alignment", () => {
  it("states deterministic output gates at the model boundary", () => {
    expect(ANALYST_SYSTEM_PROMPT).toContain("at most 3 highlights");
    expect(ANALYST_SYSTEM_PROMPT).toContain(
      "decision=checked requires exclusionTag=null",
    );
    expect(WriterRoleSpec.systemPrompt).toContain("copied verbatim");
    expect(CriticRoleSpec.systemPrompt).toContain("exactly seven");
    expect(SentinelRoleSpec.systemPrompt).toContain("never invent or repeat");
  });
});
