import type { ChatState } from "./direct-chat-screen-state";
import type { DirectChatScreenProps } from "./direct-chat-screen-types";
import type { useChatNavigation } from "./use-chat-navigation";

export type ChatContext = ChatState & DirectChatScreenProps & ReturnType<typeof useChatNavigation>;
