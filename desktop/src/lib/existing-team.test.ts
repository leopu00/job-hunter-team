import { Channel, invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { confirmOnboardingSshHostKey, probeOnboardingSshHostKey } from "./onboarding-runtime";
import {
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

  it("discovers, registers and reads the saved target through three separate commands", async () => {
    vi.mocked(invoke).mockResolvedValueOnce({ candidateSha256: "a".repeat(64) });
    vi.mocked(invoke).mockResolvedValueOnce({ outcome: "registered" });
    vi.mocked(invoke).mockResolvedValueOnce(null);

    await existingTeamBridge.discover({ teamId: "team-opaque-0001", host: HOST });
    await existingTeamBridge.register("a".repeat(64));
    expect(await existingTeamBridge.candidate()).toBeNull();

    expect(invoke).toHaveBeenNthCalledWith(1, "onboarding_existing_team_discover", {
      request: { teamId: "team-opaque-0001", host: HOST },
    });
    // the renderer sends the hash it was shown and the confirmation, never a host or a team
    expect(invoke).toHaveBeenNthCalledWith(2, "onboarding_existing_team_register", {
      request: { candidateSha256: "a".repeat(64), confirmed: true },
    });
    expect(invoke).toHaveBeenNthCalledWith(3, "existing_team_candidate_summary");
  });

  it("knows the new refusals and treats the ones a retry cannot fix as terminal", () => {
    for (const code of [
      "existing_team_runtime_candidate_exists", "existing_team_runtime_candidate_conflict",
      "existing_team_runtime_already_selected", "existing_team_container_not_found", "existing_team_not_found",
      "existing_team_ambiguous", "existing_team_image_unattested", "existing_team_too_many_containers",
      "existing_team_discovery_timeout", "existing_team_target_changed", "existing_team_receipt_required",
      "existing_team_register_not_confirmed",
    ]) {
      expect(existingTeamErrorCode({ code })).toBe(code);
    }
    for (const code of ["existing_team_ambiguous", "existing_team_image_unattested", "existing_team_too_many_containers"]) {
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
