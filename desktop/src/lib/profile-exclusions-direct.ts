import { exclusionProposals, isActingReason, isProposableReason } from "@/lib/feedback-reasons";
import { json, type ApiFetch } from "../shell/api-bridge";
import { acceptExclusion, readExclusions, withdrawExclusion, type ExclusionCode, type PanelExclusions } from "./agent-control";

/**
 * The exclusions of the profile decided straight on the team's jobs.db (JHT-T24-b), for the teams the
 * cloud does not carry: no cloud session, or a team that lives on a VPS. The web's pages call the same
 * routes as ever (`/api/profile-exclusions`, the judgements the proposals are made of); here they are
 * answered from the team itself, through the panel's native command, which asks for the full link or the
 * mark of the person's own VPS before it writes anything.
 *
 * With a cloud session and a team on this computer the cloud still carries it (lib/web-api.ts). On the
 * person's own VPS with a session the decision is also mirrored in the cloud, so the website and the
 * team's next pull say what the team already does.
 */
const MEMORY_KEY = "jht.profile-exclusion-dismissed.v1";

type Session = { auth: { getSession: () => Promise<{ data: { session: unknown } }> } };
type Memory = Pick<Storage, "getItem" | "setItem">;

/** «Not now» is the app's memory, not the team's: the team's table only knows what acts and what stopped. */
function readMemory(store: Memory, target: string): Record<string, number> {
  try {
    const all = JSON.parse(store.getItem(MEMORY_KEY) ?? "{}") as Record<string, Record<string, number>>;
    const mine = all[target];
    return mine && typeof mine === "object" ? mine : {};
  } catch {
    return {};
  }
}

function writeMemory(store: Memory, target: string, reason: string, positions: number) {
  try {
    const all = JSON.parse(store.getItem(MEMORY_KEY) ?? "{}") as Record<string, Record<string, number>>;
    store.setItem(MEMORY_KEY, JSON.stringify({ ...all, [target]: { ...(all[target] ?? {}), [reason]: positions } }));
  } catch {
    // Without a memory the proposal comes back: nothing is lost.
  }
}

function events(read: PanelExclusions) {
  return read.feedback.map((row) => ({ id: row.id, legacy_id: row.legacyId, action: row.action, reason: row.reason, created_at: row.createdAt }));
}

/** The decisions as the web's cards read them: active is accepted, withdrawn or put off is dismissed at a count. */
function decisions(read: PanelExclusions, memory: Record<string, number>) {
  const counts = Object.fromEntries(exclusionProposals(events(read), 1).map((proposal) => [proposal.reason, proposal.positions]));
  const rows = new Map<string, { reason: string; status: "accepted" | "dismissed"; positions_at_decision: number; decided_at: string | null }>();
  for (const [reason, positions] of Object.entries(memory)) {
    rows.set(reason, { reason, status: "dismissed", positions_at_decision: positions, decided_at: null });
  }
  for (const row of read.exclusions) {
    rows.set(
      row.code,
      row.status === "active"
        ? { reason: row.code, status: "accepted", positions_at_decision: counts[row.code] ?? 0, decided_at: row.decidedAt }
        : { reason: row.code, status: "dismissed", positions_at_decision: memory[row.code] ?? counts[row.code] ?? 0, decided_at: row.decidedAt },
    );
  }
  return [...rows.values()];
}

/** The two cards ask within the same instant: one read of the team serves both. */
const READ_TTL_MS = 3000;

export function directExclusionsApi(
  next: ApiFetch,
  client: Session,
  store: Memory = localStorage,
  now: () => number = Date.now,
): ApiFetch {
  let last: { at: number; read: ReturnType<typeof readExclusions> } | null = null;
  const teamRead = () => {
    if (!last || now() - last.at >= READ_TTL_MS) last = { at: now(), read: readExclusions() };
    return last.read;
  };

  const route = (input: RequestInfo | URL, init?: RequestInit): { method: string; path: string } | null => {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(raw, "http://desktop.invalid");
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    if (url.pathname === "/api/profile-exclusions" && (method === "GET" || method === "POST")) return { method, path: url.pathname };
    if (url.pathname === "/api/positions/feedback" && method === "GET") return { method, path: url.pathname };
    return null;
  };

  return async (input, init) => {
    const call = route(input, init);
    if (!call) return next(input, init);
    // Where the team is: no answer (no team, an old image) leaves the cloud to answer, as before.
    const read = await teamRead();
    if (!read.ok) return next(input, init);
    const hasSession = Boolean((await client.auth.getSession()).data.session);
    if (hasSession && read.value.where === "local") return next(input, init);

    const team = read.value;
    const memory = readMemory(store, team.target);
    if (call.path === "/api/positions/feedback") {
      return json({
        feedback: team.feedback.map((row) => ({
          id: row.id,
          position_legacy_id: row.legacyId,
          action: row.action,
          reason: row.reason,
          created_at: row.createdAt,
        })),
      });
    }
    if (call.method === "GET") return json({ exclusions: decisions(team, memory) });

    let body: Record<string, unknown> | null = null;
    try {
      const raw = typeof init?.body === "string" ? init.body : input instanceof Request ? await input.clone().text() : "";
      const parsed: unknown = raw ? JSON.parse(raw) : null;
      body = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
    } catch {
      body = null;
    }
    if (!body) return json({ error: "invalid_json" }, 400);
    const reason = typeof body.reason === "string" ? body.reason : "";
    if (!isProposableReason(reason)) return json({ error: "reason_invalid" }, 400);
    if (body.status !== "accepted" && body.status !== "dismissed") return json({ error: "status_invalid" }, 400);
    const positions =
      typeof body.positions === "number" && Number.isInteger(body.positions) && body.positions >= 0 && body.positions <= 100_000
        ? body.positions
        : 0;

    // A reason that does not act has no rule on the team: the app remembers the decision only (today every
    // proposable reason acts, and the vocabulary decides, not a list here).
    last = null;
    const acting = isActingReason(reason);
    if (acting) {
      const code = reason as ExclusionCode;
      const active = team.exclusions.some((row) => row.code === code && row.status === "active");
      if (body.status === "accepted" || active) {
        const done = body.status === "accepted" ? await acceptExclusion(code, team.target) : await withdrawExclusion(code, team.target);
        if (!done.ok) return json({ error: done.code }, 409);
      }
    }
    if (!(acting && body.status === "accepted")) writeMemory(store, team.target, reason, positions);
    // The person's own VPS with a cloud session: the cloud says what the team does.
    if (hasSession && team.ownVps !== null) {
      try {
        await next(input, init);
      } catch {
        // The team already did it; the cloud catches up at the next decision.
      }
    }
    return json({
      exclusion: {
        reason,
        status: body.status,
        positions_at_decision: positions,
        decided_at: new Date().toISOString(),
      },
    });
  };
}
