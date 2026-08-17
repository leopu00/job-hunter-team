/**
 * Parità fra le due implementazioni del local-token — [JHT-TEAM-API-BOUNDARY].
 *
 * La credenziale dell'API del team è un FILE su disco, e da questa fase lo
 * leggono due programmi scritti in due linguaggi: `web/lib/local-token.ts`
 * (TypeScript, dentro Next) e `shared/auth/local-token.js` (ESM puro, dentro
 * il container, dove `web/` non è nemmeno installato — `Dockerfile:132`). Il
 * secondo esiste perché il primo non è importabile là; non perché qualcuno
 * volesse due regole.
 *
 * Il guasto che questo test previene non è un crash: è che i due leggano lo
 * STESSO file e ne diano verdetti DIVERSI. Un `Authorization` con l'hex in
 * maiuscolo accettato da un lato e rifiutato dall'altro, un file con il
 * newline in coda che vale per uno e non per l'altro: sono differenze che non
 * si vedono in nessuna revisione e che arrivano all'utente come un 401 che
 * «capita a volte». Per questo la parità qui è MISURATA su una tabella di
 * vettori, non affidata a un commento in testa ai due file — e per questo la
 * tabella porta anche la colonna del verdetto ATTESO: due moduli d'accordo
 * sulla risposta sbagliata sarebbero un test verde.
 *
 * ⚠️ Nota di metodo: ogni vettore usa DUE directory gemelle, una per modulo,
 * seminate con lo stesso contenuto. Non è pedanteria — nei vettori «file
 * assente» e «file con spazzatura» entrambi i moduli CREANO il token, quindi
 * una directory condivisa farebbe leggere al secondo il token appena scritto
 * dal primo, e il risultato dipenderebbe dall'ordine in cui il test chiama i
 * due lati. Un fixture che dipende dall'ordine è un fixture che mente.
 *
 * Il resto del file inchioda le tre proprietà che il gemello nel web non ha e
 * che l'API richiede: il guard cloud PRIMA della cache e rivalutato a ogni
 * chiamata, `read()` che non crea mai niente, e `authenticate(req)` con UN
 * SOLO parametro (la corsia riservata al browser del desktop nativo resta di
 * là — se un giorno si accende qui, deve comparire un parametro nuovo, cioè
 * una riga che qualcuno rivede).
 */
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createLocalTokenAuth } from "../../../shared/auth/local-token.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");

const TOKEN_FILE = ".local-token";
/** Un token ben formato: 64 caratteri hex, come li scrive il prodotto. */
const TOKEN = "a".repeat(63) + "b";
/** Un secondo token ben formato ma DIVERSO: la forma non è l'identità. */
const OTHER_TOKEN = "b".repeat(64);

const BASE = mkdtempSync(path.join(tmpdir(), "jht-api-token-"));
const ORIGINAL_HOME = process.env.JHT_HOME;
const ORIGINAL_DEPLOY = process.env.NEXT_PUBLIC_JHT_DEPLOY;
const ORIGINAL_VERCEL = process.env.VERCEL;

/** Una directory nuova, con il file del token seminato (o assente). */
function seed(label: string, contents: string | null): string {
  const home = mkdtempSync(path.join(BASE, `${label}-`));
  if (contents !== null)
    writeFileSync(path.join(home, TOKEN_FILE), contents, "utf8");
  return home;
}

/**
 * Il modulo del web, ricaricato: `JHT_HOME` la legge all'import e la cache
 * del token vive nel modulo, quindi senza `resetModules` ogni vettore
 * erediterebbe lo stato del precedente.
 */
async function freshWebModule(jhtHome: string) {
  process.env.JHT_HOME = jhtHome;
  process.env.NEXT_PUBLIC_JHT_DEPLOY = "local";
  vi.resetModules();
  return import("@/lib/local-token");
}

function restoreEnv() {
  if (ORIGINAL_HOME === undefined) delete process.env.JHT_HOME;
  else process.env.JHT_HOME = ORIGINAL_HOME;
  if (ORIGINAL_DEPLOY === undefined) delete process.env.NEXT_PUBLIC_JHT_DEPLOY;
  else process.env.NEXT_PUBLIC_JHT_DEPLOY = ORIGINAL_DEPLOY;
  if (ORIGINAL_VERCEL === undefined) delete process.env.VERCEL;
  else process.env.VERCEL = ORIGINAL_VERCEL;
}

