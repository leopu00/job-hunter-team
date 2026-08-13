import { NextRequest, NextResponse } from "next/server";
import Database from "better-sqlite3";
import fs from "node:fs";
import { requireAuth } from "@/lib/auth";
import {
  MAX_DIRECTIVE_REQUEST_ID_LENGTH,
  ensureLocalDirectiveMutationSchema,
  mutateLocalTeamDirective,
  publicDirectiveError,
} from "@/lib/team-directives-local";
import {
  DESKTOP_DB_PATH,
  isAllowedDesktopBrowserRequest,
  isTrustedDesktopRequest,
} from "../../../lib/desktop-api-boundary";

export const dynamic = "force-dynamic";

const kinds = new Set(["order", "strategy", "formation", "note"]);

async function authorizeDesktopRequest(
  req: NextRequest,
): Promise<NextResponse | null> {
  // This route mutates the machine-local jobs.db. A Supabase session (when
  // configured) is necessary but not sufficient: the socket must also be the
  // loopback-only desktop server, never a LAN-facing Next instance.
  if (!isTrustedDesktopRequest(req.headers)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!isAllowedDesktopBrowserRequest(req.headers, req.method)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  return await requireAuth();
}

function openDb(): Database.Database | null {
  if (!fs.existsSync(DESKTOP_DB_PATH)) return null;
  const db = new Database(DESKTOP_DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  ensureLocalDirectiveMutationSchema(db);
  return db;
}

function requireRequestId(value: unknown): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.trim().length > MAX_DIRECTIVE_REQUEST_ID_LENGTH
  ) {
    throw new Error("invalid request id");
  }
  return value.trim();
}

export async function GET(req: NextRequest) {
  const denied = await authorizeDesktopRequest(req);
  if (denied) return denied;
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
  const denied = await authorizeDesktopRequest(req);
  if (denied) return denied;
  const input = (await req.json().catch(() => ({}))) as {
    body?: string;
    kind?: string;
    request_id?: string;
  };
  const body = typeof input.body === "string" ? input.body.trim() : "";
  if (!body || body.length > 2000) {
    return NextResponse.json({ error: "invalid directive" }, { status: 400 });
  }
  let requestId: string;
  try {
    requestId = requireRequestId(input.request_id);
  } catch {
    return NextResponse.json({ error: "invalid request id" }, { status: 400 });
  }
  const db = openDb();
  if (!db) {
    return NextResponse.json(
      { error: "database unavailable" },
      { status: 503 },
    );
  }
  try {
    return NextResponse.json(
      mutateLocalTeamDirective(db, {
        requestId,
        action: "created",
        id: 0,
        body,
        kind: input.kind && kinds.has(input.kind) ? input.kind : "order",
      }),
    );
  } catch (error) {
    const failure = publicDirectiveError(error);
    return NextResponse.json(
      { error: failure.error },
      { status: failure.status },
    );
  } finally {
    db.close();
  }
}

export async function PATCH(req: NextRequest) {
  const denied = await authorizeDesktopRequest(req);
  if (denied) return denied;
  const input = (await req.json().catch(() => ({}))) as {
    id?: number;
    body?: string;
    action?: string;
    request_id?: string;
  };
  const id = Number(input.id);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  const archive = input.action === "archive";
  const body = typeof input.body === "string" ? input.body.trim() : "";
  if (!archive && (!body || body.length > 2000)) {
    return NextResponse.json({ error: "invalid directive" }, { status: 400 });
  }
  let requestId: string;
  try {
    requestId = requireRequestId(input.request_id);
  } catch {
    return NextResponse.json({ error: "invalid request id" }, { status: 400 });
  }
  const db = openDb();
  if (!db) {
    return NextResponse.json(
      { error: "database unavailable" },
      { status: 503 },
    );
  }
  try {
    return NextResponse.json(
      mutateLocalTeamDirective(db, {
        requestId,
        action: archive ? "archived" : "edited",
        id,
        body: archive ? null : body,
      }),
    );
  } catch (error) {
    const failure = publicDirectiveError(error);
    return NextResponse.json(
      { error: failure.error },
      { status: failure.status },
    );
  } finally {
    db.close();
  }
}
