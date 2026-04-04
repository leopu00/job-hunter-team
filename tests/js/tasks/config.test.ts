/**
 * Test unitari — shared/config (vitest)
 *
 * Edge cases: Zod defaults, multi-provider, webhook URL, version int,
 * validateConfig con tipi errati, redactConfig struttura completa.
 */
import { describe, it, expect } from "vitest";
import {
  validateConfig, AIProviderSchema, TelegramChannelSchema,
} from "../../../shared/config/schema";
import { redactConfig } from "../../../shared/config/io";

const baseConfig = (overrides: Record<string, unknown> = {}) => ({
  active_provider: "claude",
  providers: {
    claude: { name: "claude", auth_method: "api_key", api_key: "sk-test" },
  },
  channels: {},
  workspace: "/tmp/jht",
  ...overrides,
});

describe("Schema — defaults e campi opzionali", () => {
  it("version default a 1 quando omesso", () => {
    const r = validateConfig(baseConfig());
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.version).toBe(1);
  });

  it("channels default a {} quando omesso", () => {
    const { channels: _, ...noChannels } = baseConfig();
    const r = validateConfig(noChannels);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.channels).toEqual({});
  });

  it("version esplicita sovrascrive default", () => {
    const r = validateConfig(baseConfig({ version: 2 }));
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.version).toBe(2);
  });

  it("AIProviderSchema accetta campo model opzionale", () => {
    const r = AIProviderSchema.safeParse({
      name: "claude", auth_method: "api_key",
      api_key: "sk-test", model: "claude-opus-4-6",
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.model).toBe("claude-opus-4-6");
  });
});

describe("Schema — TelegramChannelSchema edge cases", () => {
  it("accetta webhook_url valido", () => {
    const r = TelegramChannelSchema.safeParse({
      bot_token: "123:ABC", webhook_url: "https://example.com/hook",
    });
    expect(r.success).toBe(true);
  });

  it("rifiuta webhook_url non valido", () => {
    const r = TelegramChannelSchema.safeParse({
      bot_token: "123:ABC", webhook_url: "not-a-url",
    });
    expect(r.success).toBe(false);
  });

  it("accetta chat_id opzionale", () => {
    const r = TelegramChannelSchema.safeParse({
      bot_token: "123:ABC", chat_id: "-100123456",
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.chat_id).toBe("-100123456");
  });
});

describe("Schema — multi-provider e refine", () => {
  it("config con multipli provider e active corretto", () => {
    const r = validateConfig({
      active_provider: "openai",
      providers: {
        claude: { name: "claude", auth_method: "api_key", api_key: "sk-c" },
        openai: { name: "openai", auth_method: "api_key", api_key: "sk-o" },
      },
      channels: {},
      workspace: "/tmp/jht",
    });
    expect(r.success).toBe(true);
  });

  it("rifiuta active_provider senza config nei providers", () => {
    const r = validateConfig({
      active_provider: "minimax",
      providers: {
        claude: { name: "claude", auth_method: "api_key", api_key: "sk-c" },
      },
      channels: {},
      workspace: "/tmp/jht",
    });
    expect(r.success).toBe(false);
  });

  it("rifiuta version decimale (deve essere int)", () => {
    const r = validateConfig(baseConfig({ version: 1.5 }));
    expect(r.success).toBe(false);
  });

  it("rifiuta version negativa", () => {
    const r = validateConfig(baseConfig({ version: -1 }));
    expect(r.success).toBe(false);
  });
});

describe("validateConfig — tipi errati", () => {
  it("rifiuta null", () => {
    expect(validateConfig(null).success).toBe(false);
  });

  it("rifiuta stringa", () => {
    expect(validateConfig("not a config").success).toBe(false);
  });

  it("rifiuta array", () => {
    expect(validateConfig([1, 2, 3]).success).toBe(false);
  });

  it("rifiuta numero", () => {
    expect(validateConfig(42).success).toBe(false);
  });

  it("rifiuta oggetto vuoto", () => {
    expect(validateConfig({}).success).toBe(false);
  });
});

describe("redactConfig — struttura completa", () => {
  it("maschera tutti i campi sensibili in config reale", () => {
    const full = {
      version: 1, active_provider: "claude",
      providers: { claude: { name: "claude", auth_method: "api_key", api_key: "sk-ant-secret123" } },
      channels: { telegram: { bot_token: "789012:XYZABC", chat_id: "123" } },
      workspace: "/tmp/jht",
    };
    const r = redactConfig(full);
    expect((r.providers as any).claude.api_key).toBe("sk-a****");
    expect((r.channels as any).telegram.bot_token).toBe("7890****");
    expect((r.channels as any).telegram.chat_id).toBe("123");
    expect(r.workspace).toBe("/tmp/jht");
  });

  it("maschera session_token in subscription", () => {
    const cfg = {
      providers: {
        minimax: {
          name: "minimax", auth_method: "subscription",
          subscription: { email: "u@m.com", session_token: "tok-supersecret" },
        },
      },
    };
    const r = redactConfig(cfg);
    const sub = (r.providers as any).minimax.subscription;
    expect(sub.session_token).toBe("tok-****");
    expect(sub.email).toBe("u@m.com");
  });
});
