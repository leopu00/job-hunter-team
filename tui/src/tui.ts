/**
 * JHT TUI — Pannello di Controllo del Team.
 * Struttura ispirata a OpenClaw: header, main area, status bar, editor.
 * Viste: Team (agenti tmux), Chat (tmux), Tasks, AI (Anthropic).
 */
import { randomUUID } from "node:crypto";
import { Container, Key, matchesKey, ProcessTerminal, Text, TUI } from "@mariozechner/pi-tui";
import { createJhtLayout } from "./tui-layout.js";
import { ChatPanel } from "./components/chat-panel.js";
import { TeamPanel } from "./components/team-panel.js";
import { TaskPanel } from "./components/task-panel.js";
import { createTuiClient, loadApiKey } from "./tui-client.js";
import { runSetupWizard, saveApiKey } from "./tui-setup.js";
import { createCommandHandlers } from "./tui-command-handlers.js";
import { createEventHandlers } from "./tui-event-handlers.js";
import { listJhtSessions, capturePane } from "./tui-tmux.js";
import { loadTasks } from "./tui-tasks.js";
import type { JhtAgent, JhtTuiState, TuiStateAccess, TuiView, SessionInfo } from "./tui-types.js";

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

const VIEWS: TuiView[] = ["team", "chat", "tasks", "ai"];

