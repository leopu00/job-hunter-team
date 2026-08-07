/**
 * [WEB-AUTH-GUARDS-UNTESTED] I guard di località di `web/lib/auth.ts`.
 *
 * Sono le funzioni che decidono se una richiesta arriva "dalla macchina
 * dell'utente": da quel verdetto dipendono il write-guard WEB-READONLY
 * (`requireLocalWrite`, importato da 22 route) e il tier di rate limit del
 * middleware. Fino al 2026-07-30 non avevano **un solo test**, pur essendo
 * pure su `Headers` — il caso più facile da testare che esista.
 *
 * Perché qui e non negli e2e: non serve un browser né una sessione Supabase.
 * Header in ingresso, booleano in uscita; gli e2e coprirebbero lo stesso
 * comportamento a costo molto più alto e con meno casi.
 *
 * `requireAuth`/`requireLocalWrite` NON sono coperti: leggono `headers()` e
 * `cookies()` di `next/headers`, quindi pretendono un mock del contesto
 * richiesta di Next. Rimandati per scelta — restano il residuo dichiarato del
 * ticket.
 *
 * L'ultimo blocco è la **parità di comportamento** con la copia inlinata in
 * `web/middleware.ts` (che replica gli stessi tre helper "per Edge compat", e
 * quindi può andare alla deriva). La parità è asserita sul COMPORTAMENTO, non
 * sul testo del sorgente: il middleware viene eseguito davvero e si legge il
 * tier di rate limit che ha scelto, che è l'unico effetto osservabile del suo
 * `isLocalRequestFromHeaders`. Un test che facesse il grep delle due copie
 * ricadrebbe nel difetto descritto in [TESTS-SRC-ASSERT-FRAGILE].
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  isLocalhostHost,
  hasForwardedRequestHeaders,
  hasUntrustedForwardedHeaders,
  isLocalRequestFromHeaders,
} from "@/lib/auth";
import { middleware } from "@/middleware";

// ---------------------------------------------------------------------------
// isLocalhostHost — l'header `Host` è localhost?
// ---------------------------------------------------------------------------

const HOST_CASES: Array<[host: string, expected: boolean, why: string]> = [
  ["localhost", true, "nome nudo"],
  ["localhost:3001", true, "porta del container"],
  ["LocalHost:3001", true, "il confronto è case-insensitive"],
  ["127.0.0.1", true, "loopback IPv4"],
  ["127.0.0.1:8080", true, "loopback IPv4 con porta"],
  ["[::1]", true, "loopback IPv6 in parentesi (forma dell'header Host)"],
  ["[::1]:3000", true, "loopback IPv6 con porta"],
  ["0.0.0.0", true, "wildcard usato dal launcher desktop"],
  ["", false, "header Host assente"],
  ["jobhunterteam.ai", false, "dominio pubblico"],
  ["evil.com", false, "dominio arbitrario"],
  ["localhost.evil.com", false, "prefisso localhost dentro un dominio altrui"],
  ["evil.com:80", false, "dominio altrui con porta"],
  ["notlocalhost", false, "sottostringa, non l'host"],
  ["127.0.0.1.evil.com", false, "IP loopback come etichetta di un dominio"],
  ["192.168.1.10", false, "IP di LAN: raggiungibile da altri, non è la macchina"],
  ["::1", false, "IPv6 senza parentesi non è una forma valida di Host"],
  ["localhost:abc", false, "porta non numerica"],
];

describe("isLocalhostHost", () => {
  for (const [host, expected, why] of HOST_CASES) {
    it(`${JSON.stringify(host)} → ${expected} (${why})`, () => {
      expect(isLocalhostHost(host)).toBe(expected);
    });
  }
});

// ---------------------------------------------------------------------------
// hasForwardedRequestHeaders — variante stretta: basta la PRESENZA di un
// forwarded header per dichiarare che c'è un proxy in mezzo.
// ---------------------------------------------------------------------------

describe("hasForwardedRequestHeaders", () => {
  it("nessun forwarded header → false", () => {
    expect(
      hasForwardedRequestHeaders(new Headers({ host: "localhost:3001" })),
    ).toBe(false);
  });

  const PRESENT = [
    "forwarded",
    "x-forwarded-for",
    "x-forwarded-proto",
    "x-forwarded-host",
    "x-real-ip",
  ];
  for (const name of PRESENT) {
    it(`${name} presente → true, anche con valore loopback`, () => {
      // Differenza voluta rispetto alla variante permissiva: qui il VALORE non
      // viene guardato, conta solo che l'header ci sia.
      expect(
        hasForwardedRequestHeaders(
          new Headers({ host: "localhost:3001", [name]: "::1" }),
        ),
      ).toBe(true);
    });
  }
});

// ---------------------------------------------------------------------------
// hasUntrustedForwardedHeaders — variante permissiva: ammette i forwarded
// header del proxy interno di `next dev` (sempre loopback), blocca gli altri.
// `true` = proxy NON fidato = blocca.
// ---------------------------------------------------------------------------

const FORWARDED_CASES: Array<
  [headers: Record<string, string>, expected: boolean, why: string]
> = [
  [{}, false, "nessun forwarded header"],
  [
    { "x-forwarded-proto": "https" },
    false,
    "x-forwarded-proto è informativo: non dice da dove arriva la richiesta",
  ],
  // --- RFC 7239 `Forwarded`: conservativo, la presenza basta a bloccare ---
  [
    { forwarded: "for=192.0.2.60;proto=http;by=203.0.113.43" },
    true,
    "Forwarded RFC7239 con client pubblico",
  ],
  [
    { forwarded: 'for="[::1]"' },
    true,
    "Forwarded RFC7239 blocca anche se dice loopback: non lo parsiamo",
  ],
  [{ forwarded: "" }, true, "Forwarded presente ma vuoto: sempre bloccato"],
  // --- x-forwarded-for: conta il primo hop (il client) ---
  [{ "x-forwarded-for": "::1" }, false, "proxy interno di next dev"],
  [{ "x-forwarded-for": "127.0.0.1" }, false, "loopback IPv4"],
  [{ "x-forwarded-for": " ::1 " }, false, "spazi attorno al valore"],
  [{ "x-forwarded-for": "0.0.0.0" }, false, "wildcard trattato come loopback"],
  [{ "x-forwarded-for": "203.0.113.9" }, true, "client remoto"],
  [
    { "x-forwarded-for": "203.0.113.9, ::1" },
    true,
    "client remoto seguito dal proxy locale: il primo hop è il client",
  ],
  [
    { "x-forwarded-for": "::1, 203.0.113.9" },
    false,
    "solo il primo hop viene guardato — comportamento attuale, documentato qui",
  ],
  [{ "x-forwarded-for": "" }, true, "valore vuoto: primo hop non loopback"],
  // --- x-forwarded-host: è client-controllabile, era il vettore del bypass ---
  [{ "x-forwarded-host": "localhost:3001" }, false, "host inoltrato locale"],
  [{ "x-forwarded-host": "evil.com" }, true, "host inoltrato arbitrario"],
  [
    { "x-forwarded-host": "jobhunterteam.ai" },
    true,
    "dietro il reverse proxy di produzione",
  ],
  // --- x-real-ip ---
  [{ "x-real-ip": "::1" }, false, "real-ip loopback"],
  [{ "x-real-ip": "203.0.113.9" }, true, "real-ip pubblico"],
  [{ "x-real-ip": "192.168.1.10" }, true, "real-ip di LAN: non è loopback"],
];

describe("hasUntrustedForwardedHeaders", () => {
  for (const [hdrs, expected, why] of FORWARDED_CASES) {
    it(`${JSON.stringify(hdrs)} → ${expected} (${why})`, () => {
      expect(
        hasUntrustedForwardedHeaders(
          new Headers({ host: "localhost:3001", ...hdrs }),
        ),
      ).toBe(expected);
    });
  }
});

// ---------------------------------------------------------------------------
// isLocalRequestFromHeaders — la decisione vera e propria.
// ---------------------------------------------------------------------------

/**
 * Tabella condivisa fra il test di `lib/auth.ts` e quello di parità col
 * middleware: le due copie devono rispondere allo stesso modo su ognuno di
 * questi casi. La colonna `expected` è il verdetto in deploy **local**.
 */
