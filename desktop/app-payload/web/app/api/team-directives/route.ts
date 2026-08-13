import { NextRequest, NextResponse } from "next/server";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

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
  body?: string,
) {
  try {
    db.prepare(
      "INSERT INTO pending_user_messages (agent, body, kind, delivered_via) VALUES (?, ?, 'notification', NULL)",
    ).run(
      "capitano",
      `[TEAM-DIRECTIVE] ${action} #${id}${body ? `: ${body}` : ""}`,
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
    const info = db
      .prepare(
        "INSERT INTO team_directives (body, kind, status, sort_order, created_by) VALUES (?, ?, 'active', ?, 'user')",
      )
      .run(text, kind, n);
    return NextResponse.json({
      id: Number(info.lastInsertRowid),
      source: "local",
      captain_event: captainEvent(
        db,
        "created",
        Number(info.lastInsertRowid),
        text,
      ),
    });
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
    if (body.action === "archive")
      db.prepare(
        "UPDATE team_directives SET status='archived', archived_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE id=?",
      ).run(id);
    else if (typeof body.body === "string" && body.body.trim())
      db.prepare(
        "UPDATE team_directives SET body=?, updated_at=CURRENT_TIMESTAMP WHERE id=?",
      ).run(body.body.trim(), id);
    else return NextResponse.json({ error: "invalid update" }, { status: 400 });
    return NextResponse.json({
      ok: true,
      source: "local",
      captain_event: captainEvent(
        db,
        body.action === "archive" ? "archived" : "edited",
        id,
        body.action === "archive" ? undefined : body.body,
      ),
    });
  } finally {
    db.close();
  }
}
