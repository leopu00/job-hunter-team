import { useRef, useState } from "react";
import type { DirectChatAnswer, DirectChatMessage, DirectChatQuestion, DirectChatStatus } from "./direct-chat-contract";
import { NOT_WORKING, type Outcome, type WorkingSight } from "./chat-kinds";

function useConnectionState() {
  const [status, setStatus] = useState<DirectChatStatus>({ state: "connecting" });
  const [loading, setLoading] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [operationError, setOperationError] = useState<string | null>(null);
  // A ready event ends only a connection failure; reads cannot dismiss a failed send.
  const connectionError = useRef(false);
  const sendError = useRef(false);
  const lastSentAt = useRef(0);
  const readSoon = useRef<(() => void) | null>(null);
  const historyOf = useRef<{ client: unknown; agentId: string } | null>(null);
  return { status, setStatus, loading, setLoading, reconnecting, setReconnecting,
    operationError, setOperationError, connectionError, sendError, lastSentAt, readSoon, historyOf };
}

function useConversationState() {
  const [messages, setMessages] = useState<DirectChatMessage[]>([]);
  const [questions, setQuestions] = useState<DirectChatQuestion[]>([]);
  const [questionsHere, setQuestionsHere] = useState(false);
  // Local answers keep a question closed until the team's next read acknowledges it.
  const [answersInFlight, setAnswersInFlight] = useState<ReadonlyMap<string, DirectChatAnswer>>(() => new Map());
  const [outcomes, setOutcomes] = useState<ReadonlyMap<string, Outcome>>(() => new Map());
  const [pressing, setPressing] = useState<string | null>(null);
  const [sight, setSight] = useState<WorkingSight>(NOT_WORKING);
  const [inFlight, setInFlight] = useState<string | null>(null);
  return { messages, setMessages, questions, setQuestions, questionsHere, setQuestionsHere,
    answersInFlight, setAnswersInFlight, outcomes, setOutcomes, pressing, setPressing,
    sight, setSight, inFlight, setInFlight };
}

function useComposerState() {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [answerRefusal, setAnswerRefusal] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<{ kind: "message" | "question"; id: string } | null>(null);
  const [menu, setMenu] = useState<{ kind: "message" | "question"; id: string; x: number; y: number } | null>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const cursorAfterNewLine = useRef<number | null>(null);
  const [attachState, setAttachState] = useState<{ available: boolean; code?: string } | null>(null);
  const [attaching, setAttaching] = useState(false);
  const [attachNote, setAttachNote] = useState<{ kind: "warn" | "error"; text: string } | null>(null);
  return { text, setText, sending, setSending, answerRefusal, setAnswerRefusal, replyTo, setReplyTo,
    menu, setMenu, composer, cursorAfterNewLine, attachState, setAttachState,
    attaching, setAttaching, attachNote, setAttachNote };
}

/** These hooks run in the screen: switching a presentation tab never remounts its state. */
export function useChatState(initialAgentId: string) {
  const [agentId, setAgentId] = useState(initialAgentId);
  const currentAgent = useRef(agentId);
  currentAgent.current = agentId;
  const state = { agentId, setAgentId, currentAgent, ...useConnectionState(), ...useConversationState(), ...useComposerState() };
  const clearOperationError = () => {
    state.sendError.current = false;
    state.setOperationError(null);
  };
  const failOperation = (code: string) => {
    state.connectionError.current = false;
    state.sendError.current = false;
    state.setOperationError(code === "agent_not_running" && agentId === "mentor" ? "mentor_not_active" : code);
  };
  return { ...state, clearOperationError, failOperation };
}
export type ChatState = ReturnType<typeof useChatState>;
