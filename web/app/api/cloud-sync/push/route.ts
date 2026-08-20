import { NextRequest, NextResponse } from "next/server";
// js-yaml 5 espone solo named export: il default non esiste piu'.
import * as yaml from "js-yaml";
import { isSupabaseConfigured } from "@/lib/workspace";
import { verifyBearerToken } from "@/lib/cloud-sync/auth";
import { checkCloudSyncRateLimit } from "@/lib/cloud-sync/rate-limit";
import {
  firstTeamRunPatch,
  teamProducedWork,
} from "@/lib/cloud-sync/onboarding-milestones";
import { mapYamlToCanonical, syncProfileToSupabase } from "@/lib/profile-sync";
import {
  invalidateStaleCriticVerdict,
  normalizeApplicationStatus,
  normalizeCriticVerdict,
  normalizePositionStatus,
} from "@/lib/sync-vocabulary";
import { invalidJsonBody } from "@/app/api/_lib/error-body";
import { sanitizedError } from "@/lib/error-response";
import {
  summarizeOutOfRange,
  type OutOfRangeSummary,
} from "@/lib/score-ranges";
import { syncRequestIsPending } from "@/lib/team-state/sync-freshness";
import type { createAdminClient } from "@/lib/supabase/admin";
import {
  receiptId as wireReceiptId,
  receiptIdForKey,
} from "../../../../../shared/cloud/receipt-ids.js";

export const dynamic = "force-dynamic";

const ROW_DATA_SQLSTATE = /^(?:22[A-Z0-9]{3}|2350[235]|23514|23P01)$/;
// ⚠️ CONTRATTO CON I TRIGGER: queste stringhe sono il messaggio che
// `RAISE EXCEPTION` alza nelle migrazioni, e sono identificatori scelti da chi
// ha scritto il trigger — non prosa. Senza SQLSTATE dedicato PostgreSQL le
// classifica P0001, che PostgREST rende 500: qui le riconosciamo per dire al
// client che il rifiuto riguarda UNA RIGA e non il server, cosi' la bisezione
// puo' isolarla invece di far abortire il convoglio.
//
// `stale_position_downgrade` (mig 081, funzione
// reject_stale_applied_position_downgrade) mancava, e il gemello
// `stale_application_downgrade` c'era: il push di una macchina con una
// fotografia vecchia riceveva un 500 opaco, nessuna riga finiva in quarantena
// e il convoglio si fermava a ogni tick, per sempre (O-97).
//
// Il giorno che un trigger cambia messaggio, il client smette di capire senza
// che nessuno se ne accorga: `tests/js/tasks/cloud-push-trigger-tokens.test.ts`
// tiene le due parti allineate leggendo le migrazioni.
const ROW_P0001_MESSAGES = new Set([
  "application_identity_mismatch",
  "incomplete_application",
  "application_not_persisted",
  "application_object_required",
  "invalid_application_identity",
  "invalid_application_receipt_id",
  "invalid_score_identity",
  "position_not_found",
  "score_identity_mismatch",
  "stale_application_downgrade",
  "stale_position_downgrade",
]);

function rowAttributableWriteError(error: unknown, publicMessage: string) {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code?: unknown }).code ?? "")
      : "";
  const message =
    typeof error === "object" && error !== null && "message" in error
      ? String((error as { message?: unknown }).message ?? "")
      : "";
  const rowAttributable =
    ROW_DATA_SQLSTATE.test(code) ||
    (code === "P0001" && ROW_P0001_MESSAGES.has(message));
  // PostgreSQL row errors often echo the rejected value. The SQLSTATE is
  // enough for operators and classification; never copy the value to logs.
  const loggableError = rowAttributable
    ? new Error(`row write rejected (${code})`)
    : error;
  return sanitizedError(loggableError, {
    status: 500,
    scope: "cloud-sync/push",
    publicMessage,
    ...(rowAttributable ? { rejectionScope: "row" as const } : {}),
  });
}

/**
 * La fotografia della candidatura che il cloud oppone a un downgrade.
 *
 * Il trigger `reject_stale_applied_position_downgrade` rifiuta di riportare
 * indietro una posizione candidata quando qui esiste una candidatura vera. Il
 * box che ha mandato quel downgrade ha una fotografia piu' vecchia: il rifiuto
 * da solo gli dice «no», questo campo gli dice ANCHE cosa sa il cloud, cosi'
 * puo' imparare invece di riprovare identico al tick successivo (O-97).
 *
 * ⚠️ Solo sul SINGLETON. Con piu' righe nel batch non sappiamo quale sia la
 * colpevole — lo scopre la bisezione del client, che a forza di dimezzare
 * arriva sempre a una riga sola. Rispondere con la fotografia sbagliata
 * sarebbe peggio che non rispondere.
 *
 * ⚠️ NON contiene lo `status` della posizione, e non e' una dimenticanza: la
 * corsia che porta il dato dal cloud al box prende l'AZIONE DELL'UTENTE
 * (`applied_via = user_manual`) e mai lo stato generico, che resta autoritativo
 * sul box. Un campo `status` qui sarebbe un invito a usarlo.
 */
async function staleDowngradeSnapshot(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  rows: Array<{ legacy_id?: number }>,
  error: unknown,
) {
  const message =
    typeof error === "object" && error !== null && "message" in error
      ? String((error as { message?: unknown }).message ?? "")
      : "";
  if (message !== "stale_position_downgrade") return null;
  if (rows.length !== 1) return null;
  const legacyId = Number(rows[0]?.legacy_id);
  if (!Number.isInteger(legacyId) || legacyId <= 0) return null;

  const { data } = await admin
    .from("positions")
    .select("legacy_id, applications(applied, applied_at, applied_via)")
    .eq("user_id", userId)
    .eq("legacy_id", legacyId)
    .maybeSingle();
  const application = Array.isArray(data?.applications)
    ? data?.applications[0]
    : data?.applications;
  if (!application) return null;
  return {
    legacy_id: legacyId,
    applied: Boolean(application.applied),
    applied_at: application.applied_at ?? null,
    applied_via: application.applied_via ?? null,
  };
}

function rowRejection(error: string, status = 422) {
  return NextResponse.json({ error, rejection_scope: "row" }, { status });
}

function protocolError(error: string, status = 400) {
  return NextResponse.json({ error }, { status });
}

interface PositionIn {
  id: number;
  _receipt_id?: string;
  title: string;
  company: string;
  // FK locale (companies.id int) → risolta a companies.id UUID cloud via
  // companyLegacyToUuid prima dell'upsert. Alimenta la Company card del dettaglio.
  company_id?: number | null;
  url?: string | null;
  location?: string | null;
  remote_type?: string | null;
  status?: string | null;
  notes?: string | null;
  source?: string | null;
  jd_text?: string | null;
  jd_summary?: string | null;
  requirements?: string | null;
  found_by?: string | null;
  found_at?: string | null;
  deadline?: string | null;
  last_checked?: string | null;
  // Istanza dell'ultimo agente che ha agito (es. analista-4). Il team la scrive
  // in SQLite positions.last_actor; senza questo campo l'Analista resta generico
  // sul cloud. Mig Supabase 039.
  last_actor?: string | null;
  // Metadati location/categoria (Parte B sync, 2026-06-14): prodotti
  // dall'analista, alimentano i grafici categoria/mappa della dashboard
  // (che esiste già). Colonne cloud già presenti — nessuna migration.
  role_family?: string | null;
  loc_city?: string | null;
  loc_region?: string | null;
  loc_country?: string | null;
  loc_country_code?: string | null;
  loc_continent?: string | null;
  work_mode?: string | null;
  work_country?: string | null;
  work_country_code?: string | null;
  location_notes?: string | null;
  office_address?: string | null;
  office_lat?: number | null;
  office_lon?: number | null;
  // SQLite invia 0|1 integer; Supabase ha BOOLEAN — coerce sul payload
  // (stesso pattern di write_requested/geocode_requested).
  is_multi_location?: number | boolean | null;
  office_geocoded?: number | boolean | null;
  office_verified?: number | boolean | null;
  // Expiry/lifecycle (mig 038): is_open BOOLEAN (SQLite 0|1, default TRUE),
  // expires_at DATE, last_open_check TIMESTAMPTZ. Alimenta "Scadute/Archivio".
  expires_at?: string | null;
  is_open?: number | boolean | null;
  last_open_check?: string | null;
  salary_declared_min?: number | null;
  salary_declared_max?: number | null;
  salary_declared_currency?: string | null;
  salary_estimated_min?: number | null;
  salary_estimated_max?: number | null;
  salary_estimated_currency?: string | null;
  salary_estimated_source?: string | null;
  // Writer-on-demand (V6): user-driven flag per spawn Scrittori on-demand.
  // Mig Supabase 024. Il valore arriva da SQLite (0|1 integer) e va mappato
  // a BOOLEAN sul payload upsert.
  write_requested?: number | boolean | null;
  write_requested_at?: string | null;
  write_request_kind?: "cv" | "cover_letter" | null;
  // Geocoding-on-demand (V8): user-driven flag per office-geocoding
  // precision. Mig Supabase 027. Stesso pattern di write_requested.
  geocode_requested?: number | boolean | null;
  geocode_requested_at?: string | null;
  // Recheck on-demand (mig 042). Flag user-driven, default FALSE.
  recheck_requested?: number | boolean | null;
  recheck_requested_at?: string | null;
  // Salary-precise on-demand (V9, mig 040): flag user-driven (0|1→bool) +
  // timestamp + risultato testuale. Cross-device (push qui + pull-desired-state).
  salary_precise_requested?: number | boolean | null;
  salary_precise_requested_at?: string | null;
  salary_precise?: string | null;
}

