/**
 * Test unitari — lib/chat-delivery.ts (vitest, girati da tests/js).
 *
 * Cosa proteggono, cioè cosa può tornare a rompersi in silenzio: la chat
 * mostrava la bolla dell'utente come "inviata" e non diceva altro, per
 * sempre. Il 24/07 tre messaggi sono rimasti sei ore senza arrivare
 * all'agente e la UI era indistinguibile da un agente che sta pensando.
 *
 * Le due proprietà da tenere:
 *  · un turno consegnato si vede consegnato, e uno fermo si vede fermo;
 *  · non si accusa a vuoto — un allarme falso insegna a ignorare gli
 *    allarmi, che è di nuovo un guasto invisibile.
 */
import { describe, it, expect } from "vitest";
import {
  CHAT_DELIVERY_STALE_MS,
  chatLanePending,
  chatLaneStalled,
  chatTurnDelivery,
  hasStalledTurn,
} from "./chat-delivery";
import type { PendingMessage } from "./types";

const NOW = Date.parse("2026-07-24T15:31:00Z");
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();

function turn(over: Partial<PendingMessage> = {}): PendingMessage {
  return {
    id: "42",
    agent: "capitano",
    body: "ciao",
    kind: "notification",
    author: "user",
    related_position_id: null,
    delivered_via: "web",
    delivered_at: null,
    acknowledged_at: iso(0),
    user_reply: null,
    user_reply_at: null,
    agent_seen_reply_at: null,
    created_at: iso(0),
    ...over,
  };
}

describe("stato del turno dell'utente", () => {
  it("bolla ottimistica: la POST è ancora in volo", () => {
    expect(chatTurnDelivery(turn({ id: "pending:x" }), null, NOW)).toBe(
      "sending",
    );
  });

  it("riga sul cloud, box non ancora passato: inviato", () => {
    expect(chatTurnDelivery(turn(), null, NOW)).toBe("sent");
  });

  it("delivered_at valorizzato: l'agente ce l'ha nel pane", () => {
    expect(chatTurnDelivery(turn({ delivered_at: iso(1000) }), null, NOW)).toBe(
      "delivered",
    );
  });

  it("non consegnato da ore: fermo, e si vede", () => {
    const sixHours = turn({ created_at: iso(6 * 3600_000) });
    expect(chatTurnDelivery(sixHours, null, NOW)).toBe("stalled");
    // Il caso dell'incidente: il campanello suona da sei ore e nessuno ha
    // mai risposto (chat_delivered_at mai scritto).
    const lane = { requestedAt: iso(6 * 3600_000), deliveredAt: null };
    expect(chatTurnDelivery(sixHours, lane, NOW)).toBe("stalled");
  });

  it("appena sotto la soglia: si aspetta ancora, senza allarmi", () => {
    const recent = turn({ created_at: iso(CHAT_DELIVERY_STALE_MS - 1000) });
    expect(chatTurnDelivery(recent, null, NOW)).toBe("sent");
  });

  it("corsia chiusa dopo il turno: non si accusa (evento Realtime perso)", () => {
    // Il box ha confermato di aver ritirato tutto DOPO questo messaggio: se
    // la riga risulta ancora non consegnata la spiegazione più probabile è
    // un UPDATE che non è arrivato al browser, non un guasto della corsia.
    const old = turn({ created_at: iso(6 * 3600_000) });
    const lane = { requestedAt: iso(6 * 3600_000), deliveredAt: iso(60_000) };
    expect(chatTurnDelivery(old, lane, NOW)).toBe("sent");
  });

  it("i turni dell'agente non portano segni di consegna", () => {
    expect(chatTurnDelivery(turn({ author: "agent" }), null, NOW)).toBe(
      "delivered",
    );
  });
});

describe("stato della corsia", () => {
  it("pendente finché la consegna non supera la richiesta", () => {
    expect(chatLanePending(null)).toBe(false);
    expect(chatLanePending({ requestedAt: null, deliveredAt: null })).toBe(
      false,
    );
    expect(chatLanePending({ requestedAt: iso(1000), deliveredAt: null })).toBe(
      true,
    );
    // `iso(n)` è "n ms fa": una richiesta più RECENTE della consegna è un
    // turno che il box non ha ancora ritirato.
    expect(
      chatLanePending({ requestedAt: iso(1000), deliveredAt: iso(2000) }),
    ).toBe(true);
    expect(
      chatLanePending({ requestedAt: iso(3000), deliveredAt: iso(2000) }),
    ).toBe(false);
  });

  it("confronta le date, non le stringhe", () => {
    // `+00:00` e `Z` ordinano diversamente da come si datano: è la trappola
    // del cursore congelato del 15/07, e qui costerebbe una chat muta.
    expect(
      chatLanePending({
        requestedAt: "2026-07-24T10:00:00+00:00",
        deliveredAt: "2026-07-24T09:00:00Z",
      }),
    ).toBe(true);
  });

  it("il campanello che suona da troppo è la corsia ferma", () => {
    expect(
      chatLaneStalled({ requestedAt: iso(30_000), deliveredAt: null }, NOW),
    ).toBe(false);
    expect(
      chatLaneStalled(
        { requestedAt: iso(6 * 3600_000), deliveredAt: null },
        NOW,
      ),
    ).toBe(true);
  });
});

describe("avviso di conversazione", () => {
  it("scatta se anche un solo turno è rimasto indietro", () => {
    const messages = [
      turn({ id: "1", delivered_at: iso(3600_000) }),
      turn({ id: "2", created_at: iso(6 * 3600_000) }),
    ];
    expect(hasStalledTurn(messages, null, NOW)).toBe(true);
  });

  it("resta zitto su una conversazione sana", () => {
    const messages = [
      turn({ id: "1", delivered_at: iso(3600_000) }),
      turn({ id: "2", author: "agent", created_at: iso(6 * 3600_000) }),
    ];
    expect(hasStalledTurn(messages, null, NOW)).toBe(false);
  });
});
