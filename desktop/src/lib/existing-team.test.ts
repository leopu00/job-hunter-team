import { Channel, invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { confirmOnboardingSshHostKey, probeOnboardingSshHostKey } from "./onboarding-runtime";
import {
  ambiguousContainerChoices,
  directChatFailureCode,
  existingTeamBridge,
  existingTeamErrorCode,
  isTerminalExistingTeamError,
  type ExistingTeamVpsHost,
} from "./existing-team";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  Channel: class MockChannel<T> { onmessage?: (value: T) => void },
}));
vi.mock("./onboarding-runtime", () => ({
  probeOnboardingSshHostKey: vi.fn(),
  confirmOnboardingSshHostKey: vi.fn(),
}));

const HOST: ExistingTeamVpsHost = {
  kind: "vps",
  address: "host.example.invalid",
  user: "root",
  port: 22,
  keyPath: "/synthetic/private/id_ed25519",
};

describe("existing team native bridge", () => {
  beforeEach(() => vi.clearAllMocks());

  it("uses separate probe, explicit confirmation and attach-only commands", async () => {
    vi.mocked(probeOnboardingSshHostKey).mockResolvedValue({
      status: "confirmation_required",
      algorithm: "ssh-ed25519",
      fingerprint: "SHA256:synthetic",
    });
    vi.mocked(confirmOnboardingSshHostKey).mockResolvedValue(undefined);
    vi.mocked(invoke).mockResolvedValueOnce({ profileReady: false });

    const probe = await existingTeamBridge.probe(HOST);
    await existingTeamBridge.confirm(HOST, probe);
    await existingTeamBridge.connect({ teamId: "team-opaque-0001", host: HOST }, vi.fn());

    expect(probeOnboardingSshHostKey).toHaveBeenCalledWith(HOST);
    expect(confirmOnboardingSshHostKey).toHaveBeenCalledWith(HOST, {
      status: "confirmation_required",
      algorithm: "ssh-ed25519",
      fingerprint: "SHA256:synthetic",
    });
    expect(invoke).toHaveBeenCalledWith("onboarding_existing_team_connect", {
      request: { teamId: "team-opaque-0001", host: HOST },
      onProgress: expect.any(Channel),
    });
  });

  it("discovers and registers through two separate commands", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ candidateSha256: "a".repeat(64) });
    vi.mocked(invoke).mockResolvedValueOnce({ outcome: "registered" });

    await existingTeamBridge.discover({ teamId: "team-opaque-0001", host: HOST });
    await existingTeamBridge.register("a".repeat(64));

    expect(invoke).toHaveBeenNthCalledWith(1, "onboarding_existing_team_discover", {
      request: { teamId: "team-opaque-0001", host: HOST },
    });
    // the renderer sends the hash it was shown and the confirmation, never a host or a team
    expect(invoke).toHaveBeenNthCalledWith(2, "onboarding_existing_team_register", {
      request: { candidateSha256: "a".repeat(64), confirmed: true },
    });
    // nothing of the saved target is ever read back into the renderer
    expect(invoke).toHaveBeenCalledTimes(2);
    expect("candidate" in existingTeamBridge).toBe(false);
  });

  it("knows the new refusals and treats the ones a retry cannot fix as terminal", () => {
    for (const code of [
      "existing_team_runtime_candidate_exists", "existing_team_runtime_candidate_conflict",
      "existing_team_runtime_already_selected", "existing_team_container_not_found", "existing_team_not_found",
      "existing_team_ambiguous", "existing_team_image_unattested", "existing_team_too_many_containers",
      "existing_team_discovery_timeout", "existing_team_target_changed", "existing_team_receipt_required",
      "existing_team_register_not_confirmed", "existing_team_saved_selection_mismatch",
    ]) {
      expect(existingTeamErrorCode({ code })).toBe(code);
    }
    for (const code of [
      "existing_team_ambiguous", "existing_team_image_unattested", "existing_team_too_many_containers",
      "existing_team_saved_selection_mismatch",
    ]) {
      expect(isTerminalExistingTeamError(code)).toBe(true);
    }
    for (const code of ["existing_team_discovery_timeout", "existing_team_target_changed", "existing_team_not_found"]) {
      expect(isTerminalExistingTeamError(code)).toBe(false);
    }
  });

  it("allowlists errors without exposing native details", () => {
    expect(existingTeamErrorCode({ code: "host_key_mismatch", message: "/private/key" })).toBe("host_key_mismatch");
    expect(existingTeamErrorCode({ code: "existing_team_runtime_candidate_required" })).toBe("existing_team_runtime_candidate_required");
    expect(existingTeamErrorCode({ code: "raw_secret", message: "secret" })).toBe("unknown");
    expect(isTerminalExistingTeamError("host_key_mismatch")).toBe(true);
    expect(existingTeamErrorCode("existing_team_identity_mismatch")).toBe("existing_team_identity_mismatch");
    expect(isTerminalExistingTeamError("existing_team_identity_mismatch")).toBe(true);
    expect(isTerminalExistingTeamError("ssh_auth_failed")).toBe(false);
  });
});