interface ScoreIn {
  // Identità della riga score, distinta dal parent position_id. Il write cloud
  // resta UNIQUE(position_id), ma receipt/quarantine devono nominare la riga.
  legacy_id: number;
  _receipt_id?: string;
  position_id: number;
  total_score: number;
  experience_fit?: number | null;
  salary_fit?: number | null;
  stack_match?: number | null;
  remote_fit?: number | null;
  strategic_fit?: number | null;
  breakdown?: string | null;
  notes?: string | null;
  scored_by?: string | null;
  scored_at?: string | null;
}

interface ApplicationIn {
  // Identità distinte nel DB SQLite: applications.id non è positions.id.
  legacy_id: number;
  position_legacy_id: number;
  // Il client quarantine aggiunge un hash opaco. Per i client precedenti la
  // route lo deriva dalla stessa source identity e lo esporta senza ID raw.
  _receipt_id?: string;
  cv_path?: string | null;
  cv_pdf_path?: string | null;
  cl_path?: string | null;
  cl_pdf_path?: string | null;
  status?: string | null;
  critic_score?: number | null;
  critic_verdict?: string | null;
  critic_notes?: string | null;
  critic_round?: number | null;
  written_at?: string | null;
  applied_at?: string | null;
  applied_via?: string | null;
  response?: string | null;
  response_at?: string | null;
  written_by?: string | null;
  reviewed_by?: string | null;
  critic_reviewed_at?: string | null;
  applied?: boolean | null;
  cv_drive_id?: string | null;
  cl_drive_id?: string | null;
}

type ReceiptTable =
  | "applications"
  | "scores"
  | "companies"
  | "positions"
  | "position_highlights"
  | "pending_user_messages"
  | "tombstones"
  | "position_transitions"
  | "profile";

// ⚠️ La derivazione NON sta qui: sta in `shared/cloud/receipt-ids.js`, e la
// importa anche il client. Averne due copie e' costato #163 — stesso
// algoritmo, due implementazioni, divergenza silenziosa quando una delle due
// ha cominciato a leggere la chiave da un'altra parte.
function sourceReceiptId(table: ReceiptTable, sourceKey: unknown | unknown[]) {
  return receiptIdForKey(table, sourceKey);
}

// La ricevuta di una riga COSI' COME IL CLIENT L'HA MANDATA. Il ritorno del
// driver non entra mai nell'identita': serve a provare che la riga e' sul
// cloud, che e' un'altra domanda e ha un'altra risposta (il confronto sui
// valori, poco piu' sotto in ogni blocco).
function wireReceipt(table: ReceiptTable, row: unknown) {
  return wireReceiptId(table, row);
}

function validReceipt(
  table: ReceiptTable,
  sourceKey: unknown | unknown[],
  supplied: string | undefined,
) {
  return (
    supplied === undefined || supplied === sourceReceiptId(table, sourceKey)
  );
}

// `2026-08-16 18:24:28` — la forma che scrive SQLite con CURRENT_TIMESTAMP:
// niente `T`, niente fuso. Quel valore E' UTC (lo dice SQLite), ma `Date.parse`
// su una stringa cosi' non e' specificato e V8 la legge come ora LOCALE: su una
// macchina che non gira a UTC lo stesso istante darebbe due millisecondi
// diversi, e un confronto corretto direbbe «diverso».
const NAIVE_TIMESTAMP = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/;

function instantMs(value: unknown) {
  const text = String(value);
  return Date.parse(
    NAIVE_TIMESTAMP.test(text) ? `${text.replace(" ", "T")}Z` : text,
  );
}

function sameInstant(left: unknown, right: unknown) {
  const leftMs = instantMs(left);
  const rightMs = instantMs(right);
  return (
    Number.isFinite(leftMs) && Number.isFinite(rightMs) && leftMs === rightMs
  );
}

function sameNullableInstant(left: unknown, right: unknown) {
  if (left == null || right == null) return left == null && right == null;
  return sameInstant(left, right);
}

/**
 * Un istante epoch in secondi sopravvive al giro, la sua RESA no.
 *
 * `pending_user_messages.chat_ts` è `double precision`, e PostgREST apre la
 * sessione con `extra_float_digits = 0`: Postgres rende allora quindici cifre
 * significative invece della forma che ritorna identica. Misurato sul vivo,
 * `1786999449.694782` torna `1786999449.69478`, e i due NON sono lo stesso
 * double — a volte per troncamento, a volte per arrotondamento
 * (`1783904198.586839` → `1783904198.58684`). Il valore scritto è giusto: è la
 * lettura ad avere meno cifre di quante gliene abbiamo date.
 *
 * Confrontarli con `===` è la stessa trappola dei timestamp di #163, in un
 * altro tipo: una ricevuta non deve MAI confrontare la resa di un driver.
 * Sul campo, 14 righe su 20 campionate divergevano così, e 223 su 384 sono
 * nella popolazione a rischio.
 *
 * La tolleranza è cento microsecondi: tre ordini di grandezza sopra l'errore
 * massimo di quella resa (circa un microsecondo su un epoch di oggi) e senza
 * alcun rischio di confondere due righe, visto che il confronto avviene a
 * `legacy_id` già fissato.
 */
/**
 * Il confronto per i campi che la merge protegge con COALESCE.
 *
 * Una ricevuta attesta ciò che il CLIENT può attestare — «la mia riga è
 * arrivata e persiste» — non che il cloud non sappia niente di più. Quando il
 * client manda NULL su uno di questi campi non sta dicendo «deve essere
 * vuoto»: sta dicendo «io non lo so». Pretendere uguaglianza lì rendeva la
 * condizione falsa per costruzione su ogni riga consegnata dal web, e il
 * client si fabbricava un 422 da un 200 del server.
 */
function cloudMayKnowMore(
  onCloud: unknown,
  fromClient: unknown,
  same: (a: unknown, b: unknown) => boolean,
) {
  if (fromClient == null) return true;
  return same(onCloud, fromClient);
}

function sameNullableEpochSeconds(left: unknown, right: unknown) {
  if (left == null || right == null) return left == null && right == null;
  const a = Number(left);
  const b = Number(right);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return Math.abs(a - b) <= 1e-4;
}

function applicationReceiptId(application: ApplicationIn): string {
  // Compatibilità con client pre-quarantine: stessa derivazione opaca che il
  // nuovo client applica alla chiave sorgente. Non esponiamo l'intero locale.
  return wireReceipt("applications", application);
}

interface ProfileIn {
  yaml: string;
  _receipt_id?: string;
  summaries?: Record<string, string>;
  force?: boolean;
}

interface PendingMessageIn {
  id: number;
  _receipt_id?: string;
  agent: string;
  body: string;
  kind?: string | null;
  // [JHT-CHAT-UNIFY] Chi ha scritto il turno ('agent' | 'user') e il `ts`
  // della riga gemella in chat.jsonl. Opzionali: un box non ancora
  // ri-deployato non li manda e la RPC li tratta come "non pervenuti".
  author?: string | null;
  chat_ts?: number | null;
  related_position_id?: number | null;
  delivered_via?: string | null;
  delivered_at?: string | null;
  acknowledged_at?: string | null;
  user_reply?: string | null;
  user_reply_at?: string | null;
  agent_seen_reply_at?: string | null;
  created_at?: string | null;
}

interface SentinelTickIn {
  sample_key?: string | null;
  ts: string;
  provider: string;
  usage: number;
  delta?: number | null;
  velocity?: number | null;
  velocity_smooth?: number | null;
  velocity_ideal?: number | null;
  projection?: number | null;
  projection_naive?: number | null;
  velocity_decreasing?: boolean | null;
  status?: string | null;
  throttle?: number | null;
  reset_at?: string | null;
  reset_at_unix?: number | null;
  weekly_reset_at?: string | null;
  weekly_reset_at_unix?: number | null;
  weekly_usage?: number | null;
  source?: string | null;
  session_id?: string | null;
  host?: Record<string, unknown> | null;
  host_level?: string | null;
  raw?: Record<string, unknown> | null;
}

// Tombstones (SQLite V7): righe (table_name, legacy_id, deleted_at)
// emesse dai trigger BEFORE DELETE su positions/scores/applications.
// Il receive le interpreta come soft-delete cloud: UPDATE deleted_at.
// Vedi mig 025 + shared/skills/_db.py _migrate_v6_to_v7_tombstones.
interface TombstoneIn {
  _receipt_id?: string;
  table_name: "positions" | "scores" | "applications";
  legacy_id: number;
  deleted_at: string; // ISO timestamp client-side (preserva il "quando")
}

