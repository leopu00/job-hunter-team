import { NextRequest, NextResponse } from "next/server";
import { verifyBearerToken } from "@/lib/cloud-sync/auth";
import { checkCloudSyncRateLimit } from "@/lib/cloud-sync/rate-limit";
import { sanitizedError } from "@/lib/error-response";
import { fetchPostgrestRows } from "@/lib/postgrest-pages";

export const dynamic = "force-dynamic";

const LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;
const ACTIONS = ["position.apply_authorize", "position.apply_revoke"];
const STATES = ["queued", "done"];

type ActionRow = {
  id: string;
  action: string;
  status: string;
  created_at: string;
  summary: string;
  params: { legacy_id?: unknown; host?: unknown } | null;
  session_id: string | null;
};

// The broker is the consumer.  This route never consults positions or the
// box's desired-state flag: a row exists only after the website door accepted
// the person's session.  Every service-role query still carries the account
// predicate explicitly.
export async function GET(req: NextRequest) {
  const auth = await verifyBearerToken(req);
  if (!auth.ok) return auth.res;
  const { userId, tokenId, admin } = auth.data;

  const rate = await checkCloudSyncRateLimit(
    "apply-authorizations",
    tokenId,
    30,
  );
  if (!rate.allowed) {
    return NextResponse.json(
      { ok: false, error: "rate limited", retry_after_sec: rate.retryAfterSec },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSec) } },
    );
  }

  const supplied = new URL(req.url).searchParams.get("since");
  const since = supplied
    ? new Date(supplied)
    : new Date(Date.now() - LOOKBACK_MS);
  if (Number.isNaN(since.getTime())) {
    return NextResponse.json(
      { ok: false, error: "`since` must be ISO 8601 timestamp" },
      { status: 400 },
    );
  }

  // Every token of the account, the revoked and the expired ones too: the session a device was paired from
  // stays that device's after its token ends (migration 105 compares the door's caller with all of them).
  const { data: deviceRows, error: deviceError } = await fetchPostgrestRows<{
    pairing_session_id?: unknown;
    revoked_at?: unknown;
    expires_at?: unknown;
  }>(
    admin
      .from("cloud_sync_tokens")
      .select("pairing_session_id, revoked_at, expires_at")
      .eq("user_id", userId)
      .order("id"),
  );
  if (deviceError) {
    return sanitizedError(deviceError, {
      status: 500,
      scope: "cloud-sync/apply-authorizations-devices",
      publicMessage: "query_failed",
    });
  }
  // Tokens created before pairing_session_id existed cannot be tied to a
  // browser session. Do not hand a box any L3 receipt until it pairs again.
  // Only an ACTIVE token without a session asks for that: a legacy one that is
  // revoked or expired is over.
  const isActive = (row: { revoked_at?: unknown; expires_at?: unknown }) =>
    (row.revoked_at === null || row.revoked_at === undefined) &&
    (row.expires_at === null ||
      row.expires_at === undefined ||
      (typeof row.expires_at === "string" &&
        Date.parse(row.expires_at) > Date.now()));
  if (
    deviceRows.some((row) => row.pairing_session_id === null && isActive(row))
  ) {
    return NextResponse.json(
      { ok: false, error: "re_pair_required" },
      { status: 409 },
    );
  }
  const deviceSessions = new Set(
    deviceRows
      .map((row) => row.pairing_session_id)
      .filter((id): id is string => typeof id === "string"),
  );

  const { data, error } = await admin
    .from("web_action_log")
    .select("id, action, status, created_at, summary, params, session_id")
    .eq("user_id", userId)
    .in("action", ACTIONS)
    .in("status", STATES)
    // Inclusive is deliberate: the broker de-duplicates ids in its own
    // state, so a tied timestamp cannot cause a row to be skipped.
    .gte("created_at", since.toISOString())
    .order("created_at", { ascending: true })
    .limit(1000);
  if (error) {
    return sanitizedError(error, {
      status: 500,
      scope: "cloud-sync/apply-authorizations",
      publicMessage: "query_failed",
    });
  }

  const validRows = ((data ?? []) as ActionRow[]).flatMap((row) => {
    const legacyId = row.params?.legacy_id;
    const host = row.params?.host;
    if (
      typeof row.id !== "string" ||
      !ACTIONS.includes(row.action) ||
      !STATES.includes(row.status) ||
      !Number.isInteger(legacyId) ||
      (legacyId as number) < 1 ||
      typeof row.created_at !== "string" ||
      Number.isNaN(Date.parse(row.created_at)) ||
      typeof row.summary !== "string" ||
      (row.action === "position.apply_authorize" && typeof host !== "string") ||
      (typeof row.session_id === "string" && deviceSessions.has(row.session_id))
    ) {
      return [];
    }
    const closedLegacyId = legacyId as number;
    return [
      {
        id: row.id,
        legacy_id: closedLegacyId,
        created_at: row.created_at,
        summary: row.summary,
        ...(row.action === "position.apply_authorize" ? { host } : {}),
        action: row.action,
        status: row.status,
      },
    ];
  });
  // The database ordering is chronological.  Keeping only the last receipt
  // for a position means a withdrawal outranks an earlier authorization even
  // when the broker is being initialised and sees both in the same page.
  const latestByPosition = new Map<number, (typeof validRows)[number]>();
  for (const row of validRows) latestByPosition.set(row.legacy_id, row);
  const authorizations = [...latestByPosition.values()];
  const cursor = validRows.reduce<string | null>(
    (latest, row) =>
      latest === null || Date.parse(row.created_at) > Date.parse(latest)
        ? row.created_at
        : latest,
    null,
  );

  return NextResponse.json({
    ok: true,
    account_id: userId,
    authorizations,
    cursor: cursor ?? since.toISOString(),
    has_more: (data ?? []).length === 1000,
  });
}