afterEach(restoreEnv);

afterAll(() => {
  restoreEnv();
  rmSync(BASE, { recursive: true, force: true });
});

// ── La tabella di vettori ─────────────────────────────────────────────────

interface Vector {
  name: string;
  /** Contenuto del file `.local-token`, oppure `null` se il file non c'è. */
  file: string | null;
  /** Valore dell'header `Authorization`, oppure `null` se assente. */
  header: string | null;
  /** Il verdetto che i DUE moduli devono dare. */
  authenticated: boolean;
  /** Il token estratto dall'header dai DUE moduli. */
  extracted: string | null;
}

const VECTORS: Vector[] = [
  {
    name: "header e file combaciano",
    file: TOKEN,
    header: `Bearer ${TOKEN}`,
    authenticated: true,
    extracted: TOKEN,
  },
  {
    name: "63 hex: un carattere in meno non è un token",
    file: TOKEN,
    header: `Bearer ${TOKEN.slice(0, 63)}`,
    authenticated: false,
    extracted: null,
  },
  {
    name: "65 hex: la regex è ancorata, la coda in più non si ignora",
    file: TOKEN,
    header: `Bearer ${TOKEN}f`,
    authenticated: false,
    extracted: null,
  },
  {
    name: "hex maiuscolo nell'header: accettato e normalizzato",
    file: TOKEN,
    header: `Bearer ${TOKEN.toUpperCase()}`,
    authenticated: true,
    extracted: TOKEN,
  },
  {
    name: "hex maiuscolo nel FILE: accettato e normalizzato",
    file: TOKEN.toUpperCase(),
    header: `Bearer ${TOKEN}`,
    authenticated: true,
    extracted: TOKEN,
  },
  {
    name: "'bearer' minuscolo: lo schema è case-insensitive per RFC",
    file: TOKEN,
    header: `bearer ${TOKEN}`,
    authenticated: true,
    extracted: TOKEN,
  },
  {
    name: "spazio in testa: nessun trim, l'ancora vince",
    file: TOKEN,
    header: ` Bearer ${TOKEN}`,
    authenticated: false,
    extracted: null,
  },
  {
    name: "spazio in coda: nessun trim, l'ancora vince",
    file: TOKEN,
    header: `Bearer ${TOKEN} `,
    authenticated: false,
    extracted: null,
  },
  {
    name: "schema Basic con il token giusto dentro",
    file: TOKEN,
    header: `Basic ${TOKEN}`,
    authenticated: false,
    extracted: null,
  },
  {
    name: "header vuoto",
    file: TOKEN,
    header: "",
    authenticated: false,
    extracted: null,
  },
  {
    name: "header assente (null)",
    file: TOKEN,
    header: null,
    authenticated: false,
    extracted: null,
  },
  {
    // Node unisce con virgola gli header duplicati: è la forma in cui una
    // richiesta con due `Authorization` arriva davvero al handler, e deve
    // essere un rifiuto — mai «prendo il primo».
    name: "due Bearer validi uniti dalla virgola",
    file: TOKEN,
    header: `Bearer ${TOKEN}, Bearer ${TOKEN}`,
    authenticated: false,
    extracted: null,
  },
  {
    name: "file assente: nasce un token nuovo, quello presentato non vale",
    file: null,
    header: `Bearer ${TOKEN}`,
    authenticated: false,
    extracted: TOKEN,
  },
  {
    name: "file con spazzatura: viene rigenerato, non riusato",
    file: "not-a-token\n",
    header: `Bearer ${TOKEN}`,
    authenticated: false,
    extracted: TOKEN,
  },
  {
    name: "file con newline in coda: il trim lo salva",
    file: `${TOKEN}\n`,
    header: `Bearer ${TOKEN}`,
    authenticated: true,
    extracted: TOKEN,
  },
  {
    name: "un altro token ben formato: la forma non è l'identità",
    file: OTHER_TOKEN,
    header: `Bearer ${TOKEN}`,
    authenticated: false,
    extracted: TOKEN,
  },
];

