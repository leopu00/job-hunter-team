/**
 * Test unitari per shared/credentials/storage.ts e manager.ts
 *
 * Usa temp dir isolata per non toccare credenziali reali.
 * Esecuzione: npx tsx --test tests/test_credentials_manager.ts
 */

import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir, homedir } from "node:os";

// Override HOME per isolare i test dal filesystem reale
const originalHome = process.env.HOME;
let testHome: string;

before(() => {
  testHome = mkdtempSync(join(tmpdir(), "jht-cred-test-"));
  process.env.HOME = testHome;
  // Rimuovi env var che influenzano i test
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.MINIMAX_API_KEY;
  delete process.env.JHT_CREDENTIALS_KEY;
});

after(() => {
  process.env.HOME = originalHome;
  rmSync(testHome, { recursive: true, force: true });
});

// ── storage.ts ──────────────────────────────────────────────────────────────

describe("storage: writeCredential + readCredential", () => {
  // Import dinamico dopo override HOME
  it("roundtrip salva e rilegge credenziale API key", async () => {
    const { writeCredential, readCredential } = await import("../shared/credentials/storage.js");
    const cred = { type: "api_key" as const, provider: "claude" as const, apiKey: "sk-ant-test-xyz", savedAt: Date.now() };
    writeCredential("claude", cred);
    const result = readCredential("claude");
    assert.deepStrictEqual(result, cred);
  });

  it("roundtrip salva e rilegge credenziale OAuth", async () => {
    const { writeCredential, readCredential } = await import("../shared/credentials/storage.js");
    const cred = { type: "oauth" as const, provider: "chatgpt_pro" as const, accessToken: "tok-abc", refreshToken: "ref-123", expiresAt: Date.now() + 3600000, savedAt: Date.now() };
    writeCredential("chatgpt_pro", cred);
    const result = readCredential("chatgpt_pro");
    assert.deepStrictEqual(result, cred);
  });
});

describe("storage: readCredential inesistente", () => {
  it("ritorna null per provider senza file", async () => {
    const { readCredential } = await import("../shared/credentials/storage.js");
    const result = readCredential("provider_che_non_esiste");
    assert.equal(result, null);
  });
});

describe("storage: deleteCredential", () => {
  it("rimuove il file e ritorna true", async () => {
    const { writeCredential, deleteCredential, readCredential } = await import("../shared/credentials/storage.js");
    const cred = { type: "api_key" as const, provider: "openai" as const, apiKey: "sk-test-del", savedAt: Date.now() };
    writeCredential("openai_del_test", cred);
    const deleted = deleteCredential("openai_del_test");
    assert.equal(deleted, true);
    assert.equal(readCredential("openai_del_test"), null);
  });

  it("ritorna false per file inesistente", async () => {
    const { deleteCredential } = await import("../shared/credentials/storage.js");
    assert.equal(deleteCredential("nope_nope"), false);
  });
});

describe("storage: listStoredProviders", () => {
  it("elenca i provider salvati", async () => {
    const { writeCredential, listStoredProviders } = await import("../shared/credentials/storage.js");
    const cred = { type: "api_key" as const, provider: "minimax" as const, apiKey: "mm-key", savedAt: Date.now() };
    writeCredential("minimax", cred);
    const list = listStoredProviders();
    assert.ok(list.includes("minimax"));
  });
});

describe("storage: hasStoredCredential", () => {
  it("ritorna true dopo salvataggio", async () => {
    const { writeCredential, hasStoredCredential } = await import("../shared/credentials/storage.js");
    const cred = { type: "api_key" as const, provider: "openai" as const, apiKey: "sk-has-test", savedAt: Date.now() };
    writeCredential("openai_has_test", cred);
    assert.ok(hasStoredCredential("openai_has_test"));
  });
});

// ── manager.ts ──────────────────────────────────────────────────────────────

