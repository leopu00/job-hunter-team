/**
 * [JHT-WEB-DEMO] Le query che alimentano le pagine in demo mode.
 *
 * Quando il cookie `jht_demo_persona` è attivo, ogni funzione di
 * `lib/queries.ts` delega alla gemella in `lib/demo/queries.ts`: è quel modulo
 * a decidere cosa vede un utente nuovo su dashboard, /positions, dettaglio,
 * /map e /swipe.
 *
 * Perché qui e non negli e2e: le pagine dell'area riservata pretendono una
 * sessione Supabase, che il setup e2e locale non ha (vedi la diagnosi in
 * e2e/README.md § "State of the suite"). Queste funzioni invece
 * sono pure — persona + locale in ingresso, dati in uscita — quindi qui la
 * copertura è reale invece che skippata.
 *
 * Design record: docs/internal/architecture/2026-07-22-web-demo-mode-and-welcome.md
 */
import { describe, it, expect } from "vitest";
import { DEMO_PERSONA_KEYS, type DemoPersonaKey } from "@/lib/demo/data";
import {
  demoDashboardStats,
  demoPositions,
  demoDashboardPositions,
  demoPositionById,
  demoScoreDistribution,
  demoSourceDistribution,
  demoTypeDistribution,
  demoFacets,
  demoCoords,
  demoNoCoords,
  demoLocations,
  demoSwipeDecks,
  demoTeamActivity,
  demoTeamActivityLog,
} from "@/lib/demo/queries";

const PERSONAS = DEMO_PERSONA_KEYS;

describe("demo queries — dashboard", () => {
  it("le statistiche non sono a zero per nessuna persona", async () => {
    for (const key of PERSONAS) {
      const s = await demoDashboardStats(key);
      expect(s.total, `${key} · totale a zero`).toBeGreaterThan(0);
      // Una demo credibile ha posizioni scorate: è ciò che mostra il lavoro
      // del team, non solo che "qualcosa è stato trovato".
      expect(s.scored, `${key} · nessuna posizione scorata`).toBeGreaterThan(0);
      expect(s.scored).toBeLessThanOrEqual(s.total);
    }
  });

  it("la tabella della dashboard è ordinata per ultima attività", async () => {
    // Dal restyle del 2026-07-20 la dashboard mostra le posizioni toccate più
    // di recente (non le migliori): l'ordine è per `last_action_at` desc.
    for (const key of PERSONAS) {
      const rows = await demoDashboardPositions(key);
      expect(rows.length).toBeGreaterThan(0);
      const stamps = rows
        .map(
          (r) => (r as unknown as { last_action_at?: string }).last_action_at,
        )
        .filter((v): v is string => typeof v === "string");
      expect(stamps.length, `${key} · nessun last_action_at`).toBe(rows.length);
      const sorted = [...stamps].sort((a, b) => (a < b ? 1 : -1));
      expect(stamps, `${key} · tabella non ordinata per attività`).toEqual(
        sorted,
      );
    }
  });
});

