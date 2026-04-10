/**
 * TeamPanel — vista dedicata agli agenti del team.
 * Lista navigabile: frecce per selezionare, Enter per agire.
 */
import { Container, Text } from "@mariozechner/pi-tui";
import { theme } from "../tui-theme.js";
import type { TmuxSession } from "../tui-tmux.js";

type AgentDef = { id: string; label: string; emoji: string };

const AGENTS: AgentDef[] = [
  { id: "scout", label: "Scout", emoji: "S" },
  { id: "analista", label: "Analista", emoji: "A" },
  { id: "assistente", label: "Assistente", emoji: "H" },
  { id: "critico", label: "Critico", emoji: "C" },
  { id: "scorer", label: "Scorer", emoji: "R" },
  { id: "scrittore", label: "Scrittore", emoji: "W" },
  { id: "sentinella", label: "Sentinella", emoji: "T" },
  { id: "alfa", label: "Alfa", emoji: "*" },
];

export class TeamPanel extends Container {
  private selectedIndex = 0;
  private lastSessions: TmuxSession[] = [];

  refresh(sessions: TmuxSession[]) {
    this.clear();
    this.lastSessions = sessions;

    const sessionMap = new Map(sessions.map((s) => [s.agentId, s]));
    const onlineCount = AGENTS.filter((a) => sessionMap.has(a.id)).length;

    this.add("");
    this.add(`  ${theme.accent("Team")}`);
    this.add(`  ${theme.dim(`${onlineCount}/${AGENTS.length} agenti online`)}`);
    this.add(theme.border("  " + "─".repeat(60)));

    for (let i = 0; i < AGENTS.length; i++) {
      const agent = AGENTS[i]!;
      const session = sessionMap.get(agent.id);
      const isSelected = i === this.selectedIndex;

      const indicator = session ? theme.success("●") : theme.dim("○");
      const statusTag = session ? theme.success("online") : theme.dim("offline");
      const label = isSelected
        ? theme.bold(theme.accent(`> ${agent.emoji} ${agent.label}`))
        : `  ${agent.emoji} ${agent.label}`;
      const details = session
        ? theme.dim(` · ${session.name}${session.attached ? " · attached" : ""}`)
        : "";
      const action = isSelected
        ? session
          ? theme.dim("  Enter: chat · x: stop")
          : theme.dim("  Enter: avvia")
        : "";

      this.add(`  ${indicator} ${statusTag}  ${label}${details}${action}`);
    }

    this.add("");
    this.add(theme.border("  " + "─".repeat(60)));
    this.add(`  ${theme.dim("↑↓ seleziona  ·  Enter avvia/chat  ·  x ferma  ·  1-7 cambia vista")}`);
  }

  moveSelection(delta: number): boolean {
    const newIndex = this.selectedIndex + delta;
    if (newIndex >= 0 && newIndex < AGENTS.length) {
      this.selectedIndex = newIndex;
      return true;
    }
    return false;
  }

  getSelectedAgent(): { id: string; isOnline: boolean; sessionName: string | null } | null {
    const agent = AGENTS[this.selectedIndex];
    if (!agent) return null;
    const session = this.lastSessions.find((s) => s.agentId === agent.id);
    return {
      id: agent.id,
      isOnline: !!session,
      sessionName: session?.name ?? null,
    };
  }

  private add(text: string) {
    this.addChild(new Text(text, 0, 0));
  }
}