const REQUEST_CASES: Array<
  [headers: Record<string, string>, expected: boolean, why: string]
> = [
  [
    { host: "localhost:3001" },
    true,
    "browser aperto dal launcher desktop sul container",
  ],
  [{ host: "127.0.0.1:3001" }, true, "stessa cosa via IP loopback"],
  [
    { host: "localhost:3001", "x-forwarded-for": "::1" },
    true,
    "proxy interno di next dev: forwarded header loopback",
  ],
  [
    { host: "localhost:3001", "x-forwarded-host": "localhost:3001" },
    true,
    "host inoltrato uguale all'host locale",
  ],
  [
    { host: "localhost:3001", "x-forwarded-proto": "http" },
    true,
    "solo il protocollo inoltrato: non identifica l'origine",
  ],
  [{}, false, "nessun header Host"],
  [{ host: "jobhunterteam.ai" }, false, "richiesta al dominio pubblico"],
  [
    { host: "evil.com", "x-forwarded-host": "localhost" },
    false,
    "x-forwarded-host non promuove una richiesta remota",
  ],
  [
    { host: "localhost:3001", "x-forwarded-host": "evil.com" },
    false,
    "BYPASS C1: Host falsificato a localhost, il proxy tradisce l'origine",
  ],
  [
    { host: "localhost:3001", "x-forwarded-for": "203.0.113.9" },
    false,
    "client remoto dietro proxy che riscrive Host a localhost",
  ],
  [
    { host: "localhost:3001", forwarded: "for=192.0.2.60;proto=http" },
    false,
    "Forwarded RFC7239 presente: origine non verificabile",
  ],
  [
    { host: "localhost:3001", "x-real-ip": "203.0.113.9" },
    false,
    "real-ip pubblico con Host falsificato",
  ],
  [
    { host: "192.168.1.10:3001" },
    false,
    "raggiunto via LAN: altre macchine possono farlo",
  ],
];

