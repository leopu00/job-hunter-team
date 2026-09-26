import type { SupabaseClient } from "@supabase/supabase-js";
import type Database from "better-sqlite3";
import { NextResponse, type NextRequest } from "next/server";
import { resolveUser } from "@/lib/team-state/auth";

/**
 * Stand-in for web/lib/positions/local-first-write.ts. The web picks one of
 * three paths: the box's CLI (local token, SQLite only), a browser beside a
 * running box (SQLite first, cloud mirrored) and the box switched off
 * (Supabase only). The desktop has no box database and no local token, so
 * only the third runs here, copied as it is: the user from the session
 * (resolveUser, the web's own), a Bearer caller refused, then `spec.cloud`.
 */
export type WriteSource = "local" | "cloud";

export type StepResult<T> =
  | { ok: true; outcome: T }
  | { ok: false; status: number; body: Record<string, unknown> };

export interface LocalFirstWrite<T> {
  local: (db: Database.Database) => StepResult<T>;
  cloud: (supabase: SupabaseClient, userId: string) => Promise<StepResult<T>>;
  mirror?: (supabase: SupabaseClient, userId: string, outcome: T) => Promise<void>;
  sessionOnlyError: string;
}

export type LocalFirstResponse<T> = T & {
  source: WriteSource;
  cloud_synced: boolean | null;
};

export async function localFirstWrite<T>(
  req: NextRequest,
  spec: LocalFirstWrite<T>,
): Promise<NextResponse> {
  const resolved = await resolveUser(req);
  if (!resolved.ok) return resolved.res;
  if (resolved.user.source !== "session") {
    return NextResponse.json({ error: spec.sessionOnlyError }, { status: 403 });
  }
  const { userId, supabase } = resolved.user;

  const cloud = await spec.cloud(supabase, userId);
  if (!cloud.ok) return NextResponse.json(cloud.body, { status: cloud.status });
  return NextResponse.json({
    ...cloud.outcome,
    source: "cloud",
    cloud_synced: true,
  });
}
