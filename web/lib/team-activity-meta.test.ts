import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dmhm, timeAgo } from "./team-activity-meta";

// «1h fa» for an event of five minutes ago, and an Italian «fa» in an English app: the stamp was read as local
// time, and the words were Italian only. Now the stamp is an instant and the words are the app's language.
describe("timeAgo", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-02T15:50:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("counts minutes from a stamp with no zone as UTC, whatever zone the computer is in", () => {
    expect(timeAgo("2026-11-02 15:41:00", "en")).toMatch(/^9 min/);
    expect(timeAgo("2026-11-02T15:45:00", "en")).toMatch(/^5 min/);
    expect(timeAgo("2026-11-02T15:49:30Z", "en")).toMatch(/^0 min|now/i);
    expect(timeAgo("2026-11-02T13:50:00Z", "en")).toMatch(/^2 hr/);
    expect(timeAgo("2026-10-30 15:50:00", "en")).toMatch(/^3 days?/);
  });

  it.each([
    ["it", /fa$/],
    ["en", /ago$/],
    ["de", /^vor /],
    ["fr", /^il y a /],
    ["es", /^hace /],
    ["pt", /^há /],
    ["hu", /(?:ezelőtt|előtt)$/],
  ])("%s: says «ago» in that language and no other", (locale, pattern) => {
    expect(timeAgo("2026-11-02 15:41:00", locale)).toMatch(pattern);
  });

  it("does not put an Italian «fa» in an English app", () => {
    expect(timeAgo("2026-11-02 15:41:00", "en")).not.toMatch(/\bfa\b/);
    expect(timeAgo("2026-11-02 12:50:00", "en")).not.toMatch(/\bfa\b/);
  });

  it("has a dash for no stamp and for one that is not", () => {
    expect(timeAgo(null, "en")).toBe("—");
    expect(timeAgo("nope", "en")).toBe("—");
  });
});

describe("dmhm", () => {
  it("writes the stamp in the local time of the computer, as the agents' panel does", () => {
    const stamp = "2026-11-02 15:41:00";
    const d = new Date("2026-11-02T15:41:00Z");
    const p = (n: number) => String(n).padStart(2, "0");
    expect(dmhm(stamp)).toBe(`${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`);
  });
});

describe("the role colours of the charts", () => {
  it("come from the main colour of the chosen theme (--cat-N), one for each role and all different", async () => {
    const { ROLE_META } = await import("./team-activity-meta");
    const colors = Object.values(ROLE_META).map((meta) => meta.color);
    for (const color of colors) expect(color).toMatch(/^var\(--cat-\d{1,2}, /);
    expect(new Set(colors).size).toBe(colors.length);
  });
});
