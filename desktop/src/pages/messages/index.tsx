import { useState } from "react";
import { useExistingTeamReadOnly } from "../../lib/existing-team-readonly";
import { useLeaveReadOnly } from "../../lib/leave-read-only";
import { useReconfirmExistingTeam } from "../../lib/reconfirm-existing-team";
import type { ExistingTeamBridge } from "../../lib/existing-team";
import type { PageProps } from "../types";
import DirectChatScreen, { isDirectChatAgentId } from "./DirectChatScreen";
import ExistingTeamReconfirmDialog from "./ExistingTeamReconfirmDialog";
import { directChatClient } from "./direct-chat-client";

/**
 * The desktop Messages route talks only through the direct VPS bridge. In the read-only view of an
 * existing team it shows the history and the replies and says how to write; the refusal to write is
 * the native side's, this only tells the person first.
 */
export default function MessagesPage({ search, reconfirmBridge }: PageProps & { reconfirmBridge?: ExistingTeamBridge }) {
  const requestedAgent = search.get("agent");
  const initialAgentId = isDirectChatAgentId(requestedAgent) ? requestedAgent : "capitano";
  const readOnly = useExistingTeamReadOnly() !== null;
  const leaveReadOnly = useLeaveReadOnly();
  const reconfirm = useReconfirmExistingTeam();
  const [confirming, setConfirming] = useState(false);
  // «Collega il team» opens the setup's confirmation here, in the chat; without it (an older shell)
  // the button still leads back to the setup.
  const onConnect = readOnly ? (reconfirm ? () => setConfirming(true) : leaveReadOnly ?? undefined) : undefined;
  return (
    <>
      <DirectChatScreen client={directChatClient} initialAgentId={initialAgentId} writeLocked={readOnly} onConnect={onConnect} />
      {readOnly && reconfirm && confirming && (
        <ExistingTeamReconfirmDialog reconfirm={reconfirm} onClose={() => setConfirming(false)} bridge={reconfirmBridge} />
      )}
    </>
  );
}
