import { describe, expect, it } from "vitest";

import {
  ACTIVE_PROVIDERS,
  API_KEY_PROVIDERS,
  OAUTH_PROVIDERS,
} from "./providers";

describe("provider contracts", () => {
  it("keeps the ADR-0002 canonical runtime set closed", () => {
    expect([...API_KEY_PROVIDERS].sort()).toEqual(["claude", "kimi", "openai"]);
  });

  it("has no duplicate active provider names", () => {
    expect(new Set(ACTIVE_PROVIDERS).size).toBe(ACTIVE_PROVIDERS.length);
  });

  it("does not mistake credential products for executable runtimes", () => {
    for (const credentialProvider of OAUTH_PROVIDERS) {
      expect(ACTIVE_PROVIDERS).not.toContain(credentialProvider as never);
    }
  });
});
