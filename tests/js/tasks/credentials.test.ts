/**
 * Test unitari — shared/credentials
 *
 * Crypto AES-256, storage CRUD, manager add/remove/get/list.
 *
 * ⚠️ Isolamento filesystem: `shared/paths.js` risolve `JHT_CREDENTIALS_DIR`
 * da `$JHT_HOME` **al momento dell'import**, con fallback su `~/.jht` —
 * cioè sull'installazione reale di chi lancia i test (che su questo progetto
 * appartiene al container). Per questo ogni test di storage/manager passa da
 * `withIsolatedHome()`, che punta `JHT_HOME` a una mkdtemp e ricarica i
 * moduli con `vi.resetModules()`. Senza il reset l'import resterebbe legato
 * al valore letto al primo caricamento.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync,
  rmSync, statSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  deriveKey, generateSalt, encrypt, decrypt, isValidPayload,
} from "../../../shared/credentials/crypto.js";
import {
  resolveJhtPassphrase, MissingPassphraseError,
} from "../../../shared/credentials/passphrase.js";
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
    expect(ENV_VAR_MAP.kimi).toBe("MOONSHOT_API_KEY");
  });

  it("ALL_PROVIDERS contiene API key + OAuth", () => {
    for (const p of API_KEY_PROVIDERS) expect(ALL_PROVIDERS.has(p)).toBe(true);
    for (const p of OAUTH_PROVIDERS) expect(ALL_PROVIDERS.has(p)).toBe(true);
    expect(ALL_PROVIDERS.size).toBe(API_KEY_PROVIDERS.size + OAUTH_PROVIDERS.size);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Storage + manager: lo strato fra il cifrario e il disco.
// ─────────────────────────────────────────────────────────────────────

// I path degli import dinamici restano letterali: con uno specifier in
// variabile il bundler non lo risolve relativamente a questo file.
const importStorage = () => import("../../../shared/credentials/storage.js");
const importManager = () => import("../../../shared/credentials/manager.js");

/** Env var che i moduli sotto test leggono: le azzeriamo per non ereditare
 *  la shell di chi lancia i test (una `ANTHROPIC_API_KEY` esportata
 *  cambierebbe la precedenza risolta dal manager). */
const TOUCHED_ENV = [
  "JHT_HOME",
  "JHT_CREDENTIALS_KEY",
  "JHT_ENCRYPTION_KEY",
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "MOONSHOT_API_KEY",
];

let savedEnv: Record<string, string | undefined> = {};
let tempHomes: string[] = [];

beforeEach(() => {
  savedEnv = {};
  for (const k of TOUCHED_ENV) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of TOUCHED_ENV) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  for (const home of tempHomes) rmSync(home, { recursive: true, force: true });
  tempHomes = [];
  vi.resetModules();
});

type StorageModule = typeof import("../../../shared/credentials/storage.js");
type ManagerModule = typeof import("../../../shared/credentials/manager.js");

/**
 * Crea una JHT_HOME temporanea e ricarica storage+manager legati a quella.
 * `passphrase: null` simula l'utente che non ha impostato nulla.
 */
async function withIsolatedHome(passphrase: string | null = "passphrase-di-test"): Promise<{
  home: string;
  credDir: string;
  storage: StorageModule;
  manager: ManagerModule;
}> {
  const home = mkdtempSync(join(tmpdir(), "jht-cred-test-"));
  // Guard esplicita: se questa fallisse, i test starebbero scrivendo
  // nella ~/.jht reale dell'utente.
  expect(home.startsWith(tmpdir())).toBe(true);
  tempHomes.push(home);

  process.env.JHT_HOME = home;
  if (passphrase === null) delete process.env.JHT_CREDENTIALS_KEY;
  else process.env.JHT_CREDENTIALS_KEY = passphrase;

  vi.resetModules();
  const storage: StorageModule = await importStorage();
  const manager: ManagerModule = await importManager();
  return { home, credDir: join(home, "credentials"), storage, manager };
}

function apiKeyCred(apiKey: string): ApiKeyCredential {
  return { type: "api_key", provider: "claude", apiKey, savedAt: 1_700_000_000_000 };
}

