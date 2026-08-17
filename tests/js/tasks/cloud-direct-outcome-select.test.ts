// #187 — l'esito deve scendere da TUTTI i lettori della corsia, non da uno.
//
// La corsia cloud → macchina ha DUE implementazioni della stessa lettura:
//
//   1. `web/app/api/cloud-sync/pull-desired-state/route.ts` — la route Vercel,
//      usata come fallback;
//   2. `cli/src/lib/supabase-direct.js` — lettura diretta da PostgREST, accesa
//      con `JHT_SUPABASE_DIRECT=1` per non pagare le invocazioni serverless.
//
// Quando #187 ha aggiunto `response`/`response_at` alla candidatura, le due
// colonne sono finite in UNA sola delle due select. Sul percorso diretto
// `decideOutcomeBackflow` riceveva quindi sempre `response: null` e rispondeva
// `skip: no_outcome_on_cloud`: l'esito dichiarato sul sito non scendeva MAI, e
// il difetto era invisibile perché la metà che PROTEGGE il box (il rifiuto del
// downgrade) vive altrove e funzionava su entrambi i percorsi.
//
// Il test non guarda solo le due colonne di oggi: confronta le due select fra
// loro. La prossima colonna che qualcuno aggiunge a una sola delle due copie
// deve far diventare rosso questo file, non aspettare che un utente noti che
// un dato non arriva.
import { describe, expect, it, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repo = join(__dirname, "../../..");
const ROUTE = join(repo, "web/app/api/cloud-sync/pull-desired-state/route.ts");

/** Le colonne che una select PostgREST chiede, normalizzate. */
function columnsOf(select: string): string[] {
  return select
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);
}

/**
 * La select delle candidature dentro la route, presa DAL SORGENTE.
 *
 * Copiarla qui la renderebbe una terza copia da tenere allineata a mano — cioè
 * l'errore che questo test esiste per intercettare.
 */
function routeApplicationsSelect(): string {
  const src = readFileSync(ROUTE, "utf-8");
  const m = src.match(/"(applied,[^"]*positions!inner\(legacy_id\))"/);
  if (!m) {
    throw new Error(
      "select delle candidature non trovata in route.ts: se è stata riscritta, " +
        "aggiorna QUESTO estrattore — non cancellare il confronto.",
    );
  }
  return m[1];
}

/** Un lettore diretto con `fetch` finto: ci interessa l'URL che compone. */
async function readerWithSpy() {
  const { createSupabaseDirect } =
    await import("../../../cli/src/lib/supabase-direct.js");
  const urls: string[] = [];
  const rows = [
    {
      applied: true,
      applied_at: "2026-08-16T17:06:38.517+00:00",
      applied_via: "user_manual",
      status: "response",
      response: "rejected",
      response_at: "2026-08-17T16:03:34.265+00:00",
      updated_at: "2026-08-17T16:03:34.287+00:00",
      positions: { legacy_id: 1362 },
    },
  ];
  vi.stubGlobal("fetch", async (url: string) => {
    urls.push(String(url));
    if (String(url).includes("/auth/v1/token")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ access_token: "tok", expires_in: 3600 }),
      };
    }
    return { ok: true, status: 200, json: async () => rows };
  });
  const reader = createSupabaseDirect({
    supabaseUrl: "https://example.supabase.co",
    anonKey: "anon",
    refreshToken: "refresh",
    userId: "u",
  });
  return { reader, urls };
}

/** La select che il lettore diretto ha chiesto davvero, letta dall'URL. */
function selectFromUrls(urls: string[]): string {
  const rest = urls.find((u) => u.includes("/rest/v1/applications"));
  expect(
    rest,
    "il lettore diretto non ha interrogato `applications`",
  ).toBeTruthy();
  const select = new URL(rest as string).searchParams.get("select");
  expect(select, "nessun parametro `select` nella query").toBeTruthy();
  return select as string;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("i due lettori della corsia chiedono le stesse colonne", () => {
  it("il lettore diretto chiede response e response_at", async () => {
    const { reader, urls } = await readerWithSpy();
    await reader.readAppliedChanges({ since: "2026-08-01T00:00:00.000Z" });

    const asked = columnsOf(selectFromUrls(urls));
    // Prova POSITIVA, non «non manca niente»: si nominano le due colonne che
    // reggono l'esito. Prima della correzione la select ne chiedeva cinque e
    // queste due non c'erano.
    expect(asked).toContain("response");
    expect(asked).toContain("response_at");
  });

  it("non perde nessuna colonna che la route Vercel invece porta a casa", async () => {
    const wanted = columnsOf(routeApplicationsSelect());
    // Una ricerca vuota non è una ricerca: se l'estrattore smette di trovare
    // la select, il confronto deve fallire, non passare a mani vuote.
    expect(wanted.length).toBeGreaterThan(5);
    expect(wanted).toContain("response");

    const { reader, urls } = await readerWithSpy();
    await reader.readAppliedChanges({ since: "2026-08-01T00:00:00.000Z" });
    const asked = new Set(columnsOf(selectFromUrls(urls)));

    const missing = wanted.filter((c) => !asked.has(c));
    expect(
      missing,
      "colonne che la route porta a casa e il lettore diretto no",
    ).toEqual([]);
  });

  it("l'esito arriva nella riga appiattita, non solo nella select", async () => {
    const { reader } = await readerWithSpy();
    const rows = await reader.readAppliedChanges({
      since: "2026-08-01T00:00:00.000Z",
    });

    // Chiedere le colonne e poi buttarle nel map sarebbe lo stesso difetto un
    // passo più in là: `applyAppliedBackflow` legge `row.response`.
    expect(rows[0].response).toBe("rejected");
    expect(rows[0].response_at).toBe("2026-08-17T16:03:34.265+00:00");
    expect(rows[0].legacy_id).toBe(1362);
  });
});
