import type { DirectChatScreenProps } from "./direct-chat-screen-types";
import { useDirectChatScreenModel } from "./use-direct-chat-screen-model";
import { DirectChatView } from "./DirectChatView";

export { isDirectChatAgentId } from "./direct-chat-screen-types";
export type { DirectChatAgentId, AgentTabs } from "./direct-chat-screen-types";
export { newLineAt, groupRepeatedMessages, REOPEN_NO_RETRY } from "./direct-chat-screen-helpers";
export { systemLineText, withoutAttachmentPath } from "./chat-line-text";
export { renderChatText } from "./chat-text";

export default function DirectChatScreen(props: DirectChatScreenProps) {
  const model = useDirectChatScreenModel(props);
  return <DirectChatView m={model} />;
}
