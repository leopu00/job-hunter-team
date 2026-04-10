/**
 * JHT TUI — Pannello di Controllo del Team.
 * Viste: Home, Team (agenti tmux), Chat (tmux), Tasks, AI.
 */
import { randomUUID } from "node:crypto";
import { Container, Key, matchesKey, ProcessTerminal, Text, TUI } from "@mariozechner/pi-tui";
import { createJhtLayout } from "./tui-layout.js";
import { HomePanel } from "./components/home-panel.js";
import { ChatPanel } from "./components/chat-panel.js";
import { TeamPanel } from "./components/team-panel.js";
import { TaskPanel } from "./components/task-panel.js";
import { ProfileWizardPanel } from "./components/profile-wizard-panel.js";
import { createTuiClient, loadApiKey } from "./tui-client.js";
import { ensureWorkspaceConfigured, saveApiKey, runSetupWizard } from "./tui-setup.js";
import { createCommandHandlers } from "./tui-command-handlers.js";
import { createEventHandlers } from "./tui-event-handlers.js";
import { DashboardPanel } from "./components/dashboard-panel.js";
import { listJhtSessions, listUserSessions, capturePane } from "./tui-tmux.js";
import { loadTasks } from "./tui-tasks.js";
import { isProfileComplete, loadProfile, loadWorkspacePath, saveProfile, validateProfileField } from "./tui-profile.js";
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

const VIEWS: TuiView[] = ["home", "team", "chat", "tasks", "dashboard", "profile", "ai"];
const VIEW_SHORTCUTS: Record<string, TuiView> = {
  "1": "home",
  "2": "team", 
  "3": "chat",
  "4": "tasks",
  "5": "dashboard",
  "6": "profile",
  "7": "ai",
};
const PROFILE_WIZARD_STEPS: ProfileWizardState["steps"] = [
  { field: "nome", section: "Profilo Base", title: "Nome", question: "Come ti chiami?", hint: "Es: Anna", required: true },
  { field: "cognome", section: "Profilo Base", title: "Cognome", question: "Qual e il tuo cognome?", hint: "Es: Verdi", required: true },
  { field: "targetRoles", section: "Obiettivo", title: "Ruoli target", question: "Quali ruoli stai cercando?", hint: "Separali con virgola. Es: Backend Developer, Python Developer", required: true },
  { field: "seniorityTarget", section: "Obiettivo", title: "Seniority", question: "Che livello stai cercando?", hint: "Scrivi Junior, Mid, Senior, Lead, Manager o Head", required: true },
  { field: "competenze", section: "Obiettivo", title: "Skill principali", question: "Quali skill vuoi far emergere?", hint: "Separale con virgola. Es: Python, FastAPI, SQL, customer support", required: true },
  { field: "locationPreferences", section: "Preferenze", title: "Luogo di lavoro", question: "Dove sei disposto a lavorare?", hint: "Es: Remote Italia, Hybrid Milano, Roma", required: true },
  { field: "tipoLavoro", section: "Preferenze", title: "Tipo di lavoro", question: "Che formula contrattuale preferisci?", hint: "Es: Full-time, Part-time, Freelance, Stage", required: true },
  { field: "languages", section: "Profilo Professionale", title: "Lingue", question: "Quali lingue usi nel lavoro?", hint: "Opzionale. Es: Italiano madrelingua, Inglese C1" },
  { field: "headline", section: "Profilo Professionale", title: "Headline", question: "Come ti presenteresti in una riga?", hint: "Opzionale. Es: Backend Developer | Python | API Design" },
  { field: "strengths", section: "Profilo Professionale", title: "Punti di forza", question: "Quali punti di forza vuoi evidenziare?", hint: "Opzionale. Es: problem solving, ownership, comunicazione" },
  { field: "email", section: "Contatti", title: "Email", question: "Qual e la tua email professionale?", hint: "Opzionale. Premi Enter per saltare" },
  { field: "linkedin", section: "Contatti", title: "LinkedIn", question: "Hai un profilo LinkedIn da inserire?", hint: "Opzionale. Usa URL completo: https://linkedin.com/in/..." },
  { field: "portfolio", section: "Contatti", title: "Portfolio", question: "Hai portfolio, sito o GitHub?", hint: "Opzionale. Usa URL completo" },
  { field: "salaryTarget", section: "Vincoli", title: "Range retributivo", question: "Hai un range retributivo target?", hint: "Opzionale. Es: 35k-45k EUR oppure 1800-2200 netti" },
  { field: "availability", section: "Vincoli", title: "Disponibilita", question: "Quando saresti disponibile a iniziare?", hint: "Opzionale. Es: subito, 30 giorni, da settembre" },
  { field: "workAuthorization", section: "Vincoli", title: "Work Authorization", question: "Hai vincoli geografici o di autorizzazione al lavoro?", hint: "Opzionale. Es: Italia/UE, no sponsorship needed" },
];