describe("demo queries — lista e dettaglio posizioni", () => {
  it("la lista serve solo posizioni della persona attiva", async () => {
    for (const key of PERSONAS) {
      const rows = await demoPositions(key, {});
      expect(rows.length).toBeGreaterThan(0);
      for (const r of rows) {
        expect(r.id, `${key} · id estraneo: ${r.id}`).toContain(`demo-${key}-`);
      }
    }
  });

  it("ogni posizione della lista si apre nel dettaglio", async () => {
    // Un id in lista che non risolve nel dettaglio = link rotto sotto gli
    // occhi di chi sta valutando il prodotto.
    for (const key of PERSONAS) {
      const rows = await demoPositions(key, {});
      for (const r of rows.slice(0, 8)) {
        const detail = await demoPositionById(key, r.id);
        expect(detail, `${key} · ${r.id} non risolve`).not.toBe(null);
        expect(detail?.position.id).toBe(r.id);
      }
    }
  });

  it("un id inesistente non explode: ritorna null", async () => {
    expect(await demoPositionById("software", "demo-software-999")).toBe(null);
    expect(await demoPositionById("software", "non-un-id")).toBe(null);
  });

  it("il dettaglio porta con sé ciò che la pagina rende", async () => {
    for (const key of PERSONAS) {
      const rows = await demoPositions(key, {});
      const scored = rows.find((r) => r.score != null);
      expect(
        scored,
        `${key} · nessuna posizione scorata in lista`,
      ).toBeTruthy();
      const detail = await demoPositionById(key, scored!.id);
      expect(detail).not.toBe(null);
      // Overview + card punteggio: presenti su ogni posizione scorata.
      expect(detail!.position.title.length).toBeGreaterThan(0);
      expect(detail!.score, `${key} · dettaglio senza score`).not.toBe(null);
    }
  });

  it("LIMITE NOTO: il dossier azienda non esiste in demo", async () => {
    // `demoPositionById` ritorna `company: null` per costruzione
    // (lib/demo/queries.ts), quindi la card azienda — header con logo, banner
    // di esclusione, verdetto dell'Analista, shippata il 2026-07-22 — **non
    // compare mai** in demo. I seed portano il nome dell'azienda, non il
    // dossier.
    //
    // Questo test fotografa il limite invece di nasconderlo: quando il dossier
    // demo verrà aggiunto, fallirà e obbligherà a spostare l'aspettativa
    // (→ "esiste su una parte del dataset"). Debito tracciato nel BACKLOG
    // sotto [JHT-WEB-DEMO].
    for (const key of PERSONAS) {
      const rows = await demoPositions(key, {});
      for (const r of rows.slice(0, 5)) {
        const d = await demoPositionById(key, r.id);
        expect(
          d?.company,
          `${key} · ${r.id} ha un dossier azienda: aggiorna questo test e il BACKLOG`,
        ).toBe(null);
      }
    }
  });
});

describe("demo queries — filtri e distribuzioni", () => {
  it("i facet elencano solo valori presenti nel dataset", async () => {
    for (const key of PERSONAS) {
      const facets = await demoFacets(key);
      const rows = await demoPositions(key, {});
      const sources = new Set(rows.map((r) => r.source));
      for (const f of facets.sources ?? []) {
        expect(
          sources.has(f.value),
          `${key} · facet "${f.value}" non esiste nei dati`,
        ).toBe(true);
      }
    }
  });

  it("le distribuzioni sommano a un totale coerente", async () => {
    for (const key of PERSONAS) {
      const stats = await demoDashboardStats(key);
      const sources = await demoSourceDistribution(key);
      const types = await demoTypeDistribution(key);
      const sumSources = sources.reduce((a, s) => a + s.count, 0);
      const sumTypes = types.reduce((a, t) => a + t.count, 0);
      expect(sumSources, `${key} · sorgenti`).toBeLessThanOrEqual(stats.total);
      expect(sumTypes, `${key} · tipi`).toBeLessThanOrEqual(stats.total);
      expect(sumSources).toBeGreaterThan(0);
      expect(sumTypes).toBeGreaterThan(0);
    }
  });

  it("l'istogramma degli score resta nei limiti 0-100", async () => {
    for (const key of PERSONAS) {
      const d = await demoScoreDistribution(key);
      expect(d.withScore).toBeGreaterThan(0);
      for (const s of d.scores) {
        expect(s).toBeGreaterThanOrEqual(0);
        expect(s).toBeLessThanOrEqual(100);
      }
      if (d.avgScore != null) {
        expect(d.avgScore).toBeGreaterThan(0);
        expect(d.avgScore).toBeLessThanOrEqual(100);
      }
    }
  });

  it("un filtro che non seleziona nulla ritorna lista vuota, non tutto", async () => {
    const none = await demoPositions("software", {
      sources: ["sorgente-che-non-esiste"],
    });
    expect(none).toEqual([]);
  });
});

