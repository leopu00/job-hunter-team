import { useState } from "react";
import { useExistingTeamReadOnly } from "../../lib/existing-team-readonly";
import { useLeaveReadOnly } from "../../lib/leave-read-only";
import { useReconfirmExistingTeam } from "../../lib/reconfirm-existing-team";
import type { ExistingTeamBridge } from "../../lib/existing-team";
import type { PageProps } from "../types";
import { appLocale } from "../../lib/app-locale";
import { AgentInfoTab, AgentTerminalTab } from "../agents/AgentPage";
import AgentsPanel from "../agents/AgentsPanel";
import { TEAM_TABS_TEXT } from "./team-tabs.i18n";
import type { AgentTabs } from "./DirectChatScreen";
import DirectChatScreen from "./DirectChatScreen";
import { isChatAgentId } from "./chat-agents";
import { loadChatSessions } from "./chat-sessions";
import ExistingTeamReconfirmDialog from "./ExistingTeamReconfirmDialog";
import { directChatClient } from "./direct-chat-client";
import { loadQuietFacts } from "./quiet-facts";

/**
 * The desktop Messages route talks only through the direct VPS bridge. In the read-only view of an
 * existing team it shows the history and the replies and says how to write; the refusal to write is
 * the native side's, this only tells the person first.
 */
export default function MessagesPage({ search, reconfirmBridge, embedded }: PageProps & { reconfirmBridge?: ExistingTeamBridge; embedded?: boolean }) {
  const requestedAgent = search.get("agent");
  const initialAgentId = isChatAgentId(requestedAgent) ? requestedAgent : "capitano";
  const requestedTab = search.get("tab");
  const words = TEAM_TABS_TEXT[appLocale()];
  // next to the chat, the agent's info and its terminal (read only), in the same place
  const agentTabs: AgentTabs = {
    tabs: [
      { id: "info", label: words.info },
      { id: "terminal", label: words.terminal },
    ],
    initial: requestedTab === "info" || requestedTab === "terminal" ? requestedTab : undefined,
    render: (agent, tab) =>
      tab === "terminal" ? (
        <AgentTerminalTab key={agent.session} session={agent.session} />
      ) : (
        <div key={agent.session}>
          {/* what the Agents page shows of one agent at the top (state, times, what it asks, Pause, Restart, Stop) and, under it, the info */}
          <AgentsPanel params={{}} search={search} only="agent" agent={agent.session} />
          <AgentInfoTab session={agent.session} />
        </div>
      ),
    squad: {
      label: words.squad,
      tabs: [
        { id: "commands", label: words.commands },
        { id: "lanes", label: words.lanes },
        { id: "log", label: words.log },
      ],
      initial: requestedTab === "squad" || requestedTab === "commands" || requestedTab === "lanes" || requestedTab === "log" ? (requestedTab === "squad" ? "commands" : requestedTab) : undefined,
      render: (tab) => <AgentsPanel key={tab} params={{}} search={search} only={tab === "lanes" ? "lanes" : tab === "log" ? "log" : "commands"} />,
    },
  };
  const readOnly = useExistingTeamReadOnly() !== null;
  const leaveReadOnly = useLeaveReadOnly();
  const reconfirm = useReconfirmExistingTeam();
  const [confirming, setConfirming] = useState(false);
  // «Collega il team» opens the setup's confirmation here, in the chat; without it (an older shell)
  // the button still leads back to the setup.
  const onConnect = readOnly ? (reconfirm ? () => setConfirming(true) : leaveReadOnly ?? undefined) : undefined;
  return (
    <>
      <DirectChatScreen client={directChatClient} initialAgentId={initialAgentId} embedded={embedded} writeLocked={readOnly} onConnect={onConnect} loadQuietFacts={loadQuietFacts} loadSessions={loadChatSessions} agentTabs={embedded ? undefined : agentTabs} />
      {readOnly && reconfirm && confirming && (
        <ExistingTeamReconfirmDialog reconfirm={reconfirm} onClose={() => setConfirming(false)} bridge={reconfirmBridge} />
      )}
    </>
  );
}
