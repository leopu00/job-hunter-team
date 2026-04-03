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

  const HELP = `commands:\n  /status  — gateway status\n  /stop    — interrompi run attivo\n  /new     — nuova sessione\n  /agent [id] — mostra o cambia agente\n  /agents  — lista agenti\n  /help    — mostra aiuto`.trim();

  const handleCommand = async (raw: string) => {
    const { name, args } = parseCommand(raw);
    if (!name) return;
    switch (name) {
      case "help":
        chatLog.addSystem(HELP); break;

      case "status":
        try { const s = await client.getStatus(); for (const l of formatStatus(s)) chatLog.addSystem(l); }
        catch (err) { chatLog.addSystem(`status fallito: ${String(err)}`); }
        break;

      case "stop": case "abort":
        if (!state.activeChatRunId) { chatLog.addSystem("nessun run attivo"); break; }
        try { await client.abortRun(state.currentSessionKey); chatLog.addSystem("run interrotto"); }
        catch (err) { chatLog.addSystem(`stop fallito: ${String(err)}`); }
        break;

      case "new":
        try {
          const key = `jht-${randomUUID()}`;
          state.currentSessionKey = key; chatLog.addSystem(`nuova sessione: ${key}`);
        } catch (err) { chatLog.addSystem(`nuova sessione fallita: ${String(err)}`); }
        break;

      case "agent":
        if (!args) { chatLog.addSystem(`agente attivo: ${state.currentAgentId}`); }
        else { state.currentAgentId = args.trim().toLowerCase(); chatLog.addSystem(`agente: ${state.currentAgentId}`); }
        break;

      case "agents":
        try {
          await refreshAgents();
          if (state.agents.length === 0) { chatLog.addSystem("nessun agente"); break; }
          for (const a of state.agents) {
            const marker = a.id === state.currentAgentId ? " ◀" : "";
            chatLog.addSystem(`  ${a.id} (${a.name})${marker}`);
          }
        } catch (err) { chatLog.addSystem(`agenti fallito: ${String(err)}`); }
        break;

      default:
        await sendMessage(raw); return;
    }
    requestRender();
  };

  return { handleCommand, sendMessage };
}
