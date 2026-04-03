import { TuiStreamAssembler } from "./tui-stream-assembler.js";
import type { AgentEvent, BtwEvent, ChatEvent, TuiStateAccess } from "./tui-types.js";

export type EventChatLog = {
  startTool: (toolCallId: string, toolName: string, args: unknown) => void;
  updateToolResult: (id: string, result: unknown, opts?: { partial?: boolean; isError?: boolean }) => void;
  addSystem: (text: string) => void;
  updateAssistant: (text: string, runId: string) => void;
  finalizeAssistant: (text: string, runId: string) => void;
  dropAssistant: (runId: string) => void;
};

export type EventHandlerContext = {
  chatLog: EventChatLog;
  btw: { showResult: (p: { question: string; text: string; isError?: boolean }) => void; clear: () => void };
  tui: { requestRender: () => void };
  state: TuiStateAccess;
  setActivityStatus: (text: string) => void;
  loadHistory?: () => Promise<void>;
  noteLocalRunId?: (runId: string) => void;
  isLocalRunId?: (runId: string) => boolean;
  forgetLocalRunId?: (runId: string) => void;
  clearLocalRunIds?: () => void;
  isLocalBtwRunId?: (runId: string) => boolean;
  forgetLocalBtwRunId?: (runId: string) => void;
  clearLocalBtwRunIds?: () => void;
};

function isSameSessionKey(a: string | undefined, b: string | undefined): boolean {
  const na = (a ?? "").trim().toLowerCase();
  const nb = (b ?? "").trim().toLowerCase();
  return !!na && !!nb && na === nb;
}

function isCommandMessage(msg: unknown): boolean {
  if (!msg || typeof msg !== "object") return false;
  const r = msg as Record<string, unknown>;
  return r.type === "command" || r.kind === "command";
}

function extractTextFromMessage(msg: unknown): string {
  if (!msg || typeof msg !== "object") return "";
  const r = msg as Record<string, unknown>;
  if (typeof r.text === "string") return r.text.trim();
  if (typeof r.content === "string") return r.content.trim();
  return "";
}

export function createEventHandlers(context: EventHandlerContext) {
  const { chatLog, btw, tui, state, setActivityStatus, loadHistory,
    noteLocalRunId, isLocalRunId, forgetLocalRunId, clearLocalRunIds,
    isLocalBtwRunId, forgetLocalBtwRunId, clearLocalBtwRunIds } = context;

  const finalizedRuns = new Map<string, number>();
  const sessionRuns = new Map<string, number>();
  let streamAssembler = new TuiStreamAssembler();
  let lastSessionKey = state.currentSessionKey;
  let pendingHistoryRefresh = false;

  const pruneMap = (runs: Map<string, number>) => {
    if (runs.size <= 200) return;
    const limit = Date.now() - 10 * 60 * 1000;
    for (const [k, ts] of runs) { if (runs.size <= 150) break; if (ts < limit) runs.delete(k); }
    if (runs.size > 200) { for (const k of runs.keys()) { runs.delete(k); if (runs.size <= 150) break; } }
  };

  const syncSession = () => {
    if (state.currentSessionKey === lastSessionKey) return;
    lastSessionKey = state.currentSessionKey;
    finalizedRuns.clear(); sessionRuns.clear();
    streamAssembler = new TuiStreamAssembler();
    pendingHistoryRefresh = false; state.pendingOptimisticUserMessage = false;
    clearLocalRunIds?.(); clearLocalBtwRunIds?.(); btw.clear();
  };

  const flushHistoryIfIdle = () => {
    if (!pendingHistoryRefresh || state.activeChatRunId) return;
    pendingHistoryRefresh = false; void loadHistory?.();
  };

  const noteRun = (id: string) => { sessionRuns.set(id, Date.now()); pruneMap(sessionRuns); };
  const finalizeRun = (id: string) => { finalizedRuns.set(id, Date.now()); sessionRuns.delete(id); streamAssembler.drop(id); pruneMap(finalizedRuns); };
  const clearActiveIfMatch = (id: string) => { if (state.activeChatRunId === id) state.activeChatRunId = null; };
  const hasConcurrentRun = (id: string) => { const a = state.activeChatRunId; return !!a && a !== id && sessionRuns.has(a); };

  const maybeRefreshHistory = (id: string, opts?: { allowLocal?: boolean }) => {
    const isLocal = isLocalRunId?.(id) ?? false;
    if (isLocal) {
      forgetLocalRunId?.(id);
      if (!opts?.allowLocal) return;
      if (state.activeChatRunId && state.activeChatRunId !== id) { pendingHistoryRefresh = true; return; }
    }
    if (hasConcurrentRun(id)) return;
    pendingHistoryRefresh = false; void loadHistory?.();
  };

  const endRun = (id: string, wasActive: boolean, status: "idle" | "error") => {
    finalizeRun(id); clearActiveIfMatch(id); flushHistoryIfIdle();
    if (wasActive) setActivityStatus(status);
  };

  const abortRun = (id: string, wasActive: boolean, status: "aborted" | "error") => {
    streamAssembler.drop(id); sessionRuns.delete(id); clearActiveIfMatch(id); flushHistoryIfIdle();
    if (wasActive) setActivityStatus(status);
  };

  const handleAgentEvent = (payload: unknown) => {
    if (!payload || typeof payload !== "object") return;
    const evt = payload as AgentEvent;
    syncSession();
    const isActive = evt.runId === state.activeChatRunId;
    const isKnown = isActive || sessionRuns.has(evt.runId) || finalizedRuns.has(evt.runId);
    if (!isKnown) return;
    if (evt.stream === "tool") {
      const verbose = state.sessionInfo.verboseLevel ?? "off";
      if (verbose === "off") return;
      const data = evt.data ?? {};
      const phase = typeof data.phase === "string" ? data.phase : "";
      const toolCallId = typeof data.toolCallId === "string" ? data.toolCallId : "";
      const toolName = typeof data.name === "string" ? data.name : "tool";
      if (!toolCallId) return;
      if (phase === "start") chatLog.startTool(toolCallId, toolName, data.args);
      else if (phase === "update" && verbose === "full") chatLog.updateToolResult(toolCallId, data.partialResult, { partial: true });
      else if (phase === "result") chatLog.updateToolResult(toolCallId, data.result, { isError: Boolean(data.isError) });
      tui.requestRender(); return;
    }
    if (evt.stream === "lifecycle" && isActive) {
      const phase = typeof evt.data?.phase === "string" ? evt.data.phase : "";
      if (phase === "start") setActivityStatus("running");
      else if (phase === "end") setActivityStatus("idle");
      else if (phase === "error") setActivityStatus("error");
      tui.requestRender();
    }
  };

  const handleBtwEvent = (payload: unknown) => {
    if (!payload || typeof payload !== "object") return;
    const evt = payload as BtwEvent;
    syncSession();
    if (!isSameSessionKey(evt.sessionKey, state.currentSessionKey) || evt.kind !== "btw") return;
    const question = evt.question.trim(); const text = evt.text.trim();
    if (!question || !text) return;
    btw.showResult({ question, text, isError: evt.isError }); tui.requestRender();
  };

  const handleChatEvent = (_payload: unknown) => { /* implementato nel prossimo commit */ };

  return { handleChatEvent, handleAgentEvent, handleBtwEvent };
}
