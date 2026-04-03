import { describe, it, expect } from 'vitest';
import {
  validateConfig,
  AIProviderSchema,
  SubscriptionSchema,
} from '../../../shared/config/schema';

// --- SubscriptionSchema ---

describe('SubscriptionSchema', () => {
  it('accetta email valida', () => {
    const r = SubscriptionSchema.safeParse({ email: 'user@example.com' });
    expect(r.success).toBe(true);
  });

  it('rifiuta email non valida', () => {
    const r = SubscriptionSchema.safeParse({ email: 'not-an-email' });
    expect(r.success).toBe(false);
  });

  it('accetta session_token opzionale', () => {
    const r = SubscriptionSchema.safeParse({ email: 'a@b.com', session_token: 'tok' });
    expect(r.success).toBe(true);
  });
});

// --- AIProviderSchema ---

describe('AIProviderSchema', () => {
  it('accetta claude con api_key', () => {
    const r = AIProviderSchema.safeParse({
      name: 'claude',
      auth_method: 'api_key',
      api_key: 'sk-ant-apikey123',
    });
    expect(r.success).toBe(true);
  });

  it('accetta openai con api_key', () => {
    const r = AIProviderSchema.safeParse({
      name: 'openai',
      auth_method: 'api_key',
      api_key: 'sk-projkey123',
    });
    expect(r.success).toBe(true);
  });

  it('accetta minimax con subscription', () => {
    const r = AIProviderSchema.safeParse({
      name: 'minimax',
      auth_method: 'subscription',
      subscription: { email: 'u@m.com' },
    });
    expect(r.success).toBe(true);
  });

  it('rifiuta api_key mancante quando auth_method = api_key', () => {
    const r = AIProviderSchema.safeParse({ name: 'claude', auth_method: 'api_key' });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0].path).toContain('api_key');
  });

  it('rifiuta subscription mancante quando auth_method = subscription', () => {
    const r = AIProviderSchema.safeParse({ name: 'minimax', auth_method: 'subscription' });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0].path).toContain('subscription');
  });

  it('rifiuta provider name non valido', () => {
    const r = AIProviderSchema.safeParse({
      name: 'grok',
      auth_method: 'api_key',
      api_key: 'key123',
    });
    expect(r.success).toBe(false);
  });

  it('rifiuta auth_method non valido', () => {
    const r = AIProviderSchema.safeParse({
      name: 'claude',
      auth_method: 'oauth',
      api_key: 'key123',
    });
    expect(r.success).toBe(false);
  });
});

// --- JHTConfigSchema / validateConfig ---

const validClaudeConfig = {
  active_provider: 'claude',
  providers: {
    claude: { name: 'claude', auth_method: 'api_key', api_key: 'sk-ant-key' },
  },
  channels: {},
  workspace: '/tmp/test-jht',
};

const validOpenAIConfig = {
  active_provider: 'openai',
  providers: {
    openai: { name: 'openai', auth_method: 'api_key', api_key: 'sk-projkey' },
  },
  channels: {},
  workspace: '/tmp/test-jht',
};

const validMinimaxConfig = {
  active_provider: 'minimax',
  providers: {
    minimax: {
      name: 'minimax',
      auth_method: 'subscription',
      subscription: { email: 'user@minimax.com' },
    },
  },
  channels: {},
  workspace: '/tmp/test-jht',
};

describe('validateConfig — config valide', () => {
  it('valida config Claude con api_key', () => {
    const r = validateConfig(validClaudeConfig);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.version).toBe(1);
  });

  it('valida config OpenAI con api_key', () => {
    const r = validateConfig(validOpenAIConfig);
    expect(r.success).toBe(true);
  });

  it('valida config MiniMax con subscription', () => {
    const r = validateConfig(validMinimaxConfig);
    expect(r.success).toBe(true);
  });

  it('accetta canale telegram configurato', () => {
    const r = validateConfig({
      ...validClaudeConfig,
      channels: { telegram: { bot_token: '123456:ABCDEF' } },
    });
    expect(r.success).toBe(true);
  });
});

describe('validateConfig — errori schema', () => {
  it('rifiuta active_provider non valido', () => {
    const r = validateConfig({ ...validClaudeConfig, active_provider: 'grok' });
    expect(r.success).toBe(false);
  });

  it('rifiuta workspace vuoto', () => {
    const r = validateConfig({ ...validClaudeConfig, workspace: '' });
    expect(r.success).toBe(false);
  });

  it('rifiuta config senza providers', () => {
    const r = validateConfig({ ...validClaudeConfig, providers: undefined });
    expect(r.success).toBe(false);
  });

  it('rifiuta active_provider senza config in providers', () => {
    const r = validateConfig({
      ...validClaudeConfig,
      active_provider: 'openai',
      providers: { claude: validClaudeConfig.providers.claude },
    });
    expect(r.success).toBe(false);
  });

  it('rifiuta telegram con bot_token vuoto', () => {
    const r = validateConfig({
      ...validClaudeConfig,
      channels: { telegram: { bot_token: '' } },
    });
    expect(r.success).toBe(false);
  });

  it('rifiuta subscription con email non valida', () => {
    const r = validateConfig({
      active_provider: 'minimax',
      providers: {
        minimax: {
          name: 'minimax',
          auth_method: 'subscription',
          subscription: { email: 'bad-email' },
        },
      },
      channels: {},
      workspace: '/tmp/test-jht',
    });
    expect(r.success).toBe(false);
  });
});
