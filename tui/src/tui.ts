/**
 * JHT TUI — Terminal UI collegata ad Anthropic API.
 * Chat funzionante end-to-end: input → LLM streaming → risposta nel pannello.
 */
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { Key, matchesKey, ProcessTerminal, Text, TUI } from "@mariozechner/pi-tui";
import { createJhtLayout } from "./tui-layout.js";
import { ChatPanel } from "./components/chat-panel.js";
import { createTuiClient } from "./tui-client.js";
import { createCommandHandlers } from "./tui-command-handlers.js";
import { createEventHandlers } from "./tui-event-handlers.js";
import type { JhtAgent, JhtTuiState, TuiStateAccess, SessionInfo } from "./tui-types.js";

function countActiveTmuxSessions(): number {
  try {
    const r = spawnSync("tmux", ["list-sessions", "-F", "#{session_name}"], { encoding: "utf-8", timeout: 1000 });
    if (r.status !== 0 || !r.stdout) return 0;
    return r.stdout.split("\n").filter(s => s.startsWith("JHT-")).length;
  } catch { return 0; }
}

const KNOWN_AGENTS: JhtAgent[] = [
  { id: "scout", name: "scout", role: "scout", status: "idle" },
  { id: "analista", name: "analista", role: "analista", status: "idle" },
  { id: "assistente", name: "assistente", role: "assistente", status: "idle" },
  { id: "critico", name: "critico", role: "critico", status: "idle" },
  { id: "scorer", name: "scorer", role: "scorer", status: "idle" },
  { id: "scrittore", name: "scrittore", role: "scrittore", status: "idle" },
  { id: "sentinella", name: "sentinella", role: "sentinella", status: "idle" },
  { id: "alfa", name: "alfa", role: "alfa", status: "idle" },
];

