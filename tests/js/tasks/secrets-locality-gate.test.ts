/**
 * #158 — i secrets si leggono solo dalla macchina che li ospita.
 *
 * `GET /api/secrets` e `POST /api/secrets/reveal` (che restituisce il valore
 * IN CHIARO) avevano il solo `requireAuth`, che accerta CHI SEI e mai che la
 * macchina sia la tua: qualunque sessione Supabase valida arrivava in fondo.
 * A difenderle era la TOPOLOGIA — su cloud `~/.jht/secrets.json` non esiste e
 * il container non serve più la dashboard — non il codice. La topologia
 * cambia con un deploy; il codice resta, e questi test con lui.
 *
 * I casi cloud sono RUNTIME: eseguono davvero gli handler, con un
 * `secrets.json` vero su disco e una sessione Supabase valida mockata. Il
 * valore in chiaro è la cosa che non deve uscire, quindi ogni caso lo cerca
 * nella risposta INTERA invece di fidarsi dello status code.
 *
 * Il resto è coperto ai due capi — la decisione pura (`secretsAreReadable`,
 * quattro combinazioni) e l'ordine dei guard nelle route — perché il ramo che
 * legge davvero gli header non è eseguibile qui: vedi la nota sul residuo,
 * dichiarata come fa `auth-guards.test.ts` per lo stesso motivo.
 */
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const SECRET_VALUE = "ssh-ed25519-AAAA-valore-che-non-deve-uscire";

const state = vi.hoisted(() => ({
  home: "",
  requestHeaders: {} as Record<string, string>,
}));

vi.mock("@/lib/jht-paths", () => ({
  get JHT_HOME() {
    return state.home;
  },
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(state.requestHeaders),
  cookies: async () => ({ get: () => undefined }),
}));

// Supabase configurato e sessione VALIDA in ogni caso: è il punto del ticket.
// Se il gate di località non c'è, questo utente legge i segreti di un altro.
vi.mock("@/lib/workspace", () => ({ isSupabaseConfigured: true }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: "utente-loggato" } } }),
    },
  }),
}));

const temporary = mkdtempSync(path.join(tmpdir(), "jht-158-"));
const ORIGINAL_DEPLOY = process.env.NEXT_PUBLIC_JHT_DEPLOY;

const LOCAL_HEADERS = { host: "localhost:3001" };
/** Come arriva una richiesta al deploy pubblico, attraverso il proxy. */
const REMOTE_HEADERS = {
  host: "jobhunterteam.ai",
  "x-forwarded-for": "203.0.113.7",
  "x-forwarded-host": "jobhunterteam.ai",
};

async function listSecrets() {
  vi.resetModules();
  const mod = await import("@/app/api/secrets/route");
  return mod.GET();
}

async function revealSecret(id: string) {
  vi.resetModules();
  const mod = await import("@/app/api/secrets/reveal/route");
  return mod.POST(
    new Request("http://localhost/api/secrets/reveal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, confirm: true }),
    }) as never,
  );
}

beforeAll(() => {
  state.home = temporary;
  writeFileSync(
    path.join(temporary, "secrets.json"),
    JSON.stringify({
      version: 1,
      secrets: [
        {
          id: "secret-1",
          name: "hetzner",
          type: "token",
          value: SECRET_VALUE,
          createdAt: 1_760_000_000_000,
        },
      ],
    }),
    "utf-8",
  );
});

beforeEach(() => {
  state.requestHeaders = { ...LOCAL_HEADERS };
});

afterEach(() => {
  if (ORIGINAL_DEPLOY === undefined) delete process.env.NEXT_PUBLIC_JHT_DEPLOY;
  else process.env.NEXT_PUBLIC_JHT_DEPLOY = ORIGINAL_DEPLOY;
});

afterAll(() => rmSync(temporary, { recursive: true, force: true }));

