/**
 * Test: shared/validators/ — common, credentials, tasks
 * nonEmptyString, email, hex, validate, validateOrThrow, credentials, tasks
 */
import { describe, it, expect } from 'vitest';
import {
  nonEmptyString,
  emailSchema,
  hexString,
  validate,
  validateOrThrow,
} from '../../../shared/validators/common.js';
import {
  validateCredential,
  validateSaveApiKey,
  validateEncryptedPayload,
  isValidProvider,
  isValidApiKeyProvider,
} from '../../../shared/validators/credentials.js';
import {
  validateCreateTask,
  validateUpdateTask,
} from '../../../shared/validators/tasks.js';

// ── common ───────────────────────────────────────────────────

describe('nonEmptyString', () => {
  it('accetta stringa valida', () => {
    expect(nonEmptyString.safeParse('hello').success).toBe(true);
  });
  it('rifiuta stringa vuota', () => {
    expect(nonEmptyString.safeParse('').success).toBe(false);
  });
  it('rifiuta stringa solo spazi dopo trim', () => {
    expect(nonEmptyString.safeParse('   ').success).toBe(false);
  });
});

describe('emailSchema', () => {
  it('accetta email valida', () => {
    expect(emailSchema.safeParse('test@example.com').success).toBe(true);
  });
  it('rifiuta stringa non email', () => {
    expect(emailSchema.safeParse('notanemail').success).toBe(false);
  });
});

describe('hexString', () => {
  it('accetta stringa hex di lunghezza pari', () => {
    expect(hexString.safeParse('deadbeef').success).toBe(true);
  });
  it('rifiuta stringa hex di lunghezza dispari', () => {
    expect(hexString.safeParse('abc').success).toBe(false);
  });
  it('rifiuta caratteri non hex', () => {
    expect(hexString.safeParse('gggg').success).toBe(false);
  });
});

describe('validate', () => {
  it('ritorna success:true per dato valido', () => {
    const r = validate(emailSchema, 'a@b.com');
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toBe('a@b.com');
  });
  it('ritorna success:false con array errori', () => {
    const r = validate(emailSchema, 'invalid');
    expect(r.success).toBe(false);
    if (!r.success) expect(r.errors.length).toBeGreaterThan(0);
  });
});

describe('validateOrThrow', () => {
  it('ritorna dato su input valido', () => {
    expect(validateOrThrow(emailSchema, 'ok@ok.com')).toBe('ok@ok.com');
  });
  it('lancia su input non valido', () => {
    expect(() => validateOrThrow(emailSchema, 'bad')).toThrow();
  });
  it('include label nel messaggio di errore', () => {
    expect(() => validateOrThrow(emailSchema, 'bad', 'Email campo')).toThrow(/Email campo/);
  });
});

// ── credentials ──────────────────────────────────────────────

describe('validateCredential', () => {
  it('accetta ApiKeyCredential', () => {
    const r = validateCredential({ type: 'api_key', provider: 'claude', apiKey: 'sk-xxx', savedAt: Date.now() });
    expect(r.success).toBe(true);
  });
  it('accetta OAuthCredential', () => {
    const r = validateCredential({ type: 'oauth', provider: 'chatgpt_pro', accessToken: 'tok', savedAt: Date.now() });
    expect(r.success).toBe(true);
  });
  it('rifiuta type sconosciuto', () => {
    expect(validateCredential({ type: 'unknown', provider: 'claude', apiKey: 'x', savedAt: 1 }).success).toBe(false);
  });
  it('rifiuta ApiKey senza apiKey', () => {
    expect(validateCredential({ type: 'api_key', provider: 'claude', savedAt: Date.now() }).success).toBe(false);
  });
});

describe('validateSaveApiKey', () => {
  it('accetta provider valido con apiKey', () => {
    expect(validateSaveApiKey({ provider: 'openai', apiKey: 'sk-test' }).success).toBe(true);
  });
  it('rifiuta provider OAuth come apiKey provider', () => {
    expect(validateSaveApiKey({ provider: 'chatgpt_pro', apiKey: 'tok' }).success).toBe(false);
  });
});

describe('isValidProvider / isValidApiKeyProvider', () => {
  it('claude è provider valido', () => expect(isValidProvider('claude')).toBe(true));
  it('xyz non è provider valido', () => expect(isValidProvider('xyz')).toBe(false));
  it('claude è API key provider', () => expect(isValidApiKeyProvider('claude')).toBe(true));
  it('chatgpt_pro non è API key provider', () => expect(isValidApiKeyProvider('chatgpt_pro')).toBe(false));
});

// ── tasks ────────────────────────────────────────────────────

describe('validateCreateTask', () => {
  const base = { runtime: 'subagent', ownerKey: 'owner-1', task: 'fai qualcosa' };

  it('accetta input minimo con defaults applicati', () => {
    const r = validateCreateTask(base);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.status).toBe('queued');
      expect(r.data.notifyPolicy).toBe('done_only');
      expect(r.data.scopeKind).toBe('session');
    }
  });
  it('rifiuta runtime non valido', () => {
    expect(validateCreateTask({ ...base, runtime: 'invalid' }).success).toBe(false);
  });
  it('rifiuta task vuoto', () => {
    expect(validateCreateTask({ ...base, task: '' }).success).toBe(false);
  });
});

describe('validateUpdateTask', () => {
  it('accetta aggiornamento parziale con status', () => {
    expect(validateUpdateTask({ status: 'running' }).success).toBe(true);
  });
  it('accetta aggiornamento con progressSummary', () => {
    expect(validateUpdateTask({ progressSummary: '50%' }).success).toBe(true);
  });
  it('rifiuta oggetto completamente vuoto', () => {
    expect(validateUpdateTask({}).success).toBe(false);
  });
});
