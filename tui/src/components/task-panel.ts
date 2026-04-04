/**
 * TaskPanel — dashboard task del team JHT.
 * Legge i task da ~/.jht-dev/tasks/ e li mostra raggruppati per stato.
 * Pattern copiato da OpenClaw ChatLog (Container con figli dinamici).
 */
import { Container, Text } from "@mariozechner/pi-tui";
import { theme } from "../tui-theme.js";
import type { JhtTask } from "../tui-tasks.js";

const STATUS_ORDER = ["in-progress", "done", "merged", "rejected", "blocked"];

const statusStyle = (stato: string) => {
  switch (stato) {
    case "in-progress": return { icon: "\u25D0", color: theme.warning };
    case "done":        return { icon: "\u2713", color: theme.success };
    case "merged":      return { icon: "\u2713\u2713", color: theme.success };
    case "rejected":    return { icon: "\u2717", color: theme.error };
    case "blocked":     return { icon: "\u2298", color: theme.dim };
    default:            return { icon: "?", color: theme.dim };
  }
};

export class TaskPanel extends Container {
  refresh(tasks: JhtTask[]) {
    this.clear();

    this.add(theme.accent("  TASK \u2014 Dashboard"));
    this.add(theme.border("  " + "\u2500".repeat(60)));
    this.add("");

    if (tasks.length === 0) {
      this.add(theme.dim("  Nessun task trovato in ~/.jht-dev/tasks/"));
      return;
    }

    const groups = new Map<string, JhtTask[]>();
    for (const t of tasks) {
      const s = t.stato || "unknown";
      if (!groups.has(s)) groups.set(s, []);
      groups.get(s)!.push(t);
    }

    const shown = new Set<string>();
    for (const status of STATUS_ORDER) {
      const group = groups.get(status);
      if (!group) continue;
      shown.add(status);
      this.renderGroup(status, group);
    }
    for (const [status, group] of groups) {
      if (shown.has(status)) continue;
      this.renderGroup(status, group);
    }

    this.add(theme.border("  " + "\u2500".repeat(60)));
    this.add(`  Totale: ${theme.accent(String(tasks.length))} task`);
  }

  private renderGroup(status: string, tasks: JhtTask[]) {
    const { icon, color } = statusStyle(status);
    this.add(`  ${color(`${icon} ${status.toUpperCase()}`)} (${tasks.length})`);
    const limit = 8;
    for (const t of tasks.slice(0, limit)) {
      const desc = t.richiesta.length > 52 ? t.richiesta.slice(0, 52) + "\u2026" : t.richiesta;
      this.add(`    ${theme.dim(t.id)} ${theme.text(desc)}`);
    }
    if (tasks.length > limit) {
      this.add(theme.dim(`    \u2026 e altri ${tasks.length - limit}`));
    }
    this.add("");
  }

  private add(text: string) {
    this.addChild(new Text(text, 0, 0));
  }
}