describe("local-token: shared/auth e web/lib danno gli stessi verdetti", () => {
  for (const vector of VECTORS) {
    it(
      vector.name,
      async () => {
        const mineHome = seed("mine", vector.file);
        const webHome = seed("web", vector.file);

        const mine = createLocalTokenAuth({
          jhtHome: mineHome,
          isCloudDeploy: () => false,
        });
        const web = await freshWebModule(webHome);

        const mineVerdict = mine.authenticateHeader(vector.header);
        const webVerdict = web.isLocalTokenAuthenticated(vector.header, null);

        expect(
          mineVerdict,
          `shared/auth/local-token.js authenticateHeader() diverge dal verdetto atteso su «${vector.name}»: allinea shared/auth/local-token.js oppure aggiorna questa riga della tabella`,
        ).toBe(vector.authenticated);
        expect(
          webVerdict,
          `web/lib/local-token.ts isLocalTokenAuthenticated() diverge dal verdetto atteso su «${vector.name}»: se il cambiamento è voluto, va replicato in shared/auth/local-token.js nella stessa PR`,
        ).toBe(vector.authenticated);
        expect(
          mineVerdict,
          `i due moduli si sono separati su «${vector.name}»: lo stesso file su disco autentica in un programma e non nell'altro — riallinea shared/auth/local-token.js e web/lib/local-token.ts`,
        ).toBe(webVerdict);

        expect(
          mine.extractBearer(vector.header),
          `shared/auth/local-token.js extractBearer() estrae un valore diverso da quello atteso su «${vector.name}»`,
        ).toBe(vector.extracted);
        expect(
          web.extractBearerToken(vector.header),
          `web/lib/local-token.ts extractBearerToken() estrae un valore diverso da quello atteso su «${vector.name}»`,
        ).toBe(vector.extracted);
        expect(
          mine.extractBearer(vector.header),
          `estrazione divergente su «${vector.name}»: la regex ancorata dei due file non è più la stessa`,
        ).toBe(web.extractBearerToken(vector.header));
      },
      15_000,
    );
  }

  it(
    "lo scanner della tabella sa fallire: un token sbagliato non passa",
    async () => {
      // Senza questo controllo una `authenticateHeader` che tornasse sempre
      // `true` renderebbe verdi tutti i vettori positivi e i negativi
      // sarebbero l'unica rete: qui la rete si misura da sola.
      const home = seed("negative", TOKEN);
      const mine = createLocalTokenAuth({
        jhtHome: home,
        isCloudDeploy: () => false,
      });
      expect(
        mine.authenticateHeader(`Bearer ${OTHER_TOKEN}`),
        "shared/auth/local-token.js accetta un token che non è quello del box: il confronto è rotto",
      ).toBe(false);
      expect(
        mine.authenticateHeader(`Bearer ${TOKEN}`),
        "shared/auth/local-token.js rifiuta il token del box: il confronto è rotto nell'altro senso",
      ).toBe(true);
    },
    15_000,
  );
});

// ── Il guard cloud: prima della cache, e rivalutato ogni volta ─────────────

