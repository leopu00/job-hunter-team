import { describe, expect, it } from "vitest";
import { createNextConfig } from "../../../web/next.config";

const PHASE_DEVELOPMENT_SERVER = "phase-development-server";
const PHASE_PRODUCTION_BUILD = "phase-production-build";

describe("Next output file tracing root", () => {
  it("is absent from the Turbopack development configuration", () => {
    const config = createNextConfig(PHASE_DEVELOPMENT_SERVER);

    expect(config).not.toHaveProperty("outputFileTracingRoot");
    expect(config.turbopack).toEqual({});
  });

  it("is preserved for production standalone builds", () => {
    const config = createNextConfig(PHASE_PRODUCTION_BUILD);

    expect(config.output).toBe("standalone");
    expect(config.outputFileTracingRoot).toBeTruthy();
    expect(config.outputFileTracingExcludes).toBeTruthy();
  });
});
