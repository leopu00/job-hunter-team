import { useEffect } from "react";
import type { DirectChatEvent } from "./direct-chat-contract";
import { sightAfter } from "./chat-kinds";
import { questionsOf } from "./chat-kinds";
import { sameAsBefore } from "./same-as-before";
import { errorCode, mergeMessages, REOPEN_NO_RETRY, safeCode } from "./direct-chat-screen-helpers";
import type { ChatContext } from "./direct-chat-screen-context";
const REOPEN_TRIES = 3;
const REOPEN_WAIT_MS = 1_500;

async function openConnection(ctx: ChatContext, isActive: () => boolean, onEvent: (event: DirectChatEvent) => void) {
  const { client, setStatus } = ctx;
  // Set when the opening below failed for good: the status the native side gives afterwards is
  // «disconnected» (nothing is open), and it must not cover the reason on the bar.
  let openingFailed = false;
  try {
    let snapshot = await client.status();
    // The chat may open with the connection closed: leaving the Messages page closes it, and a profile
    // imported from the command line brings the person here with nothing opened. The saved host is
    // enough to open it again, with no question to the person: the pane and the page alike.
    for (let attempt = 1; isActive() && snapshot.state === "disconnected"; attempt += 1) {
      setStatus({ state: "connecting" });
      try {
        snapshot = await client.reconnect();
        break;
      } catch (error) {
        const code = errorCode(error);
        if (attempt >= REOPEN_TRIES || (code !== null && REOPEN_NO_RETRY.has(code))) throw error;
        await new Promise((resolve) => setTimeout(resolve, REOPEN_WAIT_MS * attempt));
        if (!isActive()) return;
        // Someone else may have opened it meanwhile (another tab of the same chat).
        snapshot = await client.status();
      }
    }
    if (isActive()) setStatus(snapshot);
  } catch (error) {
    openingFailed = true;
    if (isActive()) setStatus({ state: "error", code: errorCode(error) ?? "status_failed" });
  }
  try {
    const subscribed = await client.subscribe({ onEvent });
    if (isActive() && !(openingFailed && subscribed.state === "disconnected")) setStatus(subscribed);
  } catch (error) {
    if (isActive()) setStatus({ state: "error", code: errorCode(error) ?? "subscribe_failed" });
  }
}

export function useChatConnection(ctx: ChatContext) {
  const { client, embedded, currentAgent, connectionError, setStatus, setOperationError,
    setMessages, setSight, setQuestionsHere, setQuestions } = ctx;
  useEffect(() => {
    let active = true;
    const onEvent = (event: DirectChatEvent) => {
      if (!active) return;
      if (event.kind === "status") {
        setStatus(event.status);
        if (event.status.state === "ready" && connectionError.current) {
          connectionError.current = false;
          setOperationError(null);
        }
      } else if (event.kind === "messages" && event.agentId === currentAgent.current) {
        setMessages((current) => sameAsBefore(current, mergeMessages(current, event.page)));
        setSight((current) => sightAfter(current, event.page.activity));
        if (Array.isArray(event.page.questions)) {
          setQuestionsHere(true);
          setQuestions((current) => sameAsBefore(current, questionsOf(event.page)));
        }
      } else if (event.kind === "error") {
        // The native side says which operation failed: a «ready» ends a failed connection or stream only.
        connectionError.current = event.operation === "connect" || event.operation === "stream";
        setOperationError(safeCode(event.code) ?? "unknown");
      }
    };
    void openConnection(ctx, () => active, onEvent);
    return () => {
      active = false;
      // Embedded panes share the connection with the page around them.
      if (embedded) return;
      try {
        void Promise.resolve(client.close()).catch(() => undefined);
      } catch {
        // The browser preview has no native bridge; unmount must stay quiet.
      }
    };
  }, [client, embedded]);
}

export function connectionActions(ctx: ChatContext) {
  const { client, clearOperationError, setStatus, setReconnecting } = ctx;
  // «Start the team» looks again by itself while the team starts: a try that fails changes nothing on screen (the
  // bar and its button stay), one that works takes the bar away. True: the chat is connected.
  async function readAgain(): Promise<boolean> {
    try {
      const next = await client.reconnect();
      if (next.state !== "ready") return false;
      clearOperationError();
      setStatus(next);
      return true;
    } catch {
      return false;
    }
  }

  async function retry() {
    setReconnecting(true);
    clearOperationError();
    setStatus({ state: "connecting" });
    try {
      setStatus(await client.reconnect());
    } catch (error) {
      setStatus({ state: "error", code: errorCode(error) ?? "reconnect_failed" });
    } finally {
      setReconnecting(false);
    }
  }

  return { readAgain, retry };
}
