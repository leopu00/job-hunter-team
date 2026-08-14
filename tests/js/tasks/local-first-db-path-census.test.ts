/**
 * Censimento dei `fs.existsSync(JHT_DB_PATH)` del web (#154).
 *
 * Il difetto che previene: "se il file locale c'e', usalo" e' la scelta che
 * ha rotto il pulsante candidatura — su un deploy cloud quel file non e' la
 * verita' dell'utente, e preferirlo produce una risposta di successo per una
 * scrittura che il cloud non ha mai visto. Il ramo sbagliato non fa rumore:
 * per questo un test che lo cerca vale piu' di una revisione.
 *
 * Le porte censite sono di due tipi, e il test le distingue:
 *
 *   - CLOUD-GUARDED: la presenza del file la decide `isCloudDeploy()` insieme
 *     al filesystem (`!isCloudDeploy() && existsSync(...)`, o un guard nelle
 *     righe immediatamente sopra);
 *   - LOCAL-ONLY DICHIARATO: dentro il ramo local-token, che su cloud non si
 *     apre mai perche' `isLocalTokenAuthenticated()` e' falso per costruzione.
 *     Sono le uniche ammesse senza guard, ed elencate qui una per una.
 *
 * Una porta nuova che non rientri in nessuno dei due casi fa fallire il
 * censimento: e' fail-closed, come `account-tables-census`.
 */
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createRequire } from "node:module";
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");
const WEB = path.join(ROOT, "web");

// ── Censimento sui sorgenti ───────────────────────────────────────────────

/** Ogni occorrenza di `existsSync(JHT_DB_PATH)` sotto `web/`. */
interface Site {
  file: string;
  line: number;
  /** La riga stessa piu' le tre precedenti: dove puo' vivere il guard. */
  window: string;
  /** Le sei righe precedenti: dove puo' vivere la dichiarazione. */
  preamble: string;
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".next") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

function census(): Site[] {
  const found: Site[] = [];
  for (const file of sourceFiles(WEB)) {
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((text, index) => {
      if (!/existsSync\(JHT_DB_PATH\)/.test(text)) return;
      found.push({
        file: path.relative(ROOT, file),
        line: index + 1,
        window: lines.slice(Math.max(0, index - 3), index + 1).join("\n"),
        preamble: lines.slice(Math.max(0, index - 6), index).join("\n"),
      });
    });
  }
  return found;
}

/** I quattro rami local-token: legittimi senza guard, e dichiarati nel codice. */
const DECLARED_LOCAL_ONLY = [
  "web/app/api/positions/[legacyId]/geocode-request/route.ts",
  "web/app/api/positions/[legacyId]/recheck-request/route.ts",
  "web/app/api/positions/[legacyId]/write-request/route.ts",
  "web/lib/positions/local-first-write.ts",
].sort();

const DECLARATION = "Sito local-only DICHIARATO";

describe("censimento existsSync(JHT_DB_PATH) — nessuna porta senza guard", () => {
  const sites = census();

  it("lo scanner trova le porte che sappiamo esserci", () => {
    // Se il regex smettesse di corrispondere — import diverso, formattazione
    // nuova — troverebbe zero siti e ogni altro controllo passerebbe a vuoto.
    expect(sites.length).toBeGreaterThanOrEqual(12);
  });

  it("ogni porta e' cloud-guarded oppure dichiarata local-only", () => {
    const unclassified = sites.filter(
      (s) =>
        !s.window.includes("isCloudDeploy") &&
        !s.preamble.includes(DECLARATION),
    );
    expect(
      unclassified.map((s) => `${s.file}:${s.line}`),
      "porta senza guard cloud ne' dichiarazione local-only",
    ).toEqual([]);
  });

  it("le porte senza guard sono esattamente i rami local-token noti", () => {
    const declared = [
      ...new Set(
        sites
          .filter((s) => !s.window.includes("isCloudDeploy"))
          .map((s) => s.file),
      ),
    ].sort();
    expect(declared).toEqual(DECLARED_LOCAL_ONLY);
  });

  it("ogni ramo dichiarato spiega perche' il cloud non ci arriva", () => {
    for (const site of sites.filter((s) => s.preamble.includes(DECLARATION))) {
      expect(site.preamble).toContain("isLocalTokenAuthenticated");
    }
  });
});

// ── Le due porte chiuse a runtime ─────────────────────────────────────────

const requireFromWeb = createRequire(path.join(WEB, "package.json"));
const Database = requireFromWeb(
  "better-sqlite3",
) as typeof import("better-sqlite3");

