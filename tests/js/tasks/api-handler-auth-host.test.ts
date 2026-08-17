/**
 * [JHT-TEAM-API-BOUNDARY] I due cancelli che stanno davanti a tutto: il Bearer
 * e il `Host`.
 *
 * Perché questo file esiste separato da quello delle rotte: qui non si misura
 * *cosa* risponde l'API, si misura *chi* riesce a farsi rispondere. Sono due
 * proprietà con due modi diversi di rompersi, e una di esse — la tolleranza
 * sulla PORTA nell'header `Host` — è il genere di cosa che un revisore
 * scambierebbe per una dimenticanza e «indurirebbe» in buona fede,
 * disattivando il port-forward su cui poggia la fase 2. C'è quindi un test
 * che lo dice a voce alta, con la frase scritta nel messaggio di rimedio.
 *
 * Nessun socket, in nessun caso: il handler è richiesta-dentro/risposta-fuori,
 * e un test che si legasse a una porta competerebbe col disco con gli altri
 * worker (`tests/js/vitest.config.ts:31` documenta il conto già pagato).
 *
 * L'autenticazione usata qui è il modulo VERO (`cli/src/lib/api/auth.js`),
 * caricato con una `JHT_HOME` temporanea: è l'unico modo di provare anche la
 * lettura dell'header (array uniti con virgola, chiavi in maiuscolo) invece di
 * un finto `authenticate` che sarebbe d'accordo con noi per costruzione.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { createApiHandler } from "../../../cli/src/lib/api/handler.js";

const ORIGINAL_HOME = process.env.JHT_HOME;
const ORIGINAL_DEPLOY = process.env.NEXT_PUBLIC_JHT_DEPLOY;
const ORIGINAL_VERCEL = process.env.VERCEL;

const root = mkdtempSync(path.join(tmpdir(), "jht-api-authhost-"));
const home = path.join(root, "home");

type Req = {
  method?: string;
  path?: string;
  headers?: Record<string, unknown>;
  query?: unknown;
  hasBody?: boolean;
};
type Res = { status: number; headers: Record<string, string>; body: string };

let handler: (req: Req) => Promise<Res>;
let token = "";

/** Un backend finto: qui il database non è il soggetto. */
const backend = {
  dbPath: "/tmp/does-not-matter/jobs.db",
  describeDb: () => ({
    present: true,
    readable: true,
    readOnlyEnforced: true,
    path: "/tmp/does-not-matter/jobs.db",
  }),
  census: () => ({
    present: true,
    readable: true,
    userVersion: 7,
    expected: 7,
    missing: [] as string[],
    reason: null,
  }),
  listPositions: () => [],
  getPosition: () => null,
  getDashboard: () => ({}),
};

beforeAll(async () => {
  // `shared/paths.js` legge `JHT_HOME` all'import e il modulo di auth tiene il
  // token in una variabile di modulo: senza `resetModules` la cartella
  // temporanea non verrebbe nemmeno guardata.
  process.env.JHT_HOME = home;
  process.env.NEXT_PUBLIC_JHT_DEPLOY = "local";
  delete process.env.VERCEL;
  vi.resetModules();
  const auth = await import("../../../cli/src/lib/api/auth.js");
  token = auth.getOrCreate() ?? "";
  expect(
    token,
    "cli/src/lib/api/auth.js getOrCreate() non ha prodotto un token nella JHT_HOME " +
      "temporanea: controlla l'import di shared/paths.js e i permessi della cartella",
  ).toMatch(/^[a-f0-9]{64}$/);
  handler = createApiHandler({
    backend,
    auth,
    tmux: () => ({ tmux: "ok" as const, sessions: ["CAPITANO"] }),
    meta: { product: "test", startedAt: "2026-08-17T00:00:00.000Z" },
  }) as (req: Req) => Promise<Res>;
}, 15_000);

afterAll(() => {
  if (ORIGINAL_HOME === undefined) delete process.env.JHT_HOME;
  else process.env.JHT_HOME = ORIGINAL_HOME;
  if (ORIGINAL_DEPLOY === undefined) delete process.env.NEXT_PUBLIC_JHT_DEPLOY;
  else process.env.NEXT_PUBLIC_JHT_DEPLOY = ORIGINAL_DEPLOY;
  if (ORIGINAL_VERCEL === undefined) delete process.env.VERCEL;
  else process.env.VERCEL = ORIGINAL_VERCEL;
  try {
    rmSync(root, { recursive: true, force: true });
  } catch {
    /* la cartella temporanea resta: fastidio, non guasto */
  }
});

/** Le intestazioni di una richiesta legittima. */
function good(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { host: "127.0.0.1:9797", authorization: `Bearer ${token}`, ...extra };
}

function codeOf(res: Res): string {
  return JSON.parse(res.body).code ?? "";
}