describe("il guard cloud sta PRIMA della cache in RAM", () => {
  it(
    "shared/auth: un token già in cache non viene servito a un deploy cloud",
    () => {
      const home = seed("cloud-mine", TOKEN);
      let cloud = false;
      const mine = createLocalTokenAuth({
        jhtHome: home,
        isCloudDeploy: () => cloud,
      });

      expect(
        mine.getOrCreate(),
        "shared/auth/local-token.js non legge il token dal file seminato in JHT_HOME",
      ).toBe(TOKEN);

      cloud = true;
      expect(
        mine.getOrCreate(),
        "shared/auth/local-token.js serve un token in cache su deploy cloud: sposta il guard isCloudDeploy() PRIMA del ritorno dalla cache (mirror di web/lib/local-token.ts:81-84)",
      ).toBeNull();
      expect(
        mine.authenticateHeader(`Bearer ${TOKEN}`),
        "shared/auth/local-token.js autentica su deploy cloud: authenticateHeader deve fallire quando getOrCreate() è null",
      ).toBe(false);
      expect(
        mine.read(),
        "shared/auth/local-token.js read() legge il token su deploy cloud: applica lo stesso guard",
      ).toBeNull();

      // Rivalutato, non memorizzato: il predicato è una funzione proprio per
      // questo. Se venisse letto una volta sola, tornare «locali» non
      // riaprirebbe la corsia e il guasto sarebbe invisibile.
      cloud = false;
      expect(
        mine.getOrCreate(),
        "shared/auth/local-token.js ha congelato il verdetto cloud: isCloudDeploy() va invocato a ogni getOrCreate()",
      ).toBe(TOKEN);
    },
  );

  it(
    "web/lib: stessa proprietà, misurata sullo stesso vettore",
    async () => {
      const home = seed("cloud-web", TOKEN);
      const web = await freshWebModule(home);
      expect(web.getOrCreateLocalToken()).toBe(TOKEN);
      process.env.NEXT_PUBLIC_JHT_DEPLOY = "cloud";
      expect(
        web.getOrCreateLocalToken(),
        "web/lib/local-token.ts ha perso il guard cloud prima della cache: era pinnato da tests/js/tasks/local-first-db-path-census.test.ts:209-216",
      ).toBeNull();
      expect(web.isLocalTokenAuthenticated(`Bearer ${TOKEN}`, null)).toBe(false);
    },
    15_000,
  );

  it("un predicato cloud che non è una funzione non si può iniettare", () => {
    // Un booleano verrebbe letto come `truthy` una volta e mai più
    // rivalutato: è il guasto che l'iniezione serve a rendere impossibile,
    // quindi va rifiutato alla costruzione e non tollerato.
    const home = seed("bad-predicate", TOKEN);
    expect(
      () =>
        createLocalTokenAuth({
          jhtHome: home,
          // @ts-expect-error — è precisamente l'uso che deve esplodere
          isCloudDeploy: false,
        }),
      "shared/auth/local-token.js accetta un isCloudDeploy non-callable: il guard non sarebbe più rivalutato per chiamata",
    ).toThrow(/function/i);
    expect(
      () => createLocalTokenAuth({ jhtHome: "", isCloudDeploy: () => false }),
      "shared/auth/local-token.js accetta una jhtHome vuota: il file del token finirebbe accanto alla cwd del processo",
    ).toThrow(/jhtHome/);
  });
});

// ── Le proprietà che il gemello nel web non ha ────────────────────────────

