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
    const config = createNextConfig(PHASE_PRODUCTION_BUILD, {});

    expect(config.output).toBe("standalone");
    expect(config.outputFileTracingRoot).toBeTruthy();
    expect(config.outputFileTracingExcludes).toBeTruthy();
  });

  // Next >= 16.3 on Vercel: the adapter's onBuildComplete opens
  // .next/next-server.js.nft.json, which a standalone build never writes, so the
  // deploy fails with ENOENT after a full compile. Held production on 16.2.x —
  // inside a critical advisory — from 2026-08-20 to 2026-09-13.
  it("drops standalone output when Vercel builds", () => {
    const config = createNextConfig(PHASE_PRODUCTION_BUILD, { VERCEL: "1" });

    expect(config.output).toBeUndefined();
    expect(config.outputFileTracingRoot).toBeTruthy();
    expect(config.outputFileTracingExcludes).toBeTruthy();
  });
});
