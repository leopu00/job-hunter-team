import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  handleChatSync,
  handleSyncRendezvous,
  patchTeamStateBestEffort,
  readRendezvousState,
} from "../../../cli/src/commands/cloud.js";

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
      async acknowledgeDelivery(
        ids: string[],
        options: { closeRendezvous: boolean; expectedRequestedAt: string },
      ) {
        expect(ids).toEqual(["00000000-0000-4000-8000-000000000001"]);
        expect(options.closeRendezvous).toBe(true);
        expect(options.expectedRequestedAt).toBe("2026-08-04T10:00:00Z");
        acks += 1;
        return { closed: true, superseded: false };
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

    // Simula evento/ACK perso: il giro successivo vede ancora pending e
    // rilegge la stessa riga. Import e JSONL devono restare idempotenti; il
    // pane non deve ricevere un secondo messaggio. L'ACK invece può ritentare.
    const second = await handleChatSync({
      silent: true,
      config: CONFIG,
      dbPath,
      jhtHome: home,
      reader: null,
      channel,
      state: {
        chat_requested_at: "2026-08-04T10:00:00Z",
        chat_delivered_at: null,
      },
      sendFn,
    });
    expect(second).toMatchObject({
      status: "completed",
      pending: true,
      imported: 1,
      delivered: 0,
      acked: true,
    });

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
    expect({ reads, sends, acks }).toEqual({ reads: 2, sends: 1, acks: 2 });
  });

  it("limita nel tempo la pubblicazione observed su direct e fallback HTTP", async () => {
    let directSignal: AbortSignal | undefined;
    let httpSignal: AbortSignal | undefined;
    const reader = {
      patchTeamState: async (_fields: unknown, options?: { signal?: AbortSignal }) => {
        directSignal = options?.signal;
        await new Promise((_resolve, reject) => {
          options?.signal?.addEventListener("abort", () => reject(options.signal?.reason), { once: true });
        });
      },
    };
    const started = Date.now();
    const published = await patchTeamStateBestEffort(
      CONFIG,
      reader,
      { last_action: "sync:timeout", last_action_at: "2026-08-04T10:00:01Z" },
      {
        timeoutMs: 20,
        fetchFn: async (_url: string, init?: { signal?: AbortSignal }) => {
          httpSignal = init?.signal;
          if (init?.signal?.aborted) throw init.signal.reason;
          return { ok: true };
        },
      },
    );
    expect(published).toBe(false);
    expect(Date.now() - started).toBeLessThan(500);
    expect(directSignal).toBeInstanceOf(AbortSignal);
    expect(httpSignal).toBe(directSignal);
    expect(httpSignal?.aborted).toBe(true);
  });

  it("non lascia che una GET appesa blocchi il fast loop sync+chat", async () => {
    let reads = 0;
    let httpSignal: AbortSignal | undefined;
    const reader = {
      async readTeamState(_columns: string[], options?: { signal?: AbortSignal }) {
        reads += 1;
        const signal = options?.signal;
        await new Promise((_resolve, reject) => {
          if (signal?.aborted) return reject(signal.reason);
          signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
        });
      },
    };
    const started = Date.now();
    const state = await readRendezvousState(CONFIG, {
      reader,
      timeoutMs: 20,
      fetchFn: async (_url: string, init?: { signal?: AbortSignal }) => {
        httpSignal = init?.signal;
        throw init?.signal?.reason || new Error("expected aborted signal");
      },
    });
    expect(state).toBeNull();
    expect(Date.now() - started).toBeLessThan(500);
    expect(reads).toBe(2);
    expect(httpSignal?.aborted).toBe(true);
  });

  it("non lascia che l'ACK della richiesta A chiuda una richiesta B arrivata durante il push", async () => {
    const requestA = "2026-08-04T10:00:00Z";
    const requestB = "2026-08-04T10:00:01Z";
    let currentRequest = requestA;
    const bodies: Record<string, unknown>[] = [];
    const result = await handleSyncRendezvous({
      silent: true,
      config: CONFIG,
      reader: null,
      state: { sync_requested_at: requestA, sync_completed_at: null },
      pushFn: async () => {
        currentRequest = requestB;
        return { ok: true, skipped: 0 };
      },
      fetchFn: async (_url: string, init?: Record<string, any>) => {
        const body = JSON.parse(init?.body || "{}");
        bodies.push(body);
        return body.expected_requested_at === currentRequest
          ? ({ ok: true, status: 200, json: async () => ({ applied: true, status: body.status }) } as any)
          : ({ ok: false, status: 409 } as Response);
      },
    });
    expect(result).toEqual({ status: "superseded", retryable: false, via: "http" });
    expect(currentRequest).toBe(requestB);
    expect(bodies).toEqual([{ expected_requested_at: requestA, status: "completed" }]);
  });

  it("ACKa soltanto i cloud ID consegnati entro il budget per tick", async () => {
    const base = Date.now();
    const rows = Array.from({ length: 7 }, (_, i) => ({
      id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
      legacy_id: -(base + i * 1000),
      agent: "capitano",
      body: `messaggio ${i + 1}`,
      created_at: new Date(base + i * 1000).toISOString(),
    }));
    const ackedIds = new Set<string>();
    const acks: Array<{ ids: string[]; close: boolean }> = [];
    let sends = 0;
    const channel = {
      async readUndeliveredUserChat() {
        return rows.filter((row) => !ackedIds.has(row.id));
      },
      async acknowledgeDelivery(ids: string[], options: { closeRendezvous: boolean }) {
        ids.forEach((id) => ackedIds.add(id));
        acks.push({ ids: [...ids], close: options.closeRendezvous });
        return { closed: options.closeRendezvous, superseded: false };
      },
    };
    const run = () => handleChatSync({
      silent: true,
      config: CONFIG,
      dbPath,
      jhtHome: home,
      reader: null,
      channel,
      state: { chat_requested_at: "2026-08-04T10:00:00Z", chat_delivered_at: null },
      sendFn: async () => {
        sends += 1;
        return { ok: true, code: 0, error: "" };
      },
    });

    const first = await run();
    expect(first).toMatchObject({ status: "delivery_pending", delivered: 5, acked: false });
    expect(acks[0]).toEqual({ ids: rows.slice(0, 5).map((row) => row.id), close: false });
    expect(ackedIds.size).toBe(5);

    const second = await run();
    expect(second).toMatchObject({ delivered: 2, acked: true });
    expect(acks[1]).toEqual({ ids: rows.slice(5).map((row) => row.id), close: true });
    expect({ sends, acked: ackedIds.size }).toEqual({ sends: 7, acked: 7 });
  });

  it("preserva gli ACK di A senza chiudere una richiesta chat B", async () => {
    const requestA = "2026-08-04T10:00:00Z";
    const requestB = "2026-08-04T10:00:01Z";
    const rowId = "00000000-0000-4000-8000-000000000099";
    const acknowledged: string[] = [];
    let currentRequest = requestA;
    const channel = {
      async readUndeliveredUserChat() {
        return [{
          id: rowId,
          legacy_id: -1785837600000,
          agent: "capitano",
          body: "messaggio A",
          created_at: requestA,
        }];
      },
      async acknowledgeDelivery(
        ids: string[],
        options: { closeRendezvous: boolean; expectedRequestedAt: string },
      ) {
        acknowledged.push(...ids);
        currentRequest = requestB;
        expect(options).toEqual({ closeRendezvous: true, expectedRequestedAt: requestA });
        return { closed: false, superseded: true };
      },
    };
    const result = await handleChatSync({
      silent: true,
      config: CONFIG,
      dbPath,
      jhtHome: home,
      reader: null,
      channel,
      state: { chat_requested_at: requestA, chat_delivered_at: null },
      sendFn: async () => ({ ok: true, code: 0, error: "" }),
    });
    expect(result).toMatchObject({ status: "delivery_pending", delivered: 1, acked: false });
    expect(acknowledged).toEqual([rowId]);
    expect(currentRequest).toBe(requestB);
  });

  it("non ACKa né chiude una riga destinata a un agente senza pane supportato", async () => {
    let acknowledgements = 0;
    const channel = {
      async readUndeliveredUserChat() {
        return [{
          id: "00000000-0000-4000-8000-000000000098",
          legacy_id: -1785837600000,
          agent: "agente-sconosciuto",
          body: "messaggio non instradabile",
          created_at: "2026-08-04T10:00:00Z",
        }];
      },
      async acknowledgeDelivery() {
        acknowledgements += 1;
        return { closed: true, superseded: false };
      },
    };
    const result = await handleChatSync({
      silent: true,
      config: CONFIG,
      dbPath,
      jhtHome: home,
      reader: null,
      channel,
      state: { chat_requested_at: "2026-08-04T10:00:00Z", chat_delivered_at: null },
      sendFn: async () => ({ ok: true, code: 0, error: "" }),
    });
    expect(result).toMatchObject({
      status: "delivery_pending",
      imported: 0,
      delivered: 0,
      acked: false,
    });
    expect(acknowledgements).toBe(0);
  });
});
