import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  createLandingHit,
  isLandingPath,
  LANDING_SOURCES,
  type LandingHit,
} from "../../../web/lib/landing-funnel";
import {
  handleLandingRedirect,
  landingMethodNotAllowed,
} from "../../../web/lib/landing-redirect";
import {
  LANDING_AGGREGATE_RATE_LIMIT,
  recordLandingHit,
} from "../../../web/lib/landing-hits";

/**
 * O-47 — da quale campagna arriva il traffico.
 *
 * Si compra su due canali insieme e non si sa quale porti le visite: si
 * compra al buio. Due percorsi, /r e /t, contati SUL SERVER — perché
 * l'analytics del browser parte solo dopo il consenso e misurerebbe il
 * sottoinsieme di chi accetta, non il traffico.
 *
 * Le cose che qui possono rompersi in silenzio sono tre, e sono tutte
 * invisibili guardando la pagina: un redirect messo in cache smette di
 * arrivare al server (e il contatore cala da solo), un conteggio che fallisce
 * può trattenere chi ha cliccato l'annuncio, e un middleware al posto di due
 * route farebbe pagare ogni richiesta del sito.
 */
const REPO = path.resolve(__dirname, "../../..");
const R_ROUTE = readFileSync(path.join(REPO, "web/app/r/route.ts"), "utf8");
const T_ROUTE = readFileSync(path.join(REPO, "web/app/t/route.ts"), "utf8");
const REDIRECT = readFileSync(
  path.join(REPO, "web/lib/landing-redirect.ts"),
  "utf8",
);
const MIGRATION = readFileSync(
  path.join(REPO, "supabase/migrations/068_landing_hits.sql"),
  "utf8",
);
const ROBOTS = readFileSync(path.join(REPO, "web/app/robots.ts"), "utf8");
const SITEMAP = readFileSync(path.join(REPO, "web/app/sitemap.ts"), "utf8");
const PRIVACY = readFileSync(
  path.join(REPO, "web/app/privacy/page.tsx"),
  "utf8",
);

const FIXED_NOW = new Date("2026-08-10T14:37:58.123Z");

function testDependencies(record = vi.fn(async (_e: LandingHit) => {})) {
  const tasks: Array<() => void | Promise<void>> = [];
  const logFailure = vi.fn();
  return {
    dependencies: {
      schedule: (task: () => void | Promise<void>) => tasks.push(task),
      record,
      now: () => FIXED_NOW,
      logFailure,
    },
    tasks,
    record,
    logFailure,
  };
}

function get(path = "/r") {
  return new Request(`https://jobhunterteam.ai${path}`);
}

