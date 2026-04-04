/**
 * Test unitari — shared/credentials
 *
 * Crypto AES-256, storage CRUD, manager add/remove/get/list.
 */
import { describe, it, expect } from "vitest";
import {
  deriveKey, generateSalt, encrypt, decrypt, isValidPayload,
} from "../../../shared/credentials/crypto.js";
import type { EncryptedPayload, ApiKeyCredential, OAuthCredential } from "../../../shared/credentials/types.js";
import { ENV_VAR_MAP, API_KEY_PROVIDERS, OAUTH_PROVIDERS, ALL_PROVIDERS } from "../../../shared/credentials/types.js";

describe("Crypto — deriveKey e generateSalt", () => {
  it("generateSalt produce 32 byte random", () => {
    const salt = generateSalt();
    expect(Buffer.isBuffer(salt)).toBe(true);
    expect(salt.length).toBe(32);
  });

  it("salt diversi ogni volta", () => {
    const a = generateSalt();
    const b = generateSalt();
    expect(a.equals(b)).toBe(false);
  });

  it("deriveKey produce chiave 32 byte da passphrase + salt", () => {
    const salt = generateSalt();
    const key = deriveKey("test-passphrase", salt);
    expect(Buffer.isBuffer(key)).toBe(true);
    expect(key.length).toBe(32);
  });

  it("stessa passphrase + stesso salt = stessa chiave", () => {
    const salt = generateSalt();
    const k1 = deriveKey("pass", salt);
    const k2 = deriveKey("pass", salt);
    expect(k1.equals(k2)).toBe(true);
  });

  it("passphrase diverse = chiavi diverse", () => {
    const salt = generateSalt();
    const k1 = deriveKey("pass-a", salt);
    const k2 = deriveKey("pass-b", salt);
    expect(k1.equals(k2)).toBe(false);
  });
});

describe("Crypto — encrypt / decrypt AES-256-GCM", () => {
  const salt = generateSalt();
  const key = deriveKey("test-key", salt);

  it("encrypt ritorna payload con version, algorithm, iv, authTag, data", () => {
    const payload = encrypt({ secret: "abc" }, key);
    expect(payload.version).toBe(1);
    expect(payload.algorithm).toBe("aes-256-gcm");
    expect(typeof payload.iv).toBe("string");
    expect(typeof payload.authTag).toBe("string");
    expect(typeof payload.data).toBe("string");
  });

  it("decrypt ripristina oggetto originale", () => {
    const original = { provider: "claude", apiKey: "sk-test-123" };
    const encrypted = encrypt(original, key);
    const decrypted = decrypt<typeof original>(encrypted, key);
    expect(decrypted).toEqual(original);
  });

  it("encrypt produce IV diverso per ogni chiamata", () => {
    const a = encrypt("same", key);
    const b = encrypt("same", key);
    expect(a.iv).not.toBe(b.iv);
    expect(a.data).not.toBe(b.data);
  });

  it("decrypt con chiave sbagliata lancia errore", () => {
    const encrypted = encrypt({ x: 1 }, key);
    const wrongKey = deriveKey("wrong", salt);
    expect(() => decrypt(encrypted, wrongKey)).toThrow();
  });

  it("decrypt con authTag corrotto lancia errore", () => {
    const encrypted = encrypt({ x: 1 }, key);
    const corrupted = { ...encrypted, authTag: "00".repeat(16) };
    expect(() => decrypt(corrupted, key)).toThrow();
  });

  it("decrypt con data corrotto lancia errore", () => {
    const encrypted = encrypt({ x: 1 }, key);
    const corrupted = { ...encrypted, data: "ff".repeat(32) };
    expect(() => decrypt(corrupted, key)).toThrow();
  });

  it("decrypt con versione non supportata lancia errore", () => {
    const encrypted = encrypt({ x: 1 }, key);
    const bad = { ...encrypted, version: 99 } as unknown as EncryptedPayload;
    expect(() => decrypt(bad, key)).toThrow(/non supportato/);
  });

  it("encrypt/decrypt gestisce strutture complesse", () => {
    const complex = {
      type: "oauth" as const,
      provider: "claude_max" as const,
      accessToken: "tok-abc",
      refreshToken: "ref-xyz",
      expiresAt: Date.now() + 3600_000,
      savedAt: Date.now(),
    };
    const decrypted = decrypt<OAuthCredential>(encrypt(complex, key), key);
    expect(decrypted.accessToken).toBe("tok-abc");
    expect(decrypted.refreshToken).toBe("ref-xyz");
  });
});

describe("Crypto — isValidPayload", () => {
  it("valida payload corretto", () => {
    const salt = generateSalt();
    const key = deriveKey("p", salt);
    const payload = encrypt("x", key);
    expect(isValidPayload(payload)).toBe(true);
  });

  it("rifiuta null, undefined, primitivi", () => {
    expect(isValidPayload(null)).toBe(false);
    expect(isValidPayload(undefined)).toBe(false);
    expect(isValidPayload("string")).toBe(false);
    expect(isValidPayload(42)).toBe(false);
  });

  it("rifiuta oggetto con campi mancanti", () => {
    expect(isValidPayload({ version: 1 })).toBe(false);
    expect(isValidPayload({ version: 1, algorithm: "aes-256-gcm" })).toBe(false);
  });

  it("rifiuta versione o algoritmo errati", () => {
    expect(isValidPayload({ version: 2, algorithm: "aes-256-gcm", iv: "a", authTag: "b", data: "c" })).toBe(false);
    expect(isValidPayload({ version: 1, algorithm: "aes-128-cbc", iv: "a", authTag: "b", data: "c" })).toBe(false);
  });
});

describe("Types — costanti e set provider", () => {
  it("ENV_VAR_MAP mappa tutti i provider API key", () => {
    expect(ENV_VAR_MAP.claude).toBe("ANTHROPIC_API_KEY");
    expect(ENV_VAR_MAP.openai).toBe("OPENAI_API_KEY");
    expect(ENV_VAR_MAP.minimax).toBe("MINIMAX_API_KEY");
  });

  it("ALL_PROVIDERS contiene API key + OAuth", () => {
    for (const p of API_KEY_PROVIDERS) expect(ALL_PROVIDERS.has(p)).toBe(true);
    for (const p of OAUTH_PROVIDERS) expect(ALL_PROVIDERS.has(p)).toBe(true);
    expect(ALL_PROVIDERS.size).toBe(API_KEY_PROVIDERS.size + OAUTH_PROVIDERS.size);
  });
});
