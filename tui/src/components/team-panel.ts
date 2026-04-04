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

type AgentDef = { id: string; label: string; desc: string; aliases: string[] };

const KNOWN_AGENTS: AgentDef[] = [
  { id: "gatekeeper", label: "Master", desc: "merge & review", aliases: ["master", "gatekeeper"] },
  { id: "coord", label: "Coordinatore", desc: "orchestrazione", aliases: ["coord", "ace", "coordinatore"] },
  { id: "fullstack", label: "Fullstack-1", desc: "fullstack dev", aliases: ["fullstack", "dot", "fullstack-1"] },
  { id: "fullstack_2", label: "Fullstack-2", desc: "fullstack dev", aliases: ["fullstack_2", "rex", "fullstack-2"] },
  { id: "fullstack_3", label: "Fullstack-3", desc: "fullstack dev", aliases: ["fullstack_3", "kai", "fullstack-3"] },
  { id: "sentinel", label: "Sentinel", desc: "monitoring costi", aliases: ["sentinel", "sol"] },
  { id: "scout", label: "Scout", desc: "ricerca opportunita", aliases: ["scout"] },
  { id: "analista", label: "Analista", desc: "analisi offerte", aliases: ["analista"] },
  { id: "scorer", label: "Scorer", desc: "scoring candidature", aliases: ["scorer"] },
  { id: "scrittore", label: "Scrittore", desc: "cover letter & CV", aliases: ["scrittore"] },
  { id: "critico", label: "Critico", desc: "review & feedback", aliases: ["critico"] },
  { id: "sentinella", label: "Sentinella", desc: "monitoring", aliases: ["sentinella"] },
  { id: "assistente", label: "Assistente", desc: "supporto utente", aliases: ["assistente"] },
  { id: "alfa", label: "Alfa", desc: "agente generico", aliases: ["alfa"] },
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
  refresh(sessions: TmuxSession[], tasks: JhtTask[] = []) {
    this.clear();
    const sessionMap = new Map(sessions.map((s) => [s.agentId, s]));

    this.add(theme.accent("  TEAM JHT — Stato Agenti"));
    this.add(theme.border("  " + "\u2500".repeat(60)));
    this.add("");

    let activeCount = 0;
    for (const agent of KNOWN_AGENTS) {
      const session = sessionMap.get(agent.id);
      const isActive = !!session;
      if (isActive) activeCount++;

      const icon = isActive ? theme.success("\u25CF") : theme.dim("\u25CB");
      const status = isActive ? theme.success("attivo") : theme.dim("offline");
      const label = isActive ? theme.text(agent.label) : theme.dim(agent.label);

      this.add(`  ${icon} ${label} \u2014 ${status} \u2014 ${theme.dim(agent.desc)}`);

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
    this.add(theme.dim("  /start <id>  avvia  \u2502  /stop <id>  ferma  \u2502  /chat <id>  parla"));
  }

  private add(text: string) {
    this.addChild(new Text(text, 0, 0));
  }
}