describe("read() legge e non crea mai — è la funzione dei client", () => {
  it("su una home vuota torna null e NON lascia niente sul disco", () => {
    const home = seed("read-only", null);
    const mine = createLocalTokenAuth({
      jhtHome: home,
      isCloudDeploy: () => false,
    });

    expect(
      mine.read(),
      "shared/auth/local-token.js read() non torna null quando il file non c'è",
    ).toBeNull();
    expect(
      existsSync(path.join(home, TOKEN_FILE)),
      "shared/auth/local-token.js read() ha CREATO il file: un client che crea il token trasforma «il server non è ancora partito» in un 401 — read() non deve mai scrivere",
    ).toBe(false);
  });

  it("getOrCreate() invece lo crea, in 64 hex minuscoli", () => {
    const home = seed("create", null);
    const mine = createLocalTokenAuth({
      jhtHome: home,
      isCloudDeploy: () => false,
    });

    const created = mine.getOrCreate();
    expect(
      created,
      "shared/auth/local-token.js getOrCreate() non ha generato un token su una home vuota",
    ).toMatch(/^[a-f0-9]{64}$/);
    expect(
      mine.tokenPath,
      "shared/auth/local-token.js tokenPath non punta a <jhtHome>/.local-token",
    ).toBe(path.join(home, TOKEN_FILE));
    expect(
      readFileSync(mine.tokenPath, "utf8"),
      "shared/auth/local-token.js scrive sul disco un valore diverso da quello che ritorna",
    ).toBe(created);
    expect(
      mine.read(),
      "shared/auth/local-token.js read() non rilegge dal disco il token appena creato",
    ).toBe(created);
    expect(
      mine.authenticateHeader(`Bearer ${created}`),
      "shared/auth/local-token.js non autentica il token che ha appena generato",
    ).toBe(true);
  });

  it("i permessi richiesti sono 0600 nel file e 0700 nella directory", () => {
    // L'asserzione sta sul SORGENTE perché a runtime non è verificabile su
    // ogni host: attraverso il bind mount di Docker Desktop su Windows i file
    // di `C:\Users\<utente>\.jht\` si leggono `-rw-r--r--`, quindi la modalità
    // è una RICHIESTA, non una garanzia (lo dice il modello di minaccia). Il
    // controllo runtime qui sotto gira solo dove la modalità significa
    // qualcosa.
    const source = readFileSync(
      path.join(ROOT, "shared/auth/local-token.js"),
      "utf8",
    );
    expect(
      source,
      "shared/auth/local-token.js non chiede più 0o600 sul file del token",
    ).toContain("0o600");
    expect(
      source,
      "shared/auth/local-token.js non chiede più 0o700 sulla directory JHT_HOME",
    ).toContain("0o700");

    if (process.platform === "win32") return;
    const home = seed("modes", null);
    const mine = createLocalTokenAuth({
      jhtHome: home,
      isCloudDeploy: () => false,
    });
    mine.getOrCreate();
    expect(
      statSync(mine.tokenPath).mode & 0o777,
      "shared/auth/local-token.js crea il file del token con permessi più larghi di 0600",
    ).toBe(0o600);
  });

  it("matches() confronta i 32 byte, non le stringhe", () => {
    const home = seed("matches", TOKEN);
    const mine = createLocalTokenAuth({
      jhtHome: home,
      isCloudDeploy: () => false,
    });
    const cases: Array<[unknown, unknown, boolean]> = [
      [TOKEN, TOKEN, true],
      [TOKEN.toUpperCase(), TOKEN, true],
      [TOKEN, OTHER_TOKEN, false],
      [TOKEN.slice(0, 63), TOKEN, false],
      ["z".repeat(64), TOKEN, false],
      [null, TOKEN, false],
      [TOKEN, null, false],
      ["", "", false],
    ];
    for (const [candidate, expected, verdict] of cases) {
      expect(
        mine.matches(candidate, expected),
        `shared/auth/local-token.js matches(${JSON.stringify(candidate)}, …) non vale più ${verdict}`,
      ).toBe(verdict);
    }
  });
});

// ── Il montaggio nel CLI: una sola funzione guarda una richiesta ───────────

