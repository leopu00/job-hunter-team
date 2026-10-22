import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import Database from "better-sqlite3";
import fs from "fs";
import { resolveUser } from "@/lib/team-state/auth";
import { requireAuth, requireDesktopWrite } from "@/lib/auth";
import {
  LOCAL_TOKEN_COOKIE,
  isLocalTokenAuthenticated,
} from "@/lib/local-token";
import { JHT_DB_PATH } from "@/lib/jht-paths";
import { sanitizedError } from "@/lib/error-response";
import { isCloudDeploy } from "@/lib/deploy-mode";
import { strictMutationRefusal } from "@/lib/csrf";
import { DOOR_REFUSAL_STATUS, callDoor } from "@/lib/door-rpc";
import {
  readTeamDirectivesForUser,
  type TeamDirectivesReader,
  validateDirectiveMutationResult,
} from "@/lib/team-directives-cloud";
import type { DirectiveAction } from "@/lib/team-directive-request";
import {
  MAX_DIRECTIVE_REQUEST_ID_LENGTH,
  mutateLocalTeamDirective,
  publicDirectiveError,
} from "@/lib/team-directives-local";

export const dynamic = "force-dynamic";

// Bacheca del team (team_directives): ordini/strategia PERMANENTI dell'utente.
// La dashboard legge/scrive qui; il Capitano li rilegge a ogni riavvio via la
// skill team_directives.py, sempre dentro il recinto (fence_user_turn). Come i ticket, due path:
//   A) SQLite locale (web nel container) = source of truth per gli agenti; il
//      mirror sul cloud lo fa il daemon `jht cloud sync-directives` (round-trip
//      via cloud_id, incremento #2b). NON scriviamo su Supabase da qui.
//   B) cloud-only (container offline / desktop / il sito) → la porta unica (migrazione 101):
//      `directive.create` e `directive.update` sono L2 con la conferma a due tempi (la prima chiamata
//      risponde 202 con `confirm_id` e il riassunto; la seconda porta solo `confirm_id` e scrive il testo
//      SALVATO alla prima), `directive.archive` è L1 e vale subito. Sul sito c'è prima il controllo
//      d'origine stretto, come nelle altre route L2.

const KINDS = new Set(["order", "strategy", "formation", "note"]);
const MAX_LEN = 2000;

function requireRequestId(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.trim().length > MAX_DIRECTIVE_REQUEST_ID_LENGTH
  )
    throw new Error("invalid request id");
  return value.trim();
}

