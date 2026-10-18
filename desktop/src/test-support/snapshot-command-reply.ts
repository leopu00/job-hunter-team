import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const PARSED_KEYS = [
  "runtimeInstalled",
  "containerRunning",
  "providerConfigured",
  "providerAuthenticated",
  "assistantWelcomed",
  "assistantRunning",
  "captainRunning",
  "profileReady",
] as const;

/** The keys the remote command behind `onboarding_resume_snapshot` really prints (read from the Rust source). */
export function snapshotCommandKeys(): string[] {
  // vitest runs from desktop/
  const source = readFileSync(resolve(process.cwd(), "src-tauri/src/existing_team_runtime.rs"), "utf8");
  const start = source.indexOf("pub(crate) fn snapshot_command");
  const end = source.indexOf("fn hex_encode", start);
  if (start < 0 || end < 0) throw new Error("snapshot_command not found in the Rust source");
  const body = source.slice(start, end);
  return PARSED_KEYS.filter((key) => body.includes(`${key}=`) || body.includes(`\\"${key}=`));
}

/**
 * The reply the page gets after that command, as the native parser builds it:
 * every key the command prints is read, every key it does not print is `false`
 * (a missing key is false in `parse_snapshot`), plus the field the parser adds.
 */
export function realSnapshotReply(printed: Partial<Record<(typeof PARSED_KEYS)[number], boolean>> = {}) {
  const keys = snapshotCommandKeys();
  const reply: Record<string, boolean> = { directChatReady: false };
  for (const key of PARSED_KEYS) reply[key] = keys.includes(key) ? (printed[key] ?? true) : false;
  return reply;
}
