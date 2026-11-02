import { describe, expect, it } from "vitest";
import { parseStamp } from "./parse-stamp";

// A team's row says «YYYY-MM-DD HH:MM:SS» with no zone, and it is UTC. In whatever zone the computer is
// in, the instant is the same one: it is only WRITTEN in the person's local time.
describe("parseStamp", () => {
  it("reads a stamp with no zone as UTC, with the space or the T", () => {
    expect(parseStamp("2026-11-02 15:41:00")?.toISOString()).toBe("2026-11-02T15:41:00.000Z");
    expect(parseStamp("2026-11-02T15:41:00")?.toISOString()).toBe("2026-11-02T15:41:00.000Z");
    expect(parseStamp("2026-11-02 15:41")?.toISOString()).toBe("2026-11-02T15:41:00.000Z");
    expect(parseStamp("2026-11-02T15:41:00.250000")?.getUTCMilliseconds()).toBe(250);
  });

  it("keeps the zone a stamp has", () => {
    expect(parseStamp("2026-11-02T15:41:00Z")?.toISOString()).toBe("2026-11-02T15:41:00.000Z");
    expect(parseStamp("2026-11-02T16:41:00+01:00")?.toISOString()).toBe("2026-11-02T15:41:00.000Z");
    expect(parseStamp("2026-11-02T16:41:00+0100")?.toISOString()).toBe("2026-11-02T15:41:00.000Z");
    expect(parseStamp("2026-11-02T10:41:00-05:00")?.toISOString()).toBe("2026-11-02T15:41:00.000Z");
  });

  it("says nothing for what is not a stamp", () => {
    for (const bad of [null, undefined, "", "   ", "not-a-date"]) expect(parseStamp(bad)).toBeNull();
  });
});
