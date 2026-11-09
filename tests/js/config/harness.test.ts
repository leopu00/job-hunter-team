import { describe, it, expect } from "vitest";
import { validateConfig } from "../../../shared/config/schema";

// The harness is the program that drives the agents (codex | pi). The setup writes it, the launcher reads it.

const base = (provider: "claude" | "openai" | "kimi" | "glm", extra: object = {}) => ({
  version: 1,
  active_provider: provider,
  providers: { [provider]: { name: provider, auth_method: "subscription" } },
  channels: {},
  workspace: "/workspace",
  ...extra,
});

describe("the harness key of the config", () => {
  it("is optional: a config without it is valid and means codex", () => {
    expect(validateConfig(base("openai")).success).toBe(true);
  });

  it.each(["codex", "pi"])("accepts %s with openai", (harness) => {
    const r = validateConfig(base("openai", { harness }));
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.harness).toBe(harness);
  });

  it("accepts codex with every provider", () => {
    for (const provider of ["claude", "openai", "kimi", "glm"] as const) {
      expect(validateConfig(base(provider, { harness: "codex" })).success).toBe(true);
    }
  });

  it("refuses pi with claude: it starts only on openai, kimi and glm", () => {
    const r = validateConfig(base("claude", { harness: "pi" }));
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].path).toEqual(["harness"]);
  });

  it.each(["kimi", "glm"] as const)("accepts pi with %s (paid by the token, with an API key)", (provider) => {
    expect(validateConfig(base(provider, { harness: "pi" })).success).toBe(true);
  });

  it.each(["opencode", "PI", "", 3, null])("refuses %j instead of falling back", (harness) => {
    expect(validateConfig(base("openai", { harness })).success).toBe(false);
  });
});