// Event-log per-istanza (SQLite position_state_transitions → cloud
// position_transitions, mig 044). Mostra CHI (scout-1, analista-2…) ha fatto
// cosa e quando — le colonne *_by su positions/scores tengono solo "ultimo
// attore" e perdono l'attribuzione intermedia. Append-only lato locale: la
// chiave verso le posizioni è `position_legacy_id` (l'int stabile == positions.legacy_id),
// non l'uuid per-account, così le righe sono portabili tra account/mirror.
interface PositionTransitionIn {
  _receipt_id?: string;
  position_legacy_id: number;
  from_state?: string | null;
  to_state: string;
  ts: string;
  by_agent: string;
  notes?: string | null;
}

// Companies (mig 046): finora escluse dal sync ("Scope MVP"). `id` è l'int
// locale (→ legacy_id cloud); i nomi colonna sono quelli SQLite locali —
// notare `hq_country` locale che mappa su `hq` cloud (schemi disallineati,
// mig 001/003). L'upsert usa (user_id, legacy_id) e popola companyLegacyToUuid
// per risolvere positions.company_id.
interface CompanyIn {
  id: number;
  _receipt_id?: string;
  name: string;
  website?: string | null;
  hq_country?: string | null;
  sector?: string | null;
  size?: string | null;
  glassdoor_rating?: number | null;
  red_flags?: string | null;
  culture_notes?: string | null;
  analyzed_by?: string | null;
  analyzed_at?: string | null;
  verdict?: string | null;
  // Logo aziendale (mig 056): data-URI base64 ≤~35KB + URL sorgente + flag
  // "estrazione tentata" (pattern office_geocoded).
  logo?: string | null;
  logo_source?: string | null;
  logo_fetched?: number | boolean | null;
}

// Position highlights (mig 046): pro/contro del dettaglio posizione. `id` è
// l'int locale (→ legacy_id cloud); `position_id` è l'int locale risolto a
// UUID cloud via legacyToUuid (come scores/applications).
interface HighlightIn {
  id: number;
  _receipt_id?: string;
  position_id: number;
  type: string;
  text: string;
}

interface PushBody {
  positions?: PositionIn[];
  scores?: ScoreIn[];
  applications?: ApplicationIn[];
  companies?: CompanyIn[];
  position_highlights?: HighlightIn[];
  pending_user_messages?: PendingMessageIn[];
  sentinel_ticks?: SentinelTickIn[];
  tombstones?: TombstoneIn[];
  position_transitions?: PositionTransitionIn[];
  profile?: ProfileIn;
}

// 'ready' = CV finito + Critic PASS (lo Scrittore lo setta nel gate finale,
// single-writer). DEVE restare in whitelist: senza, normalizeApplicationStatus
// lo degrada a 'draft' e la pagina posizione mostra "draft" pur avendo il CV
// pronto — il CHECK cloud lo ammette già (mig 014_applications_status_ready).
const ALLOWED_MESSAGE_KIND = new Set([
  "notification",
  "question",
  "digest",
  "alert",
]);
const ALLOWED_DELIVERED_VIA = new Set(["telegram", "web"]);
// position_highlights.type ha CHECK (pro|con) sul cloud (mig 003): scartiamo
// le righe con type fuori enum per non far fallire l'intero batch upsert.
const ALLOWED_HIGHLIGHT_TYPE = new Set(["pro", "con"]);

function finiteNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function finiteInteger(v: unknown): number | null {
  return typeof v === "number" && Number.isInteger(v) ? v : null;
}

function cleanText(v: unknown, fallback: string | null = null): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : fallback;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

