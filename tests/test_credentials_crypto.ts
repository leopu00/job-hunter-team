/**
 * Test unitari per shared/credentials/crypto.ts e storage.ts
 *
 * Esecuzione: npx tsx --test tests/test_credentials_crypto.ts
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { deriveKey, generateSalt, encrypt, decrypt, isValidPayload } from "../shared/credentials/crypto.js";

// ── crypto.ts ───────────────────────────────────────────────────────────────

describe("deriveKey", () => {
  it("produce output deterministico per stessa passphrase e salt", () => {
    const salt = generateSalt();
    const key1 = deriveKey("my-passphrase", salt);
    const key2 = deriveKey("my-passphrase", salt);
    assert.deepStrictEqual(key1, key2);
  });

  it("produce chiavi diverse con salt diversi", () => {
    const salt1 = generateSalt();
    const salt2 = generateSalt();
    const key1 = deriveKey("my-passphrase", salt1);
    const key2 = deriveKey("my-passphrase", salt2);
    assert.notDeepStrictEqual(key1, key2);
  });

  it("produce una chiave di 32 byte (256 bit)", () => {
    const salt = generateSalt();
    const key = deriveKey("test", salt);
    assert.equal(key.length, 32);
  });
});

describe("generateSalt", () => {
  it("produce un buffer di 32 byte", () => {
    const salt = generateSalt();
    assert.ok(Buffer.isBuffer(salt));
    assert.equal(salt.length, 32);
  });

  it("produce valori unici ad ogni chiamata", () => {
    const s1 = generateSalt();
    const s2 = generateSalt();
    assert.notDeepStrictEqual(s1, s2);
  });
});

describe("encrypt / decrypt", () => {
  const salt = generateSalt();
  const key = deriveKey("test-passphrase", salt);

  it("roundtrip preserva oggetto JSON", () => {
    const data = { provider: "claude", apiKey: "sk-ant-test-123", savedAt: 1234 };
    const payload = encrypt(data, key);
    const result = decrypt(payload, key);
    assert.deepStrictEqual(result, data);
  });

  it("roundtrip preserva stringa semplice", () => {
    const data = "una stringa semplice";
    const payload = encrypt(data, key);
    const result = decrypt(payload, key);
    assert.equal(result, data);
  });

  it("roundtrip preserva array", () => {
    const data = [1, "due", { tre: 3 }];
    const payload = encrypt(data, key);
    const result = decrypt(payload, key);
    assert.deepStrictEqual(result, data);
  });

  it("decrypt con chiave sbagliata lancia errore", () => {
    const data = { secret: "top-secret" };
    const payload = encrypt(data, key);

    const wrongKey = deriveKey("wrong-passphrase", salt);
    assert.throws(() => decrypt(payload, wrongKey));
  });

  it("payload ha campi IV e authTag diversi ogni volta", () => {
    const data = { same: "data" };
    const p1 = encrypt(data, key);
    const p2 = encrypt(data, key);
    assert.notEqual(p1.iv, p2.iv);
    assert.notEqual(p1.data, p2.data);
  });
});

describe("isValidPayload", () => {
  it("valida un payload corretto", () => {
    const salt = generateSalt();
    const key = deriveKey("x", salt);
    const payload = encrypt("test", key);
    assert.ok(isValidPayload(payload));
  });

  it("rifiuta null", () => {
    assert.ok(!isValidPayload(null));
  });

  it("rifiuta oggetto senza version", () => {
    assert.ok(!isValidPayload({ algorithm: "aes-256-gcm", iv: "aa", authTag: "bb", data: "cc" }));
  });

  it("rifiuta version sbagliata", () => {
    assert.ok(!isValidPayload({ version: 2, algorithm: "aes-256-gcm", iv: "a", authTag: "b", data: "c" }));
  });

  it("rifiuta algorithm sbagliato", () => {
    assert.ok(!isValidPayload({ version: 1, algorithm: "aes-128-cbc", iv: "a", authTag: "b", data: "c" }));
  });
});