describe("cli/src/lib/api/auth.js — authenticate(req) e nient'altro", () => {
  async function freshCliAuth(jhtHome: string) {
    process.env.JHT_HOME = jhtHome;
    process.env.NEXT_PUBLIC_JHT_DEPLOY = "local";
    vi.resetModules();
    return import("../../../cli/src/lib/api/auth.js");
  }

  it(
    "autentica l'header del box e rifiuta tutto il resto",
    async () => {
      const home = seed("cli", TOKEN);
      const auth = await freshCliAuth(home);

      expect(
        auth.read(),
        "cli/src/lib/api/auth.js read() non trova il token in JHT_HOME: controlla l'import di shared/paths.js",
      ).toBe(TOKEN);
      expect(auth.getOrCreate()).toBe(TOKEN);
      expect(
        auth.tokenPath,
        "cli/src/lib/api/auth.js tokenPath non punta a <JHT_HOME>/.local-token",
      ).toBe(path.join(home, TOKEN_FILE));

      expect(
        auth.authenticate({ headers: { authorization: `Bearer ${TOKEN}` } }),
        "cli/src/lib/api/auth.js authenticate() rifiuta il token del box",
      ).toBe(true);
      expect(
        auth.authenticate({ headers: { Authorization: `Bearer ${TOKEN}` } }),
        "cli/src/lib/api/auth.js authenticate() non tollera un header con la maiuscola: il contratto del handler dice minuscolo, ma la tolleranza non allarga niente e la sua assenza si paga in 401 inspiegabili",
      ).toBe(true);
      expect(
        auth.authenticate({ headers: { authorization: `Bearer ${OTHER_TOKEN}` } }),
        "cli/src/lib/api/auth.js authenticate() accetta un token ben formato che non è quello del box",
      ).toBe(false);
      expect(
        auth.authenticate({
          headers: { authorization: [`Bearer ${TOKEN}`, `Bearer ${TOKEN}`] },
        }),
        "cli/src/lib/api/auth.js authenticate() accetta un header duplicato: va unito con la virgola e rifiutato, non risolto prendendo il primo",
      ).toBe(false);
      expect(
        auth.authenticate({ headers: {} }),
        "cli/src/lib/api/auth.js authenticate() autentica una richiesta senza Authorization",
      ).toBe(false);
      expect(
        auth.authenticate({}),
        "cli/src/lib/api/auth.js authenticate() lancia o autentica su una richiesta senza headers",
      ).toBe(false);
      expect(
        auth.authenticate(undefined as never),
        "cli/src/lib/api/auth.js authenticate() non regge un argomento assente: deve rifiutare, non lanciare",
      ).toBe(false);
    },
    15_000,
  );

  it(
    "authenticate() ha UN SOLO parametro, e questa è la sua garanzia",
    async () => {
      const home = seed("arity", TOKEN);
      const auth = await freshCliAuth(home);
      expect(
        auth.authenticate.length,
        "cli/src/lib/api/auth.js authenticate() ha cambiato arità: la corsia riservata al browser del desktop nativo si accende aggiungendo un parametro NUOVO — se è quello che stai facendo, aggiorna la nota in web/lib/local-token.ts:10-23, questo test e tests/js/tasks/api-invariants-guard.test.ts",
      ).toBe(1);
    },
    15_000,
  );

  it(
    "su un ambiente cloud non autentica nessuno",
    async () => {
      const home = seed("cli-cloud", TOKEN);
      const auth = await freshCliAuth(home);
      process.env.NEXT_PUBLIC_JHT_DEPLOY = "cloud";
      expect(
        auth.authenticate({ headers: { authorization: `Bearer ${TOKEN}` } }),
        "cli/src/lib/api/auth.js autentica con NEXT_PUBLIC_JHT_DEPLOY=cloud: il predicato non viene più rivalutato per chiamata",
      ).toBe(false);
      expect(
        auth.getOrCreate(),
        "cli/src/lib/api/auth.js getOrCreate() torna un token su un ambiente cloud: il server deve rifiutare di partire, non legarsi alla porta e rispondere 401 per sempre",
      ).toBeNull();
    },
    15_000,
  );
});

// ── Il predicato cloud: stesse regole dell'originale nel web ───────────────

describe("isCloudDeployFromEnv specchia web/lib/deploy-mode.ts", () => {
  const ENV_CASES: Array<{
    name: string;
    env: Record<string, string | undefined>;
    cloud: boolean;
  }> = [
    { name: "ambiente vuoto → locale (è il caso del container)", env: {}, cloud: false },
    { name: "flag esplicito cloud", env: { NEXT_PUBLIC_JHT_DEPLOY: "cloud" }, cloud: true },
    { name: "flag esplicito local", env: { NEXT_PUBLIC_JHT_DEPLOY: "local" }, cloud: false },
    { name: "flag con spazi e maiuscole", env: { NEXT_PUBLIC_JHT_DEPLOY: "  CLOUD  " }, cloud: true },
    { name: "flag sconosciuto → si ignora", env: { NEXT_PUBLIC_JHT_DEPLOY: "weird" }, cloud: false },
    { name: "solo VERCEL presente", env: { VERCEL: "1" }, cloud: true },
    { name: "VERCEL vuoto non conta", env: { VERCEL: "" }, cloud: false },
    {
      name: "il flag esplicito vince su VERCEL",
      env: { NEXT_PUBLIC_JHT_DEPLOY: "local", VERCEL: "1" },
      cloud: false,
    },
    {
      name: "flag vuoto: decide VERCEL",
      env: { NEXT_PUBLIC_JHT_DEPLOY: "", VERCEL: "1" },
      cloud: true,
    },
  ];

  for (const testCase of ENV_CASES) {
    it(
      testCase.name,
      async () => {
        const home = seed("deploy", TOKEN);
        process.env.JHT_HOME = home;
        delete process.env.NEXT_PUBLIC_JHT_DEPLOY;
        delete process.env.VERCEL;
        for (const [key, value] of Object.entries(testCase.env)) {
          if (value === undefined) delete process.env[key];
          else process.env[key] = value;
        }

        vi.resetModules();
        const mine = await import("../../../cli/src/lib/api/auth.js");
        const web = await import("@/lib/deploy-mode");

        expect(
          mine.isCloudDeployFromEnv(process.env),
          `cli/src/lib/api/auth.js isCloudDeployFromEnv() sbaglia su «${testCase.name}»`,
        ).toBe(testCase.cloud);
        expect(
          web.isCloudDeploy(),
          `web/lib/deploy-mode.ts isCloudDeploy() sbaglia su «${testCase.name}»: se la regola è cambiata là, va replicata in cli/src/lib/api/auth.js`,
        ).toBe(testCase.cloud);
        expect(
          mine.isCloudDeployFromEnv(process.env),
          `i due predicati si sono separati su «${testCase.name}»: il server dell'API e il web deciderebbero in modo diverso se il box esiste`,
        ).toBe(web.isCloudDeploy());
      },
      15_000,
    );
  }
});