describe("la decisione, enumerata", () => {
  it("si legge SOLO da una richiesta locale su un deploy non-cloud", async () => {
    const { secretsAreReadable } = await import("@/lib/auth");
    expect(secretsAreReadable(true, false)).toBe(true);
    // Il caso che la topologia da sola non copre: un deploy cloud raggiunto
    // su localhost (dev server, tunnel, port-forward).
    expect(secretsAreReadable(true, true)).toBe(false);
    // E il simmetrico: il box esposto in rete resta il box, ma chi bussa da
    // fuori non e' l'utente davanti alla macchina.
    expect(secretsAreReadable(false, false)).toBe(false);
    expect(secretsAreReadable(false, true)).toBe(false);
  });
});

describe("da fuori il box non si legge nulla, comunque si arrivi", () => {
  // Solo i casi CLOUD girano end-to-end: `isLocalRequest()` chiama l'`headers()`
  // di Next, che fuori da uno scope di richiesta esplode, e il mock di
  // `next/headers` non raggiunge `web/lib/auth.ts` (tests/js e web/ risolvono
  // due copie diverse del pacchetto). Residuo dichiarato, come in
  // `auth-guards.test.ts`: il ramo "deploy local + richiesta remota" e' coperto
  // sopra da `secretsAreReadable` e, per il verdetto sugli header, dai casi di
  // `isLocalRequestFromHeaders` in quel file.
  const CASES: Array<
    [nome: string, deploy: string, hdrs: typeof LOCAL_HEADERS]
  > = [
    ["deploy cloud, richiesta dal dominio", "cloud", REMOTE_HEADERS],
    ["deploy cloud, richiesta su localhost", "cloud", LOCAL_HEADERS],
  ];

  for (const [nome, deploy, hdrs] of CASES) {
    it(`${nome}: la lista è 403 e non nomina i secrets`, async () => {
      process.env.NEXT_PUBLIC_JHT_DEPLOY = deploy;
      state.requestHeaders = { ...hdrs };
      const response = await listSecrets();
      expect(response.status).toBe(403);
      const raw = JSON.stringify(await response.json());
      expect(raw).toContain("local_only");
      expect(raw).not.toContain(SECRET_VALUE);
      expect(raw).not.toContain("hetzner");
    });

    it(`${nome}: il reveal è 403 e non restituisce il valore`, async () => {
      process.env.NEXT_PUBLIC_JHT_DEPLOY = deploy;
      state.requestHeaders = { ...hdrs };
      const response = await revealSecret("secret-1");
      expect(response.status).toBe(403);
      expect(JSON.stringify(await response.json())).not.toContain(SECRET_VALUE);
    });
  }

  it("un id inesistente e uno esistente danno la STESSA risposta", async () => {
    // Altrimenti il 403/404 diventa un oracolo: si enumerano gli id da fuori
    // senza leggerne mai il valore. Per questo la località viene prima di
    // toccare il file.
    process.env.NEXT_PUBLIC_JHT_DEPLOY = "cloud";
    state.requestHeaders = { ...REMOTE_HEADERS };
    const esistente = await revealSecret("secret-1");
    const inventato = await revealSecret("secret-che-non-esiste");
    expect(esistente.status).toBe(inventato.status);
    expect(await esistente.json()).toEqual(await inventato.json());
  });
});

describe("l'ordine dei guard, che è metà del fix", () => {
  // La località deve venire PRIMA di `requireAuth` e prima di leggere il file:
  // invertirli non cambia lo status in nessuno dei casi qui sopra — cambia chi
  // riesce a distinguere un id esistente da uno inventato, e quanto lontano
  // arriva una richiesta remota prima di essere fermata. Un test sul
  // comportamento non lo vedrebbe; questo sì.
  const ROUTES = [
    "web/app/api/secrets/route.ts",
    "web/app/api/secrets/reveal/route.ts",
  ];

  it.each(ROUTES)("%s chiama la località prima dell'identità", async (rel) => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const root = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../..",
    );
    const src = readFileSync(path.join(root, rel), "utf8");
    const locality = src.indexOf("requireLocalSecretAccess()");
    const identity = src.indexOf("requireAuth()");
    expect(locality, "il gate di località è sparito").toBeGreaterThan(-1);
    expect(identity).toBeGreaterThan(-1);
    expect(locality).toBeLessThan(identity);
  });
});
