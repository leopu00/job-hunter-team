/**
 * Test unitari — cli/src/lib/bootstrap-push.js (vitest)
 *
 * [CLOUDSYNC-PUSH-ONLY-WHEN-WATCHED] Il push locale→cloud è on-demand per
 * scelta: senza browser, un box appena creato resta invisibile sul cloud
 * (misurato 2026-07-27: 25 posizioni sul box, 0 righe su Supabase ~50 minuti
 * dopo il pairing). Il bootstrap-push copre quella finestra e SOLO quella.
 *
 * Quello che questi test proteggono non è tanto "spinge" quanto **smette**: la
 * voce di backlog impone che a regime il ragionamento sulla quota resti valido,
 * cioè che questo non diventi mai un poller permanente. Le tre garanzie di
 * terminazione (fase steady · budget · finestra) sono indipendenti, e ognuna ha
 * qui il suo test — perché se una sola reggesse, un'installazione anomala
 * basterebbe a trasformare la cura nel problema.
 */
import { describe, it, expect } from "vitest";
import {
  bootstrapLimits,
  decideBootstrapPush,
  nextBootstrapState,
  signatureIsEmpty,
  signaturesDiffer,
  PHASE_STEADY,
} from "../../../cli/src/lib/bootstrap-push.js";

const T0 = Date.UTC(2026, 6, 27, 12, 0, 0);
const iso = (ms: number) => new Date(ms).toISOString();
const MIN = 60_000;
const H = 60 * MIN;

const limits = bootstrapLimits({});
const sig = (n = 3) => ({ positions: { n, max: "2026-07-27 12:00:00" }, profile: null });

// Comodo: la decisione completa (le due passate che fa il daemon).
function decide(over: Record<string, unknown> = {}) {
  const base = { now: T0, phase: "burst" as string | null, state: {} as any, limits, signature: sig() };
  return decideBootstrapPush({ ...base, ...over } as any);
}

describe("limiti di default", () => {
  it("cadenza 15 min, budget 24 push, finestra 6h", () => {
    expect(limits.enabled).toBe(true);
    expect(limits.intervalMs).toBe(15 * MIN);
    expect(limits.maxPushes).toBe(24);
    expect(limits.windowMs).toBe(6 * H);
  });

  it("il budget al ritmo massimo non supera la finestra", () => {
    // Se il budget coprisse più della finestra (o viceversa) uno dei due
    // cancelli sarebbe decorativo: si equivalgono per costruzione.
    expect(limits.maxPushes * limits.intervalMs).toBe(limits.windowMs);
  });

  it("override da env per la verifica manuale / i test E2E", () => {
    const l = bootstrapLimits({
      JHT_BOOTSTRAP_PUSH_SEC: "3",
      JHT_BOOTSTRAP_PUSH_MAX: "2",
      JHT_BOOTSTRAP_PUSH_WINDOW_H: "1",
    });
    expect(l).toMatchObject({ intervalMs: 3000, maxPushes: 2, windowMs: H });
  });

  it("JHT_CLOUD_BOOTSTRAP_PUSH=0 è l'interruttore d'emergenza", () => {
    const l = bootstrapLimits({ JHT_CLOUD_BOOTSTRAP_PUSH: "0" });
    expect(l.enabled).toBe(false);
    expect(decide({ limits: l }).push).toBe(false);
  });
});