describe("i due percorsi di campagna", () => {
  it("mandano alla home con un redirect TEMPORANEO", () => {
    // Un 301 se lo tiene il browser: /r e /t devono restare riusabili per la
    // campagna successiva, e continuare a passare dal server.
    const { dependencies } = testDependencies();
    const res = handleLandingRedirect(get(), "r", dependencies);
    expect(res.status).toBe(307);
    expect(res.headers.get("Location")!.startsWith("/?")).toBe(true);
  });

  it.each([
    ["r", "reddit"],
    ["t", "tiktok"],
  ] as const)(
    "/%s consegna alla home l'attribuzione del canale %s",
    (path, source) => {
      // Il primo anello della catena. `/download` costruisce i link `/go/<slug>`
      // con gli UTM che trova in query e `/go` li riporta sul conteggio dei
      // download: se qui si atterra sulla home NUDA, quella query non esiste e
      // ogni download risulta senza provenienza — non solo TikTok, anche
      // Reddit. Misurato in produzione il 10/08, dopo che era stato dichiarato
      // il contrario.
      const { dependencies } = testDependencies();
      const location = handleLandingRedirect(
        get(),
        path,
        dependencies,
      ).headers.get("Location")!;

      expect(location).toContain(`utm_source=${source}`);
      expect(location).toContain("utm_medium=paid");
      expect(location).toContain("utm_campaign=lancio-2026-08");
    },
  );

  it("scrive l'attribuzione dal percorso, non da chi arriva", () => {
    // Un URL pubblicitario può portarsi dietro qualunque parametro: se
    // ricopiassimo la query in ingresso, l'attribuzione sarebbe falsificabile
    // dall'esterno.
    const { dependencies } = testDependencies();
    const req = new Request("https://x/r?utm_source=tiktok&utm_campaign=finta");
    const location = handleLandingRedirect(req, "r", dependencies).headers.get(
      "Location",
    )!;

    expect(location).toContain("utm_source=reddit");
    expect(location).not.toContain("tiktok");
    expect(location).not.toContain("finta");
  });

  it("non si lasciano mettere in cache", () => {
    // È la differenza fra contare e credere di contare: un redirect cacheato
    // non torna al server, e il conteggio scende mentre la campagna gira.
    const { dependencies } = testDependencies();
    const res = handleLandingRedirect(get(), "t", dependencies);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("dicono ai motori di non indicizzarli", () => {
    const { dependencies } = testDependencies();
    const res = handleLandingRedirect(get(), "r", dependencies);
    expect(res.headers.get("X-Robots-Tag")).toContain("noindex");
    expect(ROBOTS).toContain('"/r"');
    expect(ROBOTS).toContain('"/t"');
    // E non sono contenuti: fuori dalla sitemap.
    expect(SITEMAP).not.toContain('"/r"');
    expect(SITEMAP).not.toContain('"/t"');
  });

  it("contano il canale giusto, all'ora giusta", () => {
    const { dependencies, tasks, record } = testDependencies();
    handleLandingRedirect(get("/t"), "t", dependencies);
    expect(tasks).toHaveLength(1);
    return tasks[0]!().then(() => {
      expect(record).toHaveBeenCalledWith({
        ts_hour: "2026-08-10T14",
        source: "tiktok",
      });
    });
  });

  it("l'ora è troncata: mai minuti né secondi", () => {
    // Un timestamp pieno su una tabella pubblica di conteggi diventa un
    // registro di visite, che è un'altra cosa da quella che serve.
    expect(createLandingHit("r", FIXED_NOW)).toEqual({
      ts_hour: "2026-08-10T14",
      source: "reddit",
    });
    expect(createLandingHit("r", FIXED_NOW).ts_hour).not.toContain(":");
  });

  it("un conteggio che fallisce non trattiene chi ha cliccato", async () => {
    const failing = vi.fn(async () => {
      throw new Error("supabase giù");
    });
    const { dependencies, tasks, logFailure } = testDependencies(failing);
    const res = handleLandingRedirect(get(), "r", dependencies);
    expect(res.status).toBe(307);
    await tasks[0]!();
    expect(logFailure).toHaveBeenCalledOnce();
  });

  it("nemmeno se è la PIANIFICAZIONE del conteggio a fallire", () => {
    const logFailure = vi.fn();
    const res = handleLandingRedirect(get(), "r", {
      schedule: () => {
        throw new Error("after() non disponibile");
      },
      record: vi.fn(),
      now: () => FIXED_NOW,
      logFailure,
    });
    expect(res.status).toBe(307);
    expect(logFailure).toHaveBeenCalledOnce();
  });

  it("un percorso sconosciuto è 404, non un redirect", () => {
    const { dependencies, tasks } = testDependencies();
    const res = handleLandingRedirect(get("/x"), "x", dependencies);
    expect(res.status).toBe(404);
    expect(tasks).toHaveLength(0);
    expect(isLandingPath("x")).toBe(false);
  });

  it("solo GET e HEAD", () => {
    const res = landingMethodNotAllowed();
    expect(res.status).toBe(405);
    expect(res.headers.get("Allow")).toBe("GET, HEAD");
    for (const route of [R_ROUTE, T_ROUTE]) {
      for (const m of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
        expect(route).toContain(`export const ${m} = landingMethodNotAllowed`);
      }
    }
  });
});

describe("il costo, che è la ragione del vincolo", () => {
  it("il conteggio sta in due route dedicate, non nel middleware", () => {
    // Il vincolo era «niente middleware globale». Un middleware ESISTE già
    // (auth Supabase, CORS, rate limit, nonce CSP) e copre quasi tutti i
    // path, quindi quelle invocazioni si pagano comunque: la scelta qui non
    // le aumenta né le riduce. Quello che cambia è dove vive la logica —
    // dentro due handler che rispondono solo a /r e /t, invece che dentro un
    // ramo `if (path === '/r')` percorso da ogni richiesta del sito.
    expect(R_ROUTE).toContain('handleLandingRedirect(request, "r")');
    expect(T_ROUTE).toContain('handleLandingRedirect(request, "t")');
    const middleware = readFileSync(
      path.join(REPO, "web/middleware.ts"),
      "utf8",
    );
    expect(middleware).not.toContain("landing");
    expect(middleware).not.toContain("increment_landing_hits");
  });

  it("il conteggio è dopo la risposta, non prima", () => {
    // `after()`: la persona che ha cliccato l'annuncio non aspetta il DB.
    expect(REDIRECT).toContain('import { after } from "next/server"');
    expect(REDIRECT).toContain("schedule: after");
  });
});

describe("cosa finisce nel database", () => {
  it("solo ora e canale — niente che identifichi qualcuno", () => {
    expect(MIGRATION).toContain("ts_hour text NOT NULL");
    expect(MIGRATION).toContain("source text NOT NULL");
    for (const forbidden of [
      "ip",
      "user_agent",
      "referrer",
      "cookie",
      "country",
      "user_id",
    ]) {
      expect(MIGRATION.toLowerCase()).not.toContain(`${forbidden} text`);
    }
  });

  it("i canali sono chiusi a due, nel codice e nel vincolo SQL", () => {
    // Cardinalità limitata: un parametro libero riempirebbe la tabella di
    // valori inventati da chiunque conosca l'URL.
    expect(Object.values(LANDING_SOURCES)).toEqual(["reddit", "tiktok"]);
    expect(MIGRATION).toContain("CHECK (source IN ('reddit', 'tiktok'))");
  });

  it("scrive solo il service_role, mai anon", () => {
    expect(MIGRATION).toContain("ENABLE ROW LEVEL SECURITY");
    expect(MIGRATION).toContain(
      "REVOKE ALL ON TABLE public.landing_hits FROM PUBLIC, anon, authenticated",
    );
    expect(MIGRATION).toContain("TO service_role");
  });

  it("il contatore ha un tetto globale, fail-closed", () => {
    expect(LANDING_AGGREGATE_RATE_LIMIT).toMatchObject({
      identity: "global",
      max: 60,
      windowMs: 60_000,
    });
  });

  it("un limitatore assente non passa per 'nessuno ha cliccato'", async () => {
    // Senza coordinamento non si conta — giusto — ma il contatore resta a
    // zero e si legge come un dato. I due silenzi devono distinguersi nei
    // log, altrimenti una env mancante sembra una campagna andata male.
    const logUncoordinated = vi.fn();
    const increment = vi.fn();
    await recordLandingHit(
      { ts_hour: "2026-08-10T14", source: "reddit" },
      { check: async () => null, increment, logUncoordinated },
    );
    expect(increment).not.toHaveBeenCalled();
    expect(logUncoordinated).toHaveBeenCalledOnce();

    // Saturo è un'altra cosa: silenzioso di proposito, senza allarme.
    logUncoordinated.mockClear();
    await recordLandingHit(
      { ts_hour: "2026-08-10T14", source: "reddit" },
      { check: async () => ({ allowed: false }), increment, logUncoordinated },
    );
    expect(increment).not.toHaveBeenCalled();
    expect(logUncoordinated).not.toHaveBeenCalled();
  });
});

describe("quello che l'utente può leggere", () => {
  it("la privacy lo dice in tutte e sette le lingue", () => {
    expect(PRIVACY.match(/\/r, \/t/g)).toHaveLength(7);
  });
});
