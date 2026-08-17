/**
 * O-101 — l'allarme deve suonare per il turno del Mentor e tacere per quello
 * del Capitano, e sono lo stesso identico dato tranne un invio.
 *
 * I casi qui dentro sono quelli misurati sul campo, non inventati:
 *  - il Mentor riceve il turno alle 11:17 e il suo turno muore su un limite di
 *    sessione: nessun invio dopo, resta fermo un'ora e tre quarti;
 *  - su tre giorni, due turni risultavano senza presa in carico e UNO DEI DUE
 *    era un falso positivo — il Capitano aveva risposto 50 secondi dopo. Un
 *    allarme falso una volta su due viene spento entro una settimana, quindi
 *    quel caso è un test, non una nota a piè di pagina.
 *
 * ⚠️ Il segnale NON è `acknowledged_at`: quel campo dice cosa ha fatto
 * l'UTENTE (lo scrive la route quando lui manda dal sito, o l'auto-ack della
 * lista quando apre la dashboard) e nel container non lo scrive nessuno. Il
 * modulo lo ignora di proposito, e il commento in testa porta i numeri.
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_GRACE_MS,
  stalledTurns,
  turnPickupVerdicts,
} from "../../../shared/agents/turn-pickup.js";

const root = resolve(__dirname, "../../..");

/** La mappa vera, letta dallo strumento che decide da quale bot si esce. */
function botRoleOfFromSource() {
  const source = readFileSync(
    join(root, "agents/_tools/jht-notify-user"),
    "utf8",
  );
  const declared = source.match(/BOT_ROLES = \(([^)]*)\)/);
  if (!declared) throw new Error("BOT_ROLES non trovato in jht-notify-user");
  const roles = [...declared[1].matchAll(/"([a-z]+)"/g)].map((m) => m[1]);
  if (roles.length === 0) throw new Error("BOT_ROLES vuoto");
  return (agent: string) => {
    const role = String(agent || "").toLowerCase();
    return roles.includes(role)
      ? { role, exclusive: true }
      : { role: "assistente", exclusive: false };
  };
}

const botRoleOf = botRoleOfFromSource();
const consegna = "2026-08-17T13:57:15Z";
const dopo = "2026-08-17T15:40:00Z";

describe("O-101 — un turno consegnato che nessuno raccoglie", () => {
  it("suona per il turno che ha ucciso il pomeriggio del Mentor", () => {
    const fermi = stalledTurns({
      turns: [{ legacyId: 369, agent: "mentor", deliveredAt: consegna }],
      sends: [],
      now: dopo,
      botRoleOf,
    });

    expect(fermi).toEqual([
      {
        legacyId: 369,
        agent: "mentor",
        verdict: "stalled",
        reason: "no_agent_activity_after_delivery",
      },
    ]);
  });

  it("tace per il Capitano che aveva risposto cinquanta secondi dopo", () => {
    // Il falso positivo misurato da HQ-VPS: senza questa correlazione
    // l'allarme sbaglierebbe una volta su due.
    const verdetti = turnPickupVerdicts({
      turns: [{ legacyId: 401, agent: "capitano", deliveredAt: consegna }],
      sends: [{ ts: "2026-08-17T13:58:05Z", from: "capitano", ok: true }],
      now: dopo,
      botRoleOf,
    });

    expect(verdetti[0]).toMatchObject({ verdict: "picked_up" });
    expect(
      stalledTurns({
        turns: [{ legacyId: 401, agent: "capitano", deliveredAt: consegna }],
        sends: [{ ts: "2026-08-17T13:58:05Z", from: "capitano", ok: true }],
        now: dopo,
        botRoleOf,
      }),
    ).toEqual([]);
  });

  it("un invio di un ALTRO agente non salva il turno fermo", () => {
    // È la differenza fra «il team è vivo» e «questo agente ha lavorato»:
    // il primo non è mai stata la domanda.
    const verdetti = turnPickupVerdicts({
      turns: [{ legacyId: 369, agent: "mentor", deliveredAt: consegna }],
      sends: [{ ts: "2026-08-17T13:58:05Z", from: "capitano", ok: true }],
      now: dopo,
      botRoleOf,
    });

    expect(verdetti[0]).toMatchObject({ verdict: "stalled" });
  });

  it("un invio FALLITO non prova niente", () => {
    const verdetti = turnPickupVerdicts({
      turns: [{ legacyId: 369, agent: "mentor", deliveredAt: consegna }],
      sends: [{ ts: "2026-08-17T13:58:05Z", from: "mentor", ok: false }],
      now: dopo,
      botRoleOf,
    });

    expect(verdetti[0]).toMatchObject({ verdict: "stalled" });
  });

  it("un invio PRIMA della consegna non conta come presa in carico", () => {
    // Altrimenti un agente che ha scritto ieri coprirebbe per sempre ogni
    // turno che riceve oggi.
    const verdetti = turnPickupVerdicts({
      turns: [{ legacyId: 369, agent: "mentor", deliveredAt: consegna }],
      sends: [{ ts: "2026-08-17T13:57:00Z", from: "mentor", ok: true }],
      now: dopo,
      botRoleOf,
    });

    expect(verdetti[0]).toMatchObject({ verdict: "stalled" });
  });

  it("dentro la finestra di grazia non dice ancora niente", () => {
    const verdetti = turnPickupVerdicts({
      turns: [{ legacyId: 369, agent: "mentor", deliveredAt: consegna }],
      sends: [],
      now: new Date(Date.parse(consegna) + DEFAULT_GRACE_MS - 1000),
      botRoleOf,
    });

    expect(verdetti[0]).toMatchObject({ verdict: "too_early" });
  });

  it("chi non ha un bot suo resta indecidibile, non accusato", () => {
    // Scout, Analista e Scorer escono dal bot dell'Assistente: vedere un
    // invio di quel bot non dice CHI ha lavorato, e non vederlo non dice che
    // siano fermi. Meglio un allarme mancato che uno che accusa il collega
    // sbagliato — è la ragione per cui `botRoleOf` non ha un default.
    const verdetti = turnPickupVerdicts({
      turns: [{ legacyId: 500, agent: "scout", deliveredAt: consegna }],
      sends: [],
      now: dopo,
      botRoleOf,
    });

    expect(verdetti[0]).toMatchObject({
      verdict: "undecidable",
      reason: "shared_bot",
    });
  });

  it("confronta istanti, non stringhe, e pretende una mappa dei bot", () => {
    // Le due sorgenti parlano lingue diverse: il cloud rende
    // `2026-08-17T13:57:15+00:00`, il log scrive `2026-08-17T13:58:05Z`.
    const verdetti = turnPickupVerdicts({
      turns: [
        {
          legacyId: 369,
          agent: "mentor",
          deliveredAt: "2026-08-17T13:57:15+00:00",
        },
      ],
      sends: [{ ts: "2026-08-17T13:58:05Z", from: "mentor", ok: true }],
      now: dopo,
      botRoleOf,
    });
    expect(verdetti[0]).toMatchObject({ verdict: "picked_up" });

    expect(() =>
      // @ts-expect-error: la mappa manca apposta
      turnPickupVerdicts({ turns: [], sends: [], now: dopo }),
    ).toThrow(/botRoleOf/);
  });
});
