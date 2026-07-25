/**
 * [JHT-WEB-DEMO] Semantica del cookie di feedback della demo.
 *
 * In demo il giudizio dato a una posizione non tocca il database: vive in un
 * cookie overlay (`jht_demo_feedback`). Le funzioni qui sotto sono l'unico
 * posto in cui quella semantica è implementata, e devono restare allineate al
 * path reale: event-log dove **l'ultimo evento prevale**, `clear` che ritira il
 * voto, e la stessa mappatura a 4 livelli usata da /swipe e dalle card.
 *
 * Non è coperto dagli e2e: `POST /api/positions/<id>/feedback` pretende una
 * sessione Supabase, che il setup e2e locale non ha (vedi
 * e2e/tests/81-demo-mode.spec.ts).
 */
import { describe, it, expect } from "vitest";
import {
  parseDemoFeedback,
  serializeDemoFeedback,
  demoVerdictOf,
  DEMO_PERSONA_COOKIE,
  DEMO_FEEDBACK_COOKIE,
  WELCOME_SEEN_COOKIE,
  type DemoFeedbackMap,
} from "@/lib/demo/mode";

describe("cookie demo — nomi", () => {
  it("i tre cookie hanno il prefisso jht_ (sono dichiarati nella pagina privacy)", () => {
    for (const name of [
      DEMO_PERSONA_COOKIE,
      DEMO_FEEDBACK_COOKIE,
      WELCOME_SEEN_COOKIE,
    ]) {
      expect(name).toMatch(/^jht_/);
    }
    // Nomi distinti: un refactor che li collassa cancellerebbe i giudizi
    // ogni volta che si cambia persona.
    expect(
      new Set([DEMO_PERSONA_COOKIE, DEMO_FEEDBACK_COOKIE, WELCOME_SEEN_COOKIE])
        .size,
    ).toBe(3);
  });
});

describe("parseDemoFeedback — input ostile", () => {
  it("cookie assente → mappa vuota", () => {
    expect(parseDemoFeedback(undefined)).toEqual({});
    expect(parseDemoFeedback("")).toEqual({});
  });

  it("JSON invalido → mappa vuota, nessuna eccezione", () => {
    expect(parseDemoFeedback("{non-json")).toEqual({});
    expect(parseDemoFeedback("%%%")).toEqual({});
  });

  it("JSON valido ma non un oggetto → mappa vuota", () => {
    expect(parseDemoFeedback("[1,2,3]")).toEqual({});
    expect(parseDemoFeedback('"stringa"')).toEqual({});
    expect(parseDemoFeedback("null")).toEqual({});
  });

  it("oggetto valido → passa intatto", () => {
    const map = { "9001": { a: "star", s: null } };
    expect(parseDemoFeedback(JSON.stringify(map))).toEqual(map);
  });
});

describe("serializeDemoFeedback — round-trip e cap", () => {
  it("round-trip senza perdite", () => {
    const map: DemoFeedbackMap = {
      "9001": { a: "like", s: 4 },
      "9002": { a: "clear", s: null },
    };
    expect(parseDemoFeedback(serializeDemoFeedback({ ...map }))).toEqual(map);
  });

  it("oltre 150 voci tiene le ultime, non le prime", () => {
    // Il cap è una cintura di sicurezza sui ~4KB di un cookie. Se dovesse
    // scattare, deve buttare i giudizi vecchi: l'ultimo dato dall'utente è
    // quello che si aspetta di rivedere a schermo.
    const map: DemoFeedbackMap = {};
    for (let i = 0; i < 170; i++) map[`${9000 + i}`] = { a: "like", s: 3 };
    const parsed = parseDemoFeedback(serializeDemoFeedback(map));
    const keys = Object.keys(parsed);
    expect(keys).toHaveLength(150);
    expect(keys).toContain("9169"); // l'ultimo inserito resta
    expect(keys).not.toContain("9000"); // il primo cade
  });

  it("mappa vuota → oggetto JSON vuoto", () => {
    expect(serializeDemoFeedback({})).toBe("{}");
  });
});

describe("demoVerdictOf — mappatura a 4 livelli", () => {
  it("star è sempre il livello massimo", () => {
    expect(demoVerdictOf({ a: "star", s: null })).toBe("top");
    expect(demoVerdictOf({ a: "star", s: 1 })).toBe("top");
  });

  it("dislike e hide valgono no, tranne il caso 'poco interessante' (score 2)", () => {
    expect(demoVerdictOf({ a: "dislike", s: null })).toBe("no");
    expect(demoVerdictOf({ a: "hide", s: null })).toBe("no");
    expect(demoVerdictOf({ a: "dislike", s: 2 })).toBe("review_low");
    expect(demoVerdictOf({ a: "hide", s: 2 })).toBe("review_low");
  });

  it("like: lo score decide il livello", () => {
    expect(demoVerdictOf({ a: "like", s: 1 })).toBe("review_low");
    expect(demoVerdictOf({ a: "like", s: 2 })).toBe("review_low");
    expect(demoVerdictOf({ a: "like", s: 3 })).toBe("review_ok");
    expect(demoVerdictOf({ a: "like", s: 5 })).toBe("top");
    expect(demoVerdictOf({ a: "like", s: null })).toBe("review_ok");
  });

  it("ogni combinazione ricade in uno dei 4 livelli previsti", () => {
    const LEVELS = new Set(["top", "review_ok", "review_low", "no"]);
    for (const a of ["like", "dislike", "hide", "star", "clear", "boh"]) {
      for (const s of [null, 1, 2, 3, 4, 5]) {
        expect(LEVELS.has(demoVerdictOf({ a, s })), `${a}/${s}`).toBe(true);
      }
    }
  });
});
