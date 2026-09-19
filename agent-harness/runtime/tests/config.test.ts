import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { loadConfig } from "../src/config.ts";
import { isHarnessError } from "../src/core/errors.ts";

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    return isHarnessError(error) ? error.code : `unexpected:${String(error)}`;
  }
  return "no_error";
}

/** Everything a live OpenAI run needs. Each test removes or changes one thing. */
const LIVE = {
  JHT_API_PROVIDER: "openai",
  JHT_API_LIVE: "1",
  JHT_API_MODEL: "gpt-5.6-luna",
  JHT_API_BUDGET_USD: "0.5",
  JHT_API_LEDGER: "/tmp/ledger/openai-spesa.tsv",
  OPENAI_API_KEY: "test-key",
};

function without(name: keyof typeof LIVE): Record<string, string> {
  const env: Record<string, string> = { ...LIVE };
  delete env[name];
  return env;
}

describe("loadConfig", () => {
  it("defaults to the mock provider and spends nothing", () => {
    const config = loadConfig({});
    expect(config.live).toBe(false);
    expect(config.profile.providerId).toBe("mock");
    expect(config.ledger).toBeUndefined();
  });

  it("accepts a complete live configuration", () => {
    const config = loadConfig(LIVE, "scout");
    expect(config.live).toBe(true);
    expect(config.limits.budgetUsd).toBe(0.5);
    expect(config.ledger).toBe("/tmp/ledger/openai-spesa.tsv");
  });

  it("refuses a paid provider without the live gate", () => {
    expect(codeOf(() => loadConfig(without("JHT_API_LIVE")))).toBe("live_gate_closed");
  });

  it("refuses a live run with no model", () => {
    expect(codeOf(() => loadConfig(without("JHT_API_MODEL")))).toBe("config_invalid");
  });

  it("refuses a live run on a model it cannot price", () => {
    expect(codeOf(() => loadConfig({ ...LIVE, JHT_API_MODEL: "some-unlisted-model" }))).toBe("pricing_unknown");
  });

  it("accepts an unpriced model once pricing is supplied explicitly", () => {
    const config = loadConfig({
      ...LIVE,
      JHT_API_MODEL: "some-unlisted-model",
      JHT_API_PRICE_INPUT_PER_MTOK: "3",
      JHT_API_PRICE_OUTPUT_PER_MTOK: "15",
    });
    expect(config.profile.pricing).toEqual({ inputPerMTokUsd: 3, outputPerMTokUsd: 15 });
  });

  it("refuses a live run with no credentials", () => {
    expect(codeOf(() => loadConfig(without("OPENAI_API_KEY")))).toBe("config_invalid");
  });

  it("refuses a live run with no budget: the mock's default cap is not a decision to pay", () => {
    expect(codeOf(() => loadConfig(without("JHT_API_BUDGET_USD")))).toBe("config_invalid");
  });

  it("refuses a live run with a zero or invalid budget", () => {
    expect(codeOf(() => loadConfig({ ...LIVE, JHT_API_BUDGET_USD: "0" }))).toBe("config_invalid");
    expect(codeOf(() => loadConfig({ ...LIVE, JHT_API_BUDGET_USD: "-1" }))).toBe("config_invalid");
    expect(codeOf(() => loadConfig({ ...LIVE, JHT_API_BUDGET_USD: "lots" }))).toBe("config_invalid");
  });

  it("refuses a live run with nowhere to record its spend", () => {
    expect(codeOf(() => loadConfig(without("JHT_API_LEDGER")))).toBe("config_invalid");
  });
});

