import { useEffect, useLayoutEffect, useMemo } from "react";
import type { DirectChatMessage, DirectChatQuestion } from "./direct-chat-contract";
import { transcript as conversationItems, dayKey } from "./chat-kinds";
import { groupRepeatedMessages } from "./direct-chat-screen-helpers";
import { withoutAttachmentPath } from "./chat-line-text";
import type { ChatState } from "./direct-chat-screen-state";
import type { ChatContext } from "./direct-chat-screen-context";
const UNANSWERED_AFTER_S = 600;

function answeredMessages(messages: DirectChatMessage[]) {
  const answered = new Set<string>();
  let newestAgent = 0;
  for (const message of messages) if (message.role === "agent" && message.at > newestAgent) newestAgent = message.at;
  for (const message of messages) if (message.role === "user" && message.at < newestAgent) answered.add(message.id);
  return answered;
}
function unansweredMessages(messages: DirectChatMessage[], agentOff: boolean) {
  const unanswered = new Set<string>();
  let newestAgent = 0;
  for (const message of messages) if (message.role === "agent" && message.at > newestAgent) newestAgent = message.at;
  const old = Date.now() / 1000 - UNANSWERED_AFTER_S;
  for (const message of messages) if (message.role === "user" && message.at >= newestAgent && (agentOff || message.at < old)) unanswered.add(message.id);
  return unanswered;
}
export function useChatComposerEffects(ctx: ChatContext) {
  const { questions, setAnswersInFlight, menu, setMenu } = ctx;
  // a read closed a question the person answered here: its own account replaces the local one
  useEffect(() => {
    setAnswersInFlight((current) => {
      if (current.size === 0) return current;
      const next = new Map(current);
      for (const question of questions) if (question.state !== "open") next.delete(question.id);
      return next.size === current.size ? current : next;
    });
  }, [questions]);

  useEffect(() => {
    if (!menu) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenu(null);
    };
    const close = () => setMenu(null);
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", close);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("blur", close);
    };
  }, [menu]);

}
export function useChatConversation(ctx: ChatContext) {
  const { status, writeLocked, questionsHere, client, questions, answersInFlight, messages,
    agentOff, replyTo, setMenu, setReplyTo, setAnswerRefusal, composer } = ctx;
  const canAnswer = status.state === "ready" && !writeLocked && questionsHere && typeof client.answer === "function";
  const shownQuestions = useMemo(
    () =>
      questions.map((question) => {
        const local = question.state === "open" ? answersInFlight.get(question.id) : undefined;
        return local ? { ...question, state: "answered" as const, answer: local } : question;
      }),
    [questions, answersInFlight],
  );
  const items = useMemo(() => groupRepeatedMessages(conversationItems(messages, shownQuestions)), [messages, shownQuestions]);

  const answeredIds = useMemo(() => answeredMessages(messages), [messages]);
  const unansweredIds = useMemo(() => unansweredMessages(messages, agentOff), [messages, agentOff]);
  const newDays = useMemo(() => items.map((item, index) => index === 0 || dayKey(items[index - 1].at) !== dayKey(item.at)), [items]);

  // What the composer replies to now: gone from the view, it is nothing; an open question that
  // takes words is answered with them; a closed one, or a message, is quoted.
  function replyTarget():
    | { kind: "question"; question: DirectChatQuestion; words: boolean; text: string }
    | { kind: "message"; text: string }
    | null {
    if (!replyTo) return null;
    if (replyTo.kind === "question") {
      const question = shownQuestions.find((q) => q.id === replyTo.id);
      if (!question) return null;
      return { kind: "question", question, words: question.state === "open" && question.free && canAnswer, text: question.subject || question.text };
    }
    const message = messages.find((m) => m.id === replyTo.id);
    return message ? { kind: "message", text: message.role === "user" ? withoutAttachmentPath(message.text) : message.text } : null;
  }
  const target = replyTarget();

  function openMenu(kind: "message" | "question", id: string, event: { preventDefault(): void; clientX: number; clientY: number }) {
    if (writeLocked) return;
    event.preventDefault();
    setMenu({ kind, id, x: event.clientX, y: event.clientY });
  }

  function replyFromMenu(kind: "message" | "question", id: string) {
    setMenu(null);
    setReplyTo({ kind, id });
    setAnswerRefusal(null);
    // the person writes next: the cursor goes in the box
    composer.current?.focus();
  }

  return { canAnswer, shownQuestions, items, answeredIds, unansweredIds, newDays,
    replyTarget, target, openMenu, replyFromMenu };
}
export type ChatConversation = ReturnType<typeof useChatConversation>;

export function useChatCursor(ctx: ChatState) {
  const { cursorAfterNewLine, composer, text } = ctx;
  useLayoutEffect(() => {
    const cursor = cursorAfterNewLine.current;
    if (cursor === null) return;
    cursorAfterNewLine.current = null;
    composer.current?.setSelectionRange(cursor, cursor);
  }, [text]);

}
