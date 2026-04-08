/**
 * TeamPanel — vista panoramica del team JHT.
 * Mostra tutti gli agenti con stato tmux reale, ultima attività e task assegnati.
 * Ispirato alla struttura di OpenClaw ChatLog (Container con figli Text).
 */
import { Container, Text } from "@mariozechner/pi-tui";
import { theme } from "../tui-theme.js";
import type { TmuxSession } from "../tui-tmux.js";
import { capturePane } from "../tui-tmux.js";
import type { JhtTask } from "../tui-tasks.js";
import { getMissingProfileFields, isProfileComplete, loadProfile } from "../tui-profile.js";

type AgentDef = { id: string; label: string; emoji: string; desc: string; aliases: string[] };
export type TeamAction = { id: string; label: string; hint: string; command: string };

const KNOWN_AGENTS: AgentDef[] = [
  { id: "scout", label: "Scout", emoji: "🕵️", desc: "ricerca opportunita", aliases: ["scout"] },
  { id: "analista", label: "Analista", emoji: "👨‍🔬", desc: "analisi offerte", aliases: ["analista"] },
  { id: "assistente", label: "Assistente", emoji: "🧑‍💼", desc: "supporto utente", aliases: ["assistente"] },
  { id: "critico", label: "Critico", emoji: "👨‍⚖️", desc: "review finale", aliases: ["critico"] },
  { id: "scorer", label: "Scorer", emoji: "👨‍💻", desc: "scoring candidature", aliases: ["scorer"] },
  { id: "scrittore", label: "Scrittore", emoji: "👨‍🏫", desc: "cv e cover letter", aliases: ["scrittore"] },
  { id: "sentinella", label: "Sentinella", emoji: "💂", desc: "monitoring", aliases: ["sentinella"] },
  { id: "alfa", label: "Alfa", emoji: "👨‍✈️", desc: "capitano", aliases: ["alfa"] },
];

/** Trova il task in-progress assegnato a un agente */
function findAgentTask(agent: AgentDef, tasks: JhtTask[]): JhtTask | null {
  return tasks.find((t) => {
    if (t.stato !== "in-progress") return false;
    const assignee = t.assegnato_a.toLowerCase();
    return agent.aliases.some((a) => assignee.includes(a));
  }) ?? null;
}

export class TeamPanel extends Container {
  private actions: TeamAction[] = [];
  private selectedActionIndex = 0;

  refresh(sessions: TmuxSession[], tasks: JhtTask[] = [], options?: { selectedActionIndex?: number }) {
    this.clear();
    const sessionMap = new Map(sessions.map((s) => [s.agentId, s]));
    const profile = loadProfile();
    const profileReady = isProfileComplete(profile);
    const missingFields = getMissingProfileFields(profile);
    this.actions = this.buildActions(profileReady, sessions);
    this.selectedActionIndex = this.normalizeSelectedIndex(options?.selectedActionIndex ?? this.selectedActionIndex);

    this.add(theme.accent("  TEAM JHT — Stato Agenti"));
    this.add(theme.border("  " + "\u2500".repeat(60)));
    this.add("");

    if (!profileReady) {
      this.add(theme.warning("  ⚠ PROFILO NON CONFIGURATO"));
      this.add(theme.dim(`  Mancano: ${missingFields.join(", ") || "dati profilo"}`));
      this.add(theme.dim("  Usa /profile per completarlo prima di avviare il team."));
      this.add("");
    }

    if (this.actions.length > 0) {
      this.add(theme.accent("  AZIONI"));
      for (const [index, action] of this.actions.entries()) {
        this.add(this.renderAction(action, index === this.selectedActionIndex));
      }
      this.add("");
    }

    let activeCount = 0;
    for (const agent of KNOWN_AGENTS) {
      const session = sessionMap.get(agent.id);
      const isActive = !!session;
      if (isActive) activeCount++;

      const icon = isActive ? theme.success("●") : theme.dim("○");
      const status = isActive ? theme.success("attivo") : theme.dim("offline");
      const label = isActive ? theme.text(agent.label) : theme.dim(agent.label);

      this.add(`  ${icon} ${agent.emoji} ${label}  ${theme.dim("·")} ${status}  ${theme.dim("· " + agent.desc)}`);

      // Mostra task in-progress assegnato a questo agente
      const task = findAgentTask(agent, tasks);
      if (task) {
        const richiesta = task.richiesta.length > 55
          ? task.richiesta.slice(0, 55) + "\u2026"
          : task.richiesta;
        this.add(`    ${theme.warning("\u25B8")} ${theme.dim(task.id)} ${theme.text(richiesta)}`);
      }

      // Ultima riga di output tmux (solo per agenti attivi senza task)
      if (isActive && !task) {
        const lastLines = capturePane(session.name, 3);
        const lastLine = lastLines[lastLines.length - 1];
        if (lastLine) {
          this.add(`    ${theme.dim("\u2514 " + lastLine.slice(0, 70))}`);
        }
      }
    }

    // Sessioni non in KNOWN_AGENTS (lab-*, ecc.)
    const knownIds = new Set(KNOWN_AGENTS.map((a) => a.id));
    const extra = sessions.filter((s) => !knownIds.has(s.agentId));
    if (extra.length > 0) {
      this.add("");
      this.add(theme.dim("  Altre sessioni:"));
      for (const s of extra) {
        this.add(`  ${theme.success("\u25CF")} ${theme.text(s.name)} ${s.attached ? theme.dim("(attached)") : ""}`);
      }
    }

    // Sommario task
    const inProgress = tasks.filter((t) => t.stato === "in-progress").length;
    const done = tasks.filter((t) => t.stato === "done" || t.stato === "merged").length;

    this.add("");
    this.add(theme.border("  " + "\u2500".repeat(60)));
    const totalActive = activeCount + extra.length;
    this.add(
      `  ${theme.accent(String(totalActive))} agenti attivi` +
      theme.dim(" \u2502 ") +
      `${theme.warning(String(inProgress))} task in corso` +
      theme.dim(" \u2502 ") +
      `${theme.success(String(done))} completati`,
    );
    this.add("");
    this.add(theme.dim("  ↑/↓ seleziona  │  Enter esegue  │  /start <id>  │  /chat <id>"));
  }

