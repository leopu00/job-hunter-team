import { describe, expect, it, vi } from "vitest";
import { pickSshKey, sshKeyBasename } from "./ssh-key-picker";

describe("pickSshKey", () => {
  it("opens an unrestricted native single-file dialog and returns only its path", async () => {
    const openDialog = vi.fn().mockResolvedValue("/Users/example/.ssh/id_ed25519");

    await expect(pickSshKey(openDialog, async () => "/Users/example")).resolves.toBe("/Users/example/.ssh/id_ed25519");
    expect(openDialog).toHaveBeenCalledWith({
      title: "Scegli chiave SSH",
      multiple: false,
      directory: false,
      canCreateDirectories: false,
      defaultPath: "/Users/example",
    });
    expect(openDialog.mock.calls[0][0]).not.toHaveProperty("filters");
  });

  it("starts in the home folder, never in the app's program folder; without one it lets the system choose", async () => {
    const openDialog = vi.fn().mockResolvedValue(null);
    await pickSshKey(openDialog, async () => "C:\\Users\\example");
    expect(openDialog.mock.calls[0][0].defaultPath).toBe("C:\\Users\\example");

    await pickSshKey(openDialog, () => Promise.reject(new Error("no home")));
    expect(openDialog.mock.calls[1][0]).not.toHaveProperty("defaultPath");
  });

  it("maps cancel to a no-op result and rejects an unexpected multi-selection", async () => {
    const home = async () => "/Users/example";
    await expect(pickSshKey(vi.fn().mockResolvedValue(null), home)).resolves.toBeNull();
    await expect(pickSshKey(vi.fn().mockResolvedValue(["/one", "/two"]), home)).rejects.toThrow(
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
