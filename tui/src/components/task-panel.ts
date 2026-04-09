/**
 * TaskPanel — dashboard task del team JHT.
 * Legge i task da ~/.jht-dev/tasks/ e li mostra raggruppati per stato.
 */
import { Container, Text } from "@mariozechner/pi-tui";
import { theme } from "../tui-theme.js";
import { loadProfile } from "../tui-profile.js";
import type { JhtTask } from "../tui-tasks.js";

/** Filtra task interni del team dev (task-fs-*, task-gk-*, ecc.) */
function isUserTask(t: JhtTask): boolean {
  return !(/^task-(fs|gk|rx|ka|rc|sc|cr|se|al|ac)-/i.test(t.id));
}

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

    this.add(theme.accent("  TASK \u2014 Le Tue Ricerche"));
    this.add(theme.border("  " + "\u2500".repeat(60)));
    this.add("");

    // Filtra: mostra solo task utente, non quelli interni dev
    const userTasks = tasks.filter(isUserTask);

    if (userTasks.length === 0) {
      const profile = loadProfile();
      this.add(theme.text("  Nessuna ricerca attiva."));
      this.add("");
      if (profile.completato) {
        this.add(theme.dim("  Il team sta analizzando il tuo profilo."));
        this.add(theme.dim("  Le ricerche appariranno qui appena avviate."));
      } else {
        this.add(theme.warning("  Completa il profilo per avviare le ricerche."));
        this.add(theme.dim("  Usa /profile per impostare competenze e zona."));
      }
      this.add("");

      // Mostra sommario team dev in modo discreto
      if (tasks.length > 0) {
        const inProgress = tasks.filter((t) => t.stato === "in-progress").length;
        const done = tasks.filter((t) => t.stato === "done" || t.stato === "merged").length;
        this.add(theme.border("  " + "\u2500".repeat(60)));
        this.add(theme.dim(`  Team: ${inProgress} task attivi, ${done} completati`));
      }
      return;
    }

    const groups = new Map<string, JhtTask[]>();
    for (const t of userTasks) {
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
    this.add(`  Ricerche: ${theme.accent(String(userTasks.length))}`);
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
