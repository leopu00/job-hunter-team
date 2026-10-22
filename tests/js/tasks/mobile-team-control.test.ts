/**
 * M2 mobile team safety: la porta unica, UI touch-friendly e decisione daemon.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { emergencyStopRequired } from "../../../cli/src/lib/team-state-reconciler.js";
import { mobileTeamStatus } from "@/app/(protected)/team/MobileTeamStatus";

const door = vi.hoisted(() => ({ requestAction: vi.fn() }));
vi.mock("@/lib/request-action", () => ({ requestAction: door.requestAction }));

const WEB = path.resolve(__dirname, "../../../web");
const readWeb = (relative: string) =>
  fs.readFileSync(path.join(WEB, relative), "utf8").replace(/\r\n/g, "\n");

describe("contratto stop-only: il daemon", () => {
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
    door.requestAction.mockResolvedValue(Response.json({ ok: true, state: "queued" }));
  });

  it("è la porta unica: team.emergency_stop, livello 2, la richiesta passata intera, e il ripiego solo per la porta assente", async () => {
    const { POST } = await import("@/app/api/team-state/emergency-stop/route");
    const req = { method: "POST" } as never;
    const response = await POST(req);
    expect(door.requestAction).toHaveBeenCalledTimes(1);
    const [passed, spec] = door.requestAction.mock.calls[0];
    expect(passed).toBe(req);
    expect(spec).toMatchObject({ action: "team.emergency_stop", level: "L2" });
    expect(typeof spec.whenDoorMissing).toBe("function");
    expect(await response.json()).toEqual({ ok: true, state: "queued" });
  });

  it("il gestore POST non tocca il database né il corpo: lo fa solo il ripiego, fuori dal gestore", () => {
    const source = readWeb("app/api/team-state/emergency-stop/route.ts");
    const handler = source.slice(source.indexOf("export async function POST"), source.indexOf("async function stopWithoutTheDoor"));
    expect(handler).toContain('action: "team.emergency_stop"');
    expect(handler).not.toMatch(/\.from\(|resolveUser|checkRateLimit|\.json\(\)|\.text\(\)|upsert/);
  });

  it("il ripiego (porta assente) scrive SOLO lo stop di prima, sulla riga dell'utente, col suo tetto", async () => {
    const { POST } = await import("@/app/api/team-state/emergency-stop/route");
    await POST({ method: "POST" } as never);
    const fallback = door.requestAction.mock.calls[0][1].whenDoorMissing;
    const upsert = vi.fn(async () => ({ error: null }));
    const from = vi.fn(() => ({ upsert }));
    const ok = await fallback({ supabase: { from }, userId: "u1" });
    expect(ok.status).toBe(200);
    expect(from).toHaveBeenCalledWith("team_state");
    const [row, options] = upsert.mock.calls[0] as unknown as [Record<string, unknown>, unknown];
    expect(Object.keys(row).sort()).toEqual(["emergency_stop_requested_at", "last_user_activity_at", "should_run", "user_id"]);
    expect(row).toMatchObject({ user_id: "u1", should_run: false });
    expect(options).toEqual({ onConflict: "user_id" });
    const failing = await fallback({ supabase: { from: () => ({ upsert: async () => ({ error: { message: "boom" } }) }) }, userId: "u1" });
    expect(failing.status).toBe(502);
    expect(await failing.text()).not.toContain("boom");
  });

  it("ripassa i rifiuti della porta così come sono (un limite resta un 429)", async () => {
    door.requestAction.mockResolvedValue(
      Response.json({ ok: false, error: "rate_limited" }, { status: 429, headers: { "Retry-After": "12" } }),
    );
    const { POST } = await import("@/app/api/team-state/emergency-stop/route");
    const response = await POST({ method: "POST" } as never);
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("12");
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

  it("monta stato + stop e lascia la bacheca editabile", () => {
    const page = readWeb("app/(protected)/team/page.tsx");
    const ui = readWeb("app/(protected)/team/MobileTeamStatus.tsx");
    expect(page).toContain("<MobileTeamStatus />");
    expect(page).toContain("<DirectivesPanel />");
    expect(ui).toContain('fetch("/api/team-state/emergency-stop"');
    expect(ui).toContain("body: JSON.stringify({})");
    expect(ui).not.toContain('confirm: "STOP"');
    expect(page).toContain("<TeamControl />");
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
