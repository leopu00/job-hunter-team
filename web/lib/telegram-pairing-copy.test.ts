import { describe, expect, it } from "vitest";
import { locales } from "../i18n/config";
import {
  TELEGRAM_PAIR_COMMAND,
  TELEGRAM_PAIRING_MESSAGE,
  telegramPairingError,
} from "./telegram-pairing-copy";

describe("Telegram host-pairing copy", () => {
  for (const locale of locales) {
    it(`documents safe pairing in ${locale}`, () => {
      const response = telegramPairingError(locale);

      expect(response.command).toBe(TELEGRAM_PAIR_COMMAND);
      expect(response.message).toBe(TELEGRAM_PAIRING_MESSAGE[locale]);
      expect(response.message).toContain(TELEGRAM_PAIR_COMMAND);
      expect(response.message).toContain("stdin");
      expect(response.message).toContain("~/.jht");
      expect(response.message.length).toBeGreaterThan(120);
    });
  }
});