export async function POST(req: NextRequest) {
  if (!isSupabaseConfigured) {
    return NextResponse.json(
      { error: "cloud sync non disponibile" },
      { status: 400 },
    );
  }

  const result = await verifyBearerToken(req);
  if (!result.ok) return result.res;
  const { userId, admin } = result.data;

  // Single-team enforcement (regola lockata vps.md:392): se team_state
  // ha un active_device_id non-null e non corrisponde al token corrente,
  // rifiuta il push con 409. Lascia passare se active_device_id è null
  // (nessuno ha mai claimato) per backward-compat con device legacy.
  const tsCheck = (await admin
    .from("team_state")
    .select(
      "active_device_id,last_heartbeat_at,sync_requested_at,sync_completed_at,last_action,last_action_at",
    )
    .eq("user_id", userId)
    .maybeSingle()) as {
    data: {
      active_device_id: string | null;
      last_heartbeat_at: string | null;
      sync_requested_at: string | null;
      sync_completed_at: string | null;
      last_action: string | null;
      last_action_at: string | null;
    } | null;
    error: { message: string } | null;
  };
  if (
    tsCheck.data &&
    tsCheck.data.active_device_id &&
    tsCheck.data.active_device_id !== result.data.tokenId
  ) {
    return NextResponse.json(
      {
        error: "not_active_device",
        message:
          "Questo device non è più il team attivo (un altro device ha fatto claim). " +
          'Spegni il team locale o fai POST /api/team-state/claim {"force":true} per riprendere il controllo.',
        active_device_id: tsCheck.data.active_device_id,
      },
      { status: 409 },
    );
  }

  // Push e' write-heavy (positions+scores+applications upsert): cap
  // stretto a 20/min per token. Il limite globale del proxy resta sopra.
  const rl = await checkCloudSyncRateLimit("push", result.data.tokenId, 20);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Rate limit superato. Riprova tra poco." },
      {
        status: 429,
        headers: {
          "Retry-After": String(rl.retryAfterSec),
          "X-RateLimit-Limit": "20",
          "X-RateLimit-Remaining": "0",
        },
      },
    );
  }

  let body: PushBody;
  try {
    body = await req.json();
  } catch {
    return invalidJsonBody();
  }

  const positions = Array.isArray(body.positions) ? body.positions : [];
  const scores = Array.isArray(body.scores) ? body.scores : [];
  const applications = Array.isArray(body.applications)
    ? body.applications
    : [];
  const companies = Array.isArray(body.companies) ? body.companies : [];
  const highlights = Array.isArray(body.position_highlights)
    ? body.position_highlights
    : [];
  const pendingMessages = Array.isArray(body.pending_user_messages)
    ? body.pending_user_messages
    : [];
  const sentinelTicks = Array.isArray(body.sentinel_ticks)
    ? body.sentinel_ticks.slice(-1000)
    : [];
  const tombstones = Array.isArray(body.tombstones)
    ? body.tombstones.slice(0, 1000)
    : [];
  // Event-log: cap generoso (20k) come solo guard anti-abuso. Il daemon manda
  // delta piccoli; il first-push manda l'intero log (centinaia/migliaia di
  // righe), che per qualsiasi log realistico sta sotto il cap → nessun
  // troncamento silenzioso.
  const positionTransitions = Array.isArray(body.position_transitions)
    ? body.position_transitions.slice(-20000)
    : [];

  let positionsUpserted = 0;
  let scoresUpserted = 0;
  let scoresOutOfRange: OutOfRangeSummary = {
    rows: 0,
    byColumn: {},
    worst: null,
  };
  let scoreReceiptIds: string[] = [];
  let applicationsUpserted = 0;
  let applicationReceiptIds: string[] = [];
  let companiesUpserted = 0;
  let highlightsUpserted = 0;
  let pendingMessagesUpserted = 0;
  let sentinelTicksUpserted = 0;
  let tombstonesApplied = 0;
  let positionTransitionsUpserted = 0;
  const rowReceipts: Record<ReceiptTable, string[]> = {
    applications: applicationReceiptIds,
    scores: scoreReceiptIds,
    companies: [],
    positions: [],
    position_highlights: [],
    pending_user_messages: [],
    tombstones: [],
    position_transitions: [],
    profile: [],
  };
  const legacyToUuid = new Map<number, string>();
  const appliedPositionIds = new Set<number>();
  // companies.id locale (int) → companies.id cloud (UUID). Popolata
  // dall'upsert companies, consumata dal mapping positions.company_id.
  const companyLegacyToUuid = new Map<number, string>();

  // 0. Upsert companies via (user_id, legacy_id) — PRIMA delle positions, così
  // companyLegacyToUuid è pronta per risolvere positions.company_id. Mapping
  // colonne: nomi SQLite locali → cloud, con hq_country → hq (schemi disallineati).
  if (companies.length > 0) {
    if (
      companies.some(
        (company) =>
          !validReceipt("companies", company.id, company._receipt_id),
      )
    ) {
      return protocolError("invalid_companies_receipt_id");
    }
    const payload = companies
      .filter((c) => typeof c.id === "number" && cleanText(c.name))
      .map((c) => ({
        user_id: userId,
        legacy_id: c.id,
        name: c.name,
        website: c.website ?? null,
        hq: c.hq_country ?? null,
        sector: c.sector ?? null,
        size: c.size ?? null,
        glassdoor_rating: finiteNumber(c.glassdoor_rating),
        red_flags: c.red_flags ?? null,
        culture_notes: c.culture_notes ?? null,
        analyzed_by: c.analyzed_by ?? null,
        analyzed_at: c.analyzed_at ?? null,
        verdict: c.verdict ?? null,
        logo: c.logo ?? null,
        logo_source: c.logo_source ?? null,
        logo_fetched: !!c.logo_fetched,
      }));

    if (payload.length !== companies.length) {
      return rowRejection("companies_row_rejected");
    }

    if (payload.length > 0) {
      const { data: upserted, error } = await admin
        .from("companies")
        .upsert(payload, { onConflict: "user_id,legacy_id" })
        .select("id, legacy_id");

      if (error) {
        return rowAttributableWriteError(error, "companies_upsert_failed");
      }
      companiesUpserted = upserted?.length ?? 0;
      const written = new Set<number>();
      for (const row of upserted ?? []) {
        if (row.legacy_id != null) {
          companyLegacyToUuid.set(row.legacy_id, row.id);
          written.add(Number(row.legacy_id));
        }
      }
      // La prova che la riga e' sul cloud e' il RETURNING della scrittura
      // stessa: quello che torna e' lo stato POST-write della riga con quel
      // legacy_id. L'identita', invece, viene dalla riga del client.
      for (const company of companies) {
        if (written.has(Number(company.id))) {
          rowReceipts.companies.push(wireReceipt("companies", company));
        }
      }
    }
  }

  // 1. Upsert positions via (user_id, legacy_id)
  if (positions.length > 0) {
    if (
      positions.some(
        (position) =>
          !validReceipt("positions", position.id, position._receipt_id),
      )
    ) {
      return protocolError("invalid_positions_receipt_id");
    }
    // Risolvi company_id (int locale) → UUID cloud. Riusa companyLegacyToUuid
    // dall'upsert companies; per i company_id referenziati da una position ma
    // NON presenti nel batch (delta dove la company non è cambiata), lookup
    // esplicito su companies.legacy_id (stesso pattern dei tombstones).
    const companyNeedsLookup = new Set<number>();
    for (const p of positions) {
      if (
        typeof p.company_id === "number" &&
        !companyLegacyToUuid.has(p.company_id)
      ) {
        companyNeedsLookup.add(p.company_id);
      }
    }
    if (companyNeedsLookup.size > 0) {
      const { data: rows } = await admin
        .from("companies")
        .select("id, legacy_id")
        .eq("user_id", userId)
        .in("legacy_id", Array.from(companyNeedsLookup));
      for (const r of rows ?? []) {
        if (r.legacy_id != null)
          companyLegacyToUuid.set(r.legacy_id, r.id as string);
      }
    }

    const payload = positions
      .filter((p) => typeof p.id === "number" && p.title && p.company)
      .map((p) => {
        const status = normalizePositionStatus(p.status);
        if (status === "applied") appliedPositionIds.add(p.id);
        return {
          user_id: userId,
          legacy_id: p.id,
          title: p.title,
          company: p.company,
          // company_id (UUID cloud) risolto via companyLegacyToUuid; null se la
          // company non è ancora sul cloud (degrada a "no Company card", si
          // popola al prossimo push completo).
          company_id:
            p.company_id != null
              ? (companyLegacyToUuid.get(p.company_id) ?? null)
              : null,
          url: p.url ?? null,
          location: p.location ?? null,
          remote_type: p.remote_type ?? null,
          status,
          notes: p.notes ?? null,
          source: p.source ?? null,
          jd_text: p.jd_text ?? null,
          jd_summary: p.jd_summary ?? null,
          requirements: p.requirements ?? null,
          found_by: p.found_by ?? null,
          found_at: p.found_at ?? null,
          deadline: p.deadline ?? null,
          last_checked: p.last_checked ?? null,
          last_actor: p.last_actor ?? null,
          // Metadati location/categoria (Parte B sync) — alimentano i grafici
          // categoria/mappa della dashboard. Text/numeric: passthrough.
          role_family: p.role_family ?? null,
          loc_city: p.loc_city ?? null,
          loc_region: p.loc_region ?? null,
          loc_country: p.loc_country ?? null,
          loc_country_code: p.loc_country_code ?? null,
          loc_continent: p.loc_continent ?? null,
          work_mode: p.work_mode ?? null,
          work_country: p.work_country ?? null,
          work_country_code: p.work_country_code ?? null,
          location_notes: p.location_notes ?? null,
          office_address: p.office_address ?? null,
          office_lat: p.office_lat ?? null,
          office_lon: p.office_lon ?? null,
          // boolean: SQLite 0|1 → BOOLEAN (default false se assente), come write_requested.
          is_multi_location:
            p.is_multi_location == null
              ? false
              : typeof p.is_multi_location === "boolean"
                ? p.is_multi_location
                : p.is_multi_location === 1,
          office_geocoded:
            p.office_geocoded == null
              ? false
              : typeof p.office_geocoded === "boolean"
                ? p.office_geocoded
                : p.office_geocoded === 1,
          office_verified:
            p.office_verified == null
              ? false
              : typeof p.office_verified === "boolean"
                ? p.office_verified
                : p.office_verified === 1,
          // Expiry/lifecycle (mig 038). is_open default TRUE (NOT NULL DEFAULT TRUE).
          expires_at: p.expires_at ?? null,
          is_open:
            p.is_open == null
              ? true
              : typeof p.is_open === "boolean"
                ? p.is_open
                : p.is_open === 1,
          last_open_check: p.last_open_check ?? null,
          salary_declared_min: p.salary_declared_min ?? null,
          salary_declared_max: p.salary_declared_max ?? null,
          salary_declared_currency: p.salary_declared_currency ?? null,
          salary_estimated_min: p.salary_estimated_min ?? null,
          salary_estimated_max: p.salary_estimated_max ?? null,
          salary_estimated_currency: p.salary_estimated_currency ?? null,
          salary_estimated_source: p.salary_estimated_source ?? null,
          // SQLite invia integer (0|1); Supabase ha BOOLEAN — coerce esplicito.
          // Default FALSE quando il campo manca (compat con DB pre-V6 / pre-V8
          // / push legacy).
          write_requested:
            p.write_requested == null
              ? false
              : typeof p.write_requested === "boolean"
                ? p.write_requested
                : p.write_requested === 1,
          write_requested_at: p.write_requested_at ?? null,
          // Compat pre-078: assente significa "client non conosce il campo",
          // non "azzera il desired state cloud". Con defaultToNull=false
          // PostgREST preserva il valore concorrente su UPDATE; un NULL
          // esplicito dei client aggiornati continua invece a risolverlo.
          ...(Object.prototype.hasOwnProperty.call(p, "write_request_kind")
            ? { write_request_kind: p.write_request_kind ?? null }
            : {}),
          geocode_requested:
            p.geocode_requested == null
              ? false
              : typeof p.geocode_requested === "boolean"
                ? p.geocode_requested
                : p.geocode_requested === 1,
          geocode_requested_at: p.geocode_requested_at ?? null,
          // Recheck on-demand (mig 042). Flag user-driven default FALSE.
          recheck_requested:
            p.recheck_requested == null
              ? false
              : typeof p.recheck_requested === "boolean"
                ? p.recheck_requested
                : p.recheck_requested === 1,
          recheck_requested_at: p.recheck_requested_at ?? null,
          // Salary-precise on-demand (V9, mig 040). Flag user-driven default FALSE.
          salary_precise_requested:
            p.salary_precise_requested == null
              ? false
              : typeof p.salary_precise_requested === "boolean"
                ? p.salary_precise_requested
                : p.salary_precise_requested === 1,
          salary_precise_requested_at: p.salary_precise_requested_at ?? null,
          salary_precise: p.salary_precise ?? null,
        };
      });

    if (payload.length !== positions.length) {
      return rowRejection("positions_row_rejected");
    }

    const regularPayload = payload.filter((p) => p.status !== "applied");
    const deferredAppliedPayload = payload
      .filter((p) => p.status === "applied")
      .map((p) => {
        const { status, ...deferred } = p;
        if (status !== "applied") throw new Error("unreachable_status");
        return deferred;
      });
    for (const batch of [
      { rows: regularPayload, defaultToNull: false },
      { rows: deferredAppliedPayload, defaultToNull: false },
    ]) {
      if (batch.rows.length === 0) continue;
      // Su INSERT lo status assente usa il default `new`; su UPDATE resta
      // quello corrente. Solo l'RPC dopo applications pubblica `applied`.
      const { data: upserted, error } = await admin
        .from("positions")
        .upsert(batch.rows, {
          onConflict: "user_id,legacy_id",
          defaultToNull: batch.defaultToNull,
        })
        .select("id, legacy_id");

      if (error) {
        const snapshot = await staleDowngradeSnapshot(
          admin,
          userId,
          batch.rows,
          error,
        );
        if (snapshot) {
          // Ramo esplicito, e non un helper che «a volte» allega dati:
          // `sanitizedError` esiste per TOGLIERE, e appenderci un payload lo
          // metterebbe contro il suo mestiere per ogni route che lo usa.
          console.error(
            "[cloud-sync/push] 500 row write rejected (stale_position_downgrade)",
          );
          return NextResponse.json(
            {
              error: "positions_upsert_failed",
              rejection_scope: "row",
              stale_position: snapshot,
            },
            { status: 500 },
          );
        }
        return rowAttributableWriteError(error, "positions_upsert_failed");
      }

      positionsUpserted += upserted?.length ?? 0;
      const written = new Set<number>();
      for (const row of upserted ?? []) {
        if (row.legacy_id != null) {
          legacyToUuid.set(row.legacy_id, row.id);
          written.add(Number(row.legacy_id));
        }
      }
      for (const position of positions) {
        if (written.has(Number(position.id))) {
          rowReceipts.positions.push(wireReceipt("positions", position));
        }
      }
    }
  }

  // 2. Upsert scores via position_id UUID. L'identità dell'ACK è però sempre
  // scores.legacy_id: il parent serve solo a risolvere la FK cloud.
  const scoreParents = new Set<number>();
  const scoreLegacyIds = new Set<number>();
  for (const score of scores) {
    if (!Number.isInteger(score.legacy_id) || score.legacy_id <= 0) {
      return protocolError("invalid_score_identity");
    }
    const derivedReceiptId = sourceReceiptId("scores", score.legacy_id);
    if (
      score._receipt_id !== undefined &&
      score._receipt_id !== derivedReceiptId
    ) {
      return protocolError("invalid_score_receipt_id");
    }
    if (
      scoreParents.has(score.position_id) ||
      scoreLegacyIds.has(score.legacy_id)
    ) {
      return protocolError("score_identity_collision");
    }
    scoreParents.add(score.position_id);
    scoreLegacyIds.add(score.legacy_id);
  }
  if (scores.length > 0) {
    const scoreParentsToResolve = new Set<number>();
    for (const score of scores) {
      if (!legacyToUuid.has(score.position_id)) {
        scoreParentsToResolve.add(score.position_id);
      }
    }
    if (scoreParentsToResolve.size > 0) {
      const { data: rows, error } = await admin
        .from("positions")
        .select("id, legacy_id")
        .eq("user_id", userId)
        .in("legacy_id", Array.from(scoreParentsToResolve));
      if (error) {
        return sanitizedError(error, {
          status: 500,
          scope: "cloud-sync/push",
          publicMessage: "scores_positions_lookup_failed",
        });
      }
      for (const row of rows ?? []) {
        if (row.legacy_id != null) {
          legacyToUuid.set(row.legacy_id, row.id as string);
        }
      }
    }

    const scoreReceiptByUuid = new Map<string, string>();
    const scoreLegacyByUuid = new Map<string, number>();
    const payload = scores
      .map((s) => {
        const uuid = legacyToUuid.get(s.position_id);
        if (!uuid || typeof s.total_score !== "number") return null;
        scoreReceiptByUuid.set(uuid, wireReceipt("scores", s));
        scoreLegacyByUuid.set(uuid, s.legacy_id);
        return {
          user_id: userId,
          position_id: uuid,
          legacy_id: s.legacy_id,
          total_score: Math.max(0, Math.min(100, Math.round(s.total_score))),
          experience_fit: s.experience_fit ?? null,
          salary_fit: s.salary_fit ?? null,
          stack_match: s.stack_match ?? null,
          remote_fit: s.remote_fit ?? null,
          strategic_fit: s.strategic_fit ?? null,
          breakdown: s.breakdown ?? null,
          notes: s.notes ?? null,
          scored_by: s.scored_by ?? null,
          scored_at: s.scored_at ?? null,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    if (payload.length !== scores.length) {
      return rowRejection("scores_identity_unresolved", 400);
    }

    if (payload.length > 0) {
      const { data: upserted, error } = await admin
        .from("scores")
        .upsert(payload, { onConflict: "position_id" })
        .select("position_id, legacy_id");

      if (error) {
        return rowAttributableWriteError(error, "scores_upsert_failed");
      }
      const persistedReceiptIds = Array.isArray(upserted)
        ? upserted.map((row) =>
            row.legacy_id === scoreLegacyByUuid.get(row.position_id)
              ? (scoreReceiptByUuid.get(row.position_id) ?? null)
              : null,
          )
        : [];
      const completeReceipt =
        persistedReceiptIds.length === payload.length &&
        persistedReceiptIds.every((receiptId) => receiptId !== null) &&
        new Set(persistedReceiptIds).size === payload.length;
      if (!completeReceipt) {
        return NextResponse.json(
          { error: "scores_receipt_mismatch" },
          { status: 500 },
        );
      }
      scoreReceiptIds = (persistedReceiptIds as string[]).sort();
      scoresUpserted = upserted?.length ?? 0;
      // Il cloud non ha CHECK sulle dimensioni (mig 001/003): quello che passa
      // da qui torna identico a ogni restore. Non lo tocchiamo — i punteggi
      // sono di utenti reali — ma lo contiamo, così il fenomeno è misurabile
      // dalla risposta di sync invece che solo interrogando il DB.
      scoresOutOfRange = summarizeOutOfRange(payload);
    }
  }

  // 3. L'RPC risolve position_legacy_id nel tenant e conserva separatamente
  // applications.legacy_id. Nessuna riga viene filtrata qui: identità invalida,
  // parent mancante o ricevuta incompleta devono fallire l'intero request.
  if (applications.length > 0) {
    for (const application of applications) {
      if (
        !Number.isInteger(application.legacy_id) ||
        application.legacy_id <= 0 ||
        !Number.isInteger(application.position_legacy_id) ||
        application.position_legacy_id <= 0
      ) {
        return protocolError("invalid_application_identity");
      }
      const expectedReceiptId = sourceReceiptId(
        "applications",
        application.legacy_id,
      );
      if (
        application._receipt_id !== undefined &&
        application._receipt_id !== expectedReceiptId
      ) {
        return protocolError("invalid_application_receipt_id");
      }
    }

    const payload = applications.map((a) => {
      const status = normalizeApplicationStatus(a.status);
      if (status === "applied") appliedPositionIds.add(a.position_legacy_id);
      return invalidateStaleCriticVerdict({
        legacy_id: a.legacy_id,
        position_legacy_id: a.position_legacy_id,
        _receipt_id: applicationReceiptId(a),
        cv_path: a.cv_path ?? null,
        cv_pdf_path: a.cv_pdf_path ?? null,
        cl_path: a.cl_path ?? null,
        cl_pdf_path: a.cl_pdf_path ?? null,
        status,
        critic_score: a.critic_score ?? null,
        critic_verdict: normalizeCriticVerdict(a.critic_verdict),
        critic_notes: a.critic_notes ?? null,
        // `undefined` resta assente per i client pre-O-64 e non cancella il
        // round cloud; i client aggiornati inviano invece number o null.
        critic_round: a.critic_round,
        written_at: a.written_at ?? null,
        applied_at: a.applied_at ?? null,
        applied_via: a.applied_via ?? null,
        response: a.response ?? null,
        response_at: a.response_at ?? null,
        written_by: a.written_by ?? null,
        reviewed_by: a.reviewed_by ?? null,
        critic_reviewed_at: a.critic_reviewed_at ?? null,
        applied: a.applied ?? null,
        cv_drive_id: a.cv_drive_id ?? null,
        cl_drive_id: a.cl_drive_id ?? null,
      });
    });

    if (payload.length > 0) {
      // L'RPC prende il lock della position prima di valutare l'application.
      // Un push stale non può quindi retrocedere la candidatura dopo che una
      // mark_position_applied concorrente l'ha resa visibile come applied.
      const { data: receipts, error } = await admin.rpc(
        "sync_upsert_applications",
        {
          p_user_id: userId,
          p_applications: payload,
        },
      );

      if (error) {
        return rowAttributableWriteError(error, "applications_upsert_failed");
      }
      const expectedReceiptIds = payload
        .map((application) => application._receipt_id)
        .sort();
      const receivedReceiptIds = Array.isArray(receipts)
        ? receipts
            .map((receipt) => (typeof receipt === "string" ? receipt : null))
            .sort()
        : [];
      const completeReceipt =
        receivedReceiptIds.length === expectedReceiptIds.length &&
        receivedReceiptIds.every(
          (receiptId, index) =>
            receiptId !== null && receiptId === expectedReceiptIds[index],
        );
      if (!completeReceipt) {
        return NextResponse.json(
          { error: "applications_receipt_mismatch" },
          { status: 500 },
        );
      }
      applicationReceiptIds = receivedReceiptIds as string[];
      applicationsUpserted = receipts.length;
    }
  }

  // Il solo passo che rende la posizione visibile nel filtro applied avviene
  // dopo l'application. L'RPC controlla sotto lock status, flag, timestamp e
  // canale; se uno manca, fallisce e il client non avanza il cursore.
  if (appliedPositionIds.size > 0) {
    const { error } = await admin.rpc("sync_confirm_positions_applied", {
      p_user_id: userId,
      p_position_legacy_ids: Array.from(appliedPositionIds),
    });
    if (error) {
      return rowAttributableWriteError(
        error,
        "application_state_invariant_failed",
      );
    }
  }

  // 3a. Upsert position_highlights via (user_id, legacy_id). FK position_id
  // (int locale) → UUID cloud via legacyToUuid; per i delta dove la position
  // non è nel batch positions, lookup esplicito su positions.legacy_id (stesso
  // pattern di scores/applications). type validato (pro|con), righe fuori enum
  // scartate per non far fallire l'intero upsert.
  if (highlights.length > 0) {
    if (
      highlights.some(
        (highlight) =>
          !validReceipt(
            "position_highlights",
            highlight.id,
            highlight._receipt_id,
          ),
      )
    ) {
      return protocolError("invalid_position_highlights_receipt_id");
    }
    const hlNeedsLookup = new Set<number>();
    for (const h of highlights) {
      if (typeof h.position_id === "number" && !legacyToUuid.has(h.position_id))
        hlNeedsLookup.add(h.position_id);
    }
    if (hlNeedsLookup.size > 0) {
      const { data: rows } = await admin
        .from("positions")
        .select("id, legacy_id")
        .eq("user_id", userId)
        .in("legacy_id", Array.from(hlNeedsLookup));
      for (const r of rows ?? []) {
        if (r.legacy_id != null) legacyToUuid.set(r.legacy_id, r.id as string);
      }
    }

    const payload = highlights
      .map((h) => {
        const uuid = legacyToUuid.get(h.position_id);
        const type = (h.type ?? "").trim().toLowerCase();
        const text = cleanText(h.text);
        if (
          typeof h.id !== "number" ||
          !uuid ||
          !ALLOWED_HIGHLIGHT_TYPE.has(type) ||
          !text
        )
          return null;
        return {
          user_id: userId,
          legacy_id: h.id,
          position_id: uuid,
          type,
          text,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    if (payload.length !== highlights.length) {
      return rowRejection("position_highlights_row_rejected");
    }

    if (payload.length > 0) {
      const { data: upserted, error } = await admin
        .from("position_highlights")
        .upsert(payload, { onConflict: "user_id,legacy_id" })
        .select("legacy_id");

      if (error) {
        return rowAttributableWriteError(
          error,
          "position_highlights_upsert_failed",
        );
      }
      highlightsUpserted = upserted?.length ?? 0;
      const written = new Set<number>();
      for (const row of upserted ?? []) {
        if (row.legacy_id != null) written.add(Number(row.legacy_id));
      }
      for (const highlight of highlights) {
        if (written.has(Number(highlight.id))) {
          rowReceipts.position_highlights.push(
            wireReceipt("position_highlights", highlight),
          );
        }
      }
    }
  }

  // 3b. Upsert pending_user_messages via (user_id, legacy_id).
  // related_position_id (numero locale) -> UUID cloud. Un parent dichiarato
  // non può degradare a NULL: sarebbe un 200 con perdita semantica.
  if (pendingMessages.length > 0) {
    if (
      pendingMessages.some(
        (message) =>
          !validReceipt(
            "pending_user_messages",
            message.id,
            message._receipt_id,
          ),
      )
    ) {
      return protocolError("invalid_pending_user_messages_receipt_id");
    }
    const pendingNeedsLookup = new Set<number>();
    for (const message of pendingMessages) {
      if (
        typeof message.related_position_id === "number" &&
        !legacyToUuid.has(message.related_position_id)
      ) {
        pendingNeedsLookup.add(message.related_position_id);
      }
    }
    if (pendingNeedsLookup.size > 0) {
      const { data: rows, error } = await admin
        .from("positions")
        .select("id, legacy_id")
        .eq("user_id", userId)
        .in("legacy_id", Array.from(pendingNeedsLookup));
      if (error) {
        return sanitizedError(error, {
          status: 500,
          scope: "cloud-sync/push",
          publicMessage: "message_positions_lookup_failed",
        });
      }
      for (const row of rows ?? []) {
        if (row.legacy_id != null) legacyToUuid.set(row.legacy_id, row.id);
      }
    }
    const payload = pendingMessages
      .filter(
        (m) =>
          typeof m.id === "number" &&
          m.agent &&
          m.body &&
          (m.related_position_id == null ||
            legacyToUuid.has(m.related_position_id)),
      )
      .map((m) => {
        const relatedUuid =
          m.related_position_id != null
            ? legacyToUuid.get(m.related_position_id)!
            : null;
        return {
          user_id: userId,
          legacy_id: m.id,
          agent: m.agent,
          body: m.body,
          kind:
            m.kind && ALLOWED_MESSAGE_KIND.has(m.kind)
              ? m.kind
              : "notification",
          author: m.author === "user" ? "user" : "agent",
          chat_ts:
            typeof m.chat_ts === "number" && Number.isFinite(m.chat_ts)
              ? m.chat_ts
              : null,
          related_position_id: relatedUuid,
          delivered_via:
            m.delivered_via && ALLOWED_DELIVERED_VIA.has(m.delivered_via)
              ? m.delivered_via
              : null,
          delivered_at: m.delivered_at ?? null,
          acknowledged_at: m.acknowledged_at ?? null,
          user_reply: m.user_reply ?? null,
          user_reply_at: m.user_reply_at ?? null,
          agent_seen_reply_at: m.agent_seen_reply_at ?? null,
          // created_at lato cloud usa il default now() solo se l'INSERT lo
          // omette. Forziamo a quello locale cosi' l'ordinamento per timestamp
          // riflette quando l'agente ha scritto, non quando il push e' arrivato.
          ...(m.created_at ? { created_at: m.created_at } : {}),
        };
      });

    if (payload.length !== pendingMessages.length) {
      return rowRejection("pending_user_messages_row_rejected");
    }

    if (payload.length > 0) {
      // [JHT-MSG-BACKFLOW] Merge lato DB (mig 057) invece di upsert cieco:
      // i campi utente (acknowledged_at, user_reply, user_reply_at) scritti
      // dal web NON vengono più sovrascritti dai NULL della SQLite locale
      // a ogni tick di full-push. Vedi commento nella migration.
      const { data: upsertedCount, error } = await admin.rpc(
        "upsert_pending_user_messages_merge",
        { p_rows: payload },
      );

      if (error) {
        return rowAttributableWriteError(
          error,
          "pending_user_messages_upsert_failed",
        );
      }
      pendingMessagesUpserted =
        typeof upsertedCount === "number" ? upsertedCount : payload.length;

      // ⚠️ Quante righe la RPC ha SCRITTO non dice quante ne ha ACCETTATE.
      // La merge salta i no-op di proposito (mig 060: senza quella guardia il
      // full-push riscriverebbe ogni riga identica a ogni tick), quindi a
      // regime ritorna 0 su righe che sul cloud ci sono, identiche. Legare le
      // ricevute a quel numero — com'era fino a #163 — voleva dire non
      // emetterne nessuna e far fallire il push per sempre: 334 messaggi
      // fermi su due macchine, mentre le righe erano gia' arrivate.
      //
      // La domanda giusta non e' «l'ho riscritta adesso?» ma «c'e', ed e'
      // quella che il client ha mandato?». Si risponde rileggendola e
      // confrontandola campo per campo, riga per riga: chi passa prende la
      // ricevuta, chi non torna o torna diverso NON la prende e continua a
      // fermare il push.
      const { data: persisted, error: receiptError } = await admin
        .from("pending_user_messages")
        .select(
          "legacy_id,agent,body,kind,author,chat_ts,related_position_id,delivered_via,delivered_at,agent_seen_reply_at",
        )
        .eq("user_id", userId)
        .in(
          "legacy_id",
          payload.map((message) => message.legacy_id),
        );
      if (receiptError) {
        return sanitizedError(receiptError, {
          status: 500,
          scope: "cloud-sync/push",
          publicMessage: "pending_user_messages_receipt_failed",
        });
      }
      const persistedById = new Map(
        (persisted ?? []).map((row) => [Number(row.legacy_id), row]),
      );
      // La riga com'e' arrivata dal client, per derivarne l'identita': quella
      // rimessa in fila dal database ha altre rese (per esempio le date) e
      // non e' la stessa stringa, che e' l'altra meta' di #163.
      const wireByLegacyId = new Map(
        pendingMessages.map((message) => [Number(message.id), message]),
      );
      for (const expected of payload) {
        const row = persistedById.get(Number(expected.legacy_id));
        const wire = wireByLegacyId.get(Number(expected.legacy_id));
        if (
          row &&
          wire &&
          // I campi che il client governa: la merge li sovrascrive sempre,
          // quindi qui l'uguaglianza è la prova che la SUA riga è quella
          // persistita e non un'altra con lo stesso legacy_id.
          row.agent === expected.agent &&
          row.body === expected.body &&
          row.kind === expected.kind &&
          // `author` sale a 'user' e non torna più indietro (la merge tiene
          // il valore del cloud quando il client manda 'agent'): pretendere
          // uguaglianza qui bloccherebbe per sempre ogni riga a cui l'utente
          // ha risposto dal sito.
          (row.author === expected.author || row.author === "user") &&
          // Campi che il cloud può sapere e il box no. La merge fa
          // COALESCE(in arrivo, presente) DI PROPOSITO — chi consegna sul web
          // timbra là — quindi un valore sul cloud dove il client manda NULL
          // non è una divergenza: è l'unica cosa che poteva succedere. Se
          // invece il client un valore ce l'ha, quello deve combaciare.
          cloudMayKnowMore(
            row.related_position_id,
            expected.related_position_id,
            (a, b) => a === b,
          ) &&
          cloudMayKnowMore(
            row.delivered_via,
            expected.delivered_via,
            (a, b) => a === b,
          ) &&
          cloudMayKnowMore(row.chat_ts, expected.chat_ts, (a, b) =>
            sameNullableEpochSeconds(a, b),
          ) &&
          cloudMayKnowMore(row.delivered_at, expected.delivered_at, (a, b) =>
            sameNullableInstant(a, b),
          ) &&
          cloudMayKnowMore(
            row.agent_seen_reply_at,
            expected.agent_seen_reply_at,
            (a, b) => sameNullableInstant(a, b),
          )
        ) {
          rowReceipts.pending_user_messages.push(
            wireReceipt("pending_user_messages", wire),
          );
        }
      }
    }
  }

  // 3c. Upsert sentinel bridge ticks. Questi arrivano dal JSONL
  // /jht_home/logs/sentinel-data.jsonl sulla VPS e alimentano i grafici
  // rate-budget anche su jobhunterteam.ai, dove non esiste filesystem locale.
  if (sentinelTicks.length > 0) {
    const payload = sentinelTicks
      .map((t) => {
        const tsMs = Date.parse(t.ts);
        const usage = finiteNumber(t.usage);
        const provider = cleanText(t.provider);
        if (!Number.isFinite(tsMs) || usage === null || !provider) return null;
        const isoTs = new Date(tsMs).toISOString();
        const source = cleanText(t.source);
        const sessionId = cleanText(t.session_id);
        const sampleKey =
          cleanText(t.sample_key) ??
          `${isoTs}|${provider}|${source ?? ""}|${sessionId ?? ""}`;
        return {
          user_id: userId,
          sample_key: sampleKey,
          ts: isoTs,
          provider,
          usage,
          delta: finiteNumber(t.delta),
          velocity: finiteNumber(t.velocity),
          velocity_smooth: finiteNumber(t.velocity_smooth),
          velocity_ideal: finiteNumber(t.velocity_ideal),
          projection: finiteNumber(t.projection),
          projection_naive: finiteNumber(t.projection_naive),
          velocity_decreasing:
            typeof t.velocity_decreasing === "boolean"
              ? t.velocity_decreasing
              : null,
          status: cleanText(t.status, "OK"),
          throttle: finiteInteger(t.throttle),
          reset_at: cleanText(t.reset_at),
          // Epoch dei reset (data completa, no ora-nuda lato UI/cloud).
          reset_at_unix: finiteNumber(t.reset_at_unix),
          weekly_reset_at: cleanText(t.weekly_reset_at),
          weekly_reset_at_unix: finiteNumber(t.weekly_reset_at_unix),
          weekly_usage: finiteNumber(t.weekly_usage),
          source,
          session_id: sessionId,
          host: isPlainObject(t.host) ? t.host : null,
          host_level: cleanText(t.host_level),
          raw: isPlainObject(t.raw) ? t.raw : t,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    if (payload.length > 0) {
      const { data: upserted, error } = await admin
        .from("sentinel_ticks")
        .upsert(payload, { onConflict: "user_id,sample_key" })
        .select("id");

      if (error) {
        return rowAttributableWriteError(error, "sentinel_ticks_upsert_failed");
      }
      sentinelTicksUpserted = upserted?.length ?? 0;
    }
  }

  // 3d. Tombstones (soft-delete su positions/scores/applications).
  // Volume tipico: 0-10 righe per push (gli agenti hanno regola NO DELETE,
  // i DELETE veri arrivano da migrazioni one-shot tipo db_migrate_v2).
  // Quando viene cancellata una position, scout/critico potrebbero anche
  // generare tombstones per scores/applications nello stesso tick.
  //
  // Logica:
  //   - positions: UPDATE WHERE user_id, legacy_id (1:1 con cloud).
  //   - scores/applications: lato cloud usano position_id UUID; risolviamo
  //     prima legacy_id → UUID via lookup positions, poi UPDATE.
  //
  // Idempotente: il filter `deleted_at IS NULL` evita di sovrascrivere
  // tombstone già applicati (un re-push dopo cursor reset non rompe nulla).
  if (tombstones.length > 0) {
    if (
      tombstones.some(
        (tombstone) =>
          !validReceipt(
            "tombstones",
            [tombstone.table_name, tombstone.legacy_id, tombstone.deleted_at],
            tombstone._receipt_id,
          ),
      )
    ) {
      return protocolError("invalid_tombstones_receipt_id");
    }
    const byTable = {
      positions: [] as TombstoneIn[],
      scores: [] as TombstoneIn[],
      applications: [] as TombstoneIn[],
    };
    for (const t of tombstones) {
      if (!t || typeof t.legacy_id !== "number" || !t.deleted_at) continue;
      if (
        t.table_name === "positions" ||
        t.table_name === "scores" ||
        t.table_name === "applications"
      ) {
        byTable[t.table_name].push(t);
      }
    }
    const classifiedTombstones =
      byTable.positions.length +
      byTable.scores.length +
      byTable.applications.length;
    if (classifiedTombstones !== tombstones.length) {
      return rowRejection("tombstone_row_rejected");
    }

    // Risolvi legacy_id → UUID per scores/applications. Riusa il mapping
    // già popolato dai positions upsert quando possibile; integra con
    // lookup esplicito per i legacy_id che non sono passati dal push.
    const needsLookup = new Set<number>();
    for (const t of [...byTable.scores, ...byTable.applications]) {
      if (!legacyToUuid.has(t.legacy_id)) needsLookup.add(t.legacy_id);
    }
    if (needsLookup.size > 0) {
      const { data: rows } = await admin
        .from("positions")
        .select("id, legacy_id")
        .eq("user_id", userId)
        .in("legacy_id", Array.from(needsLookup));
      for (const r of rows ?? []) {
        if (r.legacy_id != null) legacyToUuid.set(r.legacy_id, r.id as string);
      }
    }

    for (const t of byTable.positions) {
      const { data, error } = await admin
        .from("positions")
        .update({ deleted_at: t.deleted_at })
        .eq("user_id", userId)
        .eq("legacy_id", t.legacy_id)
        .select("legacy_id");
      if (error) {
        return rowAttributableWriteError(error, "tombstones_update_failed");
      }
      if ((data?.length ?? 0) > 0) {
        tombstonesApplied++;
        rowReceipts.tombstones.push(wireReceipt("tombstones", t));
      }
    }
    for (const t of byTable.scores) {
      const uuid = legacyToUuid.get(t.legacy_id);
      if (!uuid) return rowRejection("tombstone_position_not_found");
      const { data, error } = await admin
        .from("scores")
        .update({ deleted_at: t.deleted_at })
        .eq("position_id", uuid)
        .select("position_id");
      if (error) {
        return rowAttributableWriteError(error, "tombstones_update_failed");
      }
      if ((data?.length ?? 0) > 0) {
        tombstonesApplied++;
        rowReceipts.tombstones.push(wireReceipt("tombstones", t));
      }
    }
    for (const t of byTable.applications) {
      const uuid = legacyToUuid.get(t.legacy_id);
      if (!uuid) return rowRejection("tombstone_position_not_found");
      const { data, error } = await admin
        .from("applications")
        .update({ deleted_at: t.deleted_at })
        .eq("position_id", uuid)
        .select("position_id");
      if (error) {
        return rowAttributableWriteError(error, "tombstones_update_failed");
      }
      if ((data?.length ?? 0) > 0) {
        tombstonesApplied++;
        rowReceipts.tombstones.push(wireReceipt("tombstones", t));
      }
    }
  }

  // 3e. Position transitions (event-log per-istanza → feed "Attività recente").
  // Append-only: insert-if-new via UNIQUE (user_id, position_legacy_id, ts,
  // by_agent, to_state). `ignoreDuplicates` = ON CONFLICT DO NOTHING → un
  // re-push (cursor reset / overlap col backfill manuale) NON duplica, e il
  // count riflette solo le righe davvero nuove. `position_legacy_id` è l'int
  // locale stabile: nessun lookup UUID necessario (a differenza di scores/apps).
  if (positionTransitions.length > 0) {
    if (
      positionTransitions.some(
        (transition) =>
          !validReceipt(
            "position_transitions",
            [
              transition.position_legacy_id,
              transition.ts,
              transition.by_agent,
              transition.to_state,
            ],
            transition._receipt_id,
          ),
      )
    ) {
      return protocolError("invalid_position_transitions_receipt_id");
    }
    const payload = positionTransitions
      .filter(
        (t) =>
          typeof t.position_legacy_id === "number" &&
          !!t.to_state &&
          !!t.ts &&
          !!t.by_agent,
      )
      .map((t) => ({
        user_id: userId,
        position_legacy_id: t.position_legacy_id,
        from_state: t.from_state ?? null,
        to_state: t.to_state,
        ts: t.ts,
        by_agent: t.by_agent,
        notes: t.notes ?? null,
      }));

    if (payload.length !== positionTransitions.length) {
      return rowRejection("position_transition_row_rejected");
    }

    if (payload.length > 0) {
      const { data: upserted, error } = await admin
        .from("position_transitions")
        .upsert(payload, {
          onConflict: "user_id,position_legacy_id,ts,by_agent,to_state",
        })
        .select("position_legacy_id,ts,by_agent,to_state,from_state,notes");

      if (error) {
        return rowAttributableWriteError(
          error,
          "position_transitions_upsert_failed",
        );
      }
      positionTransitionsUpserted = upserted?.length ?? 0;
      // ⚠️ Qui la ricevuta si derivava da `row.ts`, cioe' da come il driver
      // rende un `timestamptz`: `2026-08-16T18:24:28+00:00`. Il client la
      // deriva da quello che ha letto da SQLite, `2026-08-16 18:24:28`. Stesso
      // istante, due stringhe, due hash — e 271 transizioni ferme per sempre
      // (#163). Il ritorno del database prova che la riga c'e'; l'identita' la
      // da' la riga che il client ha mandato.
      for (const wire of positionTransitions) {
        const row = (upserted ?? []).find(
          (candidate) =>
            Number(candidate.position_legacy_id) ===
              Number(wire.position_legacy_id) &&
            candidate.by_agent === wire.by_agent &&
            candidate.to_state === wire.to_state &&
            sameInstant(candidate.ts, wire.ts),
        );
        if (
          row &&
          (row.from_state ?? null) === (wire.from_state ?? null) &&
          (row.notes ?? null) === (wire.notes ?? null)
        ) {
          rowReceipts.position_transitions.push(
            wireReceipt("position_transitions", wire),
          );
        }
      }
    }
  }

  // 4. Profile upsert (opzionale, indipendente da positions/scores/apps)
  let profileUpserted = false;
  let profileError: string | null = null;
  if (body.profile && typeof body.profile.yaml === "string") {
    if (
      !validReceipt("profile", "candidate_profile", body.profile._receipt_id)
    ) {
      return protocolError("invalid_profile_receipt_id");
    }
    const yamlRaw = body.profile.yaml;
    if (yamlRaw.length > 64 * 1024) {
      profileError = "profile yaml troppo grande (>64 KB)";
    } else {
      try {
        const parsed = yaml.load(yamlRaw, { schema: yaml.CORE_SCHEMA });
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          // Modello a 3 livelli: candidate_profiles (core + JSONB legacy) +
          // tabelle normalizzate + candidate_blocks + candidate_contacts.
          // Best-effort sulle tabelle figlie; il core resta critico.
          const canonical = mapYamlToCanonical(
            parsed as Record<string, unknown>,
            userId,
            body.profile.summaries ?? {},
          );
          const sync = await syncProfileToSupabase(
            admin,
            userId,
            canonical,
            body.profile.force === true,
          );
          if (!sync.ok) {
            profileError = sync.error;
          } else {
            profileUpserted = sync.changed;
            rowReceipts.profile.push(
              sourceReceiptId("profile", "candidate_profile"),
            );
            if (sync.warnings.length) {
              console.warn(
                "[cloud-sync/push] profile sync warnings:",
                sync.warnings,
              );
            }
            // Segna lo stato di onboarding: primo upsert di candidate_profiles
            // con successo = profilo configurato. Best-effort, non rompe la
            // response del push se fallisce. Il flag e' "primo successo" —
            // sync ripetuti non sovrascrivono profile_configured_at.
            try {
              const { data: existing } = await admin
                .from("user_onboarding_state")
                .select("profile_configured_at")
                .eq("user_id", userId)
                .maybeSingle();
              if (!existing?.profile_configured_at) {
                const nowIso = new Date().toISOString();
                await admin.from("user_onboarding_state").upsert(
                  {
                    user_id: userId,
                    profile_configured_at: nowIso,
                    updated_at: nowIso,
                  },
                  { onConflict: "user_id" },
                );
              }
            } catch {
              // best-effort
            }
          }
        } else {
          profileError = "yaml non e' un oggetto top-level";
        }
      } catch (e) {
        profileError = `yaml parse: ${(e as Error).message}`;
      }
    }
  }

  // [JHT-DATA-FRESH-SIGNAL] Timbro `sync_completed_at` quando il push ha
  // portato dati DASHBOARD nuovi (positions/scores/…): i browser aperti sono
  // sottoscritti a team_state via Supabase Realtime (websocket diretto, zero
  // invocazioni Vercel) e usano questo timestamp come segnale "dati freschi
  // disponibili" → refresh throttled senza polling né reload manuale.
  // Esclusi pending_user_messages (full-push a ogni tick, hanno già i loro
  // eventi Realtime per-riga) e sentinel/profile (non-dashboard). Best-effort:
  // UPDATE puro (no-op se la riga team_state non esiste ancora).
  const dashboardRowsChanged =
    positionsUpserted +
    scoresUpserted +
    applicationsUpserted +
    companiesUpserted +
    highlightsUpserted +
    positionTransitionsUpserted +
    tombstonesApplied;
  const requestedAt = tsCheck.data?.sync_requested_at ?? null;
  const syncPending = syncRequestIsPending(tsCheck.data);

  if (dashboardRowsChanged > 0 && !syncPending) {
    try {
      // Il read iniziale diventa un CAS: se durante il push arriva una nuova
      // richiesta, il suo sync_requested_at non coincide e questo segnale di
      // freschezza generico non puo' chiuderla al posto dell'endpoint
      // /api/team-state/sync-observed.
      let freshness = admin
        .from("team_state")
        .update({ sync_completed_at: new Date().toISOString() })
        .eq("user_id", userId);
      freshness = requestedAt
        ? freshness.eq("sync_requested_at", requestedAt)
        : freshness.is("sync_requested_at", null);
      await freshness;
    } catch {
      // best-effort: il segnale di freschezza non deve rompere il push
    }
  }

  // [ONBOARDING-STATE-HALF-DEAD] «Il team ha mai girato davvero?»
  //
  // `user_onboarding_state.first_team_run_at` era NULL per OGNI account in
  // produzione, compresi quelli con migliaia di posizioni: la colonna
  // esisteva dalla migration 011 e nessuno la scriveva né la leggeva. Un
  // imbuto mezzo popolato è peggio di nessun imbuto, perché qualcuno lo
  // legge — quindi o si scrive dove il primo run è osservabile, o si toglie.
  //
  // Il primo push che porta lavoro del team è il segnale onesto, ed è già
  // una chiamata cloud: niente meccanismo nuovo. Le righe che contano sono
  // quelle prodotte dagli agenti; il profilo no — quello lo configura la
  // persona, e ha già la sua milestone (`profile_configured_at`).
  const producedWork = teamProducedWork({
    positions: positionsUpserted,
    companies: companiesUpserted,
    scores: scoresUpserted,
    applications: applicationsUpserted,
    highlights: highlightsUpserted,
    positionTransitions: positionTransitionsUpserted,
    sentinelTicks: sentinelTicksUpserted,
  });

  if (producedWork) {
    try {
      const { data: onboarding } = await admin
        .from("user_onboarding_state")
        .select("first_team_run_at")
        .eq("user_id", userId)
        .maybeSingle();
      const patch = firstTeamRunPatch(
        onboarding,
        userId,
        new Date().toISOString(),
      );
      if (patch) {
        await admin
          .from("user_onboarding_state")
          .upsert(patch, { onConflict: "user_id" });
      }
    } catch {
      // best-effort come il gemello in device-register: il push è la cosa
      // che deve riuscire, la milestone la recupera il prossimo.
    }
  }

  return NextResponse.json({
    ok: true,
    positions: { upserted: positionsUpserted },
    scores: { upserted: scoresUpserted, out_of_range: scoresOutOfRange },
    applications: { upserted: applicationsUpserted },
    receipts: {
      applications: applicationReceiptIds,
      scores: scoreReceiptIds,
      companies: rowReceipts.companies,
      positions: rowReceipts.positions,
      position_highlights: rowReceipts.position_highlights,
      pending_user_messages: rowReceipts.pending_user_messages,
      tombstones: rowReceipts.tombstones,
      position_transitions: rowReceipts.position_transitions,
      profile: rowReceipts.profile,
    },
    companies: { upserted: companiesUpserted },
    position_highlights: { upserted: highlightsUpserted },
    pending_user_messages: { upserted: pendingMessagesUpserted },
    sentinel_ticks: { upserted: sentinelTicksUpserted },
    tombstones: { applied: tombstonesApplied },
    position_transitions: { upserted: positionTransitionsUpserted },
    profile: { upserted: profileUpserted, error: profileError },
  });
}
