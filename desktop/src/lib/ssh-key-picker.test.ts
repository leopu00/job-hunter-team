import { describe, expect, it, vi } from "vitest";
import { pickSshKey, sshKeyBasename } from "./ssh-key-picker";

describe("pickSshKey", () => {
  it("opens an unrestricted native single-file dialog and returns only its path", async () => {
    const openDialog = vi.fn().mockResolvedValue("/Users/example/.ssh/id_ed25519");

    await expect(pickSshKey(openDialog)).resolves.toBe("/Users/example/.ssh/id_ed25519");
    expect(openDialog).toHaveBeenCalledWith({
      title: "Scegli chiave SSH",
      multiple: false,
      directory: false,
      canCreateDirectories: false,
    });
    expect(openDialog.mock.calls[0][0]).not.toHaveProperty("filters");
  });

  it("maps cancel to a no-op result and rejects an unexpected multi-selection", async () => {
    await expect(pickSshKey(vi.fn().mockResolvedValue(null))).resolves.toBeNull();
    await expect(pickSshKey(vi.fn().mockResolvedValue(["/one", "/two"]))).rejects.toThrow(
      "ssh-key-dialog-invalid-selection",
    );
  });
});

describe("sshKeyBasename", () => {
  it.each([
    ["/Users/example/.ssh/id_ed25519", "id_ed25519"],
    ["C:\\Users\\example\\.ssh\\id_rsa", "id_rsa"],
    ["", "Nome file non disponibile"],
  ])("shows a safe basename for %j", (path, basename) => {
    expect(sshKeyBasename(path)).toBe(basename);
  });
});
