import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { ApiFetch } from "../shell/api-bridge";
import { directExclusionsApi } from "./profile-exclusions-direct";
import * as control from "./agent-control";

// JHT-T24-b: the exclusions of the profile decided straight on the team's jobs.db, for the teams the cloud
// does not carry. Synthetic data only; the native command is a fake.
vi.mock("./agent-control", () => ({
  readExclusions: vi.fn(),
  acceptExclusion: vi.fn(),
  withdrawExclusion: vi.fn(),
}));

const read = vi.mocked(control.readExclusions);
const accept = vi.mocked(control.acceptExclusion);
const withdraw = vi.mocked(control.withdrawExclusion);

const reject = (id: number, reason: string, at = id) => ({
  id: at,
  legacyId: id,
  action: "dislike",
  reason,
  createdAt: `2026-10-0${at}T10:00:00Z`,
});

function team(over: Partial<control.PanelExclusions> = {}) {
  return {
    ok: true as const,
    at: 1,
    value: {
      target: "team-1",
      where: "local" as const,
      label: null,
      ownVps: null,
      exclusions: [],
      feedback: [reject(1, "company"), reject(2, "company"), reject(3, "company")],
      ...over,
    },
  };
}

const post = (body: unknown) => ({ method: "POST", body: JSON.stringify(body) });
const memory = () => {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
};
const session = (present: boolean) => ({ auth: { getSession: async () => ({ data: { session: present ? { user: {} } : null } }) } });

let cloud: Mock<ApiFetch>;
let clock: number;
beforeEach(() => {
  vi.resetAllMocks();
  cloud = vi.fn<ApiFetch>(async () => new Response(JSON.stringify({ from: "cloud" }), { status: 200 }));
  clock = 0;
  accept.mockResolvedValue({ ok: true, at: 1, value: "excluded" });
  withdraw.mockResolvedValue({ ok: true, at: 1, value: "exclusion_withdrawn" });
});
const api = (hasSession: boolean, store = memory()) => directExclusionsApi(cloud, session(hasSession), store, () => (clock += 10_000));

describe("who answers", () => {
  it("leaves the cloud to answer when the team does not (no team, an old image)", async () => {
    read.mockResolvedValue({ ok: false, at: 1, code: "agent_control_no_team" });
    const res = await api(false)("/api/profile-exclusions");
    expect(await res.json()).toEqual({ from: "cloud" });
  });

  it("leaves the cloud to answer for a team on this computer with a session", async () => {
    read.mockResolvedValue(team());
    for (const path of ["/api/profile-exclusions", "/api/positions/feedback?days=0&limit=2000"]) {
      expect(await (await api(true)(path)).json()).toEqual({ from: "cloud" });
    }
    await api(true)("/api/profile-exclusions", post({ reason: "company", status: "accepted", positions: 3 }));
    expect(accept).not.toHaveBeenCalled();
  });

  it("answers from the team without a session, and from a VPS even with one", async () => {
    read.mockResolvedValue(team());
    expect(await (await api(false)("/api/profile-exclusions")).json()).toEqual({ exclusions: [] });
    read.mockResolvedValue(team({ where: "vps", label: "vps.example" }));
    expect(await (await api(true)("/api/profile-exclusions")).json()).toEqual({ exclusions: [] });
    expect(cloud).not.toHaveBeenCalled();
  });

  it("never touches the other routes", async () => {
    read.mockResolvedValue(team());
    await api(false)("/api/positions/facets");
    await api(false)("/api/profile-exclusions", { method: "DELETE" });
    expect(read).not.toHaveBeenCalled();
    expect(cloud).toHaveBeenCalledTimes(2);
  });
});

describe("what the web's cards read", () => {
  it("gives the judgements the proposals are made of, without the users words", async () => {
    read.mockResolvedValue(team());
    const body = await (await api(false)("/api/positions/feedback?days=0&limit=2000")).json();
    expect(body.feedback).toHaveLength(3);
    expect(body.feedback[0]).toEqual({ id: 1, position_legacy_id: 1, action: "dislike", reason: "company", created_at: "2026-10-01T10:00:00Z" });
  });

  it("says accepted for an exclusion in force and dismissed for one withdrawn, at the count it had", async () => {
    read.mockResolvedValue(
      team({
        exclusions: [
          { code: "company", status: "active", decidedAt: "2026-10-04 10:00:00.000" },
          { code: "wrong_stack", status: "withdrawn", decidedAt: "2026-10-04 11:00:00.000" },
        ],
      }),
    );
    const { exclusions } = await (await api(false)("/api/profile-exclusions")).json();
    expect(exclusions).toEqual([
      { reason: "company", status: "accepted", positions_at_decision: 3, decided_at: "2026-10-04 10:00:00.000" },
      { reason: "wrong_stack", status: "dismissed", positions_at_decision: 0, decided_at: "2026-10-04 11:00:00.000" },
    ]);
  });

  it("one read of the team serves the two cards of the same moment", async () => {
    read.mockResolvedValue(team());
    const direct = directExclusionsApi(cloud, session(false), memory(), () => 1000);
    await Promise.all([direct("/api/profile-exclusions"), direct("/api/positions/feedback?days=0&limit=2000")]);
    await direct("/api/profile-exclusions");
    expect(read).toHaveBeenCalledTimes(1);
  });
});

