import { open, type OpenDialogOptions } from "@tauri-apps/plugin-dialog";

export type SshKeySelector = () => Promise<string | null>;

type OpenDialog = (
  options: OpenDialogOptions & { multiple: false; directory: false },
) => Promise<string | string[] | null>;

const SSH_KEY_DIALOG_OPTIONS = {
  title: "Scegli chiave SSH",
  multiple: false,
  directory: false,
  canCreateDirectories: false,
} as const satisfies OpenDialogOptions;

/** Opens a native single-file dialog without reading or copying the selected file. */
export async function pickSshKey(openDialog: OpenDialog = open): Promise<string | null> {
  const selected = await openDialog(SSH_KEY_DIALOG_OPTIONS);
  if (selected === null || selected === "") return null;
  if (typeof selected !== "string") throw new Error("ssh-key-dialog-invalid-selection");
  return selected;
}

/** Handles POSIX and Windows paths while never exposing their directory portion. */
export function sshKeyBasename(path: string): string {
  const parts = path.split(/[\\/]/u).filter(Boolean);
  return parts.at(-1) ?? "Nome file non disponibile";
}