describe("loadConfig — catalogue", () => {
  it("prices the plan's models from the catalog, cheapest included", () => {
    // luna at its long-context rates, the higher ones: no threshold is published.
    expect(loadConfig(LIVE).profile.pricing).toEqual({
      inputPerMTokUsd: 0.4,
      outputPerMTokUsd: 1.8,
      webSearchPerCallUsd: 0.01,
      cacheWritePerMTokUsd: 0.5,
    });
    // mini has no long-context or cache-write price: short rates, cache writes at twice input.
    expect(loadConfig({ ...LIVE, JHT_API_MODEL: "gpt-5-mini" }).profile.pricing).toEqual({
      inputPerMTokUsd: 0.25,
      outputPerMTokUsd: 2,
      webSearchPerCallUsd: 0.01,
      cacheWritePerMTokUsd: 0.5,
    });
    expect(loadConfig(LIVE).profile.capabilities.webSearch).toBe(true);
  });

  it("asks for the OpenAI key, not the Anthropic one, on an OpenAI run", () => {
    expect(codeOf(() => loadConfig({ ...without("OPENAI_API_KEY"), ANTHROPIC_API_KEY: "test-key" }))).toBe("config_invalid");
  });

  it("refuses a catalogued model asked for on the wrong provider", () => {
    // gpt-5 is real, but not on Anthropic. Lending it OpenAI's price would hide
    // the mistake behind a plausible number, so it is treated as unpriced.
    expect(
      codeOf(() => loadConfig({ ...LIVE, JHT_API_PROVIDER: "anthropic", JHT_API_MODEL: "gpt-5", ANTHROPIC_API_KEY: "test-key" })),
    ).toBe("pricing_unknown");
  });

  it("configures an OpenAI-compatible endpoint", () => {
    const config = loadConfig({
      ...LIVE,
      JHT_API_PROVIDER: "openai-compatible",
      JHT_API_MODEL: "some/model",
      JHT_API_PRICE_INPUT_PER_MTOK: "0.5",
      JHT_API_PRICE_OUTPUT_PER_MTOK: "1.5",
      JHT_API_OPENAI_COMPATIBLE_BASE_URL: "https://example.invalid/v1",
      JHT_API_OPENAI_COMPATIBLE_API_KEY: "test-key",
    });
    expect(config.openAICompatible).toEqual({
      name: "openai-compatible",
      baseURL: "https://example.invalid/v1",
      apiKey: "test-key",
    });
  });
});

describe("loadConfig — OpenAI through a key proxy", () => {
  it("goes straight to OpenAI when no base URL is set", () => {
    expect(loadConfig(LIVE).openAI).toBeUndefined();
  });

  it("honours OPENAI_BASE_URL, and JHT_API_OPENAI_BASE_URL over it", () => {
    expect(loadConfig({ ...LIVE, OPENAI_BASE_URL: "http://127.0.0.1:8787/v1" }).openAI).toEqual({ baseURL: "http://127.0.0.1:8787/v1" });
    expect(
      loadConfig({ ...LIVE, OPENAI_BASE_URL: "http://elsewhere.invalid/v1", JHT_API_OPENAI_BASE_URL: "http://127.0.0.1:8787/v1" }).openAI,
    ).toEqual({ baseURL: "http://127.0.0.1:8787/v1" });
  });

  it("accepts a placeholder key: the proxy holds the real one", () => {
    const config = loadConfig({ ...LIVE, OPENAI_API_KEY: "placeholder", OPENAI_BASE_URL: "http://127.0.0.1:8787/v1" });
    expect(config.live).toBe(true);
  });

  it("refuses a base URL that is not a URL", () => {
    expect(codeOf(() => loadConfig({ ...LIVE, JHT_API_OPENAI_BASE_URL: "127.0.0.1:8787 v1" }))).toBe("config_invalid");
  });
});

describe("loadConfig — profile folder", () => {
  it("has no profile folder unless one is configured", () => {
    expect(loadConfig({}).profileDir).toBeUndefined();
  });
  it("carries the configured folder through, on the mock too", () => {
    expect(loadConfig({ JHT_API_PROFILE_DIR: "/tmp/p" }).profileDir).toBe("/tmp/p");
  });
});

describe("loadConfig — agent home", () => {
  it("starts the role in its home under ~/.jht-api, not where it was launched", () => {
    const config = loadConfig({}, "scout");
    expect(config.apiHome).toBe(join(homedir(), ".jht-api"));
    expect(config.agentHome).toBe(join(homedir(), ".jht-api", "agents", "scout"));
    expect(config.workdir).toBe(config.agentHome);
    expect(config.auditDir).toBe(join(homedir(), ".jht-api", "audit"));
  });
  it("does not start in the profile folder", () => {
    expect(loadConfig({ JHT_API_PROFILE_DIR: "/tmp/p" }, "scout").workdir).toBe(join(homedir(), ".jht-api", "agents", "scout"));
  });
  it("honours JHT_API_HOME and an explicit JHT_API_WORKDIR", () => {
    const config = loadConfig({ JHT_API_HOME: "/tmp/jht-api", JHT_API_WORKDIR: "/tmp/w" }, "scout");
    expect(config.agentHome).toBe("/tmp/jht-api/agents/scout");
    expect(config.workdir).toBe("/tmp/w");
  });
  it("refuses a role name that could leave agents/ or logs/", () => {
    for (const role of ["../scout", "scout/..", "Scout", "", "a b", ".hidden", "x".repeat(40)]) {
      expect(codeOf(() => loadConfig({}, role)), role).toBe("config_invalid");
    }
  });
});
