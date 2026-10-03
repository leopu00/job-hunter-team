import { invoke, isTauri } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  confirmOnboardingSshHostKey,
  openOnboardingAssistant,
  parseOnboardingNativeProgress,
  prepareOnboardingRuntime,
  probeOnboardingSshHostKey,
  resumeOnboardingSnapshot,
  resumeOnboardingTeamStart,
  startOnboardingProviderLogin,
  startOnboardingTeam,
  type SshHostKeyProbe,
} from "./onboarding-runtime";

const channels: Array<{ onmessage?: (message: unknown) => void }> = [];
vi.mock("@tauri-apps/api/core", () => ({
  Channel: class {
    onmessage?: (message: unknown) => void;
    constructor() { channels.push(this); }
  },
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

const runtimeStarted = {
  stage: "runtime",
  status: "start",
  message: "Preparo il runtime verificato.",
  sequence: 1,
  elapsedMs: 0,
  code: null,
  retryable: null,
} as const;

describe("SSH host-key consent contract", () => {
  beforeEach(() => {
    channels.length = 0;
    vi.mocked(invoke).mockReset();
    vi.mocked(isTauri).mockReset().mockReturnValue(true);
  });

  it("prepares with technical data only and forwards native progress", async () => {
    vi.mocked(invoke).mockResolvedValue({});
    const onProgress = vi.fn();

    await prepareOnboardingRuntime(
      { host: { kind: "local" }, provider: "claude" },
      null,
      onProgress,
    );

    expect(invoke).toHaveBeenCalledWith("onboarding_prepare", {
      submission: { host: { kind: "local" }, provider: "claude" },
      pairingToken: null,
      onProgress: expect.anything(),
    });
    const payload = vi.mocked(invoke).mock.calls[0][1] as Record<string, unknown>;
    expect(payload).not.toHaveProperty("accountEmail");
    expect(payload.submission).not.toHaveProperty("profile");
    channels[0].onmessage?.(runtimeStarted);
    expect(onProgress).toHaveBeenCalledWith(runtimeStarted);
  });

  it("drops malformed progress and replaces unsafe native text with a fixed stage message", async () => {
    const onProgress = vi.fn();
    vi.mocked(invoke).mockResolvedValue({});
    await prepareOnboardingRuntime(
      { host: { kind: "local" }, provider: "claude" },
      null,
      onProgress,
    );

    channels[0].onmessage?.({ ...runtimeStarted, sequence: 0 });
    channels[0].onmessage?.({
      ...runtimeStarted,
      stage: "container",
      message: "token at /private/key for 192.0.2.10 host.example.invalid",
    });

    expect(onProgress).toHaveBeenCalledOnce();
    expect(onProgress).toHaveBeenCalledWith({
      ...runtimeStarted,
      stage: "container",
      message: "Preparo il container del team.",
    });
    expect(JSON.stringify(onProgress.mock.calls)).not.toMatch(/private|192\.0\.2\.10|example\.invalid|token at/i);
  });

  it("requires exact terminal error metadata", () => {
    expect(parseOnboardingNativeProgress({
      ...runtimeStarted,
      status: "error",
      code: "container_timeout",
      retryable: true,
    })).toEqual({
      ...runtimeStarted,
      status: "error",
      code: "container_timeout",
      retryable: true,
    });
    expect(parseOnboardingNativeProgress({ ...runtimeStarted, status: "error" })).toBeNull();
    expect(parseOnboardingNativeProgress({ ...runtimeStarted, code: "unexpected" })).toBeNull();
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

  it("resumes from the privately persisted native host without webview arguments", async () => {
    vi.mocked(invoke).mockResolvedValue({});
    await resumeOnboardingSnapshot();
    expect(invoke).toHaveBeenCalledWith("onboarding_resume_snapshot");
  });

  it("starts missing resumed team sessions without exposing host or account data", async () => {
    vi.mocked(invoke).mockResolvedValue({});
    const onProgress = vi.fn();
    await resumeOnboardingTeamStart(onProgress);
    expect(invoke).toHaveBeenCalledWith("onboarding_resume_team_start", {
      onProgress: expect.anything(),
    });
    expect(JSON.stringify(vi.mocked(invoke).mock.calls)).not.toMatch(/account|address|keyPath/i);
  });

  it("adds a sanitized progress channel to login, team and Assistant commands", async () => {
    vi.mocked(invoke).mockImplementation(async (command) => command === "onboarding_provider_login"
      ? { sessionId: "synthetic-session" }
      : {});
    const onProgress = vi.fn();

    await startOnboardingProviderLogin(host, vi.fn(), onProgress);
    await startOnboardingTeam(host, onProgress);
    await openOnboardingAssistant(host, onProgress);

    expect(invoke).toHaveBeenNthCalledWith(1, "onboarding_provider_login", {
      host,
      onEvent: expect.anything(),
      onProgress: expect.anything(),
    });
    expect(invoke).toHaveBeenNthCalledWith(2, "onboarding_team_start", {
      host,
      onProgress: expect.anything(),
    });
    expect(invoke).toHaveBeenNthCalledWith(3, "onboarding_assistant_open", {
      host,
      onProgress: expect.anything(),
    });
  });
});