const temporary = mkdtempSync(path.join(tmpdir(), "jht-154-"));
const ORIGINAL_HOME = process.env.JHT_HOME;
const ORIGINAL_DEPLOY = process.env.NEXT_PUBLIC_JHT_DEPLOY;

// Import fresco dei moduli: `JHT_HOME` viene letta al caricamento e la cache
// del token vive nel modulo, quindi ogni scenario riparte da zero.
async function freshLocalToken() {
  vi.resetModules();
  return import("@/lib/local-token");
}

async function freshDb() {
  vi.resetModules();
  return import("@/lib/db");
}

/** Il token del box, gia' sul filesystem: lo scenario peggiore per il cloud. */
const TOKEN = "a".repeat(63) + "b";

beforeAll(() => {
  process.env.JHT_HOME = temporary;
  writeFileSync(path.join(temporary, ".local-token"), TOKEN, "utf8");
  // Un jobs.db VERO: senza i guard sarebbe apribile e leggibile, ed e' quello
  // che rende il test capace di fallire prima del fix.
  const db = new Database(path.join(temporary, "jobs.db"));
  // In WAL come il DB vero: `getDb` apre in sola lettura e la pragma WAL su un
  // file in journal `delete` sarebbe una scrittura → errore che non c'entra.
  db.pragma("journal_mode = WAL");
  db.exec("CREATE TABLE positions (id INTEGER PRIMARY KEY, title TEXT)");
  db.exec("INSERT INTO positions (id, title) VALUES (1, 'stantia')");
  db.close();
});

afterEach(() => {
  if (ORIGINAL_DEPLOY === undefined) delete process.env.NEXT_PUBLIC_JHT_DEPLOY;
  else process.env.NEXT_PUBLIC_JHT_DEPLOY = ORIGINAL_DEPLOY;
});

afterAll(() => {
  if (ORIGINAL_HOME === undefined) delete process.env.JHT_HOME;
  else process.env.JHT_HOME = ORIGINAL_HOME;
  rmSync(temporary, { recursive: true, force: true });
});

describe("la corsia local-token non esiste su un deploy cloud", () => {
  it("in locale il token autentica header e cookie", async () => {
    process.env.NEXT_PUBLIC_JHT_DEPLOY = "local";
    const mod = await freshLocalToken();
    expect(mod.getOrCreateLocalToken()).toBe(TOKEN);
    expect(mod.isLocalTokenAuthenticated(`Bearer ${TOKEN}`, null)).toBe(true);
    expect(mod.isLocalTokenAuthenticated(null, TOKEN)).toBe(true);
  });

  it("su cloud lo stesso token non apre nulla", async () => {
    process.env.NEXT_PUBLIC_JHT_DEPLOY = "cloud";
    const mod = await freshLocalToken();
    // Il file c'e' davvero: e' l'ipotesi che il vecchio commento faceva sulla
    // home read-only, e che qui verifichiamo invece di darla per buona.
    expect(readFileSync(path.join(temporary, ".local-token"), "utf8")).toBe(
      TOKEN,
    );
    expect(mod.getOrCreateLocalToken()).toBeNull();
    expect(mod.isLocalTokenAuthenticated(`Bearer ${TOKEN}`, null)).toBe(false);
    expect(mod.isLocalTokenAuthenticated(null, TOKEN)).toBe(false);
  });

  it("la cache in RAM non sopravvive al passaggio a cloud", async () => {
    process.env.NEXT_PUBLIC_JHT_DEPLOY = "local";
    const mod = await freshLocalToken();
    expect(mod.getOrCreateLocalToken()).toBe(TOKEN);
    process.env.NEXT_PUBLIC_JHT_DEPLOY = "cloud";
    expect(mod.getOrCreateLocalToken()).toBeNull();
    expect(mod.isLocalTokenAuthenticated(`Bearer ${TOKEN}`, null)).toBe(false);
  });
});

describe("getDb non apre SQLite su un deploy cloud", () => {
  it("in locale apre il file e legge", async () => {
    process.env.NEXT_PUBLIC_JHT_DEPLOY = "local";
    const mod = await freshDb();
    const row = mod
      .getDb()
      .prepare("SELECT title FROM positions WHERE id = 1")
      .get() as { title: string };
    expect(row.title).toBe("stantia");
  });

  it("su cloud fallisce forte invece di servire il file trovato", async () => {
    process.env.NEXT_PUBLIC_JHT_DEPLOY = "cloud";
    const mod = await freshDb();
    expect(() => mod.getDb()).toThrow(/deploy cloud/i);
  });
});