describe("manager: saveApiKey + resolveApiKey", () => {
  it("salva e risolve API key da file", async () => {
    const { saveApiKey, resolveApiKey } = await import("../shared/credentials/manager.js");
    saveApiKey("claude", "sk-ant-manager-test");
    const result = resolveApiKey("claude");
    assert.ok(result);
    assert.equal(result.credential.type, "api_key");
    assert.equal((result.credential as any).apiKey, "sk-ant-manager-test");
    assert.equal(result.source, "file");
  });

  it("env-first: env var ha precedenza su file", async () => {
    const { saveApiKey, resolveApiKey } = await import("../shared/credentials/manager.js");
    saveApiKey("openai", "sk-file-key");
    process.env.OPENAI_API_KEY = "sk-env-key";
    const result = resolveApiKey("openai", "env-first");
    assert.ok(result);
    assert.equal((result.credential as any).apiKey, "sk-env-key");
    assert.equal(result.source, "env");
    delete process.env.OPENAI_API_KEY;
  });

  it("file-first: file ha precedenza su env", async () => {
    const { saveApiKey, resolveApiKey } = await import("../shared/credentials/manager.js");
    saveApiKey("minimax", "mm-file-key");
    process.env.MINIMAX_API_KEY = "mm-env-key";
    const result = resolveApiKey("minimax", "file-first");
    assert.ok(result);
    assert.equal((result.credential as any).apiKey, "mm-file-key");
    assert.equal(result.source, "file");
    delete process.env.MINIMAX_API_KEY;
  });

  it("lancia errore per provider non supportato", async () => {
    const { saveApiKey } = await import("../shared/credentials/manager.js");
    assert.throws(() => saveApiKey("fake_provider" as any, "key"));
  });

  it("lancia errore per API key vuota", async () => {
    const { saveApiKey } = await import("../shared/credentials/manager.js");
    assert.throws(() => saveApiKey("claude", "  "));
  });
});

describe("manager: OAuth token", () => {
  it("salva e risolve token OAuth", async () => {
    const { saveOAuthToken, resolveOAuthToken } = await import("../shared/credentials/manager.js");
    const exp = Date.now() + 3600_000;
    saveOAuthToken("chatgpt_pro", "access-tok", "refresh-tok", exp);
    const result = resolveOAuthToken("chatgpt_pro");
    assert.ok(result);
    assert.equal(result.accessToken, "access-tok");
    assert.equal(result.refreshToken, "refresh-tok");
    assert.equal(result.isExpired, false);
  });

  it("rileva token scaduto", async () => {
    const { saveOAuthToken, resolveOAuthToken } = await import("../shared/credentials/manager.js");
    saveOAuthToken("claude_max", "old-tok", undefined, Date.now() - 1000);
    const result = resolveOAuthToken("claude_max");
    assert.ok(result);
    assert.equal(result.isExpired, true);
  });
});

describe("manager: resolveCredential unificato", () => {
  it("risolve API key provider", async () => {
    const { saveApiKey, resolveCredential } = await import("../shared/credentials/manager.js");
    saveApiKey("claude", "sk-unified-test");
    const result = resolveCredential("claude");
    assert.ok(result);
    assert.equal(result.credential.type, "api_key");
  });

  it("risolve OAuth provider", async () => {
    const { saveOAuthToken, resolveCredential } = await import("../shared/credentials/manager.js");
    saveOAuthToken("chatgpt_pro", "unified-oauth", undefined, undefined);
    const result = resolveCredential("chatgpt_pro");
    assert.ok(result);
    assert.equal(result.credential.type, "oauth");
  });

  it("lancia errore per provider sconosciuto", async () => {
    const { resolveCredential } = await import("../shared/credentials/manager.js");
    assert.throws(() => resolveCredential("unknown" as any));
  });
});

describe("manager: deleteApiKey", () => {
  it("rimuove API key salvata", async () => {
    const { saveApiKey, deleteApiKey, resolveApiKey } = await import("../shared/credentials/manager.js");
    saveApiKey("claude", "sk-to-delete");
    const deleted = deleteApiKey("claude");
    assert.equal(deleted, true);
    // Senza env var, deve tornare null
    delete process.env.ANTHROPIC_API_KEY;
    const result = resolveApiKey("claude");
    assert.equal(result, null);
  });
});
