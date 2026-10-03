import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  profileImportBridge,
  profileImportErrorCode,
  verifiedProfileImportSnapshot,
  type ProfileImportSnapshot,
} from "./profile-import";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  isTauri: vi.fn(() => true),
  Channel: class {},
}));

vi.mock("./onboarding-runtime", () => ({
  probeOnboardingSshHostKey: vi.fn(),
  confirmOnboardingSshHostKey: vi.fn(),
}));

const HOST = {
  kind: "vps" as const,
  address: "host.example.invalid",
  user: "root",
  port: 22,
  keyPath: "/synthetic/private/key",
};

const VERIFIED: ProfileImportSnapshot = {
  sourceValid: true,
  reviewClear: true,
  sourceStable: true,
  targetWasAbsent: true,
  targetValid: true,
  receiptVerified: true,
};

describe("profile import bridge", () => {
  beforeEach(() => vi.clearAllMocks());

  it("passes only the selected VPS host and accepts a fully verified receipt", async () => {
    vi.mocked(invoke).mockResolvedValue(VERIFIED);
    await expect(profileImportBridge.importProfile(HOST)).resolves.toEqual(VERIFIED);
    expect(invoke).toHaveBeenCalledWith("profile_import_vps_to_local", { host: HOST });
    expect(verifiedProfileImportSnapshot(VERIFIED)).toBe(true);
    expect(verifiedProfileImportSnapshot({ ...VERIFIED, receiptVerified: false })).toBe(false);
  });

  it("fails closed outside Tauri and exposes only stable error codes", async () => {
    vi.mocked(isTauri).mockReturnValue(false);
    await expect(profileImportBridge.importProfile(HOST)).rejects.toEqual({ code: "desktop_only" });
    expect(profileImportErrorCode({ code: "source_review_pending", message: "private" }))
      .toBe("source_review_pending");
    expect(profileImportErrorCode(new Error("private"))).toBe("unknown");
  });
});