export async function runJhtTui() {
  // Stato completo (TuiStateAccess)
  const sessionInfo: SessionInfo = { model: "claude-sonnet-4" };
  const state: JhtTuiState & TuiStateAccess = {
    agents: KNOWN_AGENTS,
    selectedAgentId: KNOWN_AGENTS[0]?.id ?? null,
    messages: [],
    connectionStatus: "connected",
    activityStatus: "idle",
    toolsExpanded: false,
    isConnected: true,
    activeTmuxCount: countActiveTmuxSessions(),
    currentAgentId: "assistente",
    currentSessionKey: `jht-${randomUUID()}`,
    activeChatRunId: null,
    pendingOptimisticUserMessage: false,
    historyLoaded: false,
    sessionInfo,
    showThinking: false,
  };

  const tui = new TUI(new ProcessTerminal());
  const layout = createJhtLayout(tui);
  const chatPanel = new ChatPanel();

  // Sostituisci placeholder con ChatPanel reale
  layout.chatPanelSlot.clear();
  layout.chatPanelSlot.addChild(chatPanel);

  // Input line in fondo
  const inputLine = new Text("", 0, 0);
  let inputBuffer = "";
  const updateInputLine = () => {
    const prompt = state.activityStatus === "streaming" ? "  ..." : "  > ";
    inputLine.setText(`\x1b[32m${prompt}\x1b[0m${inputBuffer}\x1b[2m█\x1b[0m`);
  };
  layout.root.addChild(inputLine);
  updateInputLine();

  tui.addChild(layout.root);
  layout.agentList.setAgents(state.agents);
  layout.agentList.setSelectedAgent(state.selectedAgentId);
  layout.updateHeader(state);
  layout.updateStatusBar(state);

  // Crea client Anthropic
  let client: ReturnType<typeof createTuiClient>;
  try {
    client = createTuiClient((evt) => eventHandlers.handleChatEvent(evt));
    chatPanel.addSystem("Connesso ad Anthropic API. Scrivi un messaggio e premi Enter.");
  } catch (err) {
    chatPanel.addSystem(`Errore: ${String((err as Error).message)}`);
    chatPanel.addSystem("Imposta ANTHROPIC_API_KEY per utilizzare la chat.");
    state.isConnected = false;
    state.connectionStatus = "disconnected";
    layout.updateHeader(state);
    // Client dummy per evitare crash
    client = { sendChat: async () => {}, getStatus: async () => ({}), abortRun: async () => {}, listAgents: async () => [], history: [] } as any;
  }

  const setActivityStatus = (s: string) => { state.activityStatus = s; layout.updateStatusBar(state); updateInputLine(); };

  // Event handlers (gestisce streaming, finalize, errori)
  const eventHandlers = createEventHandlers({
    chatLog: chatPanel,
    btw: { showResult: (p) => chatPanel.addSystem(`[btw] ${p.question}: ${p.text}`), clear: () => {} },
    tui: { requestRender: () => tui.requestRender() },
    state,
    setActivityStatus,
  });

  // Command handlers (gestisce /status, /stop, /new, /help, e messaggi)
  const { handleCommand, sendMessage } = createCommandHandlers({
    client,
    chatLog: chatPanel,
    opts: {},
    state,
    setActivityStatus,
    refreshAgents: async () => { state.agents = await client.listAgents(); layout.agentList.setAgents(state.agents); },
    requestRender: () => tui.requestRender(),
  });

  let exitRequested = false;
  const requestExit = () => { if (exitRequested) return; exitRequested = true; try { tui.stop(); } catch {} process.exit(0); };

  // Input handling
  tui.addInputListener((data) => {
    // Enter — invia messaggio
    if (matchesKey(data, Key.enter) || matchesKey(data, Key.return)) {
      const text = inputBuffer.trim();
      if (text) {
        inputBuffer = "";
        updateInputLine();
        tui.requestRender();
        if (text.startsWith("/")) void handleCommand(text);
        else void sendMessage(text);
      }
      return { consume: true };
    }
    // Backspace
    if (matchesKey(data, Key.backspace) || matchesKey(data, Key.delete)) {
      if (inputBuffer.length > 0) { inputBuffer = inputBuffer.slice(0, -1); updateInputLine(); tui.requestRender(); }
      return { consume: true };
    }
    // Ctrl+C — esci
    if (matchesKey(data, Key.ctrl("c"))) { requestExit(); return { consume: true }; }
    // Ctrl+U — cancella riga
    if (matchesKey(data, Key.ctrl("u"))) { inputBuffer = ""; updateInputLine(); tui.requestRender(); return { consume: true }; }
    // Tab — navigazione agenti
    if (matchesKey(data, Key.tab)) {
      const next = layout.agentList.selectNext();
      if (next) { state.selectedAgentId = next; layout.updateHeader(state); layout.updateStatusBar(state); tui.requestRender(); }
      return { consume: true };
    }
    // Arrow up/down — navigazione agenti
    if (matchesKey(data, Key.up)) {
      const prev = layout.agentList.selectPrev();
      if (prev) { state.selectedAgentId = prev; layout.updateHeader(state); layout.updateStatusBar(state); tui.requestRender(); }
      return { consume: true };
    }
    if (matchesKey(data, Key.down)) {
      const next = layout.agentList.selectNext();
      if (next) { state.selectedAgentId = next; layout.updateHeader(state); layout.updateStatusBar(state); tui.requestRender(); }
      return { consume: true };
    }
    // Ctrl+O — toggle tool expand
    if (matchesKey(data, Key.ctrl("o"))) {
      state.toolsExpanded = !state.toolsExpanded; setActivityStatus(state.toolsExpanded ? "tool espansi" : "tool compressi");
      tui.requestRender(); return { consume: true };
    }
    // Caratteri stampabili
    const str = typeof data === "string" ? data : "";
    if (str && str.length === 1 && str.charCodeAt(0) >= 32) {
      inputBuffer += str; updateInputLine(); tui.requestRender();
      return { consume: true };
    }
    return undefined;
  });

  process.on("SIGINT", requestExit);
  process.on("SIGTERM", requestExit);
  tui.start();

  // Polling tmux
  const tmuxPoll = setInterval(() => {
    const count = countActiveTmuxSessions();
    if (count !== state.activeTmuxCount) { state.activeTmuxCount = count; layout.updateStatusBar(state); tui.requestRender(); }
  }, 5000);
  if (tmuxPoll.unref) tmuxPoll.unref();

  await new Promise<void>(resolve => {
    process.once("exit", () => { clearInterval(tmuxPoll); resolve(); });
  });
}

runJhtTui().catch(console.error);
