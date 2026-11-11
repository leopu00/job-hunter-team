import type { ChatScreenModel } from "./use-direct-chat-screen-model";
import { withName } from "./direct-chat.i18n";
import { ChatSidebar } from "./DirectChatNavigation";
import { ChatHeader, ChatTabs, ChatTabPanel } from "./DirectChatHeader";
import { StatusBar } from "./DirectChatStatusBar";
import { ChatTranscript, ChatReplyMenu } from "./DirectChatTranscript";
import { ChatComposer, ReadOnlyInvite } from "./DirectChatComposer";
import TeamQuietNotice from "./TeamQuietNotice";
import OwnVpsClaim from "../../components/OwnVpsClaim";
import KeyRefusedNotice from "../../components/KeyRefusedNotice";
import { isOwnVpsClaimCode } from "../../lib/own-vps-claim";

function ChatPane({ m }: { m: ChatScreenModel }) {
  const { status, operationError, reconnecting, agentLine, retry, readAgain,
    loadQuietFacts, embedded, unread, writeLocked, clearOperationError } = m;
  return <>
    <StatusBar status={status} operationError={operationError} reconnecting={reconnecting} agentLine={agentLine} onRetry={() => void retry()} onReadAgain={readAgain} />
    {status.state === "ready" && <KeyRefusedNotice state={m.selected.state} className="shrink-0 m-0 px-4 py-2 text-[14px] border-b border-[var(--color-border)]" />}
    {loadQuietFacts && !embedded && status.state === "ready" && (
      <TeamQuietNotice lastAgentAt={unread.lastAgentAt} loadFacts={loadQuietFacts} />
    )}
    {!writeLocked && isOwnVpsClaimCode(operationError) && (
      <div className="shrink-0 px-4 pt-3">
        <OwnVpsClaim reason={operationError} onClaimed={() => clearOperationError()} />
      </div>
    )}
    <ChatTranscript m={m} />
    <ChatReplyMenu m={m} />
    <ReadOnlyInvite m={m} />
    <ChatComposer m={m} />
  </>;
}

export function DirectChatView({ m }: { m: ChatScreenModel }) {
  const { embedded, t, selected, agentTabs, squadSelected, otherSelected, tab } = m;
  return (
    <div
      className="min-h-0 overflow-hidden flex flex-col md:flex-row bg-[var(--color-void)]"
      // Use the Shell's available space, including when a banner is above the page.
      style={{ height: "100%" }}
      data-testid="direct-chat-shell"
    >
      {!embedded && <ChatSidebar m={m} />}
      <section className="flex-1 min-w-0 min-h-0 overflow-hidden flex flex-col" aria-label={withName(t.conversationWith, selected.label)}>
        {!embedded && <ChatHeader m={m} />}
        {agentTabs && !embedded && <ChatTabs m={m} />}
        {agentTabs && !embedded && (squadSelected || otherSelected || tab !== "chat")
          ? <ChatTabPanel m={m} />
          : <ChatPane m={m} />}
      </section>
    </div>
  );
}
