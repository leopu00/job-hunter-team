import { describe, it, expect } from "vitest";
import {
  validateConfig,
  AIProviderSchema,
  SubscriptionSchema,
} from "../../../shared/config/schema";

// --- SubscriptionSchema ---

describe("SubscriptionSchema", () => {
  it("accetta email valida", () => {
    const r = SubscriptionSchema.safeParse({ email: "user@example.com" });
    expect(r.success).toBe(true);
  });

  it("rifiuta email non valida", () => {
    const r = SubscriptionSchema.safeParse({ email: "not-an-email" });
    expect(r.success).toBe(false);
  });

  it("accetta session_token opzionale", () => {
    const r = SubscriptionSchema.safeParse({
      email: "a@b.com",
      session_token: "tok",
    });
    expect(r.success).toBe(true);
  });
});

// --- AIProviderSchema ---

describe("AIProviderSchema", () => {
  it("accetta claude con api_key", () => {
    const r = AIProviderSchema.safeParse({
      name: "claude",
      auth_method: "api_key",
      api_key: "sk-ant-apikey123",
    });
    expect(r.success).toBe(true);
  });

  it("accetta openai con api_key", () => {
    const r = AIProviderSchema.safeParse({
      name: "openai",
      auth_method: "api_key",
      api_key: "sk-projkey123",
    });
    expect(r.success).toBe(true);
  });

  it("accetta kimi con subscription", () => {
    const r = AIProviderSchema.safeParse({
      name: "kimi",
      auth_method: "subscription",
      subscription: { email: "u@m.com" },
    });
    expect(r.success).toBe(true);
  });

  it("rifiuta api_key mancante quando auth_method = api_key", () => {
    const r = AIProviderSchema.safeParse({
      name: "claude",
      auth_method: "api_key",
    });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0].path).toContain("api_key");
  });

  it("accetta subscription mancante quando auth_method = subscription (auth e' OAuth CLI)", () => {
    // Il blocco "subscription" non e' piu' obbligatorio: l'auth e' OAuth
    // device-flow del CLI provider, che salva il token in ~/.claude/ etc.
    // dentro al container, non nel jht.config.json.
    const r = AIProviderSchema.safeParse({
      name: "kimi",
      auth_method: "subscription",
    });
    expect(r.success).toBe(true);
  });

  it("rifiuta provider name non valido", () => {
    const r = AIProviderSchema.safeParse({
      name: "grok",
      auth_method: "api_key",
      api_key: "key123",
    });
    expect(r.success).toBe(false);
  });

  it("rifiuta auth_method non valido", () => {
    const r = AIProviderSchema.safeParse({
      name: "claude",
      auth_method: "oauth",
      api_key: "key123",
    });
    expect(r.success).toBe(false);
  });
});

// --- JHTConfigSchema / validateConfig ---

const validClaudeConfig = {
  active_provider: "claude",
  providers: {
    claude: { name: "claude", auth_method: "api_key", api_key: "sk-ant-key" },
  },
  channels: {},
  workspace: "/tmp/test-jht",
};

const validOpenAIConfig = {
  active_provider: "openai",
  providers: {
    openai: { name: "openai", auth_method: "api_key", api_key: "sk-projkey" },
  },
  channels: {},
  workspace: "/tmp/test-jht",
};

const validKimiConfig = {
  active_provider: "kimi",
  providers: {
    kimi: {
      name: "kimi",
      auth_method: "subscription",
      subscription: { email: "user@kimi.com" },
    },
  },
  channels: {},
  workspace: "/tmp/test-jht",
};

describe("validateConfig — config valide", () => {
  it("valida config Claude con api_key", () => {
    const r = validateConfig(validClaudeConfig);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.version).toBe(1);
  });

  it("valida config OpenAI con api_key", () => {
    const r = validateConfig(validOpenAIConfig);
    expect(r.success).toBe(true);
  });

  it("valida config Kimi con subscription", () => {
    const r = validateConfig(validKimiConfig);
    expect(r.success).toBe(true);
  });

  it("accetta lo Scorer locale role-scoped senza cambiare active_provider", () => {
    const r = validateConfig({
      ...validClaudeConfig,
      team: {
        local_scorer: {
          enabled: true,
          base_url: "http://host.docker.internal:11434/v1",
          model: "model-installed-by-user",
        },
      },
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.active_provider).toBe("claude");
      expect(r.data.team?.local_scorer?.mode).toBe("shadow");
    }
  });

  it("accetta canale telegram con 3 bot configurati", () => {
    const r = validateConfig({
      ...validClaudeConfig,
      channels: {
        telegram: {
          bots: {
            assistente: { bot_token: "111:AAA", chat_id: "100" },
            capitano: { bot_token: "222:BBB", chat_id: "100" },
            mentor: { bot_token: "333:CCC", chat_id: "100" },
          },
        },
      },
    });
    expect(r.success).toBe(true);
  });
});

describe("validateConfig — errori schema", () => {
  it("rifiuta active_provider non valido", () => {
    const r = validateConfig({ ...validClaudeConfig, active_provider: "grok" });
    expect(r.success).toBe(false);
  });

  it("rifiuta workspace vuoto", () => {
    const r = validateConfig({ ...validClaudeConfig, workspace: "" });
    expect(r.success).toBe(false);
  });

  it("rifiuta config senza providers", () => {
    const r = validateConfig({ ...validClaudeConfig, providers: undefined });
    expect(r.success).toBe(false);
  });

  it("rifiuta active_provider senza config in providers", () => {
    const r = validateConfig({
      ...validClaudeConfig,
      active_provider: "openai",
      providers: { claude: validClaudeConfig.providers.claude },
    });
    expect(r.success).toBe(false);
  });

  it("rifiuta telegram con bot_token vuoto in un ruolo", () => {
    const r = validateConfig({
      ...validClaudeConfig,
      channels: {
        telegram: {
          bots: {
            assistente: { bot_token: "" },
            capitano: { bot_token: "222:BBB" },
            mentor: { bot_token: "333:CCC" },
          },
        },
      },
    });
    expect(r.success).toBe(false);
  });

  it("rifiuta telegram senza tutti e 3 i bot (manca mentor)", () => {
    const r = validateConfig({
      ...validClaudeConfig,
      channels: {
        telegram: {
          bots: {
            assistente: { bot_token: "111:AAA" },
            capitano: { bot_token: "222:BBB" },
          },
        },
      },
    });
    expect(r.success).toBe(false);
  });

  it("rifiuta telegram con schema legacy single-bot (no bots)", () => {
    const r = validateConfig({
      ...validClaudeConfig,
      channels: {
        telegram: { bot_token: "123:ABC" } as unknown as { bots: never },
      },
    });
    expect(r.success).toBe(false);
  });

  it("rifiuta subscription con email non valida", () => {
    const r = validateConfig({
      active_provider: "kimi",
      providers: {
        kimi: {
          name: "kimi",
          auth_method: "subscription",
          subscription: { email: "bad-email" },
        },
      },
      channels: {},
      workspace: "/tmp/test-jht",
    });
    expect(r.success).toBe(false);
  });

  it('rifiuta uno Scorer "locale" che invia dati a un host remoto', () => {
    const r = validateConfig({
      ...validClaudeConfig,
      team: {
        local_scorer: {
          enabled: true,
          base_url: "https://api.example.com/v1",
          model: "not-local",
        },
      },
    });
    expect(r.success).toBe(false);
  });
});
