/**
 * Command handlers — gestisce comandi slash e invio messaggi.
 * Ispirato a OpenClaw tui-command-handlers.ts con adattamenti per JHT.
 */
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import path from "node:path";
import * as readline from "node:readline";
import type { ChatOptions, JhtAgent, TuiStateAccess, TuiView } from "./tui-types.js";
import { sendToSession, resolveSessionName, startSession, stopSession, listJhtSessions } from "./tui-tmux.js";
import { loadProfile, loadWorkspacePath, saveProfile, isProfileComplete, formatProfile, type UserProfile } from "./tui-profile.js";

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
  /** Log di sistema visibile nella vista corrente (non solo AI) */
  systemLog: CommandChatLog;
  opts: ChatOptions;
  state: TuiStateAccess;
  setActivityStatus: (text: string) => void;
  refreshAgents: () => Promise<void>;
  requestRender: () => void;
  switchView: (view: TuiView) => void;
  refreshCurrentView: () => void;
  startProfileWizard?: () => void;
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
  /** Log visibile nella vista corrente */
  const sysLog = context.systemLog;

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
    "  /profile         — apre il wizard profilo",
    "  /refresh         — aggiorna vista corrente",
    "  /status          — stato connessione",
    "  /abort           — interrompi run AI attivo",
    "  /new             — nuova sessione AI",
    "  /deploy          — deploy web su Vercel (produzione)",
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
        sysLog.addSystem(HELP);
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
        sysLog.addSystem("chat AI attiva");
        break;

      case "chat": {
        if (!args) {
          sysLog.addSystem("uso: /chat <agente>  (es. /chat gatekeeper)");
          break;
        }
        const sessionName = resolveSessionName(args);
        if (!sessionName) {
          sysLog.addSystem(`sessione tmux per "${args}" non trovata. Usa /team per vedere gli agenti attivi.`);
          break;
        }
        state.chatTargetSession = sessionName;
        context.switchView("chat");
        sysLog.addSystem(`chat con ${sessionName} — scrivi un messaggio`);
        break;
      }

      case "send": {
        if (!args) {
          sysLog.addSystem("uso: /send <messaggio>");
          break;
        }
        if (!state.chatTargetSession) {
          sysLog.addSystem("nessun agente selezionato — usa /chat <agente> prima");
          break;
        }
        await sendMessage(args);
        break;
      }

      case "start": {
        if (!args) {
          sysLog.addSystem("uso: /start <agente>  (es. /start scout)");
          const sessions = listJhtSessions();
          if (sessions.length > 0) {
            sysLog.addSystem("sessioni attive: " + sessions.map((s) => s.name).join(", "));
          }
          break;
        }
        const startResult = startSession(args, loadWorkspacePath() || undefined);
        if (startResult.ok) {
          sysLog.addSystem(`sessione ${startResult.name} avviata`);
          setActivityStatus(`avviato ${startResult.name}`);
          state.activeTmuxCount = listJhtSessions().length;
          context.refreshCurrentView();
        } else {
          sysLog.addSystem(`errore: ${startResult.error ?? "impossibile avviare"} (${startResult.name})`);
        }
        break;
      }

      case "stop": case "kill": {
        if (!args) {
          sysLog.addSystem("uso: /stop <agente>  (es. /stop scout)");
          const sessions = listJhtSessions();
          if (sessions.length > 0) {
            sysLog.addSystem("sessioni attive: " + sessions.map((s) => s.name).join(", "));
          }
          break;
        }
        const targetSession = resolveSessionName(args) ?? args;
        const stopResult = stopSession(targetSession);
        if (stopResult.ok) {
          sysLog.addSystem(`sessione ${targetSession} fermata`);
          setActivityStatus(`fermato ${targetSession}`);
          state.activeTmuxCount = listJhtSessions().length;
          if (state.chatTargetSession === targetSession) {
            state.chatTargetSession = null;
          }
          context.refreshCurrentView();
        } else {
          sysLog.addSystem(`errore: ${stopResult.error ?? "impossibile fermare"} (${targetSession})`);
        }
        break;
      }

      case "refresh":
        context.refreshCurrentView();
        sysLog.addSystem("aggiornato");
        break;

      case "status":
        if (!state.isConnected) {
          sysLog.addSystem("API: non connesso — usa /setup <API_KEY>");
        } else {
          try {
            const s = await context.client.getStatus();
            if (s && typeof s === "object") {
              const r = s as Record<string, unknown>;
              const parts: string[] = [];
              if (r.model) parts.push(`model: ${r.model}`);
              if (r.historyLength !== undefined) parts.push(`history: ${r.historyLength}`);
              parts.push("API: connesso");
              for (const p of parts) sysLog.addSystem(p);
            }
          } catch (err) { sysLog.addSystem(`status fallito: ${String(err)}`); }
        }
        sysLog.addSystem(`tmux: ${state.activeTmuxCount} sessioni agenti`);
        sysLog.addSystem(`vista: ${state.currentView}`);
        break;

      case "abort":
        if (!state.activeChatRunId) { sysLog.addSystem("nessun run AI attivo"); break; }
        try {
          await context.client.abortRun(state.currentSessionKey);
          sysLog.addSystem("run AI interrotto");
        } catch (err) { sysLog.addSystem(`abort fallito: ${String(err)}`); }
        break;

      case "new":
        state.currentSessionKey = `jht-${randomUUID()}`;
        sysLog.addSystem(`nuova sessione AI: ${state.currentSessionKey}`);
        break;

      case "profile": {
        if (args === "show") {
          const profile = loadProfile();
          chatLog.addSystem("profilo utente:");
          for (const line of formatProfile(profile)) chatLog.addSystem(line);
          chatLog.addSystem(profile.completato ? "  Stato: completo" : "  Stato: incompleto");
          break;
        }
        context.startProfileWizard?.();
        break;
      }

      case "deploy": {
        sysLog.addSystem("deploy Vercel in corso...");
        setActivityStatus("deploying");
        requestRender();

        // Trova la cartella web/ risalendo dalla cwd
        const webDir = path.resolve(process.cwd(), "web");
        const child = spawn("npx", ["vercel", "--prod", "--yes"], {
          cwd: webDir,
          shell: true,
          stdio: ["ignore", "pipe", "pipe"],
        });

        let output = "";
        const onData = (chunk: Buffer) => {
          const text = chunk.toString().trim();
          if (text) {
            output += text + "\n";
            // Mostra le righe significative
            for (const line of text.split("\n")) {
              const trimmed = line.trim();
              if (trimmed && !trimmed.startsWith("Vercel CLI")) {
                sysLog.addSystem(`  ${trimmed}`);
              }
            }
            requestRender();
          }
        };
        child.stdout?.on("data", onData);
        child.stderr?.on("data", onData);

        child.on("close", (code) => {
          if (code === 0) {
            // Estrai URL dal output
            const urlMatch = output.match(/https:\/\/[^\s]+\.vercel\.app/);
            sysLog.addSystem(urlMatch ? `deploy completato: ${urlMatch[0]}` : "deploy completato");
            setActivityStatus("deployed");
          } else {
            sysLog.addSystem(`deploy fallito (exit ${code})`);
            setActivityStatus("deploy error");
          }
          requestRender();
        });

        child.on("error", (err) => {
          sysLog.addSystem(`errore deploy: ${err.message}`);
          setActivityStatus("deploy error");
          requestRender();
        });
        break;
      }

      case "setup": {
        if (!args) {
          sysLog.addSystem("uso: /setup <ANTHROPIC_API_KEY>");
          sysLog.addSystem("La chiave inizia con sk-ant- — trovala su console.anthropic.com");
          break;
        }
        // Validazione prefisso API key
        if (!args.startsWith("sk-ant-")) {
          sysLog.addSystem("chiave non valida — deve iniziare con sk-ant-");
          sysLog.addSystem("Questa sembra una chiave OpenAI, non Anthropic.");
          break;
        }
        if (context.reconnect) {
          const ok = context.reconnect(args);
          sysLog.addSystem(ok ? "connesso ad Anthropic API" : "errore connessione — verifica la chiave");
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
