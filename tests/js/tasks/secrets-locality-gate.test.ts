/**
 * #158 + #161 — quello che vive sul box lo legge chi è sul box, e la prova
 * non è un header.
 *
 * Storia in due passi, perché il secondo si capisce solo col primo:
 *
 *  #158 — `GET /api/secrets` e `POST /api/secrets/reveal` (che restituisce il
 *  valore IN CHIARO) avevano il solo `requireAuth`, che accerta CHI SEI e mai
 *  che la macchina sia la tua. A difenderle era la topologia di deploy, non il
 *  codice. Il primo gate guardava l'header `Host`.
 *
 *  #161 — l'header `Host` lo scrive il client. Su un deploy locale esposto in
 *  rete senza reverse proxy davanti, `curl -H "Host: localhost"` supera quel
 *  gate: curl non manda forwarded header, quindi non c'è niente da rifiutare.
 *  La prova buona è il POSSESSO DEL LOCAL-TOKEN, che è un segreto sul
 *  filesystem di quella macchina.
 *
 * Il test centrale è quindi quello che FORGIA l'header e pretende un 403: è
 * l'unico che distingue il gate di oggi da quello di ieri.
 *
 * Tutto gira end-to-end sugli handler veri, con `secrets.json` e catalogo dei
 * backup veri su disco. `requireAuth` è l'unica cosa stubbata — legge
 * `next/headers`, che fuori da uno scope di richiesta esplode — ed è stubbato
 * per dire SÌ: la sessione è sempre valida, perché il punto del ticket è
 * proprio che una sessione valida non basta.
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
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");
// `next` sta in `web/node_modules`: da qui non si risolve per specifier
// (tests/js non lo installa), quindi lo si chiede al package di web — stesso
// espediente di `team-directives-route-runtime.test.ts` con better-sqlite3.
const { NextRequest } = createRequire(path.join(ROOT, "web/package.json"))(
  "next/server",
) as typeof import("next/server");

const SECRET_VALUE = "ssh-ed25519-AAAA-valore-che-non-deve-uscire";
const TOKEN = "b".repeat(63) + "a";

const state = vi.hoisted(() => ({ home: "" }));

vi.mock("@/lib/jht-paths", () => ({
  get JHT_HOME() {
    return state.home;
  },
}));

// Sessione Supabase SEMPRE valida: è l'ipotesi peggiore, ed è il punto.
// (`requireAuth` legge `next/headers`; qui interessa solo che dica sì.)
vi.mock("@/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth")>()),
  requireAuth: async () => null,
  requireLocalWrite: async () => null,
}));

const temporary = mkdtempSync(path.join(tmpdir(), "jht-161-"));
const ORIGINAL_DEPLOY = process.env.NEXT_PUBLIC_JHT_DEPLOY;

/** Il caso del ticket: `Host` locale, nessun forwarded header da rifiutare. */
const FORGED_HOST = { host: "localhost:3001" };

