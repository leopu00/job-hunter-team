/**
 * JHT web capace, phase 3: the team is started, stopped and restarted from the website through the
 * single door. The routes are the door and nothing else; the page asks, confirms and follows the
 * command on the bus. What decides (recent session, limits, targets, the record) is the database's and
 * is tested on PostgreSQL (tests/test_web_action_door_postgres.py).
 */
import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ACTIONS,
  AGENT_NAMES,
  TARGETS,
  commandUrl,
  confirmCall,
  errorKey,
  fill,
  firstCall,
  isTarget,
  isTerminal,
  readCommandStatus,
  readDoorAnswer,
  teamControlEnabled,
} from "@/app/(protected)/team/team-control";
import { T } from "@/app/(protected)/team/TeamControl.i18n";

const door = vi.hoisted(() => ({ requestAction: vi.fn() }));
vi.mock("@/lib/request-action", () => ({ requestAction: door.requestAction }));

const WEB = path.resolve(__dirname, "../../../web");
const read = (relative: string) => fs.readFileSync(path.join(WEB, relative), "utf8");

describe("the routes of the team are the single door", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    door.requestAction.mockResolvedValue(Response.json({ ok: true, state: "queued" }));
  });

  it.each(ACTIONS)("POST /api/team/command/%s calls the door once, with team.<action> at level 2", async (action) => {
    const { POST } = await import(`@/app/api/team/command/${action}/route`);
    const req = { method: "POST" } as never;
    const res = await POST(req);
    expect(door.requestAction).toHaveBeenCalledTimes(1);
    expect(door.requestAction).toHaveBeenCalledWith(req, { action: `team.${action}`, level: "L2" });
    expect(res.status).toBe(200);
  });

  it.each(ACTIONS)("the %s route reads no body, no table and runs nothing: the action is fixed by the route", (action) => {
    const source = read(`app/api/team/command/${action}/route.ts`);
    expect(source).toContain(`action: "team.${action}"`);
    expect(source).not.toMatch(/\.from\(|\.rpc\(|\.json\(\)|\.text\(\)|enqueueIfRemote|runBash|insert/);
  });

  it("the old dispatch with the action in the body is gone: an action of the body would be the client's choice", () => {
    expect(fs.existsSync(path.join(WEB, "app/api/team/command/route.ts"))).toBe(false);
    expect(fs.existsSync(path.join(WEB, "app/api/team/command/[id]/route.ts"))).toBe(true); // the state of a command, read-only
  });
});

describe("what the page sends and reads", () => {
  it("the first call carries only the target; the second only the id of the line", () => {
    expect(firstCall("restart", "scout")).toEqual({ url: "/api/team/command/restart", body: { params: { target: "scout" } } });
    expect(firstCall("start", "all").body).toEqual({ params: { target: "all" } });
    const id = "6c1f2f08-4c8e-4f1e-9a52-3c3f0b7f2a11";
    expect(confirmCall("stop", id)).toEqual({ url: "/api/team/command/stop", body: { confirmId: id } });
    expect(commandUrl(id)).toBe(`/api/team/command/${id}`);
  });

  it("the targets are the door's closed list, the whole team first, and nothing else passes", () => {
    expect(TARGETS[0]).toBe("all");
    for (const target of TARGETS.slice(1)) expect(AGENT_NAMES[target as Exclude<typeof target, "all">]).toBeTruthy();
    for (const bad of ["ALL", "bridge;rm", "", "mentor ", "__proto__"]) expect(isTarget(bad)).toBe(false);
  });

  it("reads the door's answers, and anything outside the contract is a generic refusal", () => {
    expect(readDoorAnswer(200, { ok: true, state: "awaiting_confirm", id: "x", summary: "restart all", expiresAt: "2026-10-22T20:00:00Z" })).toEqual({
      kind: "confirm",
      id: "x",
      summary: "restart all",
      expiresAt: "2026-10-22T20:00:00Z",
    });
    expect(readDoorAnswer(200, { ok: true, state: "queued", commandId: "c" })).toEqual({ kind: "queued", commandId: "c" });
    expect(readDoorAnswer(200, { ok: true, state: "queued" })).toEqual({ kind: "queued", commandId: null });
    expect(readDoorAnswer(200, { ok: true, state: "done" })).toEqual({ kind: "queued", commandId: null });
    expect(readDoorAnswer(401, { ok: false, error: "reauth_required" })).toEqual({ kind: "refused", code: "reauth_required" });
    expect(readDoorAnswer(200, { ok: true, state: "something" })).toEqual({ kind: "refused", code: "" });
    expect(readDoorAnswer(502, null)).toEqual({ kind: "refused", code: "" });
  });

  it("follows the bus: only the four states of the table, the last two end it", () => {
    expect(readCommandStatus(200, { ok: true, status: "running" })).toBe("running");
    expect(readCommandStatus(200, { ok: true, status: "weird" })).toBeNull();
    expect(readCommandStatus(404, { ok: false })).toBeNull();
    expect(isTerminal("done") && isTerminal("error")).toBe(true);
    expect(isTerminal("pending") || isTerminal("running")).toBe(false);
  });

  it("a refusal has its own words only for the codes the user can act on", () => {
    expect(errorKey("reauth_required")).toBe("err_reauth_required");
    expect(errorKey("rate_limited")).toBe("err_rate_limited");
    expect(errorKey("confirm_expired")).toBe("err_confirm_expired");
    expect(errorKey("level_mismatch")).toBe("err_generic");
    expect(errorKey("")).toBe("err_generic");
  });
});

