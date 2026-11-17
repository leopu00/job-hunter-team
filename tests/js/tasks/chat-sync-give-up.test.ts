/**
 * A user's turn that cannot reach the pane is not retried forever.
 *
 * Seen on a box: a text left unsent in an agent's composer made every delivery end 130, for days; the turn stayed in
 * the queue with 31 tries, the daemon logged «stuck for NNNh» every 15 minutes, and the person saw the message as sent.
 * Here: after N failures that are not «busy» the turn is given up and the person reads it in the chat; a turn older
 * than a day, or overtaken by the agent's later messages, is never delivered late; a busy agent (rc 4, rc 8) never
 * makes a turn be given up; a turn with an uncertain outcome is never touched.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import {
  deliverPendingUserTurns,
  deliveryRetryStatus,
  givenUpCloudUserTurnIds,
  givenUpNotice,
  undeliveredUserTurns,
} from "../../../cli/src/lib/chat-sync.js";

const SCHEMA = `
CREATE TABLE pending_user_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent TEXT NOT NULL,
  body TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'notification',
  author TEXT NOT NULL DEFAULT 'agent',
  chat_ts REAL,
  source_id TEXT,
  source_action TEXT,
  source_payload TEXT,
  source_directive_id INTEGER,
  related_position_id INTEGER,
  delivered_via TEXT,
  delivered_at TIMESTAMP,
  acknowledged_at TIMESTAMP,
  user_reply TEXT,
  user_reply_at TIMESTAMP,
  agent_seen_reply_at TIMESTAMP,
  cloud_synced_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
`;

const HOUR = 3600 * 1000;
const NOW = Date.parse("2026-11-17T12:00:00Z");
const stamp = (ms: number) => new Date(ms).toISOString().replace("T", " ").slice(0, 19);

let db: InstanceType<typeof DatabaseSync>;

beforeEach(() => {
  db = new DatabaseSync(":memory:");
  db.exec(SCHEMA);
});

const seed = (agent: string, body: string, author: string, createdAt: number, chatTs: number | null = null) =>
  Number(
    db
      .prepare("INSERT INTO pending_user_messages (agent, body, author, created_at, chat_ts) VALUES (?, ?, ?, ?, ?)")
      .run(agent, body, author, stamp(createdAt), chatTs).lastInsertRowid,
  );

const notices = () =>
  db
    .prepare("SELECT agent, body, kind, author FROM pending_user_messages WHERE author = 'agent' AND kind = 'alert'")
    .all() as Array<{ agent: string; body: string; kind: string; author: string }>;

describe("a user's turn that cannot reach the pane", () => {
  it("is given up after N refusals, and the person reads it in their chat, in their language", async () => {
    const id = seed("assistente", "quando arriva la prossima offerta?", "user", NOW - 60_000);
    let clock = NOW;
    let tries = 0;
    const send = async () => {
      tries += 1;
      return { ok: false, code: 130, error: "composer not ours" };
    };
    const opts = { sendFn: send, now: () => clock, random: () => 0.5, giveUpAttempts: 3, language: "it" };
    expect(await deliverPendingUserTurns(db, opts)).toEqual({ delivered: 0, failed: 1 });
    clock += 600_000;
    expect(await deliverPendingUserTurns(db, opts)).toEqual({ delivered: 0, failed: 1 });
    clock += 600_000;
    expect(await deliverPendingUserTurns(db, opts)).toEqual({ delivered: 0, failed: 1, givenUp: 1 });
    expect(tries).toBe(3);

    const [notice] = notices();
    expect(notice.agent).toBe("assistente");
    expect(notice.body).toContain("«quando arriva la prossima offerta?»");
    expect(notice.body).toContain("Se serve ancora, riscrivilo");

    // never delivered, never retried, and the lane no longer counts it as stuck
    const row = db.prepare("SELECT delivered_at FROM pending_user_messages WHERE id = ?").get(id) as any;
    expect(row.delivered_at).toBeNull();
    clock += 24 * HOUR;
    expect(await deliverPendingUserTurns(db, opts)).toEqual({ delivered: 0, failed: 0 });
    expect(tries).toBe(3);
    expect(undeliveredUserTurns(db).count).toBe(0);
    expect(deliveryRetryStatus(db, { now: clock }).queued).toBe(0);
    expect(notices()).toHaveLength(1);
  });

  it("is never given up because the agent is busy (rc 4, rc 8)", async () => {
    seed("capitano", "a che punto siamo?", "user", NOW - 60_000);
    let clock = NOW;
    const codes = [4, 8, 4, 8, 4];
    for (const code of codes) {
      await deliverPendingUserTurns(db, {
        sendFn: async () => ({ ok: false, code, error: "busy" }),
        now: () => clock,
        random: () => 0.5,
        giveUpAttempts: 2,
      });
      clock += 600_000;
    }
    expect(notices()).toHaveLength(0);
    expect(undeliveredUserTurns(db).count).toBe(1);
    const res = await deliverPendingUserTurns(db, {
      sendFn: async () => ({ ok: true, code: 0, error: "" }),
      now: () => clock,
      giveUpAttempts: 2,
    });
    expect(res).toEqual({ delivered: 1, failed: 0 });
  });

  it("older than a day is never delivered: the person is told instead", async () => {
    seed("assistente", "messaggio di giorni fa", "user", NOW - 12 * 24 * HOUR);
    const sent: string[] = [];
    const res = await deliverPendingUserTurns(db, {
      sendFn: async (_agent: string, text: string) => {
        sent.push(text);
        return { ok: true, code: 0, error: "" };
      },
      now: () => NOW,
      language: "en",
    });
    expect(res).toEqual({ delivered: 0, failed: 0, givenUp: 1 });
    expect(sent).toEqual([]);
    expect(notices()[0].body).toBe(givenUpNotice("too_old", "messaggio di giorni fa", "en"));
    expect(notices()[0].body).toContain("waited more than a day");
  });

  it("overtaken by the agent's later messages and older than two hours is not delivered; a young one is", async () => {
    seed("assistente", "domanda vecchia", "user", NOW - 3 * HOUR);
    seed("assistente", "una risposta dell'agente", "agent", NOW - 1 * HOUR);
    seed("mentor", "domanda giovane", "user", NOW - 30 * 60_000);
    seed("mentor", "il mentor ha scritto dopo", "agent", NOW - 10 * 60_000);
    const sent: string[] = [];
    const res = await deliverPendingUserTurns(db, {
      sendFn: async (_agent: string, text: string) => {
        sent.push(text);
        return { ok: true, code: 0, error: "" };
      },
      now: () => NOW,
      language: "en",
    });
    expect(res).toEqual({ delivered: 1, failed: 0, givenUp: 1 });
    expect(sent).toEqual(["domanda giovane"]);
    expect(notices()[0].body).toContain("the conversation went on without it");
  });

  it("with an uncertain outcome (a durable claim) is never given up: it may already be in the pane", async () => {
    const id = seed("assistente", "forse già consegnato", "user", NOW - 3 * 24 * HOUR);
    await deliverPendingUserTurns(db, { sendFn: async () => ({ ok: true, code: 0, error: "" }), now: () => NOW });
    // the first round delivered or gave it up; seed a twin with a claim held by another process
    const twin = seed("assistente", "con un claim", "user", NOW - 3 * 24 * HOUR);
    db.prepare("INSERT INTO pending_user_message_delivery_claims (message_id) VALUES (?)").run(twin);
    const before = notices().length;
    const res = await deliverPendingUserTurns(db, { sendFn: async () => ({ ok: true, code: 0, error: "" }), now: () => NOW });
    expect(res).toEqual({ delivered: 0, failed: 0 });
    expect(notices()).toHaveLength(before);
    expect(undeliveredUserTurns(db).uncertain).toBe(1);
    expect(id).toBeGreaterThan(0);
  });

  it("closes the rendezvous without being acknowledged as delivered", async () => {
    seed("assistente", "dal web, vecchio", "user", NOW - 3 * 24 * HOUR, 1_700_000_000.5);
    await deliverPendingUserTurns(db, { sendFn: async () => ({ ok: true, code: 0, error: "" }), now: () => NOW });
    const cloudRow = { id: 41, legacy_id: -1_700_000_000_500, agent: "assistente", body: "dal web, vecchio" };
    expect(givenUpCloudUserTurnIds(db, [cloudRow])).toEqual([cloudRow.id]);
  });
});