describe("Storage — round-trip su disco", () => {
  it("scrive sotto $JHT_HOME/credentials e rilegge la credenziale identica", async () => {
    const { credDir, storage } = await withIsolatedHome();
    const cred = apiKeyCred("sk-ant-round-trip");

    expect(storage.hasStoredCredential("claude")).toBe(false);
    storage.writeCredential("claude", cred);

    expect(existsSync(join(credDir, "claude.enc.json"))).toBe(true);
    expect(storage.hasStoredCredential("claude")).toBe(true);
    expect(storage.readCredential("claude")).toEqual(cred);
  });

  it("round-trip di una credenziale OAuth con tutti i campi", async () => {
    const { storage } = await withIsolatedHome();
    const cred: OAuthCredential = {
      type: "oauth",
      provider: "claude_max",
      accessToken: "tok-abc",
      refreshToken: "ref-xyz",
      expiresAt: 1_800_000_000_000,
      savedAt: 1_700_000_000_000,
    };
    storage.writeCredential("claude_max", cred);
    expect(storage.readCredential("claude_max")).toEqual(cred);
  });

  it("il file su disco non contiene il segreto in chiaro", async () => {
    const { credDir, storage } = await withIsolatedHome();
    storage.writeCredential("openai", apiKeyCred("sk-super-segreto-123"));

    const raw = readFileSync(join(credDir, "openai.enc.json"), "utf-8");
    expect(raw).not.toContain("sk-super-segreto-123");
    const parsed = JSON.parse(raw);
    expect(isValidPayload(parsed)).toBe(true);
  });

  it("salt persistente: due scritture consecutive restano decifrabili", async () => {
    const { credDir, storage } = await withIsolatedHome();
    storage.writeCredential("claude", apiKeyCred("primo"));
    const saltDopoPrima = readFileSync(join(credDir, ".salt"));

    storage.writeCredential("openai", apiKeyCred("secondo"));
    expect(readFileSync(join(credDir, ".salt")).equals(saltDopoPrima)).toBe(true);
    expect((storage.readCredential("claude") as ApiKeyCredential).apiKey).toBe("primo");
    expect((storage.readCredential("openai") as ApiKeyCredential).apiKey).toBe("secondo");
  });

  it("la credenziale sopravvive a un ricaricamento del modulo (stessa home + passphrase)", async () => {
    const { home, storage } = await withIsolatedHome("segreto-stabile");
    storage.writeCredential("kimi", apiKeyCred("sk-kimi-persist"));

    // Simula un nuovo processo: stesso JHT_HOME, stessa passphrase.
    process.env.JHT_HOME = home;
    process.env.JHT_CREDENTIALS_KEY = "segreto-stabile";
    vi.resetModules();
    const reloaded: StorageModule = await importStorage();
    expect((reloaded.readCredential("kimi") as ApiKeyCredential).apiKey).toBe("sk-kimi-persist");
  });
});

