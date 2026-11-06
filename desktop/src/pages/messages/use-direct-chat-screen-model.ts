import { useCallback, useEffect, useRef } from "react";
import { DICTATION_LOCALE } from "./direct-chat.i18n";
import { useStickToBottom } from "./stick-to-bottom";
import { useChatState } from "./direct-chat-screen-state";
import type { DirectChatScreenProps } from "./direct-chat-screen-types";
import { useChatNavigation } from "./use-chat-navigation";
import { useChatAttachments, attachmentAction } from "./use-chat-attachments";
import { useChatConnection, connectionActions } from "./use-chat-connection";
import { useChatHistory } from "./use-chat-history";
import { useChatComposerEffects, useChatConversation, useChatCursor } from "./use-chat-conversation";
import { chatActions } from "./use-chat-actions";

export function useDirectChatScreenModel(props: DirectChatScreenProps) {
  const { initialAgentId = "capitano", embedded = false, writeLocked = false } = props;
  const state = useChatState(initialAgentId);
  useChatCursor(state);
  const navigation = useChatNavigation(props, state);
  const attachHere = state.agentId === "assistente" && Boolean(props.client.attach) && Boolean(props.client.attachState);
  const ctx = { ...props, embedded, writeLocked, ...state, ...navigation, attachHere };
  useEffect(() => { state.setAgentId(initialAgentId); }, [initialAgentId]);
  useChatAttachments(ctx);
  useChatConnection(ctx);
  useChatHistory(ctx);
  useChatComposerEffects(ctx);
  const conversation = useChatConversation(ctx);
  const actions = chatActions({ ...ctx, ...conversation });
  const { items, openMenu } = conversation;
  const { send, enterAgain } = actions;
  const lastItem = items.length > 0 ? items[items.length - 1].key : null;
  const bottom = useStickToBottom({ conversation: state.agentId, last: lastItem, count: items.length });
  // Memoized rows keep stable handlers, while every invocation sees the current screen state.
  const handlers = useRef({ openMenu, send, enterAgain });
  handlers.current = { openMenu, send, enterAgain };
  const onMenu = useCallback((id: string, event: { preventDefault(): void; clientX: number; clientY: number }) => handlers.current.openMenu("message", id, event), []);
  const onSend = useCallback((line: string) => void handlers.current.send(line), []);
  const onEnterAgain = useCallback((id: string) => void handlers.current.enterAgain(id), []);
  const { client } = props;
  const { status, sending, text } = state;
  const { agentOff, locale } = navigation;
  const enterAvailable = typeof client.enter === "function" && status.state === "ready" && !writeLocked && !agentOff;
  const suggestionsOff = status.state !== "ready" || writeLocked || agentOff || sending;
  const dateLocale = DICTATION_LOCALE[locale];
  const canSend = status.state === "ready" && !writeLocked && !agentOff && !sending && text.trim().length > 0;
  const composerOff = status.state !== "ready" || sending || writeLocked || agentOff;
  return { ...ctx, ...conversation, ...actions, ...connectionActions(ctx), attachFile: attachmentAction(ctx),
    bottom, onMenu, onSend, onEnterAgain, enterAvailable, suggestionsOff, dateLocale, canSend, composerOff };
}
export type ChatScreenModel = ReturnType<typeof useDirectChatScreenModel>;
