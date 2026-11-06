import { useEffect, useMemo, useState } from "react";
import { appLocale } from "../../lib/app-locale";
import { describeAgentState } from "@/lib/agent-state";
import { agentTitle } from "../agents/agent-names";
import { DIRECT_CHAT_TEXT } from "./direct-chat.i18n";
import { conversationsOf, isChatAgentId, sessionOfChatId, type ChatSession } from "./chat-agents";
import { useChatUnread } from "./chat-unread";
import type { ChatState } from "./direct-chat-screen-state";
import type { DirectChatScreenProps } from "./direct-chat-screen-types";

const SESSIONS_POLL_MS = 20_000;
function useSessions(loadSessions: DirectChatScreenProps["loadSessions"], embedded: boolean) {
  const [sessions, setSessions] = useState<ChatSession[] | null>(null);
  useEffect(() => {
    if (!loadSessions || embedded) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const again = async () => {
      if (document.visibilityState === "visible") {
        try {
          const found = await loadSessions();
          if (live && found) setSessions(found);
        } catch {
          // the list stays as it was: a failed read is not a reason to empty it
        }
      }
      if (live) timer = setTimeout(() => void again(), SESSIONS_POLL_MS);
    };
    void again();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [loadSessions, embedded]);

  return sessions;
}
export function useChatNavigation(props: DirectChatScreenProps, state: ChatState) {
  const { agentTabs, embedded = false, client, loadSessions } = props;
  const { agentId, setAgentId, messages, status } = state;
  const locale = appLocale();
  const t = DIRECT_CHAT_TEXT[locale];
  const [tab, setTab] = useState<string>(agentTabs?.initial ?? "chat");
  const [squadOn, setSquadOn] = useState<boolean>(Boolean(agentTabs?.squad?.initial));
  const [squadTab, setSquadTab] = useState<string>(agentTabs?.squad?.initial ?? agentTabs?.squad?.tabs[0]?.id ?? "");
  const squad = agentTabs?.squad && !embedded ? agentTabs.squad : null;
  const squadSelected = squad !== null && squadOn;
  const sessions = useSessions(loadSessions, embedded);
  const agents = useMemo(() => {
    const listed = conversationsOf(sessions, t.agents);
    if (listed.some((agent) => agent.id === agentId) || !isChatAgentId(agentId)) return listed;
    const session = sessionOfChatId(agentId) ?? agentId.toUpperCase();
    return [...listed, { id: agentId, session, label: agentTitle(session, t.agents), up: false, state: sessions === null ? null : { state: "spento" as const } }];
  }, [sessions, t, agentId]);
  const selected = agents.find((agent) => agent.id === agentId) ?? agents[0];
  // The team's sessions that have no chat (maintenance, a reviewer, the sentinel): rows of their own on the Team page, with Info and
  // Terminal only, so no agent that the Agents page showed goes missing.
  const others = useMemo(
    () =>
      agentTabs && !embedded && sessions
        ? sessions.filter((entry) => !agents.some((agent) => agent.session === entry.session)).map((entry) => ({ session: entry.session, label: agentTitle(entry.session, t.agents), up: entry.up }))
        : [],
    [agentTabs, embedded, sessions, agents, t],
  );
  const [otherOn, setOtherOn] = useState<string | null>(agentTabs?.initialOther ? agentTabs.initialOther.toUpperCase() : null);
  const [otherTab, setOtherTab] = useState(agentTabs?.initial && agentTabs.tabs.some((item) => item.id === agentTabs.initial) ? agentTabs.initial : "info");
  const otherSelected = otherOn === null ? null : others.find((entry) => entry.session === otherOn) ?? null;
  // The agent is off when the team's sessions are known and this one is not up: its chat is read, and nothing is written to it.
  const agentOff = sessions !== null && !selected.up;
  // What the team says of this agent now, in the words of the agents' page («Scout · ▶ lavora»), instead of «team connected».
  const agentLine = selected.state ? `${selected.label} · ${describeAgentState(selected.state, locale).line}` : null;
  // The same list of ids stays the same array while the sessions are read again every 20 s: the unread peeks go
  // round the agents one by one, and a new array would send them back to the first each time.
  const idsKey = agents.map((agent) => agent.id).join("|");
  const agentIds = useMemo(() => idsKey.split("|"), [idsKey]);
  // How many messages of each agent the person has not read: the chat on screen is read, the others are looked at slowly.
  const slowLink = status.state === "ready" && status.link === "per-command";
  const unread = useChatUnread({
    agents: agentIds,
    openAgent: agentId,
    openMessages: messages,
    read: (request) => client.read({ agentId: request.agentId }),
    peeking: !embedded && status.state === "ready" && !slowLink,
  });

  return { locale, t, tab, setTab, squad, squadSelected, squadTab, setSquadTab, setSquadOn,
    sessions, agents, selected, others, otherOn, setOtherOn, otherTab, setOtherTab, otherSelected,
    agentOff, agentLine, unread, slowLink };
}