describe("Storage — permessi dei file", () => {
  it("il file credenziale è 0600 e la directory nega group/other", async () => {
    const { credDir, storage } = await withIsolatedHome();
    storage.writeCredential("claude", apiKeyCred("sk-perm"));

    const fileMode = statSync(join(credDir, "claude.enc.json")).mode & 0o777;
    expect(fileMode).toBe(0o600);

    const dirMode = statSync(credDir).mode & 0o777;
    expect(dirMode & 0o077).toBe(0);

    const saltMode = statSync(join(credDir, ".salt")).mode & 0o777;
    expect(saltMode & 0o077).toBe(0);
  });

  it("riscrivere un file già esistente e permissivo lo riporta a 0600", async () => {
    const { credDir, storage } = await withIsolatedHome();
    // writeFileSync non cambia i permessi di un file che esiste già: senza
    // il chmod esplicito dopo la scrittura, un file lasciato 0644 da un
    // altro tool resterebbe leggibile da tutti.
    mkdirSync(credDir, { recursive: true, mode: 0o700 });
    writeFileSync(join(credDir, "claude.enc.json"), "{}", { mode: 0o644 });
    chmodSync(join(credDir, "claude.enc.json"), 0o644);

    storage.writeCredential("claude", apiKeyCred("sk-riscritto"));
    expect(statSync(join(credDir, "claude.enc.json")).mode & 0o777).toBe(0o600);
  });

  it("una directory credenziali preesistente e permissiva viene irrigidita a 0700", async () => {
    // `mode` di mkdirSync vale solo alla creazione: una dir lasciata a 0755 da
    // un altro tool (o ripristinata da un backup) restava enumerabile da
    // chiunque, pur con i file dentro a 0600.
    const { credDir, storage } = await withIsolatedHome();
    mkdirSync(credDir, { recursive: true, mode: 0o755 });
    chmodSync(credDir, 0o755);
    expect(statSync(credDir).mode & 0o777).toBe(0o755);

    // Basta un'operazione qualsiasi che tocchi la directory.
    expect(storage.listStoredProviders()).toEqual([]);
    expect(statSync(credDir).mode & 0o777).toBe(0o700);

    storage.writeCredential("claude", apiKeyCred("sk-dir"));
    expect(statSync(credDir).mode & 0o777).toBe(0o700);
  });

  it("un chmod che fallisce (dir di proprietà del container) non rompe l'avvio", async () => {
    const home = mkdtempSync(join(tmpdir(), "jht-cred-test-"));
    expect(home.startsWith(tmpdir())).toBe(true);
    tempHomes.push(home);
    process.env.JHT_HOME = home;
    process.env.JHT_CREDENTIALS_KEY = "passphrase-di-test";

    const credDir = join(home, "credentials");
    mkdirSync(credDir, { recursive: true, mode: 0o755 });
    chmodSync(credDir, 0o755);

    vi.resetModules();
    vi.doMock("node:fs", async (importOriginal) => {
      const actual = await importOriginal<typeof import("node:fs")>();
      return {
        ...actual,
        default: actual,
        chmodSync: () => {
          const err: NodeJS.ErrnoException = new Error("operation not permitted");
          err.code = "EPERM";
          throw err;
        },
      };
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    try {
      const storage: StorageModule = await importStorage();
      // Non lancia: l'irrigidimento è difesa in profondità, non precondizione.
      expect(storage.listStoredProviders()).toEqual([]);
      expect(statSync(credDir).mode & 0o777).toBe(0o755);
      // Segnalato, ma una volta sola per processo: niente spam a ogni lettura.
      storage.listStoredProviders();
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]?.[0])).toContain("EPERM");
    } finally {
      warn.mockRestore();
      vi.doUnmock("node:fs");
      vi.resetModules();
    }
  });
});

describe("Storage — file corrotto e passphrase sbagliata", () => {
  it("passphrase diversa da quella di scrittura → null, senza lanciare", async () => {
    const { home, storage } = await withIsolatedHome("passphrase-giusta");
    storage.writeCredential("claude", apiKeyCred("sk-protetta"));

    process.env.JHT_HOME = home;
    process.env.JHT_CREDENTIALS_KEY = "passphrase-sbagliata";
    vi.resetModules();
    const reloaded: StorageModule = await importStorage();

    expect(reloaded.readCredential("claude")).toBeNull();
    // Il file resta al suo posto: la lettura fallita non distrugge il dato.
    expect(reloaded.hasStoredCredential("claude")).toBe(true);
  });

  it("salt sostituito → la chiave non si deriva più, ritorna null", async () => {
    const { credDir, storage } = await withIsolatedHome();
    storage.writeCredential("claude", apiKeyCred("sk-salt"));

    writeFileSync(join(credDir, ".salt"), generateSalt(), { mode: 0o600 });
    expect(storage.readCredential("claude")).toBeNull();
  });

  it("JSON non parsabile → null", async () => {
    const { credDir, storage } = await withIsolatedHome();
    storage.writeCredential("claude", apiKeyCred("sk-x"));
    writeFileSync(join(credDir, "claude.enc.json"), "{ questo non e' json", { mode: 0o600 });
    expect(storage.readCredential("claude")).toBeNull();
  });

  it("JSON valido ma non un payload cifrato → null", async () => {
    const { credDir, storage } = await withIsolatedHome();
    storage.writeCredential("claude", apiKeyCred("sk-x"));
    writeFileSync(
      join(credDir, "claude.enc.json"),
      JSON.stringify({ apiKey: "sk-in-chiaro" }),
      { mode: 0o600 },
    );
    expect(storage.readCredential("claude")).toBeNull();
  });

  it("payload valido ma ciphertext manomesso → null (auth tag GCM)", async () => {
    const { credDir, storage } = await withIsolatedHome();
    storage.writeCredential("claude", apiKeyCred("sk-x"));

    const path = join(credDir, "claude.enc.json");
    const payload = JSON.parse(readFileSync(path, "utf-8")) as EncryptedPayload;
    const manomesso = { ...payload, data: "ff".repeat(32) };
    expect(isValidPayload(manomesso)).toBe(true); // la forma è ancora valida
    writeFileSync(path, JSON.stringify(manomesso), { mode: 0o600 });

    expect(storage.readCredential("claude")).toBeNull();
  });

  it("file assente → null, e delete su file assente → false", async () => {
    const { storage } = await withIsolatedHome();
    expect(storage.readCredential("claude")).toBeNull();
    expect(storage.deleteCredential("claude")).toBe(false);
  });
});

