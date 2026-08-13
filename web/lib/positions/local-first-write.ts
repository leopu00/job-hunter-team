// Scrittura local-first su una posizione, nella forma già collaudata da
// `positions/[legacyId]/user-exclude`.
//
// Perché esiste: la stessa sequenza serve a tre azioni dell'utente —
// escludere (O-15/O-24 la riusano per giudizio e note) — e alla terza copia il
// costo di un difetto si moltiplica per quattro. Ne esiste già una versione
// SBAGLIATA in `positions/feedback/route.ts`, che scrive solo su Supabase e
// quindi non funziona a cloud spento (O-15). Regola che ci siamo dati: la
// seconda volta si copia, la terza si estrae.
//
// Cosa NON astrae: il SQL e l'update cloud restano di chi chiama. Qui vive
// solo l'ordine dei rami, che è la parte che si sbaglia — non la query, che
// è diversa ogni volta.
//
//   1. local-token valido (desktop nativo) → SOLO SQLite, mai cloud;
//   2. sessione browser + SQLite presente  → SQLite, poi mirror best-effort;
//   3. sessione browser senza SQLite       → solo Supabase (cloud mode).
//
// L'invariante che tiene insieme i tre: quando SQLite c'è, è lui la source of
// truth in-process per il team, e un errore del cloud non deve far fallire una
// scrittura locale già avvenuta.

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import Database from "better-sqlite3";
import fs from "fs";
import { resolveUser } from "@/lib/team-state/auth";
import {
  LOCAL_TOKEN_COOKIE,
  isLocalTokenAuthenticated,
} from "@/lib/local-token";
import { JHT_DB_PATH } from "@/lib/jht-paths";
import { isCloudDeploy } from "@/lib/deploy-mode";
import type { SupabaseClient } from "@supabase/supabase-js";

export type WriteSource = "local" | "cloud";

export type StepResult<T> =
  | { ok: true; outcome: T }
  | { ok: false; status: number; body: Record<string, unknown> };

export interface LocalFirstWrite<T> {
  /** Sul DB del box. Riceve una connessione aperta, in WAL, già pronta. */
  local: (db: Database.Database) => StepResult<T>;
  /** Quando SQLite non c'è: Supabase è l'unica sorgente. */
  cloud: (supabase: SupabaseClient, userId: string) => Promise<StepResult<T>>;
  /**
   * Riflesso best-effort del risultato locale sul cloud, per la UI
   * cross-device. Il suo esito diventa `cloud_synced`, MAI un errore: la
   * scrittura autorevole è già avvenuta e fallire qui la nasconderebbe.
   */
  mirror?: (
    supabase: SupabaseClient,
    userId: string,
    outcome: T,
  ) => Promise<void>;
  /**
   * Chi non è il browser non scrive: i Bearer token del box hanno le loro
   * strade. Messaggio esplicito perché il 403 sia leggibile.
   */
  sessionOnlyError: string;
}

/** L'esito, nella shape che le route di questa famiglia restituiscono. */
export type LocalFirstResponse<T> = T & {
  source: WriteSource;
  cloud_synced: boolean | null;
};

function openLocalDb(): Database.Database {
  const db = new Database(JHT_DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  return db;
}

function runLocal<T>(spec: LocalFirstWrite<T>): StepResult<T> {
  const db = openLocalDb();
  try {
    return spec.local(db);
  } finally {
    db.close();
  }
}

export async function localFirstWrite<T>(
  req: NextRequest,
  spec: LocalFirstWrite<T>,
): Promise<NextResponse> {
  // ── 1. Desktop nativo: solo locale, e non si passa da Supabase ──────
  if (
    isLocalTokenAuthenticated(
      req.headers.get("authorization"),
      (await cookies()).get(LOCAL_TOKEN_COOKIE)?.value,
    )
  ) {
    if (!fs.existsSync(JHT_DB_PATH)) {
      return NextResponse.json({ error: "DB locale assente" }, { status: 503 });
    }
    const local = runLocal(spec);
    if (!local.ok)
      return NextResponse.json(local.body, { status: local.status });
    return NextResponse.json({
      ...local.outcome,
      source: "local",
      cloud_synced: null,
    });
  }

  const resolved = await resolveUser(req);
  if (!resolved.ok) return resolved.res;
  if (resolved.user.source !== "session") {
    return NextResponse.json({ error: spec.sessionOnlyError }, { status: 403 });
  }
  const { userId, supabase } = resolved.user;

  // ── 2. Browser col box acceso: SQLite decide, il cloud segue ────────
  // A cloud deployment is authoritative in Supabase even if a stale or
  // accidentally mounted SQLite file happens to be present.  Local-first is
  // reserved for the co-located runtime; otherwise an ephemeral Vercel file
  // could report a successful local write that never reached the cloud.
  if (!isCloudDeploy() && fs.existsSync(JHT_DB_PATH)) {
    const local = runLocal(spec);
    if (!local.ok)
      return NextResponse.json(local.body, { status: local.status });
    let cloudOk: boolean | null = null;
    if (spec.mirror) {
      try {
        await spec.mirror(supabase, userId, local.outcome);
        cloudOk = true;
      } catch {
        cloudOk = false;
      }
    }
    return NextResponse.json({
      ...local.outcome,
      source: "local",
      cloud_synced: cloudOk,
    });
  }

  // ── 3. Box spento: il cloud è l'unica sorgente ──────────────────────
  const cloud = await spec.cloud(supabase, userId);
  if (!cloud.ok) return NextResponse.json(cloud.body, { status: cloud.status });
  return NextResponse.json({
    ...cloud.outcome,
    source: "cloud",
    cloud_synced: true,
  });
}
