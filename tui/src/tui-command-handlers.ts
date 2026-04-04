/**
 * Command handlers — gestisce comandi slash e invio messaggi.
 * Ispirato a OpenClaw tui-command-handlers.ts con adattamenti per JHT.
 */
import { randomUUID } from "node:crypto";
import * as readline from "node:readline";
import type { ChatOptions, JhtAgent, TuiStateAccess, TuiView } from "./tui-types.js";
import { sendToSession, resolveSessionName, startSession, stopSession, listJhtSessions } from "./tui-tmux.js";
import { loadProfile, saveProfile, isProfileComplete, formatProfile, type UserProfile } from "./tui-profile.js";

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
  switchView: (view: TuiView) => void;
  refreshCurrentView: () => void;
  noteLocalRunId?: (runId: string) => void;
  forgetLocalRunId?: (runId: string) => void;
  reconnect?: (apiKey: string) => boolean;
};

function parseCommand(input: string): { name: string; args: string } {
  const trimmed = input.replace(/^\//, "").trim();
  if (!trimmed) return { name: "", args: "" };
  const [name, ...rest] = trimmed.split(/\s+/);
  return { name: (name ?? "").toLowerCase(), args: rest.join(" ").trim() };
}

export function createCommandHandlers(context: CommandHandlerContext) {
  const { chatLog, opts, state, setActivityStatus, requestRender,
    noteLocalRunId, forgetLocalRunId } = context;

  /** Invia messaggio: se in chat tmux, va a tmux; se in AI, va ad Anthropic */
  const sendMessage = async (text: string) => {
    // Chat tmux: invia al target
    if (state.currentView === "chat" && state.chatTargetSession) {
      chatLog.addUser(text);
      const ok = sendToSession(state.chatTargetSession, text);
      if (ok) {
        chatLog.addSystem("inviato");
        setActivityStatus("inviato a " + state.chatTargetSession);
      } else {
        chatLog.addSystem("invio fallito — sessione non raggiungibile");
        setActivityStatus("errore invio");
      }
      requestRender();
      return;
    }

    // AI chat: invia ad Anthropic
    if (state.currentView === "ai") {
      if (!state.isConnected) {
        chatLog.addSystem("non connesso — usa /setup <API_KEY> per configurare");
        setActivityStatus("disconnected");
        requestRender();
        return;
      }
      const runId = randomUUID();
      chatLog.addUser(text);
      state.pendingOptimisticUserMessage = true;
      setActivityStatus("sending");
      requestRender();
      try {
        noteLocalRunId?.(runId);
        await context.client.sendChat({
          sessionKey: state.currentSessionKey, message: text,
          thinking: opts.thinking, deliver: opts.deliver, timeoutMs: opts.timeoutMs, runId,
        });
        setActivityStatus("waiting");
      } catch (err) {
        forgetLocalRunId?.(runId);
        state.pendingOptimisticUserMessage = false;
        state.activeChatRunId = null;
        chatLog.addSystem(`invio fallito: ${String(err)}`);
        setActivityStatus("error");
      }
      requestRender();
      return;
    }

    // Altre viste: suggerisci di usare /chat o /ai
    chatLog.addSystem("usa /chat <agente> per chattare con un agente o /ai per la chat AI");
    requestRender();
  };

  const HELP = [
    "comandi:",
    "  /team            — vista panoramica team",
    "  /chat <agente>   — chat diretta con agente (tmux)",
    "  /start <agente>  — avvia sessione tmux per un agente",
    "  /stop <agente>   — ferma sessione tmux di un agente",
    "  /tasks           — dashboard task",
    "  /dashboard       — panoramica budget, deploy, task",
    "  /ai              — chat AI (Anthropic)",
    "  /send <msg>      — invia messaggio all'agente selezionato",
    "  /setup <key>     — configura API key Anthropic",
    "  /profile         — mostra/modifica profilo utente",
    "  /refresh         — aggiorna vista corrente",
    "  /status          — stato connessione",
    "  /abort           — interrompi run AI attivo",
    "  /new             — nuova sessione AI",
    "  /help            — mostra aiuto",
    "",
    "  Tab / frecce     — naviga viste",
    "  Ctrl+C           — esci",
  ].join("\n");

  const handleCommand = async (raw: string) => {
    const { name, args } = parseCommand(raw);
    if (!name) return;

    switch (name) {
      case "help":
        chatLog.addSystem(HELP);
        break;

      case "team":
        context.switchView("team");
        break;

      case "tasks":
        context.switchView("tasks");
        break;

      case "dashboard": case "dash":
        context.switchView("dashboard");
        break;

      case "ai":
        context.switchView("ai");
        chatLog.addSystem("chat AI attiva");
        break;

      case "chat": {
        if (!args) {
          chatLog.addSystem("uso: /chat <agente>  (es. /chat gatekeeper)");
          break;
        }
        const sessionName = resolveSessionName(args);
        if (!sessionName) {
          chatLog.addSystem(`sessione tmux per "${args}" non trovata. Usa /team per vedere gli agenti attivi.`);
          break;
        }
        state.chatTargetSession = sessionName;
        context.switchView("chat");
        chatLog.addSystem(`chat con ${sessionName} — scrivi un messaggio`);
        break;
      }

      case "send": {
        if (!args) {
          chatLog.addSystem("uso: /send <messaggio>");
          break;
        }
        if (!state.chatTargetSession) {
          chatLog.addSystem("nessun agente selezionato — usa /chat <agente> prima");
          break;
        }
        await sendMessage(args);
        break;
      }

      case "start": {
        if (!args) {
          chatLog.addSystem("uso: /start <agente>  (es. /start scout)");
          const sessions = listJhtSessions();
          if (sessions.length > 0) {
            chatLog.addSystem("sessioni attive: " + sessions.map((s) => s.name).join(", "));
          }
          break;
        }
        const startResult = startSession(args);
        if (startResult.ok) {
          chatLog.addSystem(`sessione ${startResult.name} avviata`);
          setActivityStatus(`avviato ${startResult.name}`);
          state.activeTmuxCount = listJhtSessions().length;
          context.refreshCurrentView();
        } else {
          chatLog.addSystem(`errore: ${startResult.error ?? "impossibile avviare"} (${startResult.name})`);
        }
        break;
      }

      case "stop": case "kill": {
        if (!args) {
          chatLog.addSystem("uso: /stop <agente>  (es. /stop scout)");
          const sessions = listJhtSessions();
          if (sessions.length > 0) {
            chatLog.addSystem("sessioni attive: " + sessions.map((s) => s.name).join(", "));
          }
          break;
        }
        const targetSession = resolveSessionName(args) ?? args;
        const stopResult = stopSession(targetSession);
        if (stopResult.ok) {
          chatLog.addSystem(`sessione ${targetSession} fermata`);
          setActivityStatus(`fermato ${targetSession}`);
          state.activeTmuxCount = listJhtSessions().length;
          if (state.chatTargetSession === targetSession) {
            state.chatTargetSession = null;
          }
          context.refreshCurrentView();
        } else {
          chatLog.addSystem(`errore: ${stopResult.error ?? "impossibile fermare"} (${targetSession})`);
        }
        break;
      }

      case "refresh":
        context.refreshCurrentView();
        chatLog.addSystem("aggiornato");
        break;

      case "status":
        if (!state.isConnected) {
          chatLog.addSystem("API: non connesso — usa /setup <API_KEY>");
        } else {
          try {
            const s = await context.client.getStatus();
            if (s && typeof s === "object") {
              const r = s as Record<string, unknown>;
              const parts: string[] = [];
              if (r.model) parts.push(`model: ${r.model}`);
              if (r.historyLength !== undefined) parts.push(`history: ${r.historyLength}`);
              parts.push("connected: true");
              for (const p of parts) chatLog.addSystem(p);
            }
          } catch (err) { chatLog.addSystem(`status fallito: ${String(err)}`); }
        }
        chatLog.addSystem(`tmux: ${state.activeTmuxCount} sessioni attive`);
        chatLog.addSystem(`vista: ${state.currentView}`);
        break;

      case "abort":
        if (!state.activeChatRunId) { chatLog.addSystem("nessun run AI attivo"); break; }
        try {
          await context.client.abortRun(state.currentSessionKey);
          chatLog.addSystem("run AI interrotto");
        } catch (err) { chatLog.addSystem(`abort fallito: ${String(err)}`); }
        break;

      case "new":
        state.currentSessionKey = `jht-${randomUUID()}`;
        chatLog.addSystem(`nuova sessione AI: ${state.currentSessionKey}`);
        break;

      case "profile": {
        const profile = loadProfile();
        if (!args) {
          // Mostra profilo corrente
          chatLog.addSystem("profilo utente:");
          for (const line of formatProfile(profile)) chatLog.addSystem(line);
          chatLog.addSystem(profile.completato ? "  Stato: completo" : "  Stato: incompleto — usa /profile <campo> <valore>");
          chatLog.addSystem("  campi: nome, eta, competenze, zona, tipo");
          break;
        }
        // Modifica campo: /profile nome Mario
        const spaceIdx = args.indexOf(" ");
        if (spaceIdx === -1) {
          chatLog.addSystem("uso: /profile <campo> <valore>");
          chatLog.addSystem("  campi: nome, eta, competenze, zona, tipo");
          break;
        }
        const field = args.slice(0, spaceIdx).toLowerCase();
        const value = args.slice(spaceIdx + 1).trim();
        switch (field) {
          case "nome":
            profile.nome = value;
            break;
          case "eta":
            profile.eta = value;
            break;
          case "competenze":
            profile.competenze = value.split(",").map((s) => s.trim()).filter(Boolean);
            break;
          case "zona":
            profile.zona = value;
            break;
          case "tipo":
            profile.tipoLavoro = value;
            break;
          default:
            chatLog.addSystem(`campo "${field}" non riconosciuto — usa: nome, eta, competenze, zona, tipo`);
            break;
        }
        profile.completato = isProfileComplete(profile);
        saveProfile(profile);
        chatLog.addSystem("profilo aggiornato:");
        for (const line of formatProfile(profile)) chatLog.addSystem(line);
        break;
      }

      case "setup": {
        if (!args) {
          chatLog.addSystem("uso: /setup <ANTHROPIC_API_KEY>");
          chatLog.addSystem("Trova la key su https://console.anthropic.com/settings/keys");
          break;
        }
        if (context.reconnect) {
          const ok = context.reconnect(args);
          chatLog.addSystem(ok ? "connesso ad Anthropic API" : "errore connessione — verifica la chiave");
        }
        break;
      }

      default:
        await sendMessage(raw);
        return;
    }
    requestRender();
  };

  return { handleCommand, sendMessage };
}