describe("isLocalRequestFromHeaders — deploy local", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_JHT_DEPLOY", "local");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  for (const [hdrs, expected, why] of REQUEST_CASES) {
    it(`${JSON.stringify(hdrs)} → ${expected} (${why})`, () => {
      expect(isLocalRequestFromHeaders(new Headers(hdrs))).toBe(expected);
    });
  }
});

describe("isLocalRequestFromHeaders — deploy cloud", () => {
  // [JHT-DASHBOARD-SPLIT] Su un deploy cloud NESSUNA richiesta è locale,
  // qualunque header presenti: le corsie locali (SQLite, tmux, ~/.jht) su
  // quel deploy non esistono. Il guard è a `auth.ts:104`.
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_JHT_DEPLOY", "cloud");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  for (const [hdrs, , why] of REQUEST_CASES) {
    it(`${JSON.stringify(hdrs)} → false (${why})`, () => {
      expect(isLocalRequestFromHeaders(new Headers(hdrs))).toBe(false);
    });
  }

  it("il flag di build vince anche sul caso più locale che esista", () => {
    expect(isLocalRequestFromHeaders(new Headers({ host: "localhost" }))).toBe(
      false,
    );
  });

  it("`VERCEL` presente e flag assente → cloud (fallback server-side)", () => {
    vi.stubEnv("NEXT_PUBLIC_JHT_DEPLOY", "");
    vi.stubEnv("VERCEL", "1");
    expect(
      isLocalRequestFromHeaders(new Headers({ host: "localhost:3001" })),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Parità di comportamento: lib/auth.ts ↔ la copia inlinata in middleware.ts
// ---------------------------------------------------------------------------
//
// Il middleware non esporta i suoi helper (sono funzioni di modulo), quindi non
// si possono chiamare direttamente — e leggerne il sorgente come stringa
// sarebbe il test fragile che non vogliamo. Si esegue invece il middleware vero
// su una richiesta `/api/*` e si legge il TIER di rate limit che ha scelto:
// `X-RateLimit-Limit` vale 600 quando la sua copia ha detto "locale" e 120
// quando ha detto "remota anonima" (`middleware.ts`, RATE_LIMIT_LOCAL_MAX vs
// RATE_LIMIT_PUBLIC_MAX). È l'unico effetto osservabile di quella decisione, ed
// è anche esattamente ciò che il ticket teme che diverga.

const LOCAL_TIER = "600";
const PUBLIC_TIER = "120";

type MiddlewareRequest = Parameters<typeof middleware>[0];

/**
 * `NextRequest` non è importabile da qui (`next` è installato in `web/`, non in
 * `tests/js/`), e al middleware serve solo questa superficie: metodo, headers,
 * cookie e `nextUrl`. Nessun cookie di sessione → il bucket di rate limit è
 * quello anonimo, quindi il tier "non locale" è deterministicamente 120 e non
 * il 600 degli utenti autenticati.
 */
function apiRequest(headers: Record<string, string>): MiddlewareRequest {
  return {
    method: "GET",
    headers: new Headers(headers),
    cookies: { getAll: () => [], set: () => {} },
    nextUrl: { pathname: "/api/positions", search: "", protocol: "http:" },
  } as unknown as MiddlewareRequest;
}

async function middlewareSaysLocal(
  headers: Record<string, string>,
): Promise<boolean> {
  const res = await middleware(apiRequest(headers));
  const tier = res.headers.get("X-RateLimit-Limit");
  expect(
    tier,
    "il middleware deve esporre X-RateLimit-Limit sulle risposte /api/*",
  ).not.toBeNull();
  expect(
    [LOCAL_TIER, PUBLIC_TIER],
    "tier inatteso: le costanti di rate limit sono cambiate, questo test non è più cieco per caso",
  ).toContain(tier);
  return tier === LOCAL_TIER;
}

describe("parità di comportamento — lib/auth.ts ↔ middleware.ts", () => {
  beforeEach(() => {
    // Supabase deliberatamente NON configurato: con una url invalida
    // `getSupabaseConfig()` restituisce `configured: false` e il middleware
    // salta il refresh di sessione, che altrimenti farebbe una chiamata di rete
    // vera dentro il test.
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "not-a-url");
    vi.stubEnv("NEXT_PUBLIC_JHT_DEPLOY", "local");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("il tier di rate limit è un osservabile valido (i due tier sono distinti)", async () => {
    expect(await middlewareSaysLocal({ host: "localhost:3001" })).toBe(true);
    expect(await middlewareSaysLocal({ host: "jobhunterteam.ai" })).toBe(false);
  });

  for (const [hdrs, expected, why] of REQUEST_CASES) {
    it(`${JSON.stringify(hdrs)} → entrambe dicono ${expected} (${why})`, async () => {
      const fromAuth = isLocalRequestFromHeaders(new Headers(hdrs));
      const fromMiddleware = await middlewareSaysLocal(hdrs);
      expect(fromAuth).toBe(expected);
      expect(fromMiddleware).toBe(expected);
    });
  }
});

describe("divergenza nota — il middleware non ha il guard cloud", () => {
  // Questo test fissa una differenza REALE fra le due copie, non un
  // comportamento desiderabile: `auth.ts:104` esce con `false` quando il deploy
  // è cloud, la copia inlinata in `middleware.ts:59-63` quel guard non ce l'ha.
  // Conseguenza: su un deploy cloud raggiunto con `Host: localhost` il
  // middleware concede ancora il tier permissivo (600 invece di 120).
  //
  // Portata: su Vercel il reverse proxy instrada per Host, quindi un `Host:
  // localhost` non arriva all'app; il caso vivo è un dev server avviato in
  // modalità cloud in locale. L'effetto è limitato al rate limit — l'auth e il
  // write-guard passano da `lib/auth.ts`, che il guard ce l'ha.
  //
  // Misurato applicando il guard al middleware e rieseguendo questo file: di
  // tutta la tabella cambia SOLO questo caso, e cambia in direzione restrittiva
  // (600 → 120, cioè il tier anonimo pubblico). Gli utenti autenticati non se
  // ne accorgerebbero, perché il loro tier è già 600.
  //
  // SE QUESTO TEST FALLISCE perché il middleware ora risponde "non locale":
  // la divergenza è stata chiusa, sposta questo caso nel blocco di parità qui
  // sopra invece di rimetterlo com'era.
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "not-a-url");
    vi.stubEnv("NEXT_PUBLIC_JHT_DEPLOY", "cloud");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("in deploy cloud lib/auth.ts dice NON locale su Host: localhost", () => {
    expect(
      isLocalRequestFromHeaders(new Headers({ host: "localhost:3001" })),
    ).toBe(false);
  });

  it("in deploy cloud il middleware dice ancora locale sullo stesso Host", async () => {
    expect(await middlewareSaysLocal({ host: "localhost:3001" })).toBe(true);
  });

  it("fuori dal caso cloud le due copie restano allineate", async () => {
    // La divergenza è circoscritta al guard di deploy: sugli header, che è
    // dove vive il rischio di sicurezza, le due copie coincidono.
    vi.stubEnv("NEXT_PUBLIC_JHT_DEPLOY", "cloud");
    expect(
      await middlewareSaysLocal({
        host: "localhost:3001",
        "x-forwarded-host": "evil.com",
      }),
    ).toBe(false);
  });
});
