import { useState } from "react";
import { appLocale } from "../../lib/app-locale";
import { useExistingTeamReadOnly } from "../../lib/existing-team-readonly";
import { useLeaveReadOnly } from "../../lib/leave-read-only";
import { useReconfirmExistingTeam } from "../../lib/reconfirm-existing-team";
import { navigate } from "../../shell/router";
import DirectChatScreen from "./DirectChatScreen";
import ExistingTeamReconfirmDialog from "./ExistingTeamReconfirmDialog";
import { directChatClient } from "./direct-chat-client";
import { DIRECT_CHAT_TEXT } from "./direct-chat.i18n";
import type { DirectChatClient } from "./direct-chat-contract";
import type { ExistingTeamBridge } from "../../lib/existing-team";

/** The three agents the person talks to from the Agents page. */
export type AgentChatRole = "capitano" | "assistente" | "mentor";

/**
 * The chat with one agent, to be mounted as a tab: it reads, writes and follows the answers by
 * itself. In the read-only view of an existing team it shows the history and the replies and
 * says how to write; the refusal to write is the native side's, this only tells the person first.
 */
export function AgentChatPane({ role, client = directChatClient, reconfirmBridge }: { role: AgentChatRole; client?: DirectChatClient; reconfirmBridge?: ExistingTeamBridge }) {
  const readOnly = useExistingTeamReadOnly() !== null;
  const leaveReadOnly = useLeaveReadOnly();
  const reconfirm = useReconfirmExistingTeam();
  const [confirming, setConfirming] = useState(false);
  // «Collega il team» opens the setup's confirmation here, in the chat; without it (an older shell)
  // the button still leads back to the setup.
  const onConnect = readOnly ? (reconfirm ? () => setConfirming(true) : leaveReadOnly ?? undefined) : undefined;
  const t = DIRECT_CHAT_TEXT[appLocale()];
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 justify-end px-3 pt-1">
        <button
          type="button"
          data-testid="agent-chat-open-full"
          onClick={() => navigate(`/messages?agent=${role}`)}
          className="text-[11px] font-semibold uppercase tracking-widest px-2 py-1 rounded border border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-bright)]"
        >
          {t.openFull}
        </button>
      </div>
      <div className="min-h-0 flex-1">
        <DirectChatScreen
          client={client}
          initialAgentId={role}
          embedded
          writeLocked={readOnly}
          onConnect={onConnect}
        />
      </div>
      {readOnly && reconfirm && confirming && (
        <ExistingTeamReconfirmDialog reconfirm={reconfirm} onClose={() => setConfirming(false)} bridge={reconfirmBridge} />
      )}
    </div>
  );
}

export default AgentChatPane;