describe("Storage — delete e listing", () => {
  it("deleteCredential rimuove il file e ritorna true solo la prima volta", async () => {
    const { credDir, storage } = await withIsolatedHome();
    storage.writeCredential("claude", apiKeyCred("sk-del"));

    expect(storage.deleteCredential("claude")).toBe(true);
    expect(existsSync(join(credDir, "claude.enc.json"))).toBe(false);
    expect(storage.hasStoredCredential("claude")).toBe(false);
    expect(storage.deleteCredential("claude")).toBe(false);
  });

  it("listStoredProviders elenca i provider salvati e ignora salt e file estranei", async () => {
    const { credDir, storage } = await withIsolatedHome();
    expect(storage.listStoredProviders()).toEqual([]);

    storage.writeCredential("claude", apiKeyCred("a"));
    storage.writeCredential("claude_max", {
      type: "oauth", provider: "claude_max", accessToken: "t", savedAt: 1,
    });
    writeFileSync(join(credDir, "README.txt"), "non sono una credenziale");

    expect([...storage.listStoredProviders()].sort()).toEqual(["claude", "claude_max"]);
  });
});

describe("Storage — passphrase mancante", () => {
  it("writeCredential lancia MissingPassphraseError se nessuna sorgente la fornisce", async () => {
    const { credDir, storage } = await withIsolatedHome(null);

    expect(() => storage.writeCredential("claude", apiKeyCred("sk-no-pass")))
      .toThrowError(/passphrase non trovata/i);
    expect(existsSync(join(credDir, "claude.enc.json"))).toBe(false);
  });

  /**
   * Asserisce che `fn` lanci una MissingPassphraseError e la restituisce.
   *
   * Volutamente su `name` e non su `instanceof`: dopo `vi.resetModules()` i
   * moduli reimportati portano con sé una *nuova* classe
   * `MissingPassphraseError`, diversa per identità da quella importata in
   * testa a questo file. Un `toThrowError(MissingPassphraseError)` fallirebbe
   * pur essendo l'errore giusto.
   */
  function expectMissingPassphrase(fn: () => unknown): Error {
    let caught: unknown;
    try {
      fn();
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).name).toBe(MissingPassphraseError.name);
    return caught as Error;
  }

  /** Scrive una credenziale, poi ricarica i moduli senza passphrase. */
  async function credenzialeSenzaPassphrase(): Promise<{
    credDir: string;
    storage: StorageModule;
    manager: ManagerModule;
  }> {
    const { home, credDir, storage } = await withIsolatedHome("passphrase-presente");
    storage.writeCredential("claude", apiKeyCred("sk-esiste"));

    process.env.JHT_HOME = home;
    delete process.env.JHT_CREDENTIALS_KEY;
    vi.resetModules();
    return {
      credDir,
      storage: await importStorage(),
      manager: await importManager(),
    };
  }

  it("readCredential su credenziale integra senza passphrase lancia invece di fingere che non esista", async () => {
    // Prima questo caso tornava null: una credenziale ESISTENTE e integra era
    // indistinguibile da una mai salvata, e chi perdeva JHT_CREDENTIALS_KEY
    // andava a cercare un problema che non c'era. Ora legge come la scrittura.
    const { credDir, storage } = await credenzialeSenzaPassphrase();

    const err = expectMissingPassphrase(() => storage.readCredential("claude"));
    // Il messaggio deve dire COSA manca, e che il dato è ancora lì.
    expect(err.message).toMatch(/manca la passphrase/i);
    expect(err.message).toContain("JHT_CREDENTIALS_KEY");
    expect(err.message).toContain("claude");

    // La lettura fallita non tocca il file.
    expect(storage.hasStoredCredential("claude")).toBe(true);
    expect(existsSync(join(credDir, "claude.enc.json"))).toBe(true);
  });

  it("credenziale mai salvata + passphrase assente → null, non un errore di passphrase", async () => {
    // Il file viene controllato prima della passphrase: reclamare una chiave
    // per un dato che non esiste sarebbe la stessa confusione al contrario.
    const { storage } = await withIsolatedHome(null);
    expect(storage.readCredential("claude")).toBeNull();
    expect(storage.inspectCredential("claude")).toEqual({ status: "absent" });
  });

  it("file illeggibile + passphrase assente → corrotto vince: nessun errore di passphrase", async () => {
    const { home, credDir, storage } = await withIsolatedHome("passphrase-presente");
    storage.writeCredential("claude", apiKeyCred("sk-x"));
    writeFileSync(join(credDir, "claude.enc.json"), "{ non json", { mode: 0o600 });

    process.env.JHT_HOME = home;
    delete process.env.JHT_CREDENTIALS_KEY;
    vi.resetModules();
    const reloaded: StorageModule = await importStorage();

    expect(reloaded.inspectCredential("claude")).toEqual({ status: "corrupted" });
    expect(reloaded.readCredential("claude")).toBeNull();
  });

  it("inspectCredential distingue i quattro esiti senza lanciare", async () => {
    const cred = apiKeyCred("sk-inspect");
    const { home, credDir, storage } = await withIsolatedHome("passphrase-presente");
    storage.writeCredential("claude", cred);

    expect(storage.inspectCredential("claude")).toEqual({ status: "ok", credential: cred });
    expect(storage.inspectCredential("openai")).toEqual({ status: "absent" });

    writeFileSync(join(credDir, "kimi.enc.json"), JSON.stringify({ apiKey: "x" }), { mode: 0o600 });
    expect(storage.inspectCredential("kimi")).toEqual({ status: "corrupted" });

    process.env.JHT_HOME = home;
    delete process.env.JHT_CREDENTIALS_KEY;
    vi.resetModules();
    const reloaded: StorageModule = await importStorage();

    const result = reloaded.inspectCredential("claude");
    expect(result.status).toBe("missing_passphrase");
    if (result.status !== "missing_passphrase") throw new Error("stato inatteso");
    expect(result.envVar).toBe("JHT_CREDENTIALS_KEY");
    expect(result.message).toMatch(/manca la passphrase/i);
    expect(result.message).toContain("claude");
  });

  it("passphrase sbagliata resta 'corrupted': con GCM non è distinguibile da un file manomesso", async () => {
    const { home, storage } = await withIsolatedHome("passphrase-giusta");
    storage.writeCredential("claude", apiKeyCred("sk-protetta"));

    process.env.JHT_HOME = home;
    process.env.JHT_CREDENTIALS_KEY = "passphrase-sbagliata";
    vi.resetModules();
    const reloaded: StorageModule = await importStorage();

    expect(reloaded.inspectCredential("claude")).toEqual({ status: "corrupted" });
    expect(reloaded.readCredential("claude")).toBeNull();
  });

  it("il manager propaga l'errore di passphrase invece di riportare 'non configurato'", async () => {
    const { manager } = await credenzialeSenzaPassphrase();

    expectMissingPassphrase(() => manager.resolveApiKey("claude"));
    expectMissingPassphrase(() => manager.resolveApiKey("claude", "file-first"));
    expectMissingPassphrase(() => manager.resolveCredential("claude"));
  });

  it("resolveOAuthToken senza passphrase lancia: il token c'è, non è leggibile", async () => {
    const { home, storage } = await withIsolatedHome("passphrase-presente");
    storage.writeCredential("claude_max", {
      type: "oauth", provider: "claude_max", accessToken: "tok", savedAt: 1,
    });

    process.env.JHT_HOME = home;
    delete process.env.JHT_CREDENTIALS_KEY;
    vi.resetModules();
    const manager: ManagerModule = await importManager();

    expectMissingPassphrase(() => manager.resolveOAuthToken("claude_max"));
    expectMissingPassphrase(() => manager.resolveCredential("claude_max"));
  });

  it("env-first: con l'env var valorizzata il file cifrato non viene nemmeno aperto", async () => {
    // Regressione da evitare: rendere loud la lettura non deve rompere chi
    // passa già la chiave dall'ambiente e ha un file orfano su disco.
    const { manager } = await credenzialeSenzaPassphrase();
    process.env[ENV_VAR_MAP.claude] = "sk-da-env";

    const resolved = manager.resolveApiKey("claude");
    expect(resolved?.source).toBe("env");
    expect((resolved?.credential as ApiKeyCredential).apiKey).toBe("sk-da-env");
    // In file-first il file serve davvero, quindi lì l'errore deve emergere.
    expectMissingPassphrase(() => manager.resolveApiKey("claude", "file-first"));
  });
});

