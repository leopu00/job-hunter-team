import { Text } from "@mariozechner/pi-tui";
import { theme } from "../tui-theme.js";
import type { JhtAgent } from "../tui-types.js";

function formatTokens(total: number | null | undefined, context: number | null | undefined): string {
  if (total == null) return "";
  const totalStr =
    total >= 1_000_000
      ? `${(total / 1_000_000).toFixed(1)}M`
      : total >= 1_000
        ? `${Math.round(total / 1_000)}k`
        : String(total);
  if (context != null && context > 0) {
    const pct = Math.round((total / context) * 100);
    return `tok ${totalStr}/${Math.round(context / 1000)}k (${pct}%)`;
  }
  return `tok ${totalStr}`;
}

const QUICK_COMMANDS = [
  ["Tab", "viste"],
  ["↑↓", "seleziona"],
  ["←→", "domande"],
  ["Enter", "apri"],
  ["/chat", "agente"],
  ["/start", "agente"],
  ["Ctrl+C", "esci"],
];

export class StatusBar {
  private textNode: Text;

  constructor() {
    this.textNode = new Text("", 1, 0);
  }

  getNode(): Text {
    return this.textNode;
  }

  update(params: {
    connectionStatus: string;
    activityStatus: string;
    selectedAgent: JhtAgent | null;
    workingAgents: number;
    currentView?: string;
  }): void {
    const { connectionStatus, activityStatus, selectedAgent, workingAgents, currentView } = params;

    const parts: string[] = [];

    // Stato connessione
    parts.push(theme.dim(connectionStatus));

    // Agenti summary
    parts.push(theme.dim(`${workingAgents} agenti attivi`));

    // Token agente selezionato
    if (selectedAgent) {
      const tokStr = formatTokens(selectedAgent.totalTokens, selectedAgent.contextTokens);
      if (tokStr) {
        parts.push(theme.dim(`[${selectedAgent.name}] ${tokStr}`));
      }
    }

    // Stato attività
    if (activityStatus && activityStatus !== "idle") {
      parts.push(theme.accentSoft(activityStatus));
    }

    const statusLine = parts.join(theme.dim(" │ "));
    if (currentView === "profile") {
      this.textNode.setText(statusLine);
      return;
    }

    // Comandi rapidi
    const cmdParts = QUICK_COMMANDS.map(
      ([key, label]) => `${theme.accent(key!)} ${theme.dim(label!)}`,
    );
    const cmdLine = cmdParts.join("  ");

    this.textNode.setText(`${statusLine}\n${cmdLine}`);
  }
}
