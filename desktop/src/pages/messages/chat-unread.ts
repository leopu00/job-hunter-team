import { useEffect, useMemo, useRef, useState } from "react";
import type { DirectChatMessage, DirectChatPage } from "../../lib/direct-chat";

/** How often another agent's chat is looked at, one agent each time: the open chat is read on its own pace. */
export const UNREAD_PEEK_MS = 45_000;
export const UNREAD_FIRST_PEEK_MS = 4_000;
const STORAGE_KEY = "jht.desktop.chat.seen.v1";
/** More than this is shown as «99+»: the number is a hint to open the chat, not a count to trust to the unit. */
export const UNREAD_SHOWN_MAX = 99;

/** Where the person read each chat up to: the time of the newest agent message they had on screen. */
export type SeenMarks = Record<string, number>;

export function loadSeen(storage: Pick<Storage, "getItem"> | null = safeStorage()): SeenMarks {
  try {
    const parsed: unknown = JSON.parse(storage?.getItem(STORAGE_KEY) ?? "{}");
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    const out: SeenMarks = {};
    for (const [agent, at] of Object.entries(parsed)) if (typeof at === "number" && Number.isFinite(at) && at >= 0) out[agent] = at;
    return out;
  } catch {
    return {};
  }
}

function saveSeen(marks: SeenMarks, storage: Pick<Storage, "setItem"> | null = safeStorage()): void {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(marks));
  } catch {
    // no storage (a private window): the marks last until the page is left
  }
}

function safeStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** The time of the newest message the agent wrote, or 0. The person's own and the system's lines are never «unread». */
export function newestAgentAt(messages: readonly DirectChatMessage[]): number {
  let newest = 0;
  for (const message of messages) if (message.role === "agent" && message.at > newest) newest = message.at;
  return newest;
}

/** The agent's messages after the mark. */
export function unreadAfter(messages: readonly DirectChatMessage[], mark: number): number {
  let count = 0;
  for (const message of messages) if (message.role === "agent" && message.at > mark) count += 1;
  return count;
}

/** «7», or «99+»: the text of the badge. */
export function unreadLabel(count: number): string {
  return count > UNREAD_SHOWN_MAX ? `${UNREAD_SHOWN_MAX}+` : String(count);
}

type Read = (request: { agentId: string }) => Promise<DirectChatPage>;

/**
 * The unread counter of the chats: for each agent, how many of its messages came after the last one the person had
 * on screen. The open chat is read by the page, and counts as read while the window is in view. The others are looked
 * at one by one, slowly (never on a link where every read is a new connection, and never while the window is hidden),
 * and a chat seen for the first time starts at zero: its old history is not «news». The marks are kept in the
 * window's own storage, so a restart does not bring the whole history back as unread.
 */
export function useChatUnread({
  agents,
  openAgent,
  openMessages,
  read,
  peeking,
}: {
  agents: readonly string[];
  openAgent: string;
  /** What the page holds of the open chat. */
  openMessages: readonly DirectChatMessage[];
  read: Read;
  /** False while the chat is not connected, on a slow link, or in a pane that has no list of agents. */
  peeking: boolean;
}): { counts: Readonly<Record<string, number>>; total: number } {
  const marks = useRef<SeenMarks | null>(null);
  if (marks.current === null) marks.current = loadSeen();
  const [counts, setCounts] = useState<Readonly<Record<string, number>>>({});

  const setCount = (agent: string, count: number) =>
    setCounts((current) => (current[agent] === count || (!current[agent] && count === 0) ? current : { ...current, [agent]: count }));
  // the latest of these, for the timers that outlive a render
  const setCountRef = useRef(setCount);
  setCountRef.current = setCount;
  const readRef = useRef(read);
  readRef.current = read;

  // The open chat: read while it is in view.
  useEffect(() => {
    const m = marks.current!;
    const apply = () => {
      const newest = newestAgentAt(openMessages);
      if (newest === 0) return;
      if (document.visibilityState === "hidden" && m[openAgent] !== undefined) {
        setCountRef.current(openAgent, unreadAfter(openMessages, m[openAgent]));
        return;
      }
      if ((m[openAgent] ?? 0) < newest) {
        m[openAgent] = newest;
        saveSeen(m);
      }
      setCountRef.current(openAgent, 0);
    };
    apply();
    document.addEventListener("visibilitychange", apply);
    return () => document.removeEventListener("visibilitychange", apply);
  }, [openAgent, openMessages]);

  // The others, one at a time.
  const others = useMemo(() => agents.filter((agent) => agent !== openAgent), [agents, openAgent]);
  useEffect(() => {
    if (!peeking || others.length === 0) return;
    let active = true;
    let index = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const peek = async () => {
      if (!active) return;
      const agent = others[index % others.length];
      index += 1;
      if (document.visibilityState !== "hidden") {
        try {
          const page = await readRef.current({ agentId: agent });
          if (!active) return;
          const m = marks.current!;
          if (m[agent] === undefined) {
            // first sight: what is there already is not news
            m[agent] = newestAgentAt(page.messages);
            saveSeen(m);
            setCountRef.current(agent, 0);
          } else {
            setCountRef.current(agent, unreadAfter(page.messages, m[agent]));
          }
        } catch {
          // an agent that is not running, a read refused: no news, and the counter stays as it was
        }
      }
      if (active) timer = setTimeout(() => void peek(), UNREAD_PEEK_MS);
    };
    timer = setTimeout(() => void peek(), UNREAD_FIRST_PEEK_MS);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [others, peeking]);

  const total = useMemo(() => Object.values(counts).reduce((sum, count) => sum + count, 0), [counts]);
  return { counts, total };
}