describe("Manager — API key e precedenza", () => {
  it("saveApiKey → resolveApiKey legge dal file con source 'file'", async () => {
    const { manager } = await withIsolatedHome();
    manager.saveApiKey("claude", "sk-file-123");

    const resolved = manager.resolveApiKey("claude");
    expect(resolved?.source).toBe("file");
    expect((resolved?.credential as ApiKeyCredential).apiKey).toBe("sk-file-123");
    expect(resolved?.credential.type).toBe("api_key");
  });

  it("saveApiKey trimma la chiave e rifiuta quelle vuote", async () => {
    const { manager } = await withIsolatedHome();
    manager.saveApiKey("claude", "  sk-con-spazi  ");
    expect((manager.resolveApiKey("claude")?.credential as ApiKeyCredential).apiKey)
      .toBe("sk-con-spazi");

    expect(() => manager.saveApiKey("claude", "   ")).toThrowError(/vuota/i);
  });

  it("env-first (default): l'env var vince sul file", async () => {
    const { manager } = await withIsolatedHome();
    manager.saveApiKey("claude", "sk-da-file");
    process.env[ENV_VAR_MAP.claude] = "sk-da-env";

    const resolved = manager.resolveApiKey("claude");
    expect(resolved?.source).toBe("env");
    expect((resolved?.credential as ApiKeyCredential).apiKey).toBe("sk-da-env");
  });

  it("file-first: il file vince sull'env var", async () => {
    const { manager } = await withIsolatedHome();
    manager.saveApiKey("claude", "sk-da-file");
    process.env[ENV_VAR_MAP.claude] = "sk-da-env";

    const resolved = manager.resolveApiKey("claude", "file-first");
    expect(resolved?.source).toBe("file");
    expect((resolved?.credential as ApiKeyCredential).apiKey).toBe("sk-da-file");
  });

  it("env var di soli spazi conta come assente e si cade sul file", async () => {
    const { manager } = await withIsolatedHome();
    manager.saveApiKey("claude", "sk-da-file");
    process.env[ENV_VAR_MAP.claude] = "   ";

    expect(manager.resolveApiKey("claude")?.source).toBe("file");
  });

  it("niente env e niente file → null", async () => {
    const { manager } = await withIsolatedHome();
    expect(manager.resolveApiKey("claude")).toBeNull();
    expect(manager.resolveApiKey("claude", "file-first")).toBeNull();
  });

  it("solo env, nessun file → source 'env' con savedAt 0", async () => {
    const { manager } = await withIsolatedHome();
    process.env[ENV_VAR_MAP.kimi] = "sk-kimi-env";
    const resolved = manager.resolveApiKey("kimi");
    expect(resolved?.source).toBe("env");
    expect(resolved?.credential.savedAt).toBe(0);
  });

  it("provider non API-key → errore esplicito su save e resolve", async () => {
    const { manager } = await withIsolatedHome();
    const bogus = "claude_max" as unknown as Parameters<typeof manager.saveApiKey>[0];
    expect(() => manager.saveApiKey(bogus, "sk-x")).toThrowError(/non supportato/i);
    expect(() => manager.resolveApiKey(bogus)).toThrowError(/non supportato/i);
  });

  it("deleteApiKey ritorna true solo se il file c'era", async () => {
    const { manager } = await withIsolatedHome();
    expect(manager.deleteApiKey("claude")).toBe(false);
    manager.saveApiKey("claude", "sk-x");
    expect(manager.deleteApiKey("claude")).toBe(true);
    expect(manager.resolveApiKey("claude")).toBeNull();
  });
});