describe("quando spinge", () => {
  it("il primo push non aspetta la cadenza: appena c'è un dato, parte", () => {
    const d = decide();
    expect(d.push).toBe(true);
    expect(d.reason).toBe("primo-push");
  });

  it("dopo il primo, uno ogni intervallo", () => {
    const state = { pushes: 1, started_at: iso(T0 - 20 * MIN), last_push_at: iso(T0 - 20 * MIN) };
    expect(decide({ state }).push).toBe(true);
  });

  it("dentro l'intervallo non spinge", () => {
    const state = { pushes: 1, started_at: iso(T0 - 5 * MIN), last_push_at: iso(T0 - 5 * MIN) };
    expect(decide({ state })).toMatchObject({ push: false, reason: "cadenza" });
  });

  it("niente di nuovo in locale = nessun push (il budget non si consuma a vuoto)", () => {
    const state = {
      pushes: 1,
      started_at: iso(T0 - 20 * MIN),
      last_push_at: iso(T0 - 20 * MIN),
      signature: sig(3),
    };
    expect(decide({ state, signature: sig(3) })).toMatchObject({ push: false, reason: "niente-di-nuovo" });
    expect(decide({ state, signature: sig(4) }).push).toBe(true);
  });

  it("DB vuoto: niente da spingere (è il caso del push di `cloud login`)", () => {
    expect(decide({ signature: { positions: { n: 0, max: null }, profile: null } }))
      .toMatchObject({ push: false, reason: "niente-in-locale" });
  });

  it("DB illeggibile: si sta zitti, non si inventa un push", () => {
    expect(decide({ signature: null })).toMatchObject({ push: false, reason: "db-illeggibile" });
  });

  it("la firma si calcola solo se i cancelli a costo zero sono già passati", () => {
    // Nessuna apertura di SQLite finché fase/budget/finestra/cadenza non
    // hanno dato via libera: a regime il tick del daemon legge 2 file JSON.
    expect(decideBootstrapPush({ now: T0, phase: "burst", state: {}, limits }))
      .toMatchObject({ needsSignature: true, push: false });
    expect(decideBootstrapPush({ now: T0, phase: PHASE_STEADY, state: {}, limits }))
      .toMatchObject({ needsSignature: false });
  });
});

describe("garanzia 1 — la fase steady chiude", () => {
  it("phase steady → done, e non spinge", () => {
    expect(decide({ phase: PHASE_STEADY })).toMatchObject({
      push: false, done: true, doneReason: "steady",
    });
  });

  it("un'installazione già a regime non riceve MAI un push senza browser", () => {
    // `first_run.py` fa nascere `steady` un DB che ha già punteggi (tipico:
    // aggiornamento di un'installazione esistente). Quel caso non è una lacuna
    // e non deve pagare nulla.
    const d = decide({ phase: PHASE_STEADY, signature: sig(500) });
    expect(d.push).toBe(false);
  });

  it("una volta done resta done, qualunque cosa dica la fase", () => {
    const state = { done: true, done_reason: "steady", pushes: 4 };
    expect(decide({ state, phase: "burst" })).toMatchObject({ push: false, reason: "done" });
  });

  it("fase sconosciuta: non spinge, ma non si chiude (il file può comparire dopo)", () => {
    const d = decide({ phase: null });
    expect(d.push).toBe(false);
    expect(d.done).toBe(false);
  });
});

describe("garanzia 2 — il budget chiude anche se la fase non passa mai", () => {
  it("awaiting_profile per sempre si esaurisce sul contatore", () => {
    const state = { pushes: 24, started_at: iso(T0 - 30 * MIN), last_push_at: iso(T0 - 30 * MIN) };
    expect(decide({ state, phase: "awaiting_profile" })).toMatchObject({
      push: false, done: true, doneReason: "budget",
    });
  });

  it("il contatore è persistito: un daemon che riparte non lo ricarica", () => {
    // Riavviare il daemon rilegge lo stesso file: `pushes` non torna a zero.
    const restarted = { pushes: 24, started_at: iso(T0 - H), last_push_at: iso(T0 - H) };
    expect(decide({ state: restarted }).done).toBe(true);
  });

  it("il contatore avanza anche sui push falliti", () => {
    const next = nextBootstrapState({
      state: { pushes: 5 }, now: T0, signature: sig(),
      result: { ok: false, authFailed: false, skipped: 0 },
    });
    expect(next.pushes).toBe(6);
    // ...ma la firma no: il tick dopo ritenta le stesse righe.
    expect(next.signature).toBeUndefined();
  });
});

describe("garanzia 3 — la finestra a orologio chiude", () => {
  it("oltre 6h dal primo push si chiude, budget residuo o no", () => {
    const state = { pushes: 2, started_at: iso(T0 - 7 * H), last_push_at: iso(T0 - 6 * H) };
    expect(decide({ state })).toMatchObject({ push: false, done: true, doneReason: "finestra" });
  });

  it("dentro la finestra si continua", () => {
    const state = { pushes: 2, started_at: iso(T0 - 2 * H), last_push_at: iso(T0 - 30 * MIN) };
    expect(decide({ state }).push).toBe(true);
  });

  it("started_at illeggibile non blocca né apre all'infinito (resta il budget)", () => {
    const state = { pushes: 24, started_at: "non-una-data", last_push_at: iso(T0 - H) };
    expect(decide({ state })).toMatchObject({ done: true, doneReason: "budget" });
  });
});