describe("the direct chat after the team answered", () => {
  it("passes the tunnel's own code to the dialog, and a bare not-ready becomes the Assistant not verified", () => {
    for (const code of ["tunnel_start_failed", "tunnel_verify_failed", "tunnel_unavailable", "tunnel_path_unavailable"]) {
      expect(directChatFailureCode({ state: "error", code })).toBe(code);
      expect(existingTeamErrorCode({ code })).toBe(code);
    }
    expect(directChatFailureCode({ state: "error" })).toBe("existing_team_assistant_unverified");
    expect(directChatFailureCode({ state: "error", code: "something_else" })).toBe("existing_team_assistant_unverified");
    // ready, but the snapshot is still not reachable (a session down): not a tunnel
    expect(directChatFailureCode({ state: "ready", code: "tunnel_verify_failed" })).toBe("existing_team_assistant_unverified");
    expect(existingTeamErrorCode({ code: "existing_team_assistant_unverified" })).toBe("existing_team_assistant_unverified");
  });
});

describe("more than one container of the team (T123)", () => {
  const choice = (n: number, startedAt: string | null, name: string | null = `jht-${n}`) => ({
    containerId: `c0${n}`.padEnd(64, "a"),
    name,
    startedAt,
    ociRevision: "7071".repeat(10),
    digest: `sha256:${"9d".repeat(32)}`,
    readiness: n === 1,
  });

  it("reads the list of an ambiguous refusal, newest first, and the dates it cannot read last", () => {
    const list = ambiguousContainerChoices({
      code: "existing_team_ambiguous",
      choices: [
        choice(1, "2026-09-01T10:00:00+02:00"),
        choice(2, null, null),
        choice(3, "2026-10-20T08:00:00.123456789Z"),
        choice(4, "0001-01-01T00:00:00Z"),
      ],
    });
    expect(list?.map((c) => c.containerId.slice(0, 3))).toEqual(["c03", "c01", "c02", "c04"]);
    expect(list?.[2]).toEqual(choice(2, null, null));
  });

  it("refuses the whole list when one entry is not exactly a container the native side could have sent", () => {
    const ok = [choice(1, null), choice(2, null)];
    const bad: unknown[] = [
      undefined,
      "not a list",
      [ok[0]],
      [...ok, choice(3, null), choice(4, null), choice(5, null)],
      [ok[0], { ...ok[1], containerId: ok[0].containerId }],
      [ok[0], { ...ok[1], containerId: "C0".repeat(32) }],
      [ok[0], { ...ok[1], name: "<img src=x>" }],
      [ok[0], { ...ok[1], name: "jht old" }],
      [ok[0], { ...ok[1], startedAt: "yesterday" }],
      [ok[0], { ...ok[1], ociRevision: "short" }],
      [ok[0], { ...ok[1], digest: "sha256:zz" }],
      [ok[0], { ...ok[1], readiness: "yes" }],
    ];
    for (const choices of bad) {
      expect(ambiguousContainerChoices({ code: "existing_team_ambiguous", choices }), JSON.stringify(choices)).toBeNull();
    }
    // only the ambiguous refusal carries a list
    expect(ambiguousContainerChoices({ code: "existing_team_not_found", choices: ok })).toBeNull();
    expect(ambiguousContainerChoices("existing_team_ambiguous")).toBeNull();
    expect(ambiguousContainerChoices({ code: "existing_team_ambiguous", choices: ok })).toHaveLength(2);
  });

  it("knows the codes of a pick that is gone or malformed, which a new reading can fix", () => {
    for (const code of ["existing_team_choice_gone", "invalid_container_choice"]) {
      expect(existingTeamErrorCode({ code })).toBe(code);
      expect(isTerminalExistingTeamError(code)).toBe(false);
    }
  });
});