describe("Manager — OAuth", () => {
  it("saveOAuthToken → resolveOAuthToken restituisce i token e isExpired=false se la scadenza è futura", async () => {
    const { manager } = await withIsolatedHome();
    manager.saveOAuthToken("claude_max", "tok-1", "ref-1", Date.now() + 3_600_000);

    const resolved = manager.resolveOAuthToken("claude_max");
    expect(resolved?.accessToken).toBe("tok-1");
    expect(resolved?.refreshToken).toBe("ref-1");
    expect(resolved?.isExpired).toBe(false);
  });

  it("scadenza nel passato → isExpired=true (il token resta leggibile)", async () => {
    const { manager } = await withIsolatedHome();
    manager.saveOAuthToken("chatgpt_pro", "tok-vecchio", undefined, Date.now() - 1_000);

    const resolved = manager.resolveOAuthToken("chatgpt_pro");
    expect(resolved?.isExpired).toBe(true);
    expect(resolved?.accessToken).toBe("tok-vecchio");
  });

  it("senza expiresAt il token non è mai considerato scaduto", async () => {
    const { manager } = await withIsolatedHome();
    manager.saveOAuthToken("claude_max", "tok-eterno");
    expect(manager.resolveOAuthToken("claude_max")?.isExpired).toBe(false);
  });

  it("access token vuoto → errore; provider non OAuth → errore", async () => {
    const { manager } = await withIsolatedHome();
    expect(() => manager.saveOAuthToken("claude_max", "  ")).toThrowError(/vuoto/i);

    const bogus = "claude" as unknown as Parameters<typeof manager.saveOAuthToken>[0];
    expect(() => manager.saveOAuthToken(bogus, "tok")).toThrowError(/non supportato/i);
    expect(() => manager.resolveOAuthToken(bogus)).toThrowError(/non supportato/i);
  });

  it("nessun token salvato → null, e deleteOAuthToken riflette l'esistenza del file", async () => {
    const { manager } = await withIsolatedHome();
    expect(manager.resolveOAuthToken("claude_max")).toBeNull();
    expect(manager.deleteOAuthToken("claude_max")).toBe(false);

    manager.saveOAuthToken("claude_max", "tok");
    expect(manager.deleteOAuthToken("claude_max")).toBe(true);
    expect(manager.resolveOAuthToken("claude_max")).toBeNull();
  });
});

