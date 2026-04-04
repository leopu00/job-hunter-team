/**
 * TeamPanel — vista panoramica del team JHT.
 * Mostra tutti gli agenti con stato tmux reale e ultima attività.
 * Ispirato alla struttura di OpenClaw ChatLog (Container con figli Text).
 */
import { Container, Text } from "@mariozechner/pi-tui";
import { theme } from "../tui-theme.js";
import type { TmuxSession } from "../tui-tmux.js";
import { capturePane } from "../tui-tmux.js";

type AgentDef = { id: string; label: string; desc: string };

const KNOWN_AGENTS: AgentDef[] = [
  { id: "gatekeeper", label: "Master", desc: "merge & review" },
  { id: "fullstack", label: "Fullstack-1", desc: "fullstack dev" },
  { id: "fullstack_2", label: "Fullstack-2", desc: "coordinatore" },
  { id: "scout", label: "Scout", desc: "ricerca opportunità" },
  { id: "analista", label: "Analista", desc: "analisi offerte" },
  { id: "scorer", label: "Scorer", desc: "scoring candidature" },
  { id: "scrittore", label: "Scrittore", desc: "cover letter & CV" },
  { id: "critico", label: "Critico", desc: "review & feedback" },
  { id: "sentinella", label: "Sentinella", desc: "monitoring" },
];

export class TeamPanel extends Container {
  refresh(sessions: TmuxSession[]) {
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

      if (isActive) {
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

    this.add("");
    this.add(theme.border("  " + "\u2500".repeat(60)));
    this.add(`  ${theme.accent(String(activeCount + extra.length))} agenti attivi su ${KNOWN_AGENTS.length}`);
    this.add("");
    this.add(theme.dim("  /start <id>  avvia  \u2502  /stop <id>  ferma  \u2502  /chat <id>  parla"));
  }

  private add(text: string) {
    this.addChild(new Text(text, 0, 0));
  }
}
