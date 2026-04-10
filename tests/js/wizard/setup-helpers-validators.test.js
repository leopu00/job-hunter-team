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
  const claude = AI_PROVIDERS.find((p) => p.value === 'claude');
  const minimax = AI_PROVIDERS.find((p) => p.value === 'minimax');

  it('rifiuta valore vuoto', () => {
    expect(validateApiKey(claude, '')).toMatch(/vuota/);
  });

  it('rifiuta chiave troppo corta', () => {
    expect(validateApiKey(claude, 'sk-ant')).toMatch(/corta/);
  });

  it('rifiuta chiave con prefisso errato per Claude', () => {
    expect(validateApiKey(claude, 'wrongprefix-12345')).toMatch(/sk-ant-/);
  });

  it('accetta chiave Claude valida', () => {
    expect(validateApiKey(claude, 'sk-ant-apikey1234567')).toBeUndefined();
  });

  it('accetta qualsiasi chiave per MiniMax (no prefisso)', () => {
    expect(validateApiKey(minimax, 'eyJsomeLongToken1234')).toBeUndefined();
  });
});

// --- validateEmail ---

describe('validateEmail', () => {
  it('rifiuta stringa vuota', () => {
    expect(validateEmail('')).toMatch(/vuota/);
  });

  it('rifiuta email senza @', () => {
    expect(validateEmail('notanemail')).toMatch(/non valida/i);
  });

  it('rifiuta email senza dominio', () => {
    expect(validateEmail('user@')).toMatch(/non valida/i);
  });

  it('accetta email valida', () => {
    expect(validateEmail('user@example.com')).toBeUndefined();
  });
});

// --- validateTelegramToken ---

describe('validateTelegramToken', () => {
  it('rifiuta token vuoto', () => {
    expect(validateTelegramToken('')).toMatch(/vuoto/);
  });

  it('rifiuta formato non valido', () => {
    expect(validateTelegramToken('invalidtoken')).toMatch(/Formato/);
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
    expect(validateChatId('not-a-number')).toMatch(/numero/);
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
