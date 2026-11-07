import { useEffect } from "react";
import { NOT_WORKING, questionsOf, settleQueued, sightAfter } from "./chat-kinds";
import { sameAsBefore } from "./same-as-before";
import { errorCode, mergeMessages } from "./direct-chat-screen-helpers";
import type { ChatContext } from "./direct-chat-screen-context";

const HISTORY_POLL_MS = 1_500;
// When every read is a new ssh connection (Windows to a VPS: no ControlMaster there), each read
// counts against the server's limits on new connections. So the page reads every 10 s, every 2 s for
// the 30 s after the person sends, not at all while the window is hidden or not focused (one read
// as soon as it is back), and after `ssh_rate_limited` it waits twice as long each time, up to 60 s,
// until a read gets through.
const SLOW_LINK_IDLE_MS = 10_000;
const SLOW_LINK_AFTER_SEND_MS = 2_000;
const AFTER_SEND_FAST_MS = 30_000;
const RATE_LIMITED_MAX_MS = 60_000;

type HistoryRun = { active: boolean; reading: boolean; cursor?: string };
function createHistoryReader(ctx: ChatContext, run: HistoryRun) {
  const { client, agentId, slowLink, setLoading, setMessages, setSight, setOutcomes,
    setQuestionsHere, setQuestions, sendError, setOperationError, failOperation } = ctx;
  // The failure code of the read, null when it got through, undefined when it did not run.
  async function readHistory(initial: boolean): Promise<string | null | undefined> {
    if (!run.active || run.reading) return undefined;
    run.reading = true;
    if (initial) setLoading(true);
    try {
      // The native bridge returns the latest bounded page. Re-read it in full
      // and merge by id: its historical cursor skips the first appended line. On a slow
      // link the cursor goes back, and the native side reads from before it.
      const page = await client.read(slowLink && run.cursor ? { agentId, cursor: run.cursor } : { agentId });
      if (!run.active) return undefined;
      if (slowLink) run.cursor = page.cursor;
      setMessages((current) => sameAsBefore(current, mergeMessages(current, page)));
      setSight((current) => sightAfter(current, page.activity));
      // a turn the team held back while its agent worked takes the ending the page reports for it
      if (Array.isArray(page.settled)) setOutcomes((current) => settleQueued(current, page.settled));
      // a page that brings the questions replaces them; one without the field (an older image)
      // leaves the chat without answers
      if (Array.isArray(page.questions)) {
        setQuestionsHere(true);
        setQuestions((current) => sameAsBefore(current, questionsOf(page)));
      }
      if (!sendError.current) setOperationError(null);
      return null;
    } catch (error) {
      const code = errorCode(error) ?? "read_failed";
      if (run.active) failOperation(code);
      return code;
    } finally {
      run.reading = false;
      if (run.active && initial) setLoading(false);
    }
  }

  return readHistory;
}
function watchWindow(windowChanged: () => void, onFocus: () => void, onBlur: () => void) {
  document.addEventListener("visibilitychange", windowChanged);
  window.addEventListener("focus", onFocus);
  window.addEventListener("blur", onBlur);
  return () => {
    document.removeEventListener("visibilitychange", windowChanged);
    window.removeEventListener("focus", onFocus);
    window.removeEventListener("blur", onBlur);
  };
}
function startHistory(ctx: ChatContext) {
  const { slowLink, lastSentAt, readSoon } = ctx;
  const run: HistoryRun = { active: true, reading: false };
  const readHistory = createHistoryReader(ctx, run);
  let timer: ReturnType<typeof setTimeout> | undefined;
  // Slow link only: the wait after ssh_rate_limited (0: none). Whether the window can be seen counts on every link.
  let backoff = 0;
  let visible = document.visibilityState !== "hidden";
  let focused = true;
  let waitingForWindow = false;
  // A window that cannot be seen reads nothing, on any link; only the slow link also waits for the focus.
  const paused = () => (slowLink ? !(visible && focused) : !visible);
  const pace = () => {
    if (!slowLink) return HISTORY_POLL_MS;
    return Date.now() - lastSentAt.current > AFTER_SEND_FAST_MS ? SLOW_LINK_IDLE_MS : SLOW_LINK_AFTER_SEND_MS;
  };
  const delay = () => (slowLink && backoff ? backoff : pace());
  const tick = async () => {
    if (paused()) {
      waitingForWindow = true;
      return;
    }
    settle(await readHistory(false));
  };
  // After a read: the next one at the pace, or later and later while the server turns this computer away:
  // 20, 40, then 60 s, from the idle pace even right after a send.
  const settle = (failed: string | null | undefined) => {
    if (!run.active) return;
    if (slowLink && failed !== undefined) {
      backoff = failed === "ssh_rate_limited" ? Math.min(RATE_LIMITED_MAX_MS, (backoff || SLOW_LINK_IDLE_MS) * 2) : failed ? backoff : 0;
    }
    schedule(delay());
  };
  const schedule = (after: number) => {
    clearTimeout(timer);
    timer = setTimeout(() => void tick(), after);
  };
  const windowChanged = () => {
    visible = document.visibilityState !== "hidden";
    if (waitingForWindow && !paused()) {
      waitingForWindow = false;
      // back in view: a read now, unless the server is turning this computer away
      schedule(backoff ? backoff : 0);
    }
  };
  const onFocus = () => {
    focused = true;
    windowChanged();
  };
  const onBlur = () => {
    focused = false;
  };
  const unlisten = watchWindow(windowChanged, onFocus, onBlur);
  readSoon.current = () => schedule(delay());
  schedule(delay());
  // the first read keeps the pace set at mount; only a refused one pushes the next read back
  void readHistory(true).then((failed) => {
    if (slowLink && failed === "ssh_rate_limited") settle(failed);
  });
  return () => {
    run.active = false;
    readSoon.current = null;
    clearTimeout(timer);
    unlisten();
  };
}
export function useChatHistory(ctx: ChatContext) {
  const { client, agentId, historyOf, setMessages, setQuestions, setQuestionsHere,
    setAnswersInFlight, setReplyTo, setMenu, setOutcomes, setSight, setPressing,
    clearOperationError, setLoading, status, slowLink } = ctx;
  useEffect(() => {
    if (historyOf.current?.client !== client || historyOf.current.agentId !== agentId) {
      historyOf.current = { client, agentId };
      setMessages([]);
    }
    setQuestions([]);
    setQuestionsHere(false);
    setAnswersInFlight(new Map());
    setReplyTo(null);
    setMenu(null);
    setOutcomes(new Map());
    setSight(NOT_WORKING);
    setPressing(null);
    clearOperationError();
    setLoading(false);
    if (status.state !== "ready") return;

    return startHistory(ctx);
  }, [agentId, client, status.state, slowLink]);
}
