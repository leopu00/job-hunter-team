import { describe, expect, it } from "vitest";

import { telegramServiceEnabled } from "../../../cli/src/commands/pid1.js";

describe("pid1 Telegram isolation cutover", () => {
  it("uses only the service-owned read-only boundary markers", () => {
    expect(telegramServiceEnabled(() => false)).toBe(false);
    expect(telegramServiceEnabled((path) => path.endsWith("/cutover"))).toBe(true);
    expect(telegramServiceEnabled((path) => path.endsWith("/cutover-required"))).toBe(true);
  });
});