describe("esiti del push → stato successivo", () => {
  it("successo pieno: la firma avanza (il tick dopo non ri-spinge lo stesso)", () => {
    const next = nextBootstrapState({
      state: {}, now: T0, signature: sig(3), result: { ok: true, authFailed: false, skipped: 0 },
    });
    expect(next).toMatchObject({ pushes: 1, started_at: iso(T0), last_push_at: iso(T0) });
    expect(next.signature).toEqual(sig(3));
  });

  it("righe scartate dopo un 413: la firma NON avanza → si ritenta", () => {
    // Stessa regola dell'ack del rendezvous (`sync_completed_at` solo su push
    // integro): un push che ha scartato righe non è un sync riuscito.
    const next = nextBootstrapState({
      state: {}, now: T0, signature: sig(3), result: { ok: true, authFailed: false, skipped: 1 },
    });
    expect(next.signature).toBeUndefined();
    expect(next.pushes).toBe(1);
  });

  it("401/403: si chiude subito, inutile insistere su un token revocato", () => {
    const next = nextBootstrapState({
      state: {}, now: T0, signature: sig(), result: { ok: false, authFailed: true, skipped: 0 },
    });
    expect(next).toMatchObject({ done: true, done_reason: "auth" });
    expect(decide({ state: next }).push).toBe(false);
  });

  it("started_at si fissa al PRIMO push e non si sposta più", () => {
    const first = nextBootstrapState({
      state: {}, now: T0, signature: sig(), result: { ok: true, authFailed: false, skipped: 0 },
    });
    const second = nextBootstrapState({
      state: first, now: T0 + H, signature: sig(4), result: { ok: true, authFailed: false, skipped: 0 },
    });
    expect(second.started_at).toBe(first.started_at);
    expect(second.last_push_at).toBe(iso(T0 + H));
  });
});

describe("firma locale — solo uguaglianze, mai ordinamenti", () => {
  // Il freeze del 2026-07-15 nasce da un confronto di stringhe usato come
  // confronto di date (`...Z` vs `...+00:00`). Qui non si ordina niente: si
  // guarda solo se qualcosa è cambiato, per tabella. Un formato inatteso può
  // al massimo costare un push in più — mai un blocco.
  it("conteggio diverso = cambiato", () => {
    expect(signaturesDiffer({ positions: { n: 3, max: "a" } }, { positions: { n: 4, max: "a" } })).toBe(true);
  });

  it("timbro diverso a parità di conteggio = cambiato (una riga aggiornata)", () => {
    expect(signaturesDiffer({ positions: { n: 3, max: "a" } }, { positions: { n: 3, max: "b" } })).toBe(true);
  });

  it("identiche = non cambiato", () => {
    expect(signaturesDiffer({ positions: { n: 3, max: "a" } }, { positions: { n: 3, max: "a" } })).toBe(false);
  });

  it("nessuna firma precedente = cambiato (primo giro)", () => {
    expect(signaturesDiffer(sig(), null)).toBe(true);
  });

  it("una tabella che compare (schema aggiornato) = cambiato", () => {
    expect(signaturesDiffer({ positions: { n: 1, max: "a" }, scores: { n: 1, max: "a" } },
      { positions: { n: 1, max: "a" }, scores: null })).toBe(true);
  });

  it("un timbro nullo non è confuso con la stringa vuota", () => {
    expect(signaturesDiffer({ t: { n: 0, max: null } }, { t: { n: 0, max: "" } })).toBe(false);
    expect(signaturesDiffer({ t: { n: 0, max: null } }, { t: { n: 0, max: null } })).toBe(false);
  });

  it("vuoto = nessuna riga da nessuna parte", () => {
    expect(signatureIsEmpty(null)).toBe(true);
    expect(signatureIsEmpty({ positions: { n: 0, max: null }, profile: null })).toBe(true);
    expect(signatureIsEmpty({ positions: { n: 0, max: null }, profile: { n: 120, max: "1" } })).toBe(false);
  });
});
