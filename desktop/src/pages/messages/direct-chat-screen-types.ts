import type { ReactNode } from "react";
import type { VoiceInputBridge } from "../../lib/voice-input";
import type { QuietFacts } from "./team-quiet";
import type { ChatSession } from "./chat-agents";
import type { DirectChatClient } from "./direct-chat-contract";
import { FIXED_CHAT_AGENTS } from "./chat-agents";

export type DirectChatAgentId = (typeof FIXED_CHAT_AGENTS)[number];
export function isDirectChatAgentId(value: string | null): value is DirectChatAgentId {
  return FIXED_CHAT_AGENTS.some((id) => id === value);
}

export type AgentTabs = {
  /** The tabs after «Chat», in order. */
  tabs: readonly { id: string; label: string }[];
  /** The tab to open first (from the address). */
  initial?: string;
  /** Open on the session that has no chat (from the address), on the tab `initial` names if it is one of the tabs. */
  initialOther?: string;
  /** What a tab shows for the chosen agent (the session is its tmux name, ANALISTA-2). */
  render: (agent: { id: string; session: string; label: string; up: boolean }, tab: string) => ReactNode;
  /** The person chose another tab or agent: the page keeps the address. */
  onChange?: (agentId: string, tab: string) => void;
  /**
   * The whole team as a row on top of the list, with tabs of its own (commands, lanes, registry): what is of all the
   * agents and not of one. Choosing it leaves the agent underneath as it was, and the chat goes on in the background.
   */
  squad?: {
    label: string;
    tabs: readonly { id: string; label: string }[];
    /** Open on this row, with this tab (from the address). */
    initial?: string;
    render: (tab: string) => ReactNode;
    /** The line under its name in the list: how many of the agents are on. */
    line?: (up: number, total: number) => string;
  };
};

export type DirectChatScreenProps = {
  client: DirectChatClient;
  voiceInputBridge?: VoiceInputBridge;
  initialAgentId?: string;
  /**
   * One agent, inside another page (the Chat tab of the Agents page): no list of agents, no title,
   * the connection stays open when the pane goes away, and a connection that fell is opened again.
   */
  embedded?: boolean;
  /** The read-only view: history and answers are shown, the composer says why it cannot write. */
  writeLocked?: boolean;
  /** With `writeLocked`: where the invitation's button goes (the way to the full connection). */
  onConnect?: () => void;
  /** What the team says about itself to explain a long silence (hours, budget...); without it the chat does not explain one. */
  loadQuietFacts?: () => Promise<QuietFacts | null>;
  /**
   * The sessions the team has up, to list a conversation for each instance (Analista 1, Analista 2…). Without it
   * (an older shell, a pane inside another page) the list is the eight roles, as it has always been.
   */
  loadSessions?: () => Promise<ChatSession[] | null>;
  /**
   * The Team page: next to the chat the agent has other sections (its info, its terminal), shown in the same place
   * under tabs. `render` gives the section for the chosen agent; the chat is the first tab and stays mounted state-wise
   * (its connection and its reads are the page's, not the tab's).
   */
  agentTabs?: AgentTabs;
};
