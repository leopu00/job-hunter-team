/**
 * Test — GET /api/latest-release (vitest).
 *
 * L'endpoint che alimenta la fascia «c'è una versione nuova» falliva in
 * silenzio per costruzione, in due modi che si sommano.
 *
 * 1. Era **prerenderizzato al build** (`export const revalidate`), quindi la
 *    risposta la decideva la rete del builder. Misurato il 2026-08-08 con
 *    `next build` + `next start`: con GitHub non raggiungibile durante il
 *    build, `{"release":null}` veniva servito con `x-nextjs-cache: HIT` per
 *    un'ora **anche a runtime sano**. La fascia non compariva e nessuno
 *    poteva accorgersene.
 * 2. Ogni esito produceva lo stesso corpo, quindi «non c'è una release» e
 *    «non sono riuscito a chiederlo» erano indistinguibili anche guardando.
 *
 * Un endpoint che avvisa gli utenti non può guastarsi in modo silenzioso:
 * è la stessa forma del difetto che quella fascia esiste per chiudere.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { GET } from "@/app/api/latest-release/route";

const ROUTE_SOURCE = readFileSync(
  join(__dirname, "../../../web/app/api/latest-release/route.ts"),
  "utf-8",
);

const RELEASE = {
  tag_name: "v0.4.0",
  html_url: "https://github.com/leopu00/job-hunter-team/releases/tag/v0.4.0",
};

let fetchSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  delete process.env.JHT_UPDATE_CHECK;
  // I log d'errore sono voluti: qui si silenziano per non sporcare la resa
  // della suite, ma il test che li pretende sta più sotto.
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("esiti distinguibili", () => {
  it("release valida: ok, con versione e pagina", async () => {
    fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue({ ok: true, json: async () => RELEASE } as never);
    const body = await (await GET()).json();
    expect(body.status).toBe("ok");
    expect(body.release).toEqual({
      version: "0.4.0",
      page: RELEASE.html_url,
    });
  });

  it("GitHub risponde 403: unreachable, e lo dice nei log", async () => {
    // 403 = quota esaurita sull'indirizzo condiviso di Vercel. È il modo in
    // cui questo endpoint muore per davvero, ed è indistinguibile da
    // «nessuna release» finché qualcuno non lo distingue.
    fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue({
        ok: false,
        status: 403,
        json: async () => ({}),
      } as never);
    const body = await (await GET()).json();
    expect(body).toMatchObject({
      release: null,
      status: "unreachable",
      http_status: 403,
    });
    expect(console.error).toHaveBeenCalled();
  });

  it("rete morta: unreachable invece di un'eccezione", async () => {
    fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("ENOTFOUND"));
    const body = await (await GET()).json();
    expect(body).toMatchObject({ release: null, status: "unreachable" });
    expect(console.error).toHaveBeenCalled();
  });

  it("payload inutilizzabile (draft/prerelease): unusable, non ok", async () => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ ...RELEASE, draft: true }),
    } as never);
    const body = await (await GET()).json();
    expect(body).toMatchObject({ release: null, status: "unusable" });
  });

  it("spento dall'interruttore: disabled, e nessuna richiesta di rete", async () => {
    // «Scelto» non è «guasto», e va potuto leggere che è una scelta.
    process.env.JHT_UPDATE_CHECK = "0";
    fetchSpy = vi.spyOn(globalThis, "fetch");
    const body = await (await GET()).json();
    expect(body).toMatchObject({ release: null, status: "disabled" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("la cache sta sulla fetch, non sulla risposta", () => {
  it("chiede a GitHub con revalidate, così l'ora vale per tutte le invocazioni", async () => {
    fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue({ ok: true, json: async () => RELEASE } as never);
    await GET();
    const [, init] = fetchSpy.mock.calls[0] as [
      string,
      RequestInit & {
        next?: { revalidate?: number };
      },
    ];
    expect(init.next?.revalidate).toBe(3600);
    // La Data Cache non memorizza le fetch fallite: è ciò che impedisce a
    // un errore di restare congelato fino alla scadenza.
  });

  it("la route resta dinamica: `revalidate` la riporterebbe al build", () => {
    // Guard di regressione sul sorgente. `export const revalidate` sembra
    // innocuo e riporta esattamente il difetto misurato: la risposta
    // decisa dalla rete del builder e servita per un'ora.
    expect(ROUTE_SOURCE).toContain('export const dynamic = "force-dynamic"');
    // Ancorato a inizio riga: il file *parla* di `export const revalidate`
    // nel commento che spiega perché non c'è più, e un guard che confonde
    // la spiegazione con la cosa spiegata è un guard che costringe a
    // cancellare la spiegazione.
    expect(ROUTE_SOURCE).not.toMatch(/^\s*export const revalidate/m);
  });
});