function request(
  url: string,
  init: {
    method?: string;
    body?: unknown;
    headers?: Record<string, string>;
  } = {},
): NextRequest {
  return new NextRequest(url, {
    method: init.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      ...FORGED_HOST,
      ...(init.headers ?? {}),
    },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
}

/** Le credenziali di chi è davvero sul box: il token letto dal filesystem. */
const WITH_TOKEN = { authorization: `Bearer ${TOKEN}` };

// Import letterali: `vite` non sa risolvere un import dinamico costruito con
// un template, e un mapping esplicito dice anche quali superfici sono in
// gioco in questo ticket.
const ROUTE_MODULES = {
  secrets: () => import("@/app/api/secrets/route"),
  reveal: () => import("@/app/api/secrets/reveal/route"),
  credentials: () => import("@/app/api/credentials/route"),
  backup: () => import("@/app/api/backup/route"),
} as const;

async function route(name: keyof typeof ROUTE_MODULES) {
  vi.resetModules();
  return ROUTE_MODULES[name]();
}

beforeAll(() => {
  state.home = temporary;
  writeFileSync(path.join(temporary, ".local-token"), TOKEN, "utf-8");
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
  mkdirSync(path.join(temporary, "backups"), { recursive: true });
  writeFileSync(
    path.join(temporary, "backups", "catalog.json"),
    JSON.stringify([
      {
        id: "bk1",
        createdAt: 1_760_000_000_000,
        sizeBytes: 4096,
        sources: ["/Users/persona-vera/.jht/config.json"],
        compressed: true,
        archivePath: "/Users/persona-vera/.jht/backups/bk1.tar.gz",
      },
    ]),
    "utf-8",
  );
  mkdirSync(path.join(temporary, "credentials"), { recursive: true });
  writeFileSync(
    path.join(temporary, "credentials", "claude.json"),
    JSON.stringify({ type: "api_key", savedAt: 1_760_000_000_000 }),
    "utf-8",
  );
  process.env.NEXT_PUBLIC_JHT_DEPLOY = "local";
});

afterEach(() => {
  process.env.NEXT_PUBLIC_JHT_DEPLOY = "local";
});

afterAll(() => {
  if (ORIGINAL_DEPLOY === undefined) delete process.env.NEXT_PUBLIC_JHT_DEPLOY;
  else process.env.NEXT_PUBLIC_JHT_DEPLOY = ORIGINAL_DEPLOY;
  rmSync(temporary, { recursive: true, force: true });
});

// ── Il caso del ticket ─────────────────────────────────────────────────────

describe("un Host forgiato non è una prova di località", () => {
  it("la lista dei secrets è 403", async () => {
    const { GET } = await route("secrets");
    const res = await GET(request("http://localhost:3001/api/secrets"));
    expect(res.status).toBe(403);
    const raw = JSON.stringify(await res.json());
    expect(raw).toContain("local_only");
    expect(raw).not.toContain("hetzner");
  });

  it("il reveal è 403 e non restituisce il valore", async () => {
    const { POST } = await route("reveal");
    const res = await POST(
      request("http://localhost:3001/api/secrets/reveal", {
        method: "POST",
        body: { id: "secret-1", confirm: true },
      }),
    );
    expect(res.status).toBe(403);
    expect(JSON.stringify(await res.json())).not.toContain(SECRET_VALUE);
  });

  it("la cancellazione è 403: chiudere solo la lettura è una porta girevole", async () => {
    const { DELETE } = await route("secrets");
    const res = await DELETE(
      request("http://localhost:3001/api/secrets?id=secret-1", {
        method: "DELETE",
      }),
    );
    expect(res.status).toBe(403);
  });

  it("i metadati delle credenziali sono 403 (quali provider ha l'utente)", async () => {
    const { GET } = await route("credentials");
    const res = await GET(request("http://localhost:3001/api/credentials"));
    expect(res.status).toBe(403);
    expect(JSON.stringify(await res.json())).not.toContain("claude");
  });

  it("il catalogo backup è 403 (percorsi assoluti e dimensioni)", async () => {
    const { GET } = await route("backup");
    const res = await GET(request("http://localhost:3001/api/backup"));
    expect(res.status).toBe(403);
    expect(JSON.stringify(await res.json())).not.toContain("persona-vera");
  });
});

// ── Chi è davvero sul box continua a lavorare ──────────────────────────────

describe("il local-token apre, perché è un segreto di quella macchina", () => {
  it("lista e reveal rispondono", async () => {
    const { GET } = await route("secrets");
    const list = await GET(
      request("http://localhost:3001/api/secrets", { headers: WITH_TOKEN }),
    );
    expect(list.status).toBe(200);
    const body = await list.json();
    expect(body.total).toBe(1);
    expect(body.secrets[0].masked).toBe(true);
    expect(JSON.stringify(body)).not.toContain(SECRET_VALUE);

    const { POST } = await route("reveal");
    const revealed = await POST(
      request("http://localhost:3001/api/secrets/reveal", {
        method: "POST",
        headers: WITH_TOKEN,
        body: { id: "secret-1", confirm: true },
      }),
    );
    expect(revealed.status).toBe(200);
    expect(await revealed.json()).toEqual({ ok: true, value: SECRET_VALUE });
  });

  it("credenziali e backup rispondono", async () => {
    const { GET: credentials } = await route("credentials");
    const creds = await credentials(
      request("http://localhost:3001/api/credentials", { headers: WITH_TOKEN }),
    );
    expect(creds.status).toBe(200);

    const { GET: backup } = await route("backup");
    const backups = await backup(
      request("http://localhost:3001/api/backup", { headers: WITH_TOKEN }),
    );
    expect(backups.status).toBe(200);
    expect((await backups.json()).backups).toHaveLength(1);
  });

  it("un token SBAGLIATO non apre niente", async () => {
    const { GET } = await route("secrets");
    const res = await GET(
      request("http://localhost:3001/api/secrets", {
        headers: { authorization: `Bearer ${"c".repeat(64)}` },
      }),
    );
    expect(res.status).toBe(403);
  });

  it("su deploy cloud non apre nemmeno il token giusto", async () => {
    // #154: lì `getOrCreateLocalToken()` ritorna null, quindi non c'è nessun
    // valore atteso con cui confrontarsi. È il motivo per cui questo gate non
    // ha bisogno di un secondo guard su `isCloudDeploy`.
    process.env.NEXT_PUBLIC_JHT_DEPLOY = "cloud";
    const { GET } = await route("secrets");
    const res = await GET(
      request("http://localhost:3001/api/secrets", { headers: WITH_TOKEN }),
    );
    expect(res.status).toBe(403);
  });
});

// ── L'ordine dei guard ─────────────────────────────────────────────────────

describe("l'ordine dei guard, che è metà del fix", () => {
  // La località deve venire PRIMA di `requireAuth` e prima di leggere il file:
  // invertirli non cambia lo status di nessun caso qui sopra — cambia chi
  // riesce a distinguere un id esistente da uno inventato, e quanto lontano
  // arriva una richiesta remota prima di essere fermata.
  const ROUTES = [
    "web/app/api/secrets/route.ts",
    "web/app/api/secrets/reveal/route.ts",
    "web/app/api/credentials/route.ts",
    "web/app/api/backup/route.ts",
  ];

  it.each(ROUTES)("%s chiama la località prima dell'identità", async (rel) => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(path.join(ROOT, rel), "utf8");
    const locality = src.indexOf("requireLocalMachine(req)");
    const identity = src.indexOf("requireAuth()");
    expect(locality, "il gate di località è sparito").toBeGreaterThan(-1);
    expect(identity).toBeGreaterThan(-1);
    expect(locality).toBeLessThan(identity);
  });

  it("il gate non consulta più l'header Host", async () => {
    // Il difetto di #158 era esattamente questo: la decisione poggiava su
    // `isLocalRequest()`. Se qualcuno ce la riporta, il 403 sopra tornerebbe
    // verde per il motivo sbagliato.
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(path.join(ROOT, "web/lib/auth.ts"), "utf8");
    const gate = src.slice(
      src.indexOf("export function requireLocalMachine"),
      src.indexOf("function secretsUnavailableResponse"),
    );
    expect(gate).toContain("isLocalTokenAuthenticated");
    expect(gate).not.toContain("isLocalRequest");
  });
});
