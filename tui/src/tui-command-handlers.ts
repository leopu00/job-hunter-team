import { randomUUID } from "node:crypto";
import type { ChatOptions, JhtAgent, TuiStateAccess } from "./tui-types.js";

export type JhtChatClient = {
  sendChat: (params: {
    sessionKey: string;
    message: string;
    thinking?: string;
    deliver?: boolean;
    timeoutMs?: number;
    runId: string;
  }) => Promise<void>;
  getStatus: () => Promise<unknown>;
  abortRun: (sessionKey: string) => Promise<void>;
  listAgents: () => Promise<JhtAgent[]>;
};

type CommandChatLog = {
  addSystem: (text: string) => void;
  addUser: (text: string) => void;
};

export type CommandHandlerContext = {
  client: JhtChatClient;
  chatLog: CommandChatLog;
  opts: ChatOptions;
  state: TuiStateAccess;
  setActivityStatus: (text: string) => void;
  refreshAgents: () => Promise<void>;
  requestRender: () => void;
  noteLocalRunId?: (runId: string) => void;
  forgetLocalRunId?: (runId: string) => void;
};

function parseCommand(input: string): { name: string; args: string } {
  const trimmed = input.replace(/^\//, "").trim();
  if (!trimmed) return { name: "", args: "" };
  const [name, ...rest] = trimmed.split(/\s+/);
  return { name: (name ?? "").toLowerCase(), args: rest.join(" ").trim() };
}

function formatStatus(status: unknown): string[] {
  if (typeof status === "string") return [status];
  if (!status || typeof status !== "object") return ["status: no data"];
  const r = status as Record<string, unknown>;
  const lines: string[] = [];
  if (r.runtimeVersion) lines.push(`version: ${r.runtimeVersion}`);
  if (r.isConnected !== undefined) lines.push(`connected: ${r.isConnected}`);
  if (r.activeRuns !== undefined) lines.push(`active runs: ${r.activeRuns}`);
  return lines.length > 0 ? lines : ["status: ok"];
}

export function createCommandHandlers(context: CommandHandlerContext) {
  const { client, chatLog, opts, state, setActivityStatus, refreshAgents, requestRender,
    noteLocalRunId, forgetLocalRunId } = context;

  const sendMessage = async (text: string) => {
    if (!state.isConnected) {
      chatLog.addSystem("non connesso al gateway — messaggio non inviato");
      setActivityStatus("disconnected"); requestRender(); return;
    }
    const runId = randomUUID();
    chatLog.addUser(text); state.pendingOptimisticUserMessage = true;
    setActivityStatus("sending"); requestRender();
    try {
      noteLocalRunId?.(runId);
      await client.sendChat({ sessionKey: state.currentSessionKey, message: text,
        thinking: opts.thinking, deliver: opts.deliver, timeoutMs: opts.timeoutMs, runId });
      setActivityStatus("waiting");
    } catch (err) {
      forgetLocalRunId?.(runId); state.pendingOptimisticUserMessage = false;
      state.activeChatRunId = null;
      chatLog.addSystem(`invio fallito: ${String(err)}`); setActivityStatus("error");
    }
    requestRender();
  };

  const handleCommand = async (raw: string) => { /* implementato nel prossimo commit */ void raw; };

  return { handleCommand, sendMessage };
}
