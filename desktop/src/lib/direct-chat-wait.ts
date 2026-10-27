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

/** Codes that waiting does not change: the container is not the one that was installed, a host key changed... */
const NOT_CURED_BY_WAITING = new Set(["local_container_not_attested"]);

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
  while (chatMayStillCome(chat) && now() < deadline && stillCurrent()) {
    if (!announced) {
      announced = true;
      onWaiting?.();
    }
    await sleep(pollMs);
    if (!stillCurrent()) break;
    chat = await retry();
  }
  return chat;
}