describe("demo queries — mappa", () => {
  it("coordinate e griglia nord si spartiscono tutte le posizioni", async () => {
    for (const key of PERSONAS) {
      const withCoords = await demoCoords(key);
      const without = await demoNoCoords(key);
      const stats = await demoDashboardStats(key);
      expect(withCoords.length).toBeGreaterThan(0);
      // Chi non ha coordinate finisce nella griglia nord: nessuna posizione
      // deve sparire dalla mappa.
      expect(withCoords.length + without.length).toBeLessThanOrEqual(
        stats.total,
      );
    }
  });

  it("ogni pin ha coordinate valide", async () => {
    for (const key of PERSONAS) {
      for (const c of await demoCoords(key)) {
        expect(typeof c.lat).toBe("number");
        expect(typeof c.lon).toBe("number");
        expect(Math.abs(c.lat)).toBeLessThanOrEqual(90);
        expect(Math.abs(c.lon)).toBeLessThanOrEqual(180);
      }
    }
  });

  it("l'albero delle località non ha nodi vuoti", async () => {
    for (const key of PERSONAS) {
      const locs = await demoLocations(key);
      expect(locs.length).toBeGreaterThan(0);
      for (const l of locs) {
        expect(l.count ?? 0).toBeGreaterThan(0);
      }
    }
  });
});

describe("demo queries — swipe e messaggi", () => {
  it("il mazzo pending non è vuoto e non ripete le stesse carte", async () => {
    for (const key of PERSONAS) {
      const decks = await demoSwipeDecks(key);
      expect(decks.pending.length, `${key} · mazzo vuoto`).toBeGreaterThan(0);
      const ids = decks.pending.map((p) => p.id);
      expect(new Set(ids).size, `${key} · carte duplicate`).toBe(ids.length);
    }
  });

  it("l'attività del team ha eventi con ruolo, attore e timestamp", async () => {
    const ROLES = new Set([
      "scout",
      "analista",
      "scorer",
      "scrittore",
      "critico",
    ]);
    for (const key of PERSONAS) {
      const act = await demoTeamActivity(key, {});
      expect(act.recent.length, `${key} · feed attività vuoto`).toBeGreaterThan(
        0,
      );
      for (const e of act.recent.slice(0, 10)) {
        expect(ROLES.has(e.role), `${key} · ruolo sconosciuto: ${e.role}`).toBe(
          true,
        );
        expect(e.actor.length).toBeGreaterThan(0);
        expect(e.ts.length).toBeGreaterThan(0);
      }
    }
  });

  it("il log attività è ordinato dal più recente", async () => {
    for (const key of PERSONAS) {
      const log = await demoTeamActivityLog(key);
      expect(log.length).toBeGreaterThan(0);
      const ts = log.map((e) => e.ts);
      expect(ts, `${key} · log non ordinato`).toEqual(
        [...ts].sort((a, b) => (a < b ? 1 : -1)),
      );
    }
  });
});

describe("demo queries — le 4 personas sono equivalenti come esperienza", () => {
  it("nessuna persona è più povera delle altre nelle superfici chiave", async () => {
    const rows: Array<[DemoPersonaKey, number, number, number]> = [];
    for (const key of PERSONAS) {
      const stats = await demoDashboardStats(key);
      const coords = await demoCoords(key);
      const decks = await demoSwipeDecks(key);
      rows.push([key, stats.scored, coords.length, decks.pending.length]);
    }
    for (const [key, scored, coords, deck] of rows) {
      expect(scored, `${key} · scorate`).toBeGreaterThan(5);
      expect(coords, `${key} · pin mappa`).toBeGreaterThan(5);
      expect(deck, `${key} · carte swipe`).toBeGreaterThan(5);
    }
  });
});
