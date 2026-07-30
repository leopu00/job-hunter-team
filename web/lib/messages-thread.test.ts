/**
 * Test unitari — web/lib/messages-thread.ts (vitest)
 *
 * [JHT-CHAT-UNIFY] La chat web sapeva solo *rispondere*: il testo finiva in
 * `pending_user_messages.user_reply`, appeso all'ultimo messaggio
 * dell'agente ancora senza risposta. Finiti quelli, il composer si spegneva
 * con "Nessun messaggio in attesa di risposta" e non c'era modo di aprire
 * una conversazione — è quello che l'utente vedeva sul Mentor.
 *
 * Ora ogni turno è una riga (`author='user'`). Qui si prova la parte pura di
 * quel flusso: la bolla ottimistica e la sua riconciliazione con la riga
 * vera, che è dove si annidano i doppioni (l'evento Realtime può arrivare
 * PRIMA della risposta HTTP alla POST).
 */
import { describe, it, expect } from "vitest";
import {
  optimisticUserTurn,
  withAgentAcked,
  withConfirmedTurn,
  withReply,
  withoutTurn,
  unreadIdsOf,
} from "./messages-thread";
import type { PendingMessage } from "./types";

const msg = (over: Partial<PendingMessage> = {}): PendingMessage => ({
  id: "m1",
  agent: "capitano",
  body: "corpo",
  kind: "notification",
  author: "agent",
  related_position_id: null,
  delivered_via: "web",
  delivered_at: null,
  acknowledged_at: null,
  user_reply: null,
  user_reply_at: null,
  agent_seen_reply_at: null,
  created_at: "2026-07-29T10:00:00.000Z",
  ...over,
});

describe("turno ottimistico dell'utente", () => {
  it("nasce già letto e marcato come utente", () => {
    const t = optimisticUserTurn("mentor", "ciao");
    expect(t.author).toBe("user");
    expect(t.agent).toBe("mentor");
    expect(t.body).toBe("ciao");
    // Un turno scritto da chi lo legge non deve contare fra i non letti.
    expect(t.acknowledged_at).not.toBeNull();
  });

  it("ha un id riconoscibile come provvisorio", () => {
    // La UI lo usa per smorzare la bolla finché il server non conferma.
    expect(optimisticUserTurn("mentor", "ciao").id.startsWith("pending:")).toBe(
      true,
    );
  });

  it("due invii ravvicinati non collidono", () => {
    const a = optimisticUserTurn("mentor", "uno");
    const b = optimisticUserTurn("mentor", "due");
    expect(a.id).not.toBe(b.id);
  });
});

describe("riconciliazione con la riga confermata", () => {
  it("sostituisce la bolla provvisoria", () => {
    const temp = optimisticUserTurn("capitano", "che ore sono?");
    const real = msg({ id: "uuid-1", author: "user", body: "che ore sono?" });
    const out = withConfirmedTurn([temp], temp.id, real);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("uuid-1");
  });

  it("se la riga vera è già arrivata via Realtime, non la duplica", () => {
    // Il websocket può battere la risposta HTTP: senza questa guardia
    // l'utente vedrebbe il proprio messaggio due volte.
    const temp = optimisticUserTurn("capitano", "ciao");
    const real = msg({ id: "uuid-1", author: "user", body: "ciao" });
    const out = withConfirmedTurn([real, temp], temp.id, real);
    expect(out.map((m) => m.id)).toEqual(["uuid-1"]);
  });

  it("senza conferma lascia tutto com'è", () => {
    const temp = optimisticUserTurn("capitano", "ciao");
    expect(withConfirmedTurn([temp], temp.id, null)).toEqual([temp]);
  });

  it("un invio fallito toglie la bolla orfana", () => {
    const temp = optimisticUserTurn("capitano", "ciao");
    const keep = msg({ id: "altro" });
    expect(withoutTurn([temp, keep], temp.id).map((m) => m.id)).toEqual([
      "altro",
    ]);
  });
});

describe("non letti e ack (comportamento invariato)", () => {
  it("conta solo ciò che non è stato ancora ack-ato", () => {
    const list = [
      msg({ id: "a" }),
      msg({ id: "b", acknowledged_at: "2026-07-29T10:00:00.000Z" }),
      msg({ id: "c", agent: "mentor" }),
    ];
    expect(unreadIdsOf(list, "capitano")).toEqual(["a"]);
  });

  it("aprire la conversazione ack-a solo la sua", () => {
    const now = "2026-07-29T11:00:00.000Z";
    const out = withAgentAcked(
      [msg({ id: "a" }), msg({ id: "c", agent: "mentor" })],
      "capitano",
      now,
    );
    expect(out[0].acknowledged_at).toBe(now);
    expect(out[1].acknowledged_at).toBeNull();
  });

  it("le vecchie user_reply restano applicabili", () => {
    // Le conversazioni salvate prima del cambio devono restare leggibili e
    // modificabili con la stessa funzione.
    const now = "2026-07-29T11:00:00.000Z";
    const out = withReply([msg({ id: "a" })], "a", "va bene", now);
    expect(out[0].user_reply).toBe("va bene");
    expect(out[0].acknowledged_at).toBe(now);
  });
});