describe("Manager — validazione provider sulle delete", () => {
  it("deleteApiKey e deleteOAuthToken rifiutano i provider fuori dal loro insieme", async () => {
    const { manager } = await withIsolatedHome();

    const oauthComeApiKey = "claude_max" as unknown as Parameters<typeof manager.deleteApiKey>[0];
    expect(() => manager.deleteApiKey(oauthComeApiKey)).toThrowError(/non supportato/i);

    const apiKeyComeOauth = "claude" as unknown as Parameters<typeof manager.deleteOAuthToken>[0];
    expect(() => manager.deleteOAuthToken(apiKeyComeOauth)).toThrowError(/non supportato/i);

    const sconosciuto = "gemini" as unknown as Parameters<typeof manager.deleteApiKey>[0];
    expect(() => manager.deleteApiKey(sconosciuto)).toThrowError(/non supportato/i);
  });

  it("una stringa arbitraria non arriva mai al path del file", async () => {
    // Il vincolo era solo di tipo TypeScript: a runtime la stringa finiva
    // grezza in join(dir, `${provider}.enc.json`).
    const { home, credDir, manager } = await withIsolatedHome();
    mkdirSync(credDir, { recursive: true, mode: 0o700 });
    const fuori = join(home, "altro.enc.json");
    writeFileSync(fuori, "non sono una credenziale", { mode: 0o600 });

    const traversal = "../altro" as unknown as Parameters<typeof manager.deleteApiKey>[0];
    expect(() => manager.deleteApiKey(traversal)).toThrowError(/non supportato/i);
    expect(existsSync(fuori)).toBe(true);
  });
});

