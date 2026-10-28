import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  takeChatRowsToPush,
  toCloudRow,
} from "../../../cli/src/lib/chat-sync.js";
import {
  plainQuestionCondition,
  replyColumnsForCloud,
} from "../../../cli/src/lib/local-only-replies.js";

/**
 * La risposta libera a una domanda semplice (`jht-notify-user --kind question`, senza opzioni)
 * resta sul Mac: `close_plain_questions` la copia in `user_reply`, e dai due punti da cui le
 * righe partono verso il cloud — la corsia veloce di chat-sync.js e il full-push di
 * `jht cloud` — quei campi escono NULL. Le domande strutturate (etichette) e la closer
 * (segnaposto) non cambiano.
 */

// Lo schema fedele della tabella reale (shared/skills/_db.py), come in chat-sync.test.ts.
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

const PERSONAL = "Mi chiamo Mario Rossi, il mio numero e 333 1234567";
const AT = "2026-10-28 18:00:00";

let db: InstanceType<typeof DatabaseSync>;

beforeEach(() => {
  db = new DatabaseSync(":memory:");
  db.exec(SCHEMA);
});

afterEach(() => db.close());

function insert(row: Record<string, unknown>) {
  const columns = Object.keys(row);
  const info = db
    .prepare(
      `INSERT INTO pending_user_messages (${columns.join(", ")}) VALUES (${columns
        .map(() => "?")
        .join(", ")})`,
    )
    .run(...(Object.values(row) as never[]));
  return Number(info.lastInsertRowid);
}

const answered = { user_reply: PERSONAL, user_reply_at: AT, agent_seen_reply_at: AT };

/** Le righe come il full-push di cloud.js le legge: le colonne di msgCols, senza altro. */
function fullPushRows() {
  const has = (column: string) =>
    (db.prepare("PRAGMA table_info(pending_user_messages)").all() as { name: string }[]).some(
      (c) => c.name === column,
    );
  const cols = [
    "id",
    "agent",
    "body",
    "kind",
    "related_position_id",
    "delivered_via",
    "delivered_at",
    "acknowledged_at",
    ...replyColumnsForCloud(has),
    "created_at",
    "author",
    "chat_ts",
  ];
  return db.prepare(`SELECT ${cols.join(", ")} FROM pending_user_messages ORDER BY id`).all() as Record<
    string,
    unknown
  >[];
}

const replyOf = (r: Record<string, unknown>) => [r.user_reply, r.user_reply_at, r.agent_seen_reply_at];

describe("la risposta libera a una domanda semplice non esce", () => {
  it("la corsia veloce manda NULL nei tre campi, il testo resta nel database", () => {
    const id = insert({ agent: "assistente", body: "Quale citta?", kind: "question", ...answered });

    const [row] = takeChatRowsToPush(db);
    expect(replyOf(row)).toEqual([null, null, null]);
    expect(JSON.stringify(toCloudRow(row, "u-1"))).not.toContain("Mario Rossi");

    const local = db.prepare("SELECT user_reply FROM pending_user_messages WHERE id = ?").get(id) as {
      user_reply: string;
    };
    expect(local.user_reply).toBe(PERSONAL);
  });

  it("il full-push manda NULL nei tre campi, il testo resta nel database", () => {
    insert({ agent: "assistente", body: "Quale citta?", kind: "question", ...answered });

    const [row] = fullPushRows();
    expect(replyOf(row)).toEqual([null, null, null]);
    expect(JSON.stringify(row)).not.toContain("Mario Rossi");
    expect(db.prepare("SELECT user_reply FROM pending_user_messages").get()).toEqual({ user_reply: PERSONAL });
  });

  it("senza risposta la domanda parte com'e, con la sua data e il suo testo", () => {
    insert({ agent: "assistente", body: "Quale citta?", kind: "question" });
    for (const row of [takeChatRowsToPush(db)[0], fullPushRows()[0]]) {
      expect(replyOf(row)).toEqual([null, null, null]);
      expect(row.body).toBe("Quale citta?");
      expect(row.kind).toBe("question");
    }
  });

  it("il testo della domanda dell'agente non cambia: e la risposta della persona a restare qui", () => {
    insert({ agent: "assistente", body: "Quale citta?", kind: "question", ...answered });
    expect(takeChatRowsToPush(db)[0].body).toBe("Quale citta?");
    expect(fullPushRows()[0].body).toBe("Quale citta?");
  });
});