describe("the words", () => {
  it("every message key the page uses exists in the seven languages, and every confirmation names its target", () => {
    const keys = ["title", "intro", "target", "target_all", "expires", "confirm", "cancel", "status_lost"]
      .concat(ACTIONS.map(String), ACTIONS.map((a) => `confirm_${a}`))
      .concat(["pending", "running", "done", "error"].map((s) => `status_${s}`))
      .concat(["reauth_required", "rate_limited", "confirm_expired", "unauthenticated"].map(errorKey), ["err_generic"]);
    for (const key of keys) {
      const entry = (T as Record<string, Record<string, string>>)[key];
      expect(entry, key).toBeTruthy();
      for (const locale of ["it", "en", "es", "fr", "de", "hu", "pt"]) expect(entry[locale], `${key}.${locale}`).toBeTruthy();
    }
    for (const action of ACTIONS) {
      for (const text of Object.values((T as Record<string, Record<string, string>>)[`confirm_${action}`])) {
        expect(text).toContain("{target}");
      }
    }
    expect(fill("Riavviare {target}?", "Scout")).toBe("Riavviare Scout?");
  });
});

describe("the page", () => {
  it("mounts the control under the status and keeps the desktop out (it has its own panel)", () => {
    const page = read("app/(protected)/team/page.tsx");
    expect(page.indexOf("<MobileTeamStatus />")).toBeLessThan(page.indexOf("<TeamControl />"));
    const ui = read("app/(protected)/team/TeamControl.tsx");
    expect(ui).toContain("useContext(TeamStatusControls)");
    expect(ui).toMatch(/if \(desktopControls \|\| !teamControlEnabled\(\)\) return null;/);
    // it never decides what the database decides
    expect(ui).not.toMatch(/\.rpc\(|from\("team_commands"\)|from\("team_state"\)/);
  });
});

describe("the flag: start, stop and restart stay hidden until the box runs team_commands", () => {
  it("is off unless the build says exactly 1", () => {
    expect(teamControlEnabled(undefined)).toBe(false);
    for (const value of ["", "0", "true", "yes", " 1", "1 "]) expect(teamControlEnabled(value)).toBe(false);
    expect(teamControlEnabled("1")).toBe(true);
  });

  it("reads NEXT_PUBLIC_JHT_TEAM_CONTROL by default (inlined at build time)", () => {
    const pure = read("app/(protected)/team/team-control.ts");
    expect(pure).toContain("value: string | undefined = process.env.NEXT_PUBLIC_JHT_TEAM_CONTROL");
  });

  it("the emergency stop does not depend on it", () => {
    const status = read("app/(protected)/team/MobileTeamStatus.tsx");
    expect(status).not.toContain("teamControlEnabled");
    expect(status).toContain('fetch("/api/team-state/emergency-stop"');
  });
});