  hasActions(): boolean {
    return this.actions.length > 0;
  }

  getSelectedActionIndex(): number {
    return this.selectedActionIndex;
  }

  moveSelection(delta: number): boolean {
    if (this.actions.length === 0) return false;
    const next = this.normalizeSelectedIndex(this.selectedActionIndex + delta);
    if (next === this.selectedActionIndex) return false;
    this.selectedActionIndex = next;
    return true;
  }

  activateSelectedAction(): TeamAction | null {
    return this.actions[this.selectedActionIndex] ?? null;
  }

  private normalizeSelectedIndex(index: number): number {
    if (this.actions.length === 0) return 0;
    if (index < 0) return this.actions.length - 1;
    if (index >= this.actions.length) return 0;
    return index;
  }

  private buildActions(profileReady: boolean, sessions: TmuxSession[]): TeamAction[] {
    const assistenteActive = sessions.some((s) => s.agentId === "assistente");
    const scoutActive = sessions.some((s) => s.agentId === "scout");
    const actions: TeamAction[] = [];

    if (!profileReady) {
      actions.push({
        id: "profile",
        label: "Configura profilo",
        hint: "completa nome, competenze, zona e tipo lavoro",
        command: "/profile",
      });
    }

    actions.push({
      id: "dashboard",
      label: "Apri dashboard",
      hint: "riepilogo profilo, task e team",
      command: "/dashboard",
    });

    actions.push(assistenteActive
      ? {
          id: "assistente-chat",
          label: "Apri chat Assistente",
          hint: "entra nella sessione assistente",
          command: "/chat assistente",
        }
      : {
          id: "assistente-start",
          label: "Avvia Assistente",
          hint: "crea la sessione tmux dell'assistente",
          command: "/start assistente",
        });

    actions.push(scoutActive
      ? {
          id: "scout-chat",
          label: "Apri chat Scout",
          hint: "entra nella sessione scout",
          command: "/chat scout",
        }
      : {
          id: "scout-start",
          label: "Avvia Scout",
          hint: "crea la sessione tmux dello scout",
          command: "/start scout",
        });

    return actions;
  }

  private renderAction(action: TeamAction, selected: boolean): string {
    const line = `  ${selected ? "❯" : " "} ${action.label} · ${action.hint}`;
    if (!selected) return theme.dim(line);
    return theme.selectedRow(theme.bold(line));
  }

  private add(text: string) {
    this.addChild(new Text(text, 0, 0));
  }
}
