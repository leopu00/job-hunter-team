import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleChatSync } from "../../../cli/src/commands/cloud.js";

const SCHEMA = `
CREATE TABLE pending_user_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent TEXT NOT NULL,
  body TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'notification',
  author TEXT NOT NULL DEFAULT 'agent',
  chat_ts REAL,
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

const CONFIG = {
  enabled: true,
  token: "token-fixture",
  base_url: "https://example.invalid",
  user_id: "00000000-0000-4000-8000-000000000000",
};

let home: string;
let dbPath: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "jht-chat-worker-"));
  dbPath = join(home, "jobs.db");
  const db = new DatabaseSync(dbPath);
  db.exec(SCHEMA);
  db.close();
});

afterEach(() => rmSync(home, { recursive: true, force: true }));

describe("handleChatSync — worker completo", () => {
  it("importa, scrive JSONL, consegna e ACKa una volta sola", async () => {
    let reads = 0;
    let sends = 0;
    let acks = 0;
    const channel = {
      async readUndeliveredUserChat() {
        reads += 1;
        return [{
          id: "00000000-0000-4000-8000-000000000001",
          legacy_id: -1785837600000,
          agent: "capitano",
          body: "messaggio fixture",
          created_at: "2026-08-04T10:00:00Z",
        }];
      },
      async closeRendezvous(ids: string[]) {
        expect(ids).toEqual(["00000000-0000-4000-8000-000000000001"]);
        acks += 1;
      },
    };
    const sendFn = async () => {
      sends += 1;
      return { ok: true, code: 0, error: "" };
    };

    const first = await handleChatSync({
      silent: true,
      config: CONFIG,
      dbPath,
      jhtHome: home,
      reader: null,
      channel,
      state: { chat_requested_at: "2026-08-04T10:00:00Z", chat_delivered_at: null },
      sendFn,
    });
    expect(first).toMatchObject({
      status: "completed",
      pending: true,
      imported: 1,
      delivered: 1,
      failed: 0,
      acked: true,
    });

    // Il giro successivo vede il rendezvous chiuso: nessun nuovo pull,
    // nessun secondo invio e nessun secondo ACK.
    const second = await handleChatSync({
      silent: true,
      config: CONFIG,
      dbPath,
      jhtHome: home,
      reader: null,
      channel,
      state: {
        chat_requested_at: "2026-08-04T10:00:00Z",
        chat_delivered_at: "2026-08-04T10:00:01Z",
      },
      sendFn,
    });
    expect(second).toMatchObject({ status: "completed", pending: false, delivered: 0, acked: false });

    const db = new DatabaseSync(dbPath, { readOnly: true });
    const counts = db
      .prepare("SELECT COUNT(*) AS rows, COUNT(delivered_at) AS delivered FROM pending_user_messages")
      .get() as { rows: number; delivered: number };
    db.close();
    const jsonl = readFileSync(join(home, "agents", "capitano", "chat.jsonl"), "utf-8")
      .trim()
      .split("\n");

    expect(counts).toEqual({ rows: 1, delivered: 1 });
    expect(jsonl).toHaveLength(1);
    expect(JSON.parse(jsonl[0])).toMatchObject({ role: "user", text: "messaggio fixture" });
    expect({ reads, sends, acks }).toEqual({ reads: 1, sends: 1, acks: 1 });
  });
});
