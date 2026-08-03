/**
 * M2 mobile team safety: route stretta, UI touch-friendly e decisione daemon.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { validateEmergencyStopBody } from "@/lib/team-state/emergency-stop";
import { emergencyStopRequired } from "../../../cli/src/lib/team-state-reconciler.js";
import { mobileTeamStatus } from "@/app/(protected)/team/MobileTeamStatus";

const mocks = vi.hoisted(() => ({
  resolveUser: vi.fn(),
  checkRateLimit: vi.fn(),
  sanitizedError: vi.fn(),
}));

vi.mock("@/lib/team-state/auth", () => ({
  resolveUser: mocks.resolveUser,
}));
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: mocks.checkRateLimit,
}));
vi.mock("@/lib/error-response", () => ({
  sanitizedError: mocks.sanitizedError,
}));

const WEB = path.resolve(__dirname, "../../../web");
const readWeb = (relative: string) =>
  fs.readFileSync(path.join(WEB, relative), "utf8").replace(/\r\n/g, "\n");

function request(body: unknown) {
  return { json: vi.fn().mockResolvedValue(body) } as never;
}

function sessionDb(state = { should_run: false, is_running: true }) {
  const single = vi.fn().mockResolvedValue({ data: state, error: null });
  const select = vi.fn(() => ({ single }));
  const upsert = vi.fn(() => ({ select }));
  const from = vi.fn(() => ({ upsert }));
  return { supabase: { from }, from, upsert, select, single };
}

describe("contratto stop-only", () => {
  it("accetta solo la conferma esatta, senza action/target/args", () => {
    expect(validateEmergencyStopBody({ confirm: "STOP" })).toEqual({
      ok: true,
    });
    for (const bad of [
      null,
      {},
      { confirm: "stop" },
      { confirm: "STOP", action: "restart" },
      { action: "stop", target: "all" },
    ]) {
      expect(validateEmergencyStopBody(bad).ok).toBe(false);
    }
  });

  it("il daemon decide fail-closed su un rendezvous nuovo", () => {
    const requested = "2026-08-03T19:00:00.000Z";
    expect(
      emergencyStopRequired({
        should_run: false,
        emergency_stop_requested_at: requested,
        emergency_stop_completed_at: null,
      }),
    ).toBe(true);
    expect(
      emergencyStopRequired({
        should_run: false,
        emergency_stop_requested_at: requested,
        emergency_stop_completed_at: requested,
      }),
    ).toBe(false);
    expect(
      emergencyStopRequired({
        should_run: true,
        emergency_stop_requested_at: requested,
      }),
    ).toBe(false);
    expect(
      emergencyStopRequired({
        should_run: false,
        emergency_stop_requested_at: "invalid",
      }),
    ).toBe(false);
    expect(emergencyStopRequired(null)).toBe(false);
  });
});

describe("POST /api/team-state/emergency-stop", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkRateLimit.mockResolvedValue({
      allowed: true,
      remaining: 2,
      resetAtMs: Date.now() + 60_000,
      retryAfterSec: 0,
    });
  });

  it("richiede una sessione browser: il token device non basta", async () => {
    const db = sessionDb();
    mocks.resolveUser.mockResolvedValue({
      ok: true,
      user: { source: "token", userId: "u1", token: {}, supabase: db.supabase },
    });
    const { POST } = await import("@/app/api/team-state/emergency-stop/route");
    const response = await POST(request({ confirm: "STOP" }));
    expect(response.status).toBe(403);
    expect(db.from).not.toHaveBeenCalled();
  });

  it("rifiuta payload ampliati prima di toccare DB o rate bucket", async () => {
    const db = sessionDb();
    mocks.resolveUser.mockResolvedValue({
      ok: true,
      user: { source: "session", userId: "u1", supabase: db.supabase },
    });
    const { POST } = await import("@/app/api/team-state/emergency-stop/route");
    const response = await POST(request({ confirm: "STOP", target: "scout" }));
    expect(response.status).toBe(400);
    expect(mocks.checkRateLimit).not.toHaveBeenCalled();
    expect(db.from).not.toHaveBeenCalled();
  });

  it("ha un bucket dedicato e scrive solo desired=false + presenza", async () => {
    const db = sessionDb();
    mocks.resolveUser.mockResolvedValue({
      ok: true,
      user: { source: "session", userId: "u1", supabase: db.supabase },
    });
    const { POST } = await import("@/app/api/team-state/emergency-stop/route");
    const response = await POST(request({ confirm: "STOP" }));
    expect(response.status).toBe(200);
    expect(mocks.checkRateLimit).toHaveBeenCalledWith(
      "team-state",
      "emergency-stop",
      "u1",
      3,
      60_000,
    );
    expect(db.from).toHaveBeenCalledWith("team_state");
    const row = db.upsert.mock.calls[0][0];
    expect(row).toMatchObject({ user_id: "u1", should_run: false });
    expect(Object.keys(row).sort()).toEqual([
      "emergency_stop_requested_at",
      "last_user_activity_at",
      "should_run",
      "user_id",
    ]);
    expect(row).not.toHaveProperty("action");
    expect(row).not.toHaveProperty("target");
  });

  it("risponde 429 senza scrivere quando il bucket utente è esaurito", async () => {
    const db = sessionDb();
    mocks.resolveUser.mockResolvedValue({
      ok: true,
      user: { source: "session", userId: "u1", supabase: db.supabase },
    });
    mocks.checkRateLimit.mockResolvedValue({
      allowed: false,
      remaining: 0,
      resetAtMs: Date.now() + 12_000,
      retryAfterSec: 12,
    });
    const { POST } = await import("@/app/api/team-state/emergency-stop/route");
    const response = await POST(request({ confirm: "STOP" }));
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("12");
    expect(db.from).not.toHaveBeenCalled();
  });
});

describe("/team mobile read-only", () => {
  it("deriva uno stato onesto dal desired + observed", () => {
    expect(mobileTeamStatus(null)).toBe("unavailable");
    expect(
      mobileTeamStatus({ should_run: true, is_running: true } as never),
    ).toBe("running");
    expect(
      mobileTeamStatus({
        should_run: false,
        is_running: true,
        emergency_stop_requested_at: "2026-08-03T19:00:00.000Z",
        emergency_stop_completed_at: null,
      } as never),
    ).toBe("stopping");
    expect(
      mobileTeamStatus({
        should_run: false,
        is_running: false,
        emergency_stop_requested_at: "2026-08-03T19:00:00.000Z",
        emergency_stop_completed_at: "2026-08-03T19:00:00.000Z",
      } as never),
    ).toBe("stopped");
  });

  it("monta stato + stop e rende la bacheca non editabile", () => {
    const page = readWeb("app/(protected)/team/page.tsx");
    const ui = readWeb("app/(protected)/team/MobileTeamStatus.tsx");
    expect(page).toContain("<MobileTeamStatus />");
    expect(page).toContain("<DirectivesPanel readOnly />");
    expect(ui).toContain('fetch("/api/team-state/emergency-stop"');
    expect(ui).toContain("min-h-12");
    expect(ui).toContain('role="alertdialog"');
  });

  it("la lane container è hard-coded e riusa il giro esistente", () => {
    const reconciler = fs.readFileSync(
      path.resolve(__dirname, "../../../cli/src/lib/team-state-reconciler.js"),
      "utf8",
    );
    const daemon = fs.readFileSync(
      path.resolve(__dirname, "../../../cli/src/commands/cloud.js"),
      "utf8",
    );
    const start = fs.readFileSync(
      path.resolve(__dirname, "../../../cli/src/commands/team/start.js"),
      "utf8",
    );
    const migration = fs.readFileSync(
      path.resolve(
        __dirname,
        "../../../supabase/migrations/061_team_state_emergency_stop.sql",
      ),
      "utf8",
    );
    expect(reconciler).toContain("['team', 'stop']");
    expect(reconciler).toContain("emergencyStopRequired(state)");
    expect(daemon).toContain("reconcileEmergencyStop(config, rendezvousState)");
    expect(daemon).toContain("runEmergencyStop('realtime'");
    expect(start).toContain("if (!agentArg)");
    expect(start).toContain("unlinkSync(haltedFlag)");
    expect(migration).toContain("emergency_stop_requested_at");
    expect(migration).toContain("emergency_stop_completed_at");
  });
});