describe("API del team — il Bearer è l'unica via d'ingresso", () => {
  it("senza Authorization risponde 401 e non chiede una password al browser", async () => {
    const res = await handler({ method: "GET", path: "/version", headers: { host: "127.0.0.1" } });
    expect(
      res.status,
      "cli/src/lib/api/handler.js ha lasciato passare una richiesta senza Authorization: " +
        "il Bearer è obbligatorio su OGNI rotta, /version compresa",
    ).toBe(401);
    expect(codeOf(res)).toBe("UNAUTHORIZED");
    expect(
      Object.keys(res.headers).map((k) => k.toLowerCase()),
      "cli/src/lib/api/handler.js ha emesso WWW-Authenticate: togli quell'header — " +
        "chiederebbe a un browser di aprire una finestra di password su un'API senza utenti",
    ).not.toContain("www-authenticate");
  });

  it("un token ben formato ma sbagliato è 401, e la risposta non lo ripete", async () => {
    const wrong = "b".repeat(64);
    const res = await handler({
      method: "GET",
      path: "/version",
      headers: { host: "127.0.0.1", authorization: `Bearer ${wrong}` },
    });
    expect(
      res.status,
      "cli/src/lib/api/handler.js accetta un token che non corrisponde: il confronto deve " +
        "passare da auth.authenticate e fallire",
    ).toBe(401);
    expect(
      res.body,
      "cli/src/lib/api/handler.js ripete nella risposta il valore fornito: togli l'eco — " +
        "un server non deve scrivere un segreto in un terminale o in un log altrui",
    ).not.toContain(wrong);
  });

  it("due Authorization uniti con virgola non sono un passaggio (fail-closed)", async () => {
    const res = await handler({
      method: "GET",
      path: "/version",
      headers: { host: "127.0.0.1", authorization: `Bearer ${token}, Bearer ${token}` },
    });
    expect(
      res.status,
      "cli/src/lib/api/handler.js ha accettato un Authorization duplicato unito da Node: " +
        "la regex di shared/auth/local-token.js è ancorata e deve rifiutarlo",
    ).toBe(401);
  });

  it("il token corretto passa", async () => {
    const res = await handler({ method: "GET", path: "/version", headers: good() });
    expect(
      res.status,
      "cli/src/lib/api/handler.js rifiuta il token che auth.getOrCreate() ha appena scritto: " +
        "controlla il formato in shared/auth/local-token.js",
    ).toBe(200);
  });

  it("il cookie NON è una corsia: jht_local_token da solo resta fuori", async () => {
    const res = await handler({
      method: "GET",
      path: "/version",
      headers: { host: "127.0.0.1", cookie: `jht_local_token=${token}` },
    });
    expect(
      res.status,
      "qualcuno ha attivato la corsia cookie fuori da web/: la riserva di ADR-0009 decisione 3 " +
        "richiede un PARAMETRO NUOVO in authenticate() e i quattro aggiornamenti di documentazione " +
        "elencati in web/lib/local-token.ts",
    ).toBe(401);
  });
});

describe("API del team — il Host guarda la parte host e IGNORA la porta", () => {
  it("un nome che non è loopback è 421 anche con un token valido", async () => {
    const res = await handler({
      method: "GET",
      path: "/version",
      headers: good({ host: "evil.example" }),
    });
    expect(
      res.status,
      "cli/src/lib/api/handler.js non controlla il Host: serve la difesa in profondità contro " +
        "il DNS rebinding (un nome che risolve a 127.0.0.1 ma si chiama altrimenti)",
    ).toBe(421);
    expect(codeOf(res)).toBe("HOST_NOT_LOOPBACK");
  });

  it("l'indirizzo jolly 0.0.0.0 è 421 (qui NON si copia web/lib/auth.ts)", async () => {
    const res = await handler({
      method: "GET",
      path: "/version",
      headers: good({ host: "0.0.0.0:9797" }),
    });
    expect(
      res.status,
      "cli/src/lib/api/handler.js accetta 0.0.0.0 come Host: la regex di web/lib/auth.ts:15-19 " +
        "lo ammette, la nostra allowlist NO — rimettilo fuori da LOOPBACK_HOSTS",
    ).toBe(421);
  });

  it("una porta qualunque su 127.0.0.1 passa: è il tunnel della fase 2", async () => {
    const res = await handler({
      method: "GET",
      path: "/version",
      headers: good({ host: "127.0.0.1:59999" }),
    });
    expect(
      res.status,
      "cli/src/lib/api/handler.js ha reso il controllo del Host sensibile alla PORTA: non " +
        "indurirlo. Attraverso `ssh -L 51234:127.0.0.1:9797` il client manda " +
        "Host: 127.0.0.1:51234 e non ha modo di sapere la porta dall'altro capo — un " +
        "allowlist host:porta romperebbe la fase 2",
    ).toBe(200);
  });

  it("localhost, ::1 e [::1] sono la stessa scatola, con o senza porta", async () => {
    for (const host of ["localhost", "localhost:3000", "::1", "[::1]", "[::1]:9797", "127.0.0.1"]) {
      const res = await handler({ method: "GET", path: "/version", headers: good({ host }) });
      expect(
        res.status,
        `cli/src/lib/api/handler.js rifiuta Host: ${host}, che è loopback: aggiorna ` +
          "LOOPBACK_HOSTS o hostPartOf() in cli/src/lib/api/handler.js",
      ).toBe(200);
    }
  });

  it("un Host assente o malformato è 421, non un passaggio", async () => {
    for (const headers of [
      { authorization: `Bearer ${token}` },
      good({ host: "" }),
      good({ host: "127.0.0.1:" }),
      good({ host: "127.0.0.1:99999999" }),
      good({ host: "127.0.0.1 evil" }),
      good({ host: "localhost.evil.example" }),
      good({ host: "127.0.0.2" }),
    ]) {
      const res = await handler({ method: "GET", path: "/version", headers });
      expect(
        res.status,
        `cli/src/lib/api/handler.js ha accettato Host=${JSON.stringify(headers.host)}: ` +
          "un Host che non si legge non ha superato il controllo, ha solo evitato di sottoporsi",
      ).toBe(421);
    }
  });
});

