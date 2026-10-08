import { describe, expect, it } from "vitest";
import {
  setupChannels,
  TelegramPairingBelongsToHostError,
} from "./setup-channels";

describe("setupChannels", () => {
  it("keeps non-Telegram channel settings", () => {
    expect(setupChannels({ slack: { enabled: true } })).toEqual({
      slack: { enabled: true },
    });
  });

  it("preserves legacy channels until the host pairing command rotates them", () => {
    const existing = {
      telegram: { bots: { assistente: { bot_token: "legacy" } } },
    };

    expect(setupChannels(undefined, existing)).toEqual(existing);
  });

  it("refuses Telegram data instead of persisting it in jht.config.json", () => {
    expect(() =>
      setupChannels({
        telegram: {
          bots: {
            assistente: { bot_token: "not-a-real-token", chat_id: "100" },
          },
        },
      }),
    ).toThrow(TelegramPairingBelongsToHostError);
  });
});
