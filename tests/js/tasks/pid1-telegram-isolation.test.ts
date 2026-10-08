import { describe, expect, it } from "vitest";

import { telegramServiceEnabled } from "../../../cli/src/commands/pid1.js";

describe("pid1 Telegram isolation cutover", () => {
  it("keeps the legacy bridge unless the protected host switch is exactly 1", () => {
    expect(telegramServiceEnabled({})).toBe(false);
    expect(telegramServiceEnabled({ JHT_TELEGRAM_SERVICE_ENABLED: "0" })).toBe(false);
    expect(telegramServiceEnabled({ JHT_TELEGRAM_SERVICE_ENABLED: "true" })).toBe(false);
    expect(telegramServiceEnabled({ JHT_TELEGRAM_SERVICE_ENABLED: "1" })).toBe(true);
  });
});