describe("API del team — l'ordine della pipeline è normativo", () => {
  it("il metodo viene prima del Host: POST con un Host ostile è 405 con Allow", async () => {
    const res = await handler({
      method: "POST",
      path: "/v1/dashboard",
      headers: good({ host: "evil.example" }),
    });
    expect(res.status, "cli/src/lib/api/handler.js: il metodo va controllato per primo").toBe(405);
    expect(
      res.headers.allow,
      "cli/src/lib/api/handler.js: un 405 senza header Allow non dice al client cosa fare",
    ).toBe("GET, HEAD");
  });

  it("il Host viene prima del corpo: un corpo con Host ostile è 421", async () => {
    const res = await handler({
      method: "GET",
      path: "/version",
      headers: good({ host: "evil.example", "content-length": "12" }),
    });
    expect(
      res.status,
      "cli/src/lib/api/handler.js ha invertito Host e corpo rispetto alla pipeline normativa " +
        "(metodo → Host → corpo → auth → rotta → contratto)",
    ).toBe(421);
  });

  it("l'auth viene prima della rotta: senza token un percorso inesistente è 401", async () => {
    const res = await handler({ method: "GET", path: "/questa-rotta-non-esiste", headers: { host: "127.0.0.1" } });
    expect(
      res.status,
      "cli/src/lib/api/handler.js risponde 404 a chi non è autenticato: così un client senza " +
        "token impara quali percorsi esistono. L'auth precede il riconoscimento della rotta",
    ).toBe(401);
  });

  it("l'auth viene prima del contratto: senza token e senza header di contratto è 401", async () => {
    const res = await handler({ method: "GET", path: "/v1/dashboard", headers: { host: "127.0.0.1" } });
    expect(
      res.status,
      "cli/src/lib/api/handler.js risponde 400 CONTRACT_HEADER_MISSING a chi non è " +
        "autenticato: chi non ha il token non deve imparare niente sul protocollo",
    ).toBe(401);
  });
});

describe("API del team — nessuna affordance da browser, su nessuna risposta", () => {
  it("ogni risposta porta i tre header di contratto e nessuno di quelli vietati", async () => {
    const cases: Array<[string, Req]> = [
      ["200 /version", { method: "GET", path: "/version", headers: good() }],
      ["401", { method: "GET", path: "/version", headers: { host: "127.0.0.1" } }],
      ["421", { method: "GET", path: "/version", headers: good({ host: "evil.example" }) }],
      ["405", { method: "PUT", path: "/version", headers: good() }],
      ["413", { method: "GET", path: "/version", headers: good({ "content-length": "9" }) }],
      ["404", { method: "GET", path: "/nope", headers: good() }],
      [
        "400",
        { method: "GET", path: "/v1/dashboard", headers: good() },
      ],
    ];
    for (const [label, req] of cases) {
      const res = await handler(req);
      const keys = Object.keys(res.headers).map((k) => k.toLowerCase());
      expect(
        res.headers["content-type"],
        `cli/src/lib/api/handler.js (${label}): ogni risposta è JSON, errori compresi`,
      ).toBe("application/json; charset=utf-8");
      expect(
        res.headers["x-jht-api-contract"],
        `cli/src/lib/api/handler.js (${label}): senza l'header di contratto in RISPOSTA un ` +
          "client non può accorgersi di un container vecchio sulla stessa porta",
      ).toBe("1");
      expect(
        res.headers["cache-control"],
        `cli/src/lib/api/handler.js (${label}): queste risposte sono lo stato di adesso`,
      ).toBe("no-store");
      expect(
        keys.filter((k) => /^access-control-/.test(k)),
        `cli/src/lib/api/handler.js (${label}) emette header CORS: questa non è un'API per un ` +
          "browser, e ADR-0009 decisione 1 dice che non c'è nessun punto d'ingresso da browser",
      ).toEqual([]);
      expect(
        keys,
        `cli/src/lib/api/handler.js (${label}) emette Set-Cookie: la corsia cookie resta inerte`,
      ).not.toContain("set-cookie");
      expect(keys).not.toContain("www-authenticate");
    }
  });
});
