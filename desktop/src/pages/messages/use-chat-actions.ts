import { ENTER_AGAIN_MAX, outcomeOf, quoteLine } from "./chat-kinds";
import type { DirectChatMessage } from "./direct-chat-contract";
import { clientMessageId, errorCode, mergeMessages } from "./direct-chat-screen-helpers";
import type { ChatContext } from "./direct-chat-screen-context";
import type { ChatConversation } from "./use-chat-conversation";

type ActionContext = ChatContext & ChatConversation;
type Answer = (questionId: string, choices: string[], words: string | null) => Promise<string | null>;
function createAnswer(ctx: ActionContext) {
  const { canAnswer, client, t, agentId, setAnswersInFlight, readSoon, failOperation } = ctx;
  // The answer to one of the agent's questions: the question closes with the choice as soon as the
  // team took it; the next read brings the team's own account of it.
  async function answer(questionId: string, choices: string[], words: string | null): Promise<string | null> {
    if (!canAnswer || !client.answer) return t.answerErrors.answer_failed;
    try {
      const receipt = await client.answer({ agentId, questionId, choices, text: words });
      setAnswersInFlight((current) =>
        new Map(current).set(questionId, { choices, ...(words ? { text: words } : {}), at: receipt.at, origin: "user", seenAt: null }),
      );
      readSoon.current?.();
      return null;
    } catch (error) {
      const code = errorCode(error);
      // answered elsewhere: the next read brings the team's account of it
      if (code === "question_closed") readSoon.current?.();
      if (code && Object.prototype.hasOwnProperty.call(t.answerErrors, code)) {
        return t.answerErrors[code as keyof typeof t.answerErrors];
      }
      // why the chat could not take it (an older image, the read-only link, a fallen connection): the
      // status bar says it with the app's sentence, the card that the answer did not go
      if (code) failOperation(code);
      return t.answerErrors.answer_failed;
    }
  }
  return answer;
}
function createSend(ctx: ActionContext, answer: Answer) {
  const { text, sending, writeLocked, agentOff, status, replyTarget, setSending,
    clearOperationError, setText, setReplyTo, setAnswerRefusal, t, setAttachNote,
    setInFlight, lastSentAt, readSoon, setMessages, client, agentId, setOutcomes,
    failOperation, sendError } = ctx;
  // `suggested`: a reply the agent suggested, sent as it is (the composer keeps what was typed).
  async function send(suggested?: string) {
    const typed = (suggested ?? text).trim();
    if (!typed || sending || writeLocked || agentOff || status.state !== "ready") return;
    const target = suggested === undefined ? replyTarget() : null;
    if (target?.kind === "question" && target.words) {
      // the words are the answer to the open question, not a message in the agent's terminal
      setSending(true);
      clearOperationError();
      const refusal = await answer(target.question.id, [], typed);
      setSending(false);
      if (refusal === null) {
        setText("");
        setReplyTo(null);
      } else {
        setAnswerRefusal(`${refusal} ${t.answerTextKept}`);
      }
      return;
    }
    const body = target ? `${quoteLine(t.quotePrefix, target.text)}\n${typed}` : typed;
    if (suggested === undefined) setReplyTo(null);
    setAnswerRefusal(null);
    // the line under the composer was about the last attachment: once the person writes, it goes
    setAttachNote(null);
    const id = clientMessageId();
    // in seconds, as the team's times: the receipt's time replaces it
    const optimistic: DirectChatMessage = { id, role: "user", text: body, at: Date.now() / 1000 };
    if (suggested === undefined) setText("");
    setSending(true);
    setInFlight(id);
    lastSentAt.current = Date.now();
    readSoon.current?.();
    clearOperationError();
    setMessages((current) => mergeMessages(current, { messages: [optimistic] }));
    try {
      const receipt = await client.send({ agentId, text: body, clientMessageId: id });
      setMessages((current) =>
        current.map((message) =>
          message.id === receipt.clientMessageId
            ? { ...message, id: receipt.messageId, at: receipt.at }
            : message,
        ),
      );
      setOutcomes((current) => new Map(current).set(receipt.messageId, outcomeOf(receipt, 0)));
    } catch (error) {
      // Not delivered: the words go back to the composer, and the status bar says why.
      setMessages((current) => current.filter((message) => message.id !== id));
      // what was typed goes back to the composer; a suggestion leaves the composer as it is
      if (suggested === undefined) setText(typed);
      failOperation(errorCode(error) ?? "send_failed");
      sendError.current = true;
    } finally {
      setSending(false);
      setInFlight(null);
    }
  }

  return send;
}
function createEnterAgain(ctx: ActionContext) {
  const { outcomes, client, pressing, writeLocked, status, setPressing,
    clearOperationError, agentId, setOutcomes, failOperation } = ctx;
  // Enter once more on a text left in the agent's composer: never the text, and only a few times.
  async function enterAgain(messageId: string) {
    const before = outcomes.get(messageId);
    if (!client.enter || pressing || before?.kind !== "notSent" || before.presses >= ENTER_AGAIN_MAX) return;
    if (writeLocked || status.state !== "ready") return;
    setPressing(messageId);
    clearOperationError();
    try {
      const receipt = await client.enter({ agentId, messageId });
      setOutcomes((current) => new Map(current).set(messageId, outcomeOf(receipt, before.presses + 1)));
    } catch (error) {
      failOperation(errorCode(error) ?? "send_failed");
    } finally {
      setPressing(null);
    }
  }

  return enterAgain;
}
export function chatActions(ctx: ActionContext) {
  const answer = createAnswer(ctx);
  return { answer, send: createSend(ctx, answer), enterAgain: createEnterAgain(ctx) };
}