interface DirectiveRow {
  id: number;
  body: string;
  kind: string;
  status: string;
  sort_order: number;
  created_by: string;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

function localDbOrNull(): Database.Database | null {
  if (isCloudDeploy() || !fs.existsSync(JHT_DB_PATH)) return null;
  const db = new Database(JHT_DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  return db;
}

// Solo il browser (sessione) può scrivere sul cloud; il local-token esige il DB
// locale. Ritorna null se il chiamante è autorizzato a proseguire sul path cloud,
// altrimenti una NextResponse d'errore già pronta.
async function cloudGuard(req: NextRequest): Promise<NextResponse | null> {
  if (
    isLocalTokenAuthenticated(
      req.headers.get("authorization"),
      (await cookies()).get(LOCAL_TOKEN_COOKIE)?.value,
    )
  ) {
    return NextResponse.json({ error: "DB locale assente" }, { status: 503 });
  }
  return null;
}

// Sul sito (deploy cloud) una scrittura sulla bacheca comanda la squadra (L2): prima di leggere il corpo, la
// stessa regola d'origine stretta della libreria della porta. Fuori dal sito vale requireDesktopWrite.
function siteEntryRefusal(req: NextRequest): NextResponse | null {
  const proto =
    req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ||
    (req.nextUrl?.protocol ?? "https:").replace(":", "");
  const host =
    req.headers.get("x-forwarded-host")?.split(",")[0]?.trim() ||
    req.headers.get("host")?.trim();
  const refusal = strictMutationRefusal({
    method: "POST", // la regola stretta è quella del POST, anche per il PATCH
    origin: req.headers.get("origin"),
    referer: req.headers.get("referer"),
    secFetchSite: req.headers.get("sec-fetch-site"),
    hostOrigin: host ? `${proto}://${host}` : null,
    contentType: req.headers.get("content-type"),
    requirePublicOrigin: true,
  });
  if (!refusal) return null;
  const status =
    refusal === "unsupported_media_type"
      ? 415
      : refusal === "origin_not_configured"
        ? 503
        : refusal === "method_not_allowed"
          ? 405
          : 403;
  return NextResponse.json({ ok: false, error: refusal }, { status });
}

type DoorOp =
  | { op: "create"; text: string; kind: string }
  | { op: "update"; id: number; text: string }
  | { op: "archive"; id: number }
  | { op: "confirm-create" }
  | { op: "confirm-update" };

const DOOR_ACTION = {
  create: "directive.create",
  "confirm-create": "directive.create",
  update: "directive.update",
  "confirm-update": "directive.update",
  archive: "directive.archive",
} as const;

// Il ramo B passa dalla porta unica. `legacy` è la strada di prima (la RPC 079), TEMPORANEA (O1, 22/10):
// solo fuori dal sito e solo finché il database non ha la 101 (la porta risponde che non conosce l'azione,
// o manca). La 101 revoca la 079 ai ruoli del browser: dopo, questo ramo non si apre più, e si toglie.
async function viaDoor(
  supabase: SupabaseClient,
  userId: string,
  requestId: string,
  op: DoorOp & { confirmId?: string },
  legacy: () => Promise<NextResponse>,
): Promise<NextResponse> {
  const action = DOOR_ACTION[op.op];
  const confirming = op.op === "confirm-create" || op.op === "confirm-update";
  const door = await callDoor(supabase, {
    action,
    level: op.op === "archive" ? "L1" : "L2",
    ...(confirming
      ? { confirmId: op.confirmId ?? "" }
      : op.op === "create"
        ? { params: { kind: op.kind }, body: op.text }
        : op.op === "update"
          ? { params: { id: op.id }, body: op.text }
          : { params: { id: op.id } }),
  });
  const verb =
    action === "directive.create"
      ? "created"
      : action === "directive.update"
        ? "edited"
        : "archived";
  if (door.kind === "door_missing") {
    if (isCloudDeploy() || confirming) {
      return NextResponse.json({ error: "not_available_yet" }, { status: 503 });
    }
    return legacy();
  }
  if (door.kind === "failed") {
    return NextResponse.json({ error: "action_failed" }, { status: 502 });
  }
  if (door.kind === "refused") {
    const error =
      door.error === "not_found" ? "directive_not_found" : door.error;
    return NextResponse.json(
      { error, request_id: requestId },
      { status: DOOR_REFUSAL_STATUS[door.error] ?? 500 },
    );
  }
  if (door.state === "awaiting_confirm") {
    return NextResponse.json(
      {
        ok: true,
        state: "awaiting_confirm",
        confirm_id: door.id,
        summary: door.summary,
        expires_at: door.expiresAt,
        request_id: requestId,
        action: verb,
      },
      { status: 202 },
    );
  }
  // Fatto. L'id della direttiva: quella aggiornata, oppure quella che l'effetto ha creato con il segno della
  // riga del registro (source_id, migrazione 101).
  let id: number | null =
    op.op === "update" || op.op === "archive" ? op.id : null;
  if (id === null) {
    const { data } = await supabase
      .from("team_directives")
      .select("id")
      .eq("user_id", userId)
      .eq("source_id", `team-directive:${door.id}`)
      .maybeSingle();
    const found = Number((data as { id?: unknown } | null)?.id);
    id = Number.isInteger(found) && found > 0 ? found : null;
  }
  if (id === null && verb !== "created") {
    return NextResponse.json({ error: "update_unconfirmed" }, { status: 502 });
  }
  if (id === null) {
    return NextResponse.json({ error: "insert_unconfirmed" }, { status: 502 });
  }
  return NextResponse.json({
    ok: true,
    id: String(id),
    source: "cloud",
    request_id: requestId,
    action: verb,
    captain_event: { ok: true, status: "queued" },
  });
}

// ── GET: elenco direttive (attive + archiviate) ────────────────────────────
export async function GET(req: NextRequest): Promise<NextResponse> {
  const denied = await requireAuth();
  if (denied) return denied;
  const db = localDbOrNull();
  if (db) {
    try {
      const hasTable = db
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE type='table' AND name='team_directives'",
        )
        .get();
      const rows = hasTable
        ? (db
            .prepare(
              "SELECT id, body, kind, status, sort_order, created_by, created_at, updated_at, archived_at " +
                "FROM team_directives ORDER BY status ASC, sort_order ASC, created_at ASC",
            )
            .all() as DirectiveRow[])
        : [];
      return NextResponse.json({ directives: rows, source: "local" });
    } finally {
      db.close();
    }
  }

  const guard = await cloudGuard(req);
  if (guard) return guard;
  const resolved = await resolveUser(req);
  if (!resolved.ok) return resolved.res;
  const { supabase, userId } = resolved.user;
  const { data, error } = await readTeamDirectivesForUser(
    supabase as unknown as TeamDirectivesReader,
    userId,
  );
  if (error) {
    return sanitizedError(error, {
      status: 500,
      scope: "team-directives",
      publicMessage: "query_failed",
    });
  }
  return NextResponse.json({ directives: data || [], source: "cloud" });
}

// ── POST: crea una direttiva (o ne conferma la creazione: `confirm_id`) ─────
export async function POST(req: NextRequest): Promise<NextResponse> {
  const denied = await requireAuth();
  if (denied) return denied;
  // Sul sito: la regola d'origine stretta delle azioni L2. Altrove: la scrive la desktop o il box.
  const refused = isCloudDeploy()
    ? siteEntryRefusal(req)
    : await requireDesktopWrite();
  if (refused) return refused;
  const body = (await req.json().catch(() => ({}))) as {
    body?: string;
    kind?: string;
    request_id?: string;
    confirm_id?: string;
  };
  let requestId: string;
  try {
    requestId = requireRequestId(body.request_id);
  } catch {
    return NextResponse.json({ error: "invalid request id" }, { status: 400 });
  }
  const confirmId =
    typeof body.confirm_id === "string" ? body.confirm_id : null;
  const text = typeof body.body === "string" ? body.body.trim() : "";
  const kind = body.kind && KINDS.has(body.kind) ? body.kind : "order";
  if (confirmId === null) {
    if (!text) {
      return NextResponse.json(
        { error: "La direttiva non può essere vuota" },
        { status: 400 },
      );
    }
    if (text.length > MAX_LEN) {
      return NextResponse.json(
        { error: `Direttiva troppo lunga (max ${MAX_LEN} caratteri)` },
        { status: 400 },
      );
    }
  }

  const db = localDbOrNull();
  if (db) {
    try {
      // Il SQLite del box non ha la conferma a due tempi: è la macchina dell'utente.
      if (confirmId !== null) {
        return NextResponse.json({ error: "invalid_request" }, { status: 400 });
      }
      return NextResponse.json(
        mutateLocalTeamDirective(db, {
          requestId,
          action: "created",
          id: 0,
          body: text,
          kind,
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

  const guard = await cloudGuard(req);
  if (guard) return guard;
  const resolved = await resolveUser(req);
  if (!resolved.ok) return resolved.res;
  if (resolved.user.source !== "session") {
    return NextResponse.json(
      { error: "Solo il browser può creare direttive (no Bearer token)" },
      { status: 403 },
    );
  }
  const { supabase, userId } = resolved.user;
  if (confirmId !== null) {
    return viaDoor(
      supabase,
      userId,
      requestId,
      { op: "confirm-create", confirmId },
      async () =>
        NextResponse.json({ error: "not_available_yet" }, { status: 503 }),
    );
  }
  return viaDoor(
    supabase,
    userId,
    requestId,
    { op: "create", text, kind },
    () =>
      legacyMutation(supabase, requestId, {
        p_id: 0,
        p_action: "created",
        p_body: text,
        p_kind: kind,
      }),
  );
}

// ── PATCH: modifica il testo o archivia una direttiva (o conferma la modifica) ──
export async function PATCH(req: NextRequest): Promise<NextResponse> {
  const denied = await requireAuth();
  if (denied) return denied;
  const refused = isCloudDeploy()
    ? siteEntryRefusal(req)
    : await requireDesktopWrite();
  if (refused) return refused;
  const body = (await req.json().catch(() => ({}))) as {
    id?: number | string;
    body?: string;
    action?: string;
    request_id?: string;
    confirm_id?: string;
  };
  let requestId: string;
  try {
    requestId = requireRequestId(body.request_id);
  } catch {
    return NextResponse.json({ error: "invalid request id" }, { status: 400 });
  }
  const confirmId =
    typeof body.confirm_id === "string" ? body.confirm_id : null;
  const id = Number(body.id);
  const archive = body.action === "archive";
  const text = typeof body.body === "string" ? body.body.trim() : null;
  if (confirmId === null) {
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: "id non valido" }, { status: 400 });
    }
    if (!archive && !text) {
      return NextResponse.json(
        { error: "Niente da aggiornare (testo vuoto)" },
        { status: 400 },
      );
    }
    if (text && text.length > MAX_LEN) {
      return NextResponse.json(
        { error: `Direttiva troppo lunga (max ${MAX_LEN} caratteri)` },
        { status: 400 },
      );
    }
  }

  const db = localDbOrNull();
  if (db) {
    try {
      if (confirmId !== null) {
        return NextResponse.json({ error: "invalid_request" }, { status: 400 });
      }
      const action = archive ? "archived" : "edited";
      return NextResponse.json(
        mutateLocalTeamDirective(db, {
          requestId,
          action,
          id,
          body: archive ? null : text,
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

  const guard = await cloudGuard(req);
  if (guard) return guard;
  const resolved = await resolveUser(req);
  if (!resolved.ok) return resolved.res;
  if (resolved.user.source !== "session") {
    return NextResponse.json(
      { error: "Solo il browser può modificare direttive" },
      { status: 403 },
    );
  }
  const { supabase, userId } = resolved.user;
  if (confirmId !== null) {
    return viaDoor(
      supabase,
      userId,
      requestId,
      { op: "confirm-update", confirmId },
      async () =>
        NextResponse.json({ error: "not_available_yet" }, { status: 503 }),
    );
  }
  const legacy = () =>
    legacyMutation(
      supabase,
      requestId,
      {
        p_id: id,
        p_action: archive ? "archived" : "edited",
        p_body: archive ? null : text,
        p_kind: null,
      },
      id,
    );
  return archive
    ? viaDoor(supabase, userId, requestId, { op: "archive", id }, legacy)
    : viaDoor(
        supabase,
        userId,
        requestId,
        { op: "update", id, text: text as string },
        legacy,
      );
}

// La strada di prima della porta: la RPC della 079 con la sessione dell'utente. TEMPORANEA (O1, 22/10):
// solo fuori dal sito e solo finché il database non ha la 101, che la revoca ai ruoli del browser.
async function legacyMutation(
  supabase: SupabaseClient,
  requestId: string,
  args: {
    p_id: number;
    p_action: DirectiveAction;
    p_body: string | null;
    p_kind: string | null;
  },
  expectedId?: number,
): Promise<NextResponse> {
  const { data, error } = await supabase.rpc(
    "mutate_team_directive_with_event",
    { ...args, p_request_id: requestId },
  );
  const creating = args.p_action === "created";
  if (error) {
    if (error.message?.includes("request id payload mismatch")) {
      return NextResponse.json(
        { error: "request_id_mismatch" },
        { status: 409 },
      );
    }
    return sanitizedError(error, {
      status: 500,
      scope: "team-directives",
      publicMessage: creating ? "insert_failed" : "update_failed",
    });
  }
  const mutation = validateDirectiveMutationResult(data, {
    requestId,
    action: args.p_action,
    ...(expectedId !== undefined ? { id: expectedId } : {}),
  });
  if (!mutation) {
    return NextResponse.json(
      { error: creating ? "insert_unconfirmed" : "update_unconfirmed" },
      { status: 502 },
    );
  }
  return NextResponse.json({
    ok: true,
    id: String(mutation.id),
    source: "cloud",
    request_id: requestId,
    action: args.p_action,
    captain_event: { ok: true, status: "queued" },
  });
}