// ── Le tre righe che non devono esistere nei file nuovi ───────────────────

describe("nei file nuovi non esiste una seconda via d'accesso", () => {
  const SCANNED_DIRS = ["shared/auth", "cli/src/lib/api"];

  function jsFiles(dir: string): string[] {
    const out: string[] = [];
    const full = path.join(ROOT, dir);
    if (!existsSync(full)) return out;
    for (const entry of readdirSync(full, { withFileTypes: true })) {
      if (entry.name === "node_modules") continue;
      const child = path.join(dir, entry.name);
      if (entry.isDirectory()) out.push(...jsFiles(child));
      else if (/\.m?js$/.test(entry.name)) out.push(child);
    }
    return out;
  }

  const files = SCANNED_DIRS.flatMap(jsFiles);

  it("lo scanner vede i file che sappiamo esserci", () => {
    // Uno scanner che non trova niente rende verde qualunque cosa venga dopo.
    expect(
      files,
      "lo scanner non trova più i file dell'API: controlla i percorsi in SCANNED_DIRS",
    ).toContain(path.join("shared", "auth", "local-token.js"));
    expect(files).toContain(path.join("cli", "src", "lib", "api", "auth.js"));
  });

  it("nessuno nomina il token della corsia browser, la legge o la scrive", () => {
    // Le tre forme in cui la corsia riservata al browser potrebbe rientrare di
    // soppiatto. Il divieto largo (la parola, in qualunque contesto, sotto le
    // quattro directory nuove) sta in tests/js/tasks/api-invariants-guard.test.ts,
    // che è il posto dove vivono i guard trasversali: qui si misurano le tre
    // forme che hanno un effetto.
    const patterns: Array<[RegExp, string]> = [
      [/jht_local_token/, "nomina il token della corsia browser"],
      [
        /headers\s*(?:\.\s*cookie|\[\s*["'`]cookie)/i,
        "legge l'header della corsia browser dalla richiesta",
      ],
      [/set-cookie/i, "scrive l'header di risposta della corsia browser"],
    ];
    const offenders: string[] = [];
    for (const relative of files) {
      const source = readFileSync(path.join(ROOT, relative), "utf8");
      for (const [pattern, why] of patterns)
        if (pattern.test(source)) offenders.push(`${relative}: ${why}`);
    }
    expect(
      offenders,
      "un file dell'API ha aperto la corsia riservata al browser del desktop nativo: ADR-0009 decisione 3 la tiene INERTE, e accenderla è un lavoro con quattro obblighi (web/lib/local-token.ts:10-23, web/lib/auth.ts:134-138, docs/security/05-checklist.md:45, docs/security/03-implementation-tradeoffs.md:51-52) più un parametro nuovo in authenticate()",
    ).toEqual([]);
  });

  it("lo scanner sa riconoscere le tre forme, se ci fossero", () => {
    const fake = [
      'const t = cookies.get("jht_local_token")',
      "const raw = req.headers.cookie",
      'res.setHeader("Set-Cookie", value)',
    ];
    const patterns = [
      /jht_local_token/,
      /headers\s*(?:\.\s*cookie|\[\s*["'`]cookie)/i,
      /set-cookie/i,
    ];
    for (let i = 0; i < fake.length; i += 1)
      expect(
        patterns[i].test(fake[i]),
        `il pattern ${i} non riconosce più la forma che deve vietare: senza questo controllo il divieto sarebbe verde per sempre`,
      ).toBe(true);
  });
});
