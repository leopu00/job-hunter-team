import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../cli/wizard/setup-helpers.js", async (importOriginal) => ({
  ...(await importOriginal()),
  writeConfigFile: vi.fn(),
}));

import {
  assembleAndSaveConfig,
  promptTelegramOptional,
} from "../../../cli/wizard/setup-steps.js";
import { writeConfigFile } from "../../../cli/wizard/setup-helpers.js";

function prompter(wantsTelegram = true) {
  return {
    confirm: vi.fn(async () => wantsTelegram),
    note: vi.fn(async () => undefined),
    text: vi.fn(async () => {
      throw new Error("the in-container wizard must not ask for Telegram secrets");
    }),
    progress: vi.fn(() => ({ stop: vi.fn() })),
  };
}

beforeEach(() => vi.clearAllMocks());

describe("host-owned Telegram pairing", () => {
  it("directs the user to all three host commands without asking for a token", async () => {
    const ui = prompter();

    await promptTelegramOptional(ui);

    const note = ui.note.mock.calls.map(([body]) => body).join("\n");
    expect(note).toContain("jht telegram pair assistente");
    expect(note).toContain("jht telegram pair capitano");
    expect(note).toContain("jht telegram pair mentor");
    expect(note).toContain("rotation_required");
    expect(ui.text).not.toHaveBeenCalled();
  });

  it("never writes a legacy Telegram channel into jht.config.json", async () => {
    const ui = prompter();

    await assembleAndSaveConfig(ui, {
      providerChoice: "claude",
      authMethod: "subscription",
      model: "claude-sonnet-4-6",
      baseProviders: {},
      telegramChannel: {
        bots: {
          assistente: { bot_token: "not-a-real-token", chat_id: "100" },
        },
      },
    });

    expect(writeConfigFile).toHaveBeenCalledWith(
      expect.objectContaining({ channels: {} }),
    );
  });
});
