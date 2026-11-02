import type { DirectChatStatus } from "./direct-chat";
import { isTerminalExistingTeamError } from "./existing-team";

/**
 * The Assistant's direct chat answers only once its first turn is over (31 s measured at the first start of the
 * team on a Mac; the same chat was reachable 11 s later from the command line). The setup used to ask once, and
 * show «The direct chat cannot be reached yet» as a failure to set up again. It now waits for that turn: a bounded
 * time, asking again every few seconds, and a failure only if the chat still does not come.
 */
export const FIRST_ROUND_WAIT_MS = 90_000;
export const FIRST_ROUND_POLL_MS = 3_000;

/**
 * Codes that waiting does not change: the container is not the one that was installed, a host key changed, the
 * server refuses us (`ssh_rate_limited`: asking again every few seconds makes it worse), there is no ssh client or
 * the program does not start, the runtime or its wrapper is not the right one, the account is not the team's.
 */
const NOT_CURED_BY_WAITING = new Set([
  "local_container_not_attested", "local_chat_wrapper_outdated", "local_account_owner_mismatch",
  "local_account_owner_unavailable", "local_migration_host_invalid", "local_migration_host_not_local",
  "local_migration_host_missing", "runtime_missing", "ssh_rate_limited", "ssh_client_missing", "ssh_auth_failed",
  "process_start_failed", "tunnel_start_failed", "tunnel_path_unavailable",
]);

/**
 * Codes that may be the team not being ready yet or a host that refuses us (a key that is rejected looks the same
 * as a team that is not up): every attempt is a new ssh connection, and a rejected key counted many times is a
 * ban. A few attempts, each after twice the wait before it, and then the failure.
 */
const FEW_TRIES = new Set(["tunnel_verify_failed", "tunnel_unavailable", "connect_failed"]);
export const FEW_TRIES_MAX = 3;

export function chatMayStillCome(chat: Pick<DirectChatStatus, "state" | "code">): boolean {
  if (chat.state === "ready") return false;
  return !(chat.code && (NOT_CURED_BY_WAITING.has(chat.code) || isTerminalExistingTeamError(chat.code)));
}

export interface WaitForDirectChatOptions {
  maxMs?: number;
  pollMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** False once the person has left (another account, another setup): the wait ends where it stands. */
  stillCurrent?: () => boolean;
  /** Called once, when the first answer is not «ready» and waiting makes sense, to say what is going on. */
  onWaiting?: () => void;
}

/**
 * `first` is the answer to the first connection; `retry` asks again. Returns the last answer: «ready», or the
 * one that did not change in time (the caller shows its failure as before).
 */
export async function waitForDirectChat(
  first: DirectChatStatus,
  retry: () => Promise<DirectChatStatus>,
  options: WaitForDirectChatOptions = {},
): Promise<DirectChatStatus> {
  const {
    maxMs = FIRST_ROUND_WAIT_MS,
    pollMs = FIRST_ROUND_POLL_MS,
    sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
    now = Date.now,
    stillCurrent = () => true,
    onWaiting,
  } = options;
  const deadline = now() + maxMs;
  let chat = first;
  let announced = false;
  let fewTries = 0;
  while (chatMayStillCome(chat) && now() < deadline && stillCurrent()) {
    const few = Boolean(chat.code && FEW_TRIES.has(chat.code));
    if (few && fewTries >= FEW_TRIES_MAX) break;
    if (!announced) {
      announced = true;
      onWaiting?.();
    }
    await sleep(few ? pollMs * 2 ** fewTries : pollMs);
    if (few) fewTries += 1;
    if (!stillCurrent()) break;
    chat = await retry();
  }
  return chat;
}
