import { NextResponse } from "next/server";
import fs from "fs";
import {
  JHT_DB_PATH,
  JHT_PROFILE_YAML,
  JHT_USER_DIR,
  JHT_USER_CV_DIR,
  JHT_USER_UPLOADS_DIR,
  JHT_USER_OUTPUT_DIR,
} from "@/lib/jht-paths";
import { requireAuth } from "@/lib/auth";
import { sanitizedError } from "@/lib/error-response";

export const dynamic = "force-dynamic";

function workspaceState() {
  const hasDb = fs.existsSync(JHT_DB_PATH);
  const hasProfile = fs.existsSync(JHT_PROFILE_YAML);
  return { path: JHT_USER_DIR, hasDb, hasProfile };
}

export async function GET() {
  const denied = await requireAuth();
  if (denied) return denied;
  return NextResponse.json(workspaceState());
}

export async function POST() {
  const denied = await requireAuth();
  if (denied) return denied;
  // Cartella utente visibile creata al primo POST (idempotente)
  try {
    fs.mkdirSync(JHT_USER_DIR, { recursive: true });
    fs.mkdirSync(JHT_USER_CV_DIR, { recursive: true });
    fs.mkdirSync(JHT_USER_UPLOADS_DIR, { recursive: true });
    fs.mkdirSync(JHT_USER_OUTPUT_DIR, { recursive: true });
  } catch (err: unknown) {
    return sanitizedError(err, {
      status: 500,
      scope: "workspace",
      publicMessage: "user_dir_create_failed",
    });
  }
  return NextResponse.json({ ok: true, ...workspaceState() });
}

export async function DELETE() {
  const denied = await requireAuth();
  if (denied) return denied;
  // Path fisso: non cancellabile. Mantiene compat col frontend.
  return NextResponse.json({ ok: true, ...workspaceState() });
}
