import { describe, expect, it, vi } from "vitest";
import {
  pickTeamStatusFields,
  readTeamStatus,
  TEAM_STATUS_FIELDS,
  teamStatusErrorCode,
} from "./existing-team-status";

const ALL_NO = Object.fromEntries(TEAM_STATUS_FIELDS.map((field) => [field, false]));

describe("pickTeamStatusFields", () => {
  it("takes the eight probed fields, as booleans, and nothing else the reply carries", () => {
    const picked = pickTeamStatusFields({
      ...ALL_NO,
      assistantRunning: true,
      directChatReady: true,
      limitsVerified: false,
      providerName: "synthetic-provider",
      credentialsPath: "/synthetic/path",
    });
    expect(picked).toEqual({ ...ALL_NO, assistantRunning: true });
    expect(Object.keys(picked!).sort()).toEqual([...TEAM_STATUS_FIELDS].sort());
  });

  it("refuses a reply with a missing or non-boolean field instead of reading it as «no»", () => {
    const { captainRunning: _captain, ...missing } = ALL_NO;
    expect(pickTeamStatusFields(missing)).toBeNull();
    expect(pickTeamStatusFields({ ...ALL_NO, profileReady: "yes" })).toBeNull();
    expect(pickTeamStatusFields({ ...ALL_NO, profileReady: null })).toBeNull();
    for (const bad of [null, undefined, "x", 3, [], [ALL_NO]]) expect(pickTeamStatusFields(bad)).toBeNull();
  });
});

describe("teamStatusErrorCode", () => {
  it("keeps the real code of a failed native call", () => {
    expect(teamStatusErrorCode({ code: "snapshot_failed" })).toBe("snapshot_failed");
    expect(teamStatusErrorCode("host_key_mismatch")).toBe("host_key_mismatch");
  });

  it("names a failure that carries no code, never a made-up one", () => {
    for (const bad of [new Error("boom"), null, undefined, { code: 7 }, { code: "Not A Code!" }, 42]) {
      expect(teamStatusErrorCode(bad)).toBe("desktop_transport_unavailable");
    }
  });
});

describe("readTeamStatus", () => {
  it("reads through the command it is given, with the moment of the read", async () => {
    const read = vi.fn().mockResolvedValue({ ...ALL_NO, containerRunning: true });
    const reading = await readTeamStatus(read, () => 1_000);
    expect(read).toHaveBeenCalledTimes(1);
    expect(reading).toEqual({ kind: "read", at: 1_000, fields: { ...ALL_NO, containerRunning: true } });
  });

  it("answers the code of a failed read, with the moment it failed", async () => {
    const reading = await readTeamStatus(vi.fn().mockRejectedValue({ code: "snapshot_failed" }), () => 2_000);
    expect(reading).toEqual({ kind: "error", at: 2_000, code: "snapshot_failed" });
  });

  it("answers a bad reply as such", async () => {
    const reading = await readTeamStatus(vi.fn().mockResolvedValue({ runtimeInstalled: true }), () => 3_000);
    expect(reading).toEqual({ kind: "error", at: 3_000, code: "desktop_bad_reply" });
  });

  it("reads again every time: nothing is kept between two reads", async () => {
    const read = vi.fn().mockResolvedValueOnce(ALL_NO).mockResolvedValueOnce({ ...ALL_NO, assistantRunning: true });
    const first = await readTeamStatus(read, () => 1);
    const second = await readTeamStatus(read, () => 2);
    expect(read).toHaveBeenCalledTimes(2);
    expect(first).toMatchObject({ kind: "read", fields: { assistantRunning: false } });
    expect(second).toMatchObject({ kind: "read", fields: { assistantRunning: true } });
  });
});