export async function runJhtTui() {
  // Setup wizard se API key non configurata
  let resolvedApiKey = loadApiKey();
  if (!resolvedApiKey) {
    resolvedApiKey = await runSetupWizard();
  }

  // Stato completo
  const sessionInfo: SessionInfo = { model: "claude-sonnet-4" };
  const state: JhtTuiState & TuiStateAccess = {
    agents: KNOWN_AGENTS,
    selectedAgentId: KNOWN_AGENTS[0]?.id ?? null,
    messages: [],
    connectionStatus: "connected",
    activityStatus: "idle",
    toolsExpanded: false,
    isConnected: true,
    activeTmuxCount: listJhtSessions().length,
    currentView: "team",
    chatTargetSession: null,
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

  // Pannelli per ogni vista
  const teamPanel = new TeamPanel();
  const chatPanel = new ChatPanel();
  const taskPanel = new TaskPanel();
  const aiChatPanel = new ChatPanel();

  // Chat tmux: container per output catturato
  const tmuxOutputPanel = new Container();

  // Input line in fondo (ispirato a OpenClaw CustomEditor, semplificato)
  const inputLine = new Text("", 0, 0);
  let inputBuffer = "";
  const updateInputLine = () => {
    const viewLabel = state.currentView === "chat" && state.chatTargetSession
      ? state.chatTargetSession
      : state.currentView;
    const prompt = state.activityStatus === "streaming" ? "  ..." : `  ${viewLabel} > `;
    inputLine.setText(`\x1b[32m${prompt}\x1b[0m${inputBuffer}\x1b[2m\u2588\x1b[0m`);
  };
  layout.root.addChild(inputLine);
  updateInputLine();

  tui.addChild(layout.root);

  /** Aggiorna contenuto della vista tmux chat */
  const refreshTmuxChat = () => {
    tmuxOutputPanel.clear();
    if (!state.chatTargetSession) {
      tmuxOutputPanel.addChild(new Text("  Nessun agente selezionato. Usa /chat <agente>", 0, 0));
      return;
    }
    const lines = capturePane(state.chatTargetSession, 30);
    if (lines.length === 0) {
      tmuxOutputPanel.addChild(new Text(`  (nessun output da ${state.chatTargetSession})`, 0, 0));
      return;
    }
    for (const line of lines.slice(-25)) {
      tmuxOutputPanel.addChild(new Text(`  ${line}`, 0, 0));
    }
  };

  /** Switch view — aggiorna mainSlot */
  const switchView = (view: TuiView) => {
    state.currentView = view;
    layout.mainSlot.clear();
    switch (view) {
      case "team":
        teamPanel.refresh(listJhtSessions());
        layout.mainSlot.addChild(teamPanel);
        break;
      case "chat":
        refreshTmuxChat();
        layout.mainSlot.addChild(tmuxOutputPanel);
        break;
      case "tasks":
        taskPanel.refresh(loadTasks());
        layout.mainSlot.addChild(taskPanel);
        break;
      case "ai":
        layout.mainSlot.addChild(aiChatPanel);
        break;
    }
    layout.updateHeader(state);
    updateInputLine();
    tui.requestRender();
  };

  /** Refresh vista corrente */
  const refreshCurrentView = () => {
    state.activeTmuxCount = listJhtSessions().length;
    switchView(state.currentView);
  };

  const setActivityStatus = (s: string) => {
    state.activityStatus = s;
    layout.updateStatusBar(state);
    updateInputLine();
  };

  // Event handlers per AI chat
  const eventHandlers = createEventHandlers({
    chatLog: aiChatPanel,
    btw: { showResult: (p) => aiChatPanel.addSystem(`[btw] ${p.question}: ${p.text}`), clear: () => {} },
    tui: { requestRender: () => tui.requestRender() },
    state,
    setActivityStatus,
  });

  // Stub client
  const stubClient = { sendChat: async () => {}, getStatus: async () => ({}), abortRun: async () => {}, listAgents: async () => [], history: [] } as any;

  // Command context
  const commandContext: Parameters<typeof createCommandHandlers>[0] = {
    client: stubClient,
    chatLog: aiChatPanel,
    opts: {},
    state,
    setActivityStatus,
    refreshAgents: async () => { state.agents = await commandContext.client.listAgents(); },
    requestRender: () => tui.requestRender(),
    switchView,
    refreshCurrentView,
    reconnect: (apiKey: string) => {
      try {
        saveApiKey(apiKey);
        commandContext.client = createTuiClient((evt) => eventHandlers.handleChatEvent(evt), apiKey);
        state.isConnected = true;
        state.connectionStatus = "connected";
        layout.updateHeader(state);
        layout.updateStatusBar(state);
        tui.requestRender();
        return true;
      } catch { return false; }
    },
  };

  // Connessione API iniziale
  if (resolvedApiKey) {
    try {
      commandContext.client = createTuiClient((evt) => eventHandlers.handleChatEvent(evt), resolvedApiKey);
      state.isConnected = true;
      state.connectionStatus = "connected";
      aiChatPanel.addSystem("Connesso ad Anthropic API.");
    } catch (err) {
      aiChatPanel.addSystem(`Errore API: ${String((err as Error).message)}`);
      state.isConnected = false;
      state.connectionStatus = "no API";
    }
  } else {
    state.isConnected = false;
    state.connectionStatus = "no API";
  }

  layout.updateHeader(state);
  layout.updateStatusBar(state);

  const { handleCommand, sendMessage } = createCommandHandlers(commandContext);

  // Vista iniziale: team
  switchView("team");

  let exitRequested = false;
  const requestExit = () => {
    if (exitRequested) return;
    exitRequested = true;
    try { tui.stop(); } catch {}
    process.exit(0);
  };

  // Input handling (ispirato a OpenClaw tui.ts input listeners)
  tui.addInputListener((data) => {
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
    if (matchesKey(data, Key.backspace) || matchesKey(data, Key.delete)) {
      if (inputBuffer.length > 0) {
        inputBuffer = inputBuffer.slice(0, -1);
        updateInputLine();
        tui.requestRender();
      }
      return { consume: true };
    }
    if (matchesKey(data, Key.ctrl("c"))) {
      requestExit();
      return { consume: true };
    }
    if (matchesKey(data, Key.ctrl("u"))) {
      inputBuffer = "";
      updateInputLine();
      tui.requestRender();
      return { consume: true };
    }
    // Tab — cicla viste
    if (matchesKey(data, Key.tab)) {
      const idx = VIEWS.indexOf(state.currentView);
      const next = VIEWS[(idx + 1) % VIEWS.length]!;
      switchView(next);
      return { consume: true };
    }
    // Ctrl+O — toggle tools expand (AI view)
    if (matchesKey(data, Key.ctrl("o"))) {
      state.toolsExpanded = !state.toolsExpanded;
      setActivityStatus(state.toolsExpanded ? "tool espansi" : "tool compressi");
      tui.requestRender();
      return { consume: true };
    }
    // Caratteri stampabili
    const str = typeof data === "string" ? data : "";
    if (str && str.length === 1 && str.charCodeAt(0) >= 32) {
      inputBuffer += str;
      updateInputLine();
      tui.requestRender();
      return { consume: true };
    }
    return undefined;
  });

  process.on("SIGINT", requestExit);
  process.on("SIGTERM", requestExit);
  tui.start();

  // Polling tmux + auto-refresh vista chat
  const tmuxPoll = setInterval(() => {
    const sessions = listJhtSessions();
    const count = sessions.length;
    if (count !== state.activeTmuxCount) {
      state.activeTmuxCount = count;
      layout.updateHeader(state);
      layout.updateStatusBar(state);
    }
    // Auto-refresh chat tmux
    if (state.currentView === "chat" && state.chatTargetSession) {
      refreshTmuxChat();
    }
    tui.requestRender();
  }, 3000);
  if (tmuxPoll.unref) tmuxPoll.unref();

  await new Promise<void>((resolve) => {
    process.once("exit", () => {
      clearInterval(tmuxPoll);
      resolve();
    });
  });
}

runJhtTui().catch(console.error);
