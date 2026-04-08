/**
 * TeamPanel — vista dedicata agli agenti del team.
 */
import { Container, Text } from "@mariozechner/pi-tui";
import { theme } from "../tui-theme.js";
import type { TmuxSession } from "../tui-tmux.js";

type AgentDef = { id: string; label: string; emoji: string };

const AGENTS: AgentDef[] = [
  { id: "scout", label: "Scout", emoji: "🕵️" },
  { id: "analista", label: "Analista", emoji: "👨‍🔬" },
  { id: "assistente", label: "Assistente", emoji: "🧑‍💼" },
  { id: "critico", label: "Critico", emoji: "👨‍⚖️" },
  { id: "scorer", label: "Scorer", emoji: "👨‍💻" },
  { id: "scrittore", label: "Scrittore", emoji: "👨‍🏫" },
  { id: "sentinella", label: "Sentinella", emoji: "💂" },
  { id: "alfa", label: "Alfa", emoji: "👨‍✈️" },
];

export class TeamPanel extends Container {
  refresh(sessions: TmuxSession[]) {
    this.clear();

    const sessionMap = new Map(sessions.map((session) => [session.agentId, session]));

    this.add("");
    this.add(`  ${theme.accent("Team")}`);
    this.add(`  ${theme.dim(`${sessions.length} sessioni attive`)}`);
    this.add(theme.border("  " + "─".repeat(60)));
    this.add("");

    for (const agent of AGENTS) {
      const session = sessionMap.get(agent.id);
      const status = session ? theme.success("● online") : theme.dim("○ offline");
      const details = session
        ? theme.dim(` · ${session.name}${session.attached ? " · attached" : " · background"}`)
        : theme.dim(" · usa /start " + agent.id);
      this.add(`  ${status}  ${agent.emoji} ${theme.text(agent.label)}${details}`);
    }

    this.add("");
    this.add(theme.border("  " + "─".repeat(60)));
    this.add(theme.dim("  /chat <agente> · /start <agente> · /stop <agente>"));
  }

  private add(text: string) {
    this.addChild(new Text(text, 0, 0));
  }
}
