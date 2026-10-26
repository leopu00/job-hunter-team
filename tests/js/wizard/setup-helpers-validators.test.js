import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:fs');

import {
  validateApiKey,
  validateEmail,
  validateTelegramToken,
  validateChatId,
  AI_PROVIDERS,
} from '../../../cli/wizard/setup-helpers.js';

beforeEach(() => vi.clearAllMocks());

// --- validateApiKey ---

describe('validateApiKey', () => {
  const codex = AI_PROVIDERS.find((p) => p.value === 'openai');

  it('offre solo Codex: Claude e Kimi non sono fra i provider da scegliere', () => {
    expect(AI_PROVIDERS.map((p) => p.value)).toEqual(['openai']);
  });

  it('rifiuta valore vuoto', () => {
    expect(validateApiKey(codex, '')).toMatch(/cannot be empty/);
  });

  it('rifiuta chiave troppo corta', () => {
    expect(validateApiKey(codex, 'sk-')).toMatch(/too short/);
  });

  it('rifiuta chiave con prefisso errato per Codex (richiesto sk-)', () => {
    expect(validateApiKey(codex, 'eyJsomeLongToken1234')).toMatch(/sk-/);
  });

  it('accetta chiave Codex con prefisso sk-', () => {
    expect(validateApiKey(codex, 'sk-proj-apikey1234567')).toBeUndefined();
  });
});

// --- validateEmail ---

describe('validateEmail', () => {
  it('rifiuta stringa vuota', () => {
    expect(validateEmail('')).toMatch(/cannot be empty/);
  });

  it('rifiuta email senza @', () => {
    expect(validateEmail('notanemail')).toMatch(/Invalid email/i);
  });

  it('rifiuta email senza dominio', () => {
    expect(validateEmail('user@')).toMatch(/Invalid email/i);
  });

  it('accetta email valida', () => {
    expect(validateEmail('user@example.com')).toBeUndefined();
  });
});

// --- validateTelegramToken ---

describe('validateTelegramToken', () => {
  it('rifiuta token vuoto', () => {
    expect(validateTelegramToken('')).toMatch(/cannot be empty/);
  });

  it('rifiuta formato non valido', () => {
    expect(validateTelegramToken('invalidtoken')).toMatch(/Invalid token format/);
  });

  it('accetta token nel formato corretto', () => {
    expect(validateTelegramToken('123456789:ABCdefGHIjklMNOpqrsTUVwxyz')).toBeUndefined();
  });
});

// --- validateChatId ---

describe('validateChatId', () => {
  it('accetta stringa vuota (opzionale)', () => {
    expect(validateChatId('')).toBeUndefined();
  });

  it('rifiuta chat ID non numerico', () => {
    expect(validateChatId('not-a-number')).toMatch(/must be a number/);
  });

  it('accetta ID positivo', () => {
    expect(validateChatId('123456789')).toBeUndefined();
  });

  it('accetta ID negativo (gruppi)', () => {
    expect(validateChatId('-100123456789')).toBeUndefined();
  });
});

// --- validateWorkspacePath (rimossa) ---
// I path JHT sono ora fissi (~/.jht + ~/Documents/Job Hunter Team),
// l'utente non sceglie piu' il workspace quindi non serve validazione.
