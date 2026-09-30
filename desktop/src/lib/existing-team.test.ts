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

  it("allowlists errors without exposing native details", () => {
    expect(existingTeamErrorCode({ code: "host_key_mismatch", message: "/private/key" })).toBe("host_key_mismatch");
    expect(existingTeamErrorCode({ code: "raw_secret", message: "secret" })).toBe("unknown");
    expect(isTerminalExistingTeamError("host_key_mismatch")).toBe(true);
    expect(existingTeamErrorCode("existing_team_identity_mismatch")).toBe("existing_team_identity_mismatch");
    expect(isTerminalExistingTeamError("existing_team_identity_mismatch")).toBe(true);
    expect(isTerminalExistingTeamError("ssh_auth_failed")).toBe(false);
  });
});
