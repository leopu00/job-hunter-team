import type Database from "better-sqlite3";

export const MAX_DIRECTIVE_REQUEST_ID_LENGTH = 180;

export type LocalDirectiveAction = "created" | "edited" | "archived";

export type LocalDirectiveMutation = {
  requestId: string;
  action: LocalDirectiveAction;
  id: number;
  body: string | null;
  kind?: string;
};

export type LocalDirectiveMutationResult = {
  id: string;
  ok: true;
  source: "local";
  request_id: string;
  action: LocalDirectiveAction;
  captain_event: { ok: true; status: "queued" };
};

export class DirectiveRequestMismatchError extends Error {
  constructor() {
    super("request id payload mismatch");
  }
}

export class DirectiveNotFoundError extends Error {
  constructor() {
    super("directive not found");
  }
}

export function publicDirectiveError(error: unknown): {
  error: "request_id_mismatch" | "directive_not_found" | "directive_not_queued";
  status: 404 | 409 | 503;
} {
  if (error instanceof DirectiveRequestMismatchError) {
    return { error: "request_id_mismatch", status: 409 };
  }
  if (error instanceof DirectiveNotFoundError) {
    return { error: "directive_not_found", status: 404 };
  }
  return { error: "directive_not_queued", status: 503 };
}

function ensureColumn(
  db: Database.Database,
  table: string,
  column: string,
  definition: string,
) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{
    name: string;
  }>;
  if (!columns.some((entry) => entry.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

export function ensureLocalDirectiveMutationSchema(db: Database.Database) {
  db.pragma("busy_timeout = 10000");
  db.exec(`
    CREATE TABLE IF NOT EXISTS team_directives (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      body TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'order' CHECK (kind IN ('order','strategy','formation','note')),
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_by TEXT NOT NULL DEFAULT 'user',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      archived_at TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS pending_user_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent TEXT NOT NULL,
      body TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'notification',
      author TEXT NOT NULL DEFAULT 'agent',
      source_id TEXT,
      source_action TEXT,
      source_payload TEXT,
      source_directive_id INTEGER,
      delivered_via TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
  ensureColumn(
    db,
    "pending_user_messages",
    "author",
    "TEXT NOT NULL DEFAULT 'agent'",
  );
  ensureColumn(db, "pending_user_messages", "source_id", "TEXT");
  ensureColumn(db, "pending_user_messages", "source_action", "TEXT");
  ensureColumn(db, "pending_user_messages", "source_payload", "TEXT");
  ensureColumn(db, "pending_user_messages", "source_directive_id", "INTEGER");
  ensureColumn(db, "pending_user_messages", "delivered_via", "TEXT");
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_pending_messages_source_id
      ON pending_user_messages(source_id) WHERE source_id IS NOT NULL;
    CREATE TABLE IF NOT EXISTS team_directive_request_ledger (
      request_id TEXT PRIMARY KEY,
      action TEXT NOT NULL,
      target_id INTEGER NOT NULL,
      payload TEXT,
      result TEXT
    );
  `);
}

function identityPayload(input: LocalDirectiveMutation): string | null {
  if (input.action === "created") {
    return JSON.stringify({ body: input.body, kind: input.kind ?? "order" });
  }
  return input.action === "edited" ? input.body : null;
}

export function mutateLocalTeamDirective(
  db: Database.Database,
  input: LocalDirectiveMutation,
): LocalDirectiveMutationResult {
  ensureLocalDirectiveMutationSchema(db);
  const payload = identityPayload(input);
  const mutation = db.transaction(() => {
    const claim = db
      .prepare(
        "INSERT OR IGNORE INTO team_directive_request_ledger(request_id,action,target_id,payload) VALUES(?,?,?,?)",
      )
      .run(input.requestId, input.action, input.id, payload);
    if (!claim.changes) {
      const prior = db
        .prepare(
          "SELECT action,target_id,payload,result FROM team_directive_request_ledger WHERE request_id=?",
        )
        .get(input.requestId) as
        | {
            action: string;
            target_id: number;
            payload: string | null;
            result: string | null;
          }
        | undefined;
      if (
        !prior ||
        prior.action !== input.action ||
        prior.target_id !== input.id ||
        prior.payload !== payload
      ) {
        throw new DirectiveRequestMismatchError();
      }
      if (!prior.result) throw new Error("request result missing");
      return JSON.parse(prior.result) as LocalDirectiveMutationResult;
    }

    let directiveId = input.id;
    if (input.action === "created") {
      const next = db
        .prepare(
          "SELECT COALESCE(MAX(sort_order), 0) + 1 AS value FROM team_directives WHERE status='active'",
        )
        .get() as { value: number };
      const inserted = db
        .prepare(
          "INSERT INTO team_directives(body,kind,status,sort_order,created_by) VALUES(?,?,'active',?,'user')",
        )
        .run(input.body, input.kind ?? "order", next.value);
      directiveId = Number(inserted.lastInsertRowid);
    } else {
      const changed =
        input.action === "archived"
          ? db
              .prepare(
                "UPDATE team_directives SET status='archived', archived_at=datetime('now','localtime'), updated_at=datetime('now','localtime') WHERE id=? AND status='active'",
              )
              .run(directiveId)
          : db
              .prepare(
                "UPDATE team_directives SET body=?, updated_at=datetime('now','localtime') WHERE id=? AND status='active'",
              )
              .run(input.body, directiveId);
      if (changed.changes !== 1) throw new DirectiveNotFoundError();
    }

    db.prepare(
      "INSERT INTO pending_user_messages(agent,body,kind,author,source_id,source_action,source_payload,source_directive_id,delivered_via) VALUES(?,?,'notification','user',?,?,?,?,NULL)",
    ).run(
      "capitano",
      `[TEAM-DIRECTIVE] ${input.action}`,
      `team-directive:${input.requestId}`,
      input.action,
      input.body,
      directiveId,
    );
    const result: LocalDirectiveMutationResult = {
      id: String(directiveId),
      ok: true,
      source: "local",
      request_id: input.requestId,
      action: input.action,
      captain_event: { ok: true, status: "queued" },
    };
    const persisted = db
      .prepare(
        "UPDATE team_directive_request_ledger SET result=? WHERE request_id=? AND result IS NULL",
      )
      .run(JSON.stringify(result), input.requestId);
    if (persisted.changes !== 1)
      throw new Error("request result not persisted");
    return result;
  });
  return mutation.immediate();
}