describe("a decision", () => {
  it("accepting writes on the team with the target the page read, and remembers nothing", async () => {
    read.mockResolvedValue(team());
    const store = memory();
    const res = await api(false, store)("/api/profile-exclusions", post({ reason: "company", status: "accepted", positions: 3 }));
    expect(accept).toHaveBeenCalledWith("company", "team-1");
    expect((await res.json()).exclusion).toMatchObject({ reason: "company", status: "accepted", positions_at_decision: 3 });
    expect(store.getItem("jht.profile-exclusion-dismissed.v1")).toBeNull();
  });

  it("withdrawing one in force goes to the team and the count is kept, so the proposal waits for three more", async () => {
    read.mockResolvedValue(team({ exclusions: [{ code: "company", status: "active", decidedAt: null }] }));
    const store = memory();
    const direct = api(false, store);
    const res = await direct("/api/profile-exclusions", post({ reason: "company", status: "dismissed", positions: 3 }));
    expect(withdraw).toHaveBeenCalledWith("company", "team-1");
    expect(res.status).toBe(200);
    read.mockResolvedValue(team({ exclusions: [{ code: "company", status: "withdrawn", decidedAt: null }], feedback: [] }));
    const { exclusions } = await (await direct("/api/profile-exclusions")).json();
    expect(exclusions[0]).toMatchObject({ reason: "company", status: "dismissed", positions_at_decision: 3 });
  });

  it("putting a proposal off writes nothing on the team and is remembered by the app", async () => {
    read.mockResolvedValue(team());
    const store = memory();
    await api(false, store)("/api/profile-exclusions", post({ reason: "company", status: "dismissed", positions: 3 }));
    await api(false, store)("/api/profile-exclusions", post({ reason: "too_senior", status: "dismissed", positions: 4 }));
    expect(accept).not.toHaveBeenCalled();
    expect(withdraw).not.toHaveBeenCalled();
    expect(JSON.parse(store.getItem("jht.profile-exclusion-dismissed.v1")!)).toEqual({ "team-1": { company: 3, too_senior: 4 } });
  });

  it("the seniority acts now: accepting it goes to the team like the others, and remembers nothing", async () => {
    read.mockResolvedValue(team());
    const store = memory();
    const res = await api(false, store)("/api/profile-exclusions", post({ reason: "too_senior", status: "accepted", positions: 4 }));
    expect(res.status).toBe(200);
    expect(accept).toHaveBeenCalledWith("too_senior", "team-1");
    expect(store.getItem("jht.profile-exclusion-dismissed.v1")).toBeNull();
  });

  it("a refusal of the team (no link, no mark, no evidence) is said and nothing is remembered or mirrored", async () => {
    read.mockResolvedValue(team({ where: "vps", ownVps: "claimable" }));
    accept.mockResolvedValue({ ok: false, at: 1, code: "own_vps_claim_required" });
    const store = memory();
    const res = await api(true, store)("/api/profile-exclusions", post({ reason: "company", status: "accepted", positions: 3 }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "own_vps_claim_required" });
    expect(store.getItem("jht.profile-exclusion-dismissed.v1")).toBeNull();
    expect(cloud).not.toHaveBeenCalled();
  });

  it("on the persons own VPS with a session the cloud is told too; on an existing team it is not", async () => {
    read.mockResolvedValue(team({ where: "vps", ownVps: "marked" }));
    await api(true)("/api/profile-exclusions", post({ reason: "company", status: "accepted", positions: 3 }));
    expect(accept).toHaveBeenCalledTimes(1);
    expect(cloud).toHaveBeenCalledTimes(1);
    cloud.mockClear();
    read.mockResolvedValue(team({ where: "vps", ownVps: null }));
    await api(true)("/api/profile-exclusions", post({ reason: "company", status: "accepted", positions: 3 }));
    expect(cloud).not.toHaveBeenCalled();
  });

  it("refuses what the route refuses: a bad reason, a bad status, no JSON; the team is never asked", async () => {
    read.mockResolvedValue(team());
    const direct = api(false);
    expect((await direct("/api/profile-exclusions", post({ reason: "rm -rf", status: "accepted" }))).status).toBe(400);
    expect((await direct("/api/profile-exclusions", post({ reason: "company", status: "maybe" }))).status).toBe(400);
    expect((await direct("/api/profile-exclusions", { method: "POST", body: "not json" })).status).toBe(400);
    expect(accept).not.toHaveBeenCalled();
  });
});