const PROFILE_ARRAY_FIELDS = new Set([
  "targetRoles",
  "competenze",
  "locationPreferences",
  "languages",
  "strengths",
]);

function clearTerminalScreen() {
  process.stdout.write("\x1b[2J\x1b[3J\x1b[H");
}

export async function runJhtTui() {
  await ensureWorkspaceConfigured();
  const resolvedApiKey = loadApiKey();

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
    currentView: "home",
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
  clearTerminalScreen();
  const layout = createJhtLayout(tui);

  // Pannelli per ogni vista
  const homePanel = new HomePanel();
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
        headline: profile.headline,
        targetRoles: [...profile.targetRoles],
        seniorityTarget: profile.seniorityTarget,
        competenze: [...profile.competenze],
        locationPreferences: [...profile.locationPreferences],
        tipoLavoro: profile.tipoLavoro,
        languages: [...profile.languages],
        strengths: [...profile.strengths],
        email: profile.email,
        linkedin: profile.linkedin,
        portfolio: profile.portfolio,
        salaryTarget: profile.salaryTarget,
        availability: profile.availability,
        workAuthorization: profile.workAuthorization,
      },
      lastMessage: null,
    };
    switchView("profile");
    setActivityStatus("configura profilo");
  };

  const persistProfileDraftValue = (wizard: ProfileWizardState, rawValue: string) => {
    const currentStep = wizard.steps[wizard.stepIndex];
    const raw = rawValue.trim();
    if (!raw) {
      return;
    }
    const validation = validateProfileField(currentStep.field as never, raw);
    if (!validation.ok) return;
    if (PROFILE_ARRAY_FIELDS.has(currentStep.field) && Array.isArray(validation.value)) {
      wizard.draft[currentStep.field] = validation.value as never;
      return;
    }
    if (typeof validation.value === "string") {
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

    const currentValue = wizard.draft[currentStep.field];
    const fallbackValue = Array.isArray(currentValue)
      ? currentValue.join(", ")
      : String(currentValue ?? "");
    const nextRaw = raw || fallbackValue;

    if (currentStep.required && !nextRaw.trim()) {
      wizard.lastMessage = "Questo campo e obbligatorio.";
      updateInputLine();
      switchView("profile");
      return;
    }

    const validation = validateProfileField(currentStep.field as never, nextRaw);
    if (!validation.ok) {
      wizard.lastMessage = validation.error;
      updateInputLine();
      switchView("profile");
      return;
    }

    if (PROFILE_ARRAY_FIELDS.has(currentStep.field)) {
      wizard.draft[currentStep.field] = validation.value as never;
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

    const existingProfile = loadProfile();
    const savedProfile = {
      ...existingProfile,
      ...wizard.draft,
      zona: wizard.draft.locationPreferences.join(", "),
      completato: false,
    };
    savedProfile.completato = isProfileComplete(savedProfile);
    saveProfile(savedProfile);
    state.profileWizard = null;
    setActivityStatus("profilo salvato");
    updateInputLine();
    switchView("home");
    aiChatPanel.addSystem(savedProfile.completato
      ? "profilo completato"
      : "profilo salvato ma ancora incompleto");
  };

  // Input line — visibile solo quando serve (non in home/team)
  const inputLine = new Text("", 0, 0);
  let inputBuffer = "";
  let isEditingWorkspace = false;
  let isEditingApiKey = false;
  const updateInputLine = () => {
    // In home/team: input visibile solo quando l'utente sta digitando un comando
    if ((state.currentView === "home" || state.currentView === "team") && !isEditingWorkspace && !isEditingApiKey) {
      if (inputBuffer.length === 0) {
        inputLine.setText("");
        return;
      }
      // Mostra riga di comando quando l'utente digita (es. /start scout)
      const viewLabel = state.currentView;
      inputLine.setText(`\x1b[32m  ${viewLabel} > \x1b[0m${inputBuffer}\x1b[2m\u2588\x1b[0m`);
      return;
    }
    // In profile wizard: nessun prompt, input silenzioso
    if (state.currentView === "profile") {
      inputLine.setText("");
      return;
    }
    if (state.currentView === "home" && isEditingWorkspace) {
      inputLine.setText(`\x1b[32m  workspace > \x1b[0m${inputBuffer}\x1b[2m\u2588\x1b[0m`);
      return;
    }
    if (state.currentView === "home" && isEditingApiKey) {
      inputLine.setText(`\x1b[32m  api key > \x1b[0m${inputBuffer}\x1b[2m\u2588\x1b[0m`);
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
    if (view !== "home") {
      isEditingWorkspace = false;
    }
    state.currentView = view;
    layout.mainSlot.clear();
    switch (view) {
      case "home":
        homePanel.refresh(listUserSessions());
        layout.mainSlot.addChild(homePanel);
        break;
      case "team":
        teamPanel.refresh(listUserSessions());
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
    const forceFullRedraw = previousView !== view || view === "home" || view === "team";
    tui.requestRender(forceFullRedraw);
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

  // Vista iniziale: home
  switchView("home");

  let exitRequested = false;
  const requestExit = () => {
    if (exitRequested) return;
    exitRequested = true;
    try { tui.stop(); } catch {}
    process.exit(0);
  };

  // Input handling
  tui.addInputListener((data) => {
    if (matchesKey(data, Key.enter) || matchesKey(data, Key.return)) {
      if (state.currentView === "profile" && state.profileWizard) {
        submitProfileWizardAnswer();
        tui.requestRender();
        return { consume: true };
      }
      if (state.currentView === "home" && isEditingWorkspace) {
        const nextWorkspace = inputBuffer.trim();
        inputBuffer = "";
        isEditingWorkspace = false;
        updateInputLine();
        tui.requestRender();
        if (nextWorkspace) {
          setActivityStatus("aggiorna cartella");
          void handleCommand(`/workspace ${nextWorkspace}`);
        } else {
          setActivityStatus("idle");
        }
        return { consume: true };
      }
      const text = inputBuffer.trim();
      if (text) {
        inputBuffer = "";
        updateInputLine();
        tui.requestRender();
        if (text.startsWith("/")) void handleCommand(text);
        else void sendMessage(text);
      } else if (state.currentView === "team") {
        // Team: Enter su agente selezionato → avvia (offline) o chat (online)
        const agent = teamPanel.getSelectedAgent();
        if (agent) {
          if (agent.isOnline) {
            void handleCommand(`/chat ${agent.id}`);
          } else {
            void handleCommand(`/start ${agent.id}`);
          }
        }
      } else if (state.currentView === "home") {
        if (isEditingApiKey) {
          // Salva API key
          const key = inputBuffer.trim();
          inputBuffer = "";
          isEditingApiKey = false;
          updateInputLine();
          tui.requestRender();
          if (key) {
            if (key.startsWith("sk-ant-")) {
              const ok = commandContext.reconnect?.(key);
              setActivityStatus(ok ? "api key salvata" : "errore connessione");
            } else {
              setActivityStatus("chiave deve iniziare con sk-ant-");
            }
          } else {
            setActivityStatus("idle");
          }
          return { consume: true };
        }
        
        const selectedItem = homePanel.getSelectedItem();
        if (!selectedItem) return { consume: true };
        
        switch (selectedItem.type) {
          case "workspace":
            isEditingWorkspace = true;
            inputBuffer = loadWorkspacePath();
            setActivityStatus("modifica cartella");
            updateInputLine();
            tui.requestRender();
            break;
          case "apikey":
            isEditingApiKey = true;
            inputBuffer = loadApiKey() || "";
            setActivityStatus("inserisci api key");
            updateInputLine();
            tui.requestRender();
            break;
          case "provider":
            setActivityStatus("provider: usa /setup <key>");
            tui.requestRender();
            break;
          case "profile":
            setActivityStatus("avvio wizard profilo...");
            void handleCommand("/profile");
            break;
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
    // Ctrl+D — esci
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
    // Esc — cancella input e torna a navigazione
    if (matchesKey(data, Key.escape)) {
      if (inputBuffer.length > 0) {
        inputBuffer = "";
        updateInputLine();
        tui.requestRender();
        return { consume: true };
      }
      return { consume: true };
    }
    // Tab — cicla viste
    if (matchesKey(data, Key.tab)) {
      const idx = VIEWS.indexOf(state.currentView);
      const next = VIEWS[(idx + 1) % VIEWS.length]!;
      switchView(next);
      return { consume: true };
    }
    // Numeri 1-7 — shortcut diretti alle viste (solo se input vuoto)
    const keyStr = typeof data === "string" ? data : "";
    if (keyStr && VIEW_SHORTCUTS[keyStr] && inputBuffer.length === 0) {
      switchView(VIEW_SHORTCUTS[keyStr]);
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
    if (matchesKey(data, Key.up) && inputBuffer.length === 0 && state.currentView === "home") {
      if (homePanel.moveSelection(-1)) {
        switchView("home");
      }
      return { consume: true };
    }
    if (matchesKey(data, Key.down) && inputBuffer.length === 0 && state.currentView === "home") {
      if (homePanel.moveSelection(1)) {
        switchView("home");
      }
      return { consume: true };
    }
    // Team view: navigazione frecce
    if (matchesKey(data, Key.up) && inputBuffer.length === 0 && state.currentView === "team") {
      if (teamPanel.moveSelection(-1)) {
        switchView("team");
      }
      return { consume: true };
    }
    if (matchesKey(data, Key.down) && inputBuffer.length === 0 && state.currentView === "team") {
      if (teamPanel.moveSelection(1)) {
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
    // Team view: "x" ferma agente selezionato
    if (typeof data === "string" && data === "x" && inputBuffer.length === 0 && state.currentView === "team") {
      const agent = teamPanel.getSelectedAgent();
      if (agent?.isOnline) {
        void handleCommand(`/stop ${agent.id}`);
      }
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
