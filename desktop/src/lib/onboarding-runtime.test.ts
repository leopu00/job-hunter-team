import { invoke, isTauri } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  confirmOnboardingSshHostKey,
  probeOnboardingSshHostKey,
  type SshHostKeyProbe,
} from "./onboarding-runtime";

vi.mock("@tauri-apps/api/core", () => ({
  Channel: class { onmessage?: (message: unknown) => void },
  invoke: vi.fn(),
  isTauri: vi.fn(),
}));

const host = {
  kind: "vps" as const,
  address: "example.invalid",
  user: "operator",
  port: 22,
  keyPath: "/synthetic/id_ed25519",
};

const firstSeen: SshHostKeyProbe = {
  status: "confirmation_required",
  algorithm: "ssh-ed25519",
  fingerprint: "SHA256:syntheticFingerprint",
};

describe("SSH host-key consent contract", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    vi.mocked(isTauri).mockReset().mockReturnValue(true);
  });

  it("probes without sending a pairing token or confirmation", async () => {
    vi.mocked(invoke).mockResolvedValue(firstSeen);

    await expect(probeOnboardingSshHostKey(host)).resolves.toEqual(firstSeen);

    expect(invoke).toHaveBeenCalledOnce();
    expect(invoke).toHaveBeenCalledWith("onboarding_ssh_host_key_probe", { host });
    expect(JSON.stringify(vi.mocked(invoke).mock.calls)).not.toMatch(/token|stdin|refresh/i);
  });

  it("confirms only the exact algorithm and fingerprint shown by the UI", async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);

    await confirmOnboardingSshHostKey(host, firstSeen);

    expect(invoke).toHaveBeenCalledWith("onboarding_ssh_host_key_confirm", {
      host,
      algorithm: "ssh-ed25519",
      fingerprint: "SHA256:syntheticFingerprint",
    });
  });

  it("fails closed outside Tauri without invoking native code", async () => {
    vi.mocked(isTauri).mockReturnValue(false);

    await expect(probeOnboardingSshHostKey(host)).rejects.toEqual({ code: "desktop_only" });
    expect(invoke).not.toHaveBeenCalled();
  });
});