describe("Manager — interfaccia unificata", () => {
  it("resolveCredential smista API key e OAuth, e rifiuta i provider sconosciuti", async () => {
    const { manager } = await withIsolatedHome();
    manager.saveApiKey("openai", "sk-openai");
    manager.saveOAuthToken("claude_max", "tok-max");

    const apiKey = manager.resolveCredential("openai");
    expect(apiKey?.source).toBe("file");
    expect((apiKey?.credential as ApiKeyCredential).apiKey).toBe("sk-openai");

    const oauth = manager.resolveCredential("claude_max");
    expect(oauth?.source).toBe("file");
    expect(oauth?.credential.type).toBe("oauth");
    // isExpired è un campo calcolato: non deve finire nella credenziale.
    expect(oauth?.credential).not.toHaveProperty("isExpired");

    const bogus = "gemini" as unknown as Parameters<typeof manager.resolveCredential>[0];
    expect(() => manager.resolveCredential(bogus)).toThrowError(/sconosciuto/i);
  });

  it("resolveCredential propaga la precedenza richiesta per le API key", async () => {
    const { manager } = await withIsolatedHome();
    manager.saveApiKey("claude", "sk-file");
    process.env[ENV_VAR_MAP.claude] = "sk-env";

    expect(manager.resolveCredential("claude")?.source).toBe("env");
    expect(manager.resolveCredential("claude", "file-first")?.source).toBe("file");
  });

  it("listConfiguredProviders distingue env, file e OAuth", async () => {
    const { manager } = await withIsolatedHome();
    expect(manager.listConfiguredProviders()).toEqual([]);

    manager.saveApiKey("claude", "sk-file");
    process.env[ENV_VAR_MAP.openai] = "sk-env";
    manager.saveOAuthToken("chatgpt_pro", "tok");

    const configured = manager.listConfiguredProviders();
    expect(configured).toContainEqual({ provider: "claude", type: "api_key", source: "file" });
    expect(configured).toContainEqual({ provider: "openai", type: "api_key", source: "env" });
    expect(configured).toContainEqual({ provider: "chatgpt_pro", type: "oauth", source: "file" });
    expect(configured.find((c) => c.provider === "kimi")).toBeUndefined();
  });

  it("per un provider con env var l'origine dichiarata è 'env' anche se esiste il file", async () => {
    const { manager } = await withIsolatedHome();
    manager.saveApiKey("kimi", "sk-file");
    process.env[ENV_VAR_MAP.kimi] = "sk-env";

    const kimi = manager.listConfiguredProviders().filter((c) => c.provider === "kimi");
    expect(kimi).toEqual([{ provider: "kimi", type: "api_key", source: "env" }]);
  });
});

describe("Passphrase — resolveJhtPassphrase", () => {
  // Account keyring inesistente: garantisce che il lookup OS non risponda
  // nemmeno sulle macchine dove @napi-rs/keyring fosse installato.
  const NO_KEYRING = { keyringAccount: "jht-tests-account-inesistente-9f2c" };

  it("legge l'env var di default e la trimma", async () => {
    process.env.JHT_CREDENTIALS_KEY = "  segreto-con-spazi  ";
    expect(resolveJhtPassphrase(NO_KEYRING)).toBe("segreto-con-spazi");
  });

  it("rispetta un nome di env var custom", () => {
    process.env.JHT_ENCRYPTION_KEY = "segreto-legacy";
    expect(resolveJhtPassphrase({ ...NO_KEYRING, envVar: "JHT_ENCRYPTION_KEY" }))
      .toBe("segreto-legacy");
  });

  it("usa le legacy env var solo se la primaria manca", () => {
    process.env.JHT_ENCRYPTION_KEY = "legacy";
    expect(resolveJhtPassphrase({ ...NO_KEYRING, legacyEnvVars: ["JHT_ENCRYPTION_KEY"] }))
      .toBe("legacy");

    process.env.JHT_CREDENTIALS_KEY = "primaria";
    expect(resolveJhtPassphrase({ ...NO_KEYRING, legacyEnvVars: ["JHT_ENCRYPTION_KEY"] }))
      .toBe("primaria");
  });

  it("un valore di soli spazi non conta come passphrase", () => {
    process.env.JHT_CREDENTIALS_KEY = "   ";
    process.env.JHT_ENCRYPTION_KEY = "legacy-vero";
    expect(resolveJhtPassphrase({ ...NO_KEYRING, legacyEnvVars: ["JHT_ENCRYPTION_KEY"] }))
      .toBe("legacy-vero");
  });

  it("nessuna sorgente → MissingPassphraseError con istruzioni che nominano l'env var", () => {
    let caught: unknown;
    try {
      resolveJhtPassphrase({ ...NO_KEYRING, envVar: "JHT_TEST_PASSPHRASE_VAR" });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(MissingPassphraseError);
    expect((caught as Error).name).toBe("MissingPassphraseError");
    expect((caught as Error).message).toContain("JHT_TEST_PASSPHRASE_VAR");
    // Il finding H4 dell'audit ha rimosso i fallback machine-derived: se
    // tornassero, questo throw sparirebbe.
    expect((caught as Error).message).toMatch(/machine-derived/i);
  });
});
