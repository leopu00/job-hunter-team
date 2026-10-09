import { invoke, isTauri } from "@tauri-apps/api/core";

/**
 * The team's mailbox (src-tauri/src/mail.rs). The broker keeps the password;
 * the app shows the state and saves a new app password through the host's
 * `jht mail setup --password-stdin`, never on a command line.
 */
export interface MailStatus {
  configured: boolean;
  address: string | null;
  admission: "allowlist" | "whole_mailbox" | null;
  /** The saved password was readable by the agents: a new one is due. */
  rotationPending: boolean;
}

export interface MailPasswordRequest {
  address: string;
  /** «Is this mailbox dedicated to forwarded job alerts?» Required, no default. */
  dedicated: boolean;
  imapHost?: string;
  smtpHost?: string;
  password: string;
}

/** Fired after a password is saved, so the warning reads the state again. */
export const MAIL_SAVED_EVENT = "jht:mail-saved";

export async function mailStatus(): Promise<MailStatus> {
  if (!isTauri()) throw { code: "desktop_only" };
  return invoke<MailStatus>("mail_status");
}

export async function saveMailPassword(request: MailPasswordRequest): Promise<void> {
  if (!isTauri()) throw { code: "desktop_only" };
  await invoke("mail_save_password", { request });
}
