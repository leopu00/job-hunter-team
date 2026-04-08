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
import { ProfileWizardPanel } from "./components/profile-wizard-panel.js";
import { createTuiClient, loadApiKey } from "./tui-client.js";
import { runSetupWizard, saveApiKey } from "./tui-setup.js";
import { createCommandHandlers } from "./tui-command-handlers.js";
import { createEventHandlers } from "./tui-event-handlers.js";
import { DashboardPanel } from "./components/dashboard-panel.js";
import { listJhtSessions, listUserSessions, capturePane } from "./tui-tmux.js";
import { loadTasks } from "./tui-tasks.js";
import { isProfileComplete, loadProfile, saveProfile, validateProfileField } from "./tui-profile.js";
import type { JhtAgent, JhtTuiState, ProfileWizardState, TuiStateAccess, TuiView, SessionInfo } from "./tui-types.js";

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

const VIEWS: TuiView[] = ["team", "chat", "tasks", "dashboard", "profile", "ai"];
const PROFILE_WIZARD_STEPS: ProfileWizardState["steps"] = [
  { field: "nome", title: "Nome", question: "Inserisci nome", hint: "Es: Anna", required: true },
  { field: "cognome", title: "Cognome", question: "Inserisci cognome", hint: "Es: Verdi", required: true },
  { field: "dataNascita", title: "Data di nascita", question: "Inserisci data di nascita", hint: "Formato: GG/MM/AAAA", required: true },
  { field: "competenze", title: "Competenze", question: "Inserisci competenze professionali", hint: "Separate da virgola. Es: assistenza clienti, organizzazione, analisi dati", required: true },
  { field: "zona", title: "Zona", question: "Inserisci zona di lavoro", hint: "Es: Roma, provincia, disponibilita nazionale", required: true },
  { field: "tipoLavoro", title: "Tipo di lavoro", question: "Inserisci tipo di lavoro", hint: "Es: Full-time, Part-time, Contratto a tempo determinato", required: true },
];

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
    activeTmuxCount: listUserSessions().length,
    currentView: "team",
    chatTargetSession: null,
    teamSelectedActionIndex: 0,
    profileWizard: null,
    currentAgentId: "assistente",
    currentSessionKey: `jht-${randomUUID()}`,
    activeChatRunId: null,
    pendingOptimisticUserMessage: false,
    historyLoaded: false,
    sessionInfo,
    showThinking: false,
  };

  const tui = new TUI(new ProcessTerminal());
  tui.setClearOnShrink(true);
  const layout = createJhtLayout(tui);

  // Pannelli per ogni vista
  const teamPanel = new TeamPanel();
  const chatPanel = new ChatPanel();
  const taskPanel = new TaskPanel();
  const dashboardPanel = new DashboardPanel();
  const profileWizardPanel = new ProfileWizardPanel();
  const aiChatPanel = new ChatPanel();

  // Chat tmux: container per output catturato
  const tmuxOutputPanel = new Container();

  const startProfileWizard = () => {
    const profile = loadProfile();
    state.profileWizard = {
      stepIndex: 0,
      steps: PROFILE_WIZARD_STEPS,
      draft: {
        nome: profile.nome,
        cognome: profile.cognome,
        dataNascita: profile.dataNascita,
        competenze: [...profile.competenze],
        zona: profile.zona,
        tipoLavoro: profile.tipoLavoro,
      },
      lastMessage: null,
    };
    switchView("profile");
    setActivityStatus("configura profilo");
  };

  const persistProfileDraftValue = (wizard: ProfileWizardState, rawValue: string) => {
    const currentStep = wizard.steps[wizard.stepIndex];
    const raw = rawValue.trim();
    if (currentStep.field === "competenze") {
      if (!raw) return;
      const validation = validateProfileField("competenze", raw);
      if (validation.ok && Array.isArray(validation.value)) {
        wizard.draft.competenze = validation.value;
      }
      return;
    }
    if (!raw) return;
    const validation = validateProfileField(currentStep.field, raw);
    if (validation.ok && typeof validation.value === "string") {
      wizard.draft[currentStep.field] = validation.value as never;
    }
  };

  const moveProfileWizardStep = (delta: number) => {
    const wizard = state.profileWizard;
    if (!wizard) return;
    persistProfileDraftValue(wizard, inputBuffer);
    inputBuffer = "";
    wizard.lastMessage = null;
    const nextIndex = Math.max(0, Math.min(wizard.steps.length - 1, wizard.stepIndex + delta));
    wizard.stepIndex = nextIndex;
    updateInputLine();
    switchView("profile");
  };

  const submitProfileWizardAnswer = () => {
    const wizard = state.profileWizard;
    if (!wizard) return;

    const currentStep = wizard.steps[wizard.stepIndex];
    const raw = inputBuffer.trim();
    inputBuffer = "";

    const fallbackValue = currentStep.field === "competenze"
      ? wizard.draft.competenze.join(", ")
      : String(wizard.draft[currentStep.field] ?? "");
    const nextRaw = raw || fallbackValue;

    if (currentStep.required && !nextRaw.trim()) {
      wizard.lastMessage = "Questo campo e obbligatorio.";
      updateInputLine();
      switchView("profile");
      return;
    }

    const validation = validateProfileField(currentStep.field, nextRaw);
    if (!validation.ok) {
      wizard.lastMessage = validation.error;
      updateInputLine();
      switchView("profile");
      return;
    }

    if (currentStep.field === "competenze") {
      wizard.draft.competenze = validation.value as string[];
    } else {
      wizard.draft[currentStep.field] = validation.value as never;
    }

    wizard.lastMessage = null;
    if (wizard.stepIndex < wizard.steps.length - 1) {
      wizard.stepIndex += 1;
      updateInputLine();
      switchView("profile");
      return;
    }

    const savedProfile = {
      ...wizard.draft,
      completato: false,
    };
    savedProfile.completato = isProfileComplete(savedProfile);
    saveProfile(savedProfile);
    state.profileWizard = null;
    setActivityStatus("profilo salvato");
    updateInputLine();
    switchView("team");
    aiChatPanel.addSystem(savedProfile.completato
      ? "profilo completato"
      : "profilo salvato ma ancora incompleto");
  };

  // Input line in fondo (ispirato a OpenClaw CustomEditor, semplificato)
  const inputLine = new Text("", 0, 0);
  let inputBuffer = "";
  const updateInputLine = () => {
    if (state.currentView === "profile") {
      inputLine.setText("");
      return;
    }
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

  const refreshProfileWizard = () => {
    if (!state.profileWizard) return;
    layout.mainSlot.clear();
    profileWizardPanel.refresh(state.profileWizard, inputBuffer);
    layout.mainSlot.addChild(profileWizardPanel);
    layout.updateHeader(state);
    updateInputLine();
    tui.requestRender();
  };

  /** Switch view — aggiorna mainSlot */
  const switchView = (view: TuiView) => {
    const previousView = state.currentView;
    state.currentView = view;
    layout.mainSlot.clear();
    switch (view) {
      case "team":
        teamPanel.refresh(listUserSessions(), loadTasks(), { selectedActionIndex: state.teamSelectedActionIndex });
        state.teamSelectedActionIndex = teamPanel.getSelectedActionIndex();
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
      case "dashboard":
        dashboardPanel.refresh();
        layout.mainSlot.addChild(dashboardPanel);
        break;
      case "profile":
        if (!state.profileWizard) startProfileWizard();
        if (state.profileWizard) {
          refreshProfileWizard();
          return;
        }
        break;
      case "ai":
        layout.mainSlot.addChild(aiChatPanel);
        break;
    }
    layout.updateHeader(state);
    updateInputLine();
    tui.requestRender(previousView !== view);
  };

  /** Refresh vista corrente */
  const refreshCurrentView = () => {
    state.activeTmuxCount = listUserSessions().length;
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

  // systemLog proxy — scrive nel pannello della vista corrente
  const systemLog = {
    addSystem: (text: string) => {
      switch (state.currentView) {
        case "ai": aiChatPanel.addSystem(text); break;
        case "chat": chatPanel.addSystem(text); break;
        default: aiChatPanel.addSystem(text); break;
      }
    },
    addUser: (text: string) => { aiChatPanel.addUser(text); },
  };

  // Command context
  const commandContext: Parameters<typeof createCommandHandlers>[0] = {
    client: stubClient,
    chatLog: aiChatPanel,
    systemLog,
    opts: {},
    state,
    setActivityStatus,
    refreshAgents: async () => { state.agents = await commandContext.client.listAgents(); },
    requestRender: () => tui.requestRender(),
    switchView,
    refreshCurrentView,
    startProfileWizard,
    reconnect: (apiKey: string) => {
      if (!apiKey.startsWith("sk-ant-")) return false;
      try {
        saveApiKey(apiKey);
        commandContext.client = createTuiClient((evt) => eventHandlers.handleChatEvent(evt), apiKey);
        state.isConnected = true;
        state.connectionStatus = "connected";
        layout.updateHeader(state);
        layout.updateStatusBar(state);
        tui.requestRender();
        return true;
      } catch {
        state.isConnected = false;
        state.connectionStatus = "no API";
        layout.updateHeader(state);
        layout.updateStatusBar(state);
        tui.requestRender();
        return false;
      }
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
      if (state.currentView === "profile" && state.profileWizard) {
        submitProfileWizardAnswer();
        tui.requestRender();
        return { consume: true };
      }
      const text = inputBuffer.trim();
      if (text) {
        inputBuffer = "";
        updateInputLine();
        tui.requestRender();
        if (text.startsWith("/")) void handleCommand(text);
        else void sendMessage(text);
      } else if (state.currentView === "team" && teamPanel.hasActions()) {
        const action = teamPanel.activateSelectedAction();
        if (action) {
          setActivityStatus(action.label.toLowerCase());
          void handleCommand(action.command);
        }
      }
      return { consume: true };
    }
    if (matchesKey(data, Key.backspace) || matchesKey(data, Key.delete)) {
      if (inputBuffer.length > 0) {
        inputBuffer = inputBuffer.slice(0, -1);
        if (state.currentView === "profile" && state.profileWizard) {
          refreshProfileWizard();
          return { consume: true };
        }
        updateInputLine();
        tui.requestRender();
      }
      return { consume: true };
    }
    if (matchesKey(data, Key.ctrl("c"))) {
      requestExit();
      return { consume: true };
    }
    // Ctrl+D — esci (come OpenClaw)
    if (matchesKey(data, Key.ctrl("d"))) {
      if (inputBuffer.length === 0) { requestExit(); }
      return { consume: true };
    }
    if (matchesKey(data, Key.ctrl("u"))) {
      inputBuffer = "";
      if (state.currentView === "profile" && state.profileWizard) {
        refreshProfileWizard();
        return { consume: true };
      }
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
    if (state.currentView === "profile" && state.profileWizard) {
      if (matchesKey(data, Key.left) || matchesKey(data, Key.up)) {
        moveProfileWizardStep(-1);
        return { consume: true };
      }
      if (matchesKey(data, Key.right) || matchesKey(data, Key.down)) {
        moveProfileWizardStep(1);
        return { consume: true };
      }
    }
    if (matchesKey(data, Key.up) && inputBuffer.length === 0 && state.currentView === "team" && teamPanel.hasActions()) {
      if (teamPanel.moveSelection(-1)) {
        state.teamSelectedActionIndex = teamPanel.getSelectedActionIndex();
        switchView("team");
      }
      return { consume: true };
    }
    if (matchesKey(data, Key.down) && inputBuffer.length === 0 && state.currentView === "team" && teamPanel.hasActions()) {
      if (teamPanel.moveSelection(1)) {
        state.teamSelectedActionIndex = teamPanel.getSelectedActionIndex();
        switchView("team");
      }
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
      if (state.currentView === "profile" && state.profileWizard) {
        refreshProfileWizard();
        return { consume: true };
      }
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
    const sessions = listUserSessions();
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
    // Auto-refresh dashboard
    if (state.currentView === "dashboard") {
      dashboardPanel.refresh();
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
