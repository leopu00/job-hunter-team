import { NextRequest, NextResponse } from "next/server";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";

export const dynamic = "force-dynamic";

const dbPath = path.join(os.homedir(), ".jht", "databases", "jobs.db");

function openDb(): Database.Database | null {
  if (!fs.existsSync(dbPath)) return null;
  return new Database(dbPath);
}

function captainEvent(
  db: Database.Database,
  action: string,
  id: number,
  fingerprint = "",
) {
  try {
    db.prepare(
      "INSERT OR IGNORE INTO pending_user_messages (agent, body, kind, author, source_id, delivered_via) VALUES (?, ?, 'notification', 'user', ?, NULL)",
    ).run(
      "capitano",
      `[TEAM-DIRECTIVE] ${action} #${id}`,
      `team-directive:${id}:${action}:${fingerprint}`,
    );
    return { status: "queued" as const };
  } catch {
    return { status: "error" as const };
  }
}

export async function GET() {
  const db = openDb();
  if (!db) return NextResponse.json({ directives: [], source: "local" });
  try {
    const directives = db
      .prepare(
        "SELECT id, body, kind, status, sort_order, created_by, created_at, updated_at, archived_at FROM team_directives ORDER BY status ASC, sort_order ASC, created_at ASC",
      )
      .all();
    return NextResponse.json({ directives, source: "local" });
  } finally {
    db.close();
  }
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    body?: string;
    kind?: string;
  };
  const text = typeof body.body === "string" ? body.body.trim() : "";
  if (!text || text.length > 2000)
    return NextResponse.json({ error: "invalid directive" }, { status: 400 });
  const kind = ["order", "strategy", "formation", "note"].includes(
    body.kind || "",
  )
    ? body.kind
    : "order";
  const db = openDb();
  if (!db)
    return NextResponse.json(
      { error: "database unavailable" },
      { status: 503 },
    );
  try {
    const n = (
      db
        .prepare(
          "SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM team_directives WHERE status='active'",
        )
        .get() as { n: number }
    ).n;
    const result = db.transaction(() => {
      const info = db
        .prepare(
          "INSERT INTO team_directives (body, kind, status, sort_order, created_by) VALUES (?, ?, 'active', ?, 'user')",
        )
        .run(text, kind, n);
      const id = Number(info.lastInsertRowid);
      const event = captainEvent(
        db,
        "created",
        id,
        createHash("sha256").update(text).digest("hex"),
      );
      if (event.status === "error") throw new Error("enqueue_failed");
      return { id, event };
    })();
    return NextResponse.json({
      id: result.id,
      source: "local",
      captain_event: result.event,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "directive_not_queued",
      },
      { status: 503 },
    );
  } finally {
    db.close();
  }
}

export async function PATCH(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    id?: number;
    body?: string;
    action?: string;
  };
  const id = Number(body.id);
  if (!Number.isInteger(id) || id <= 0)
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  const db = openDb();
  if (!db)
    return NextResponse.json(
      { error: "database unavailable" },
      { status: 503 },
    );
  try {
    const result = db.transaction(() => {
      const changed =
        body.action === "archive"
          ? db
              .prepare(
                "UPDATE team_directives SET status='archived', archived_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='active'",
              )
              .run(id)
          : typeof body.body === "string" && body.body.trim()
            ? db
                .prepare(
                  "UPDATE team_directives SET body=?, updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='active'",
                )
                .run(body.body.trim(), id)
            : null;
      if (!changed || changed.changes !== 1)
        throw new Error("directive_not_found");
      const fp = body.body
        ? createHash("sha256").update(body.body.trim()).digest("hex")
        : "";
      const event = captainEvent(
        db,
        body.action === "archive" ? "archived" : "edited",
        id,
        fp,
      );
      if (event.status === "error") throw new Error("enqueue_failed");
      return event;
    })();
    return NextResponse.json({
      ok: true,
      source: "local",
      captain_event: result,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "directive_not_queued",
      },
      { status: 503 },
    );
  } finally {
    db.close();
  }
}