describe("le altre righe escono come prima", () => {
  const others: [string, Record<string, unknown>][] = [
    [
      "domanda strutturata (etichette)",
      { kind: "question", source_action: "agent_question", source_id: "q-1", user_reply: "Pro (+ nota)", user_reply_at: AT, agent_seen_reply_at: AT },
    ],
    [
      "domanda della closer (segnaposto)",
      { kind: "question", source_action: "closer_application_answer", source_id: "closer-essential:1", user_reply: "[received]", user_reply_at: AT },
    ],
    ["notifica con una risposta del web", { kind: "notification", user_reply: "ok", user_reply_at: AT }],
    ["messaggio della persona", { kind: "notification", author: "user", user_reply: "ok", user_reply_at: AT }],
    ["domanda scritta dalla persona", { kind: "question", author: "user", user_reply: "ok", user_reply_at: AT }],
  ];

  for (const [name, fields] of others) {
    it(`${name}: i tre campi partono col valore vero`, () => {
      insert({ agent: "assistente", body: "testo", ...fields });
      const expected = [fields.user_reply ?? null, fields.user_reply_at ?? null, fields.agent_seen_reply_at ?? null];
      expect(replyOf(takeChatRowsToPush(db)[0])).toEqual(expected);
      expect(replyOf(fullPushRows()[0])).toEqual(expected);
    });
  }

  it("in un database con righe miste maschera solo le domande semplici", () => {
    insert({ agent: "assistente", body: "a", kind: "question", ...answered });
    insert({ agent: "assistente", body: "b", kind: "notification", user_reply: "ok", user_reply_at: AT });
    insert({ agent: "capitano", body: "c", kind: "question", ...answered });
    expect(fullPushRows().map((r) => r.user_reply)).toEqual([null, "ok", null]);
    expect(takeChatRowsToPush(db).map((r: Record<string, unknown>) => r.user_reply)).toEqual([null, "ok", null]);
  });
});

describe("la condizione segue lo schema locale", () => {
  it("con lo schema completo guarda tipo, autore e assenza di source_action", () => {
    expect(plainQuestionCondition(() => true)).toBe(
      "kind = 'question' AND author = 'agent' AND COALESCE(source_action, '') = ''",
    );
  });

  it("un database vecchio senza author e senza source_action maschera comunque le domande", () => {
    expect(plainQuestionCondition(() => false)).toBe("kind = 'question'");
    const old = new DatabaseSync(":memory:");
    old.exec(
      "CREATE TABLE pending_user_messages (id INTEGER PRIMARY KEY, kind TEXT, user_reply TEXT, user_reply_at TEXT, agent_seen_reply_at TEXT)",
    );
    old.exec(
      `INSERT INTO pending_user_messages VALUES (1, 'question', '${PERSONAL}', '${AT}', '${AT}'), (2, 'notification', 'ok', '${AT}', NULL)`,
    );
    const columns = replyColumnsForCloud(() => false).join(", ");
    const rows = old.prepare(`SELECT id, ${columns} FROM pending_user_messages ORDER BY id`).all() as Record<string, unknown>[];
    expect(rows.map((r) => [r.id, r.user_reply, r.user_reply_at])).toEqual([
      [1, null, null],
      [2, "ok", AT],
    ]);
    old.close();
  });
});

describe("i due punti di uscita usano la regola", () => {
  const read = (path: string) => readFileSync(resolve(__dirname, "../../..", path), "utf-8");

  it("il full-push di cloud.js costruisce le colonne con replyColumnsForCloud e non nomina i campi nudi", () => {
    const src = read("cli/src/commands/cloud.js");
    const block = src.slice(src.indexOf("const msgCols = ["), src.indexOf("pendingMessages = readSqliteTable"));
    expect(block).toContain("...replyColumnsForCloud(");
    expect(block).not.toMatch(/'user_reply/);
    expect(block).not.toMatch(/'agent_seen_reply_at'/);
  });

  it("la corsia veloce di chat-sync.js seleziona i campi dalla stessa funzione", () => {
    const src = read("cli/src/lib/chat-sync.js");
    const take = src.slice(src.indexOf("export function takeChatRowsToPush"), src.indexOf("export function markChatRowsPushed"));
    expect(take).toContain("replyColumnsForCloud(");
    expect(take).not.toMatch(/\buser_reply\b,/);
  });
});
