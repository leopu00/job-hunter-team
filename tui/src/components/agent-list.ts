import { Text } from "@mariozechner/pi-tui";
import { theme } from "../tui-theme.js";
import type { JhtAgent, AgentStatus } from "../tui-types.js";

const PANEL_WIDTH = 28;

function padRight(str: string, len: number): string {
  if (str.length >= len) return str.slice(0, len);
  return str + " ".repeat(len - str.length);
}

function formatTokensShort(tokens: number | null | undefined): string {
  if (tokens == null) return "";
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}k`;
  return String(tokens);
}

function renderAgentRow(agent: JhtAgent, isSelected: boolean): string {
  const icon = theme.agentStatusIcon(agent.status);
  const colorFn = theme.agentStatus(agent.status);
  const statusIcon = colorFn(icon);

  const nameMaxLen = 14;
  const name = padRight(agent.name, nameMaxLen);
  const nameStr = isSelected
    ? theme.bold(theme.accent(name))
    : theme.text(name);

  const tokStr = formatTokensShort(agent.totalTokens);
  const tokLabel = tokStr ? theme.dim(tokStr.padStart(6)) : "      ";

  const selector = isSelected ? theme.accent(">") : " ";
  return `${selector} ${statusIcon} ${nameStr} ${tokLabel}`;
}

function renderHeader(): string {
  const label = padRight("AGENTI", PANEL_WIDTH - 2);
  return theme.header(` ${label}`);
}

function renderDivider(): string {
  return theme.border("─".repeat(PANEL_WIDTH));
}

export class AgentList {
  private textNode: Text;
  private agents: JhtAgent[] = [];
  private selectedAgentId: string | null = null;

  constructor() {
    this.textNode = new Text("", 0, 0);
  }

  getNode(): Text {
    return this.textNode;
  }

  setAgents(agents: JhtAgent[]): void {
    this.agents = agents;
    this.render();
  }

  setSelectedAgent(agentId: string | null): void {
    this.selectedAgentId = agentId;
    this.render();
  }

  selectNext(): string | null {
    if (this.agents.length === 0) return null;
    const idx = this.agents.findIndex((a) => a.id === this.selectedAgentId);
    const next = this.agents[(idx + 1) % this.agents.length];
    if (next) {
      this.selectedAgentId = next.id;
      this.render();
      return next.id;
    }
    return null;
  }

  selectPrev(): string | null {
    if (this.agents.length === 0) return null;
    const idx = this.agents.findIndex((a) => a.id === this.selectedAgentId);
    const prevIdx = (idx - 1 + this.agents.length) % this.agents.length;
    const prev = this.agents[prevIdx];
    if (prev) {
      this.selectedAgentId = prev.id;
      this.render();
      return prev.id;
    }
    return null;
  }

  private render(): void {
    const lines: string[] = [];
    lines.push(renderHeader());
    lines.push(renderDivider());

    if (this.agents.length === 0) {
      lines.push(theme.dim("  nessun agente connesso"));
    } else {
      for (const agent of this.agents) {
        const isSelected = agent.id === this.selectedAgentId;
        lines.push(renderAgentRow(agent, isSelected));
      }
    }

    lines.push(renderDivider());
    lines.push(theme.dim(" ↑↓ naviga  Tab seleziona"));

    this.textNode.setText(lines.join("\n"));
  }
}
