/**
 * Dashboard Panel — budget sentinella, stato deploy, riepilogo task.
 * Legge ~/.jht-dev/tasks/ e ~/.jht/sentinel-log.txt.
 * Pattern: Container con figli Text (come TaskPanel).
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { Container, Text } from "@mariozechner/pi-tui";
import { theme } from "../tui-theme.js";

// ── Types ─────────────────────────────────────────────────────────

interface SentinelEntry {
  timestamp: string;
  usage: number;
  velocita: string;
  proiezione: string;
  livello: "OK" | "ATTENZIONE" | "CRITICO" | "SOTTOUTILIZZO" | string;
}

interface TaskCount { stato: string; count: number; }

// ── Paths ─────────────────────────────────────────────────────────

const TASKS_DIR = path.join(os.homedir(), ".jht-dev", "tasks");
const SENTINEL_LOG = path.join(os.homedir(), ".jht", "sentinel-log.txt");

// ── Parsers ───────────────────────────────────────────────────────

function parseSentinel(): SentinelEntry | null {
  try {
    if (!fs.existsSync(SENTINEL_LOG)) return null;
    const content = fs.readFileSync(SENTINEL_LOG, "utf-8");
    const lines = content.trim().split("\n").filter(l => l.includes("usage="));
    const last = lines[lines.length - 1];
    if (!last) return null;

    const timestamp = last.match(/\[([^\]]+)\]/)?.[1] ?? "";
    const usage = parseInt(last.match(/usage=(\d+)%/)?.[1] ?? "0", 10);
    const velocita = last.match(/velocita=([^|]+)/)?.[1]?.trim() ?? "?";
    const proiezione = last.match(/proiezione_reset=([^|%]+%?)/)?.[1]?.trim()
                    ?? last.match(/proiezione_al_reset=([^|%]+%?)/)?.[1]?.trim()
                    ?? "?";

    let livello = "OK";
    if (last.includes("CRITICO")) livello = "CRITICO";
    else if (last.includes("ATTENZIONE")) livello = "ATTENZIONE";
    else if (last.includes("SOTTOUTILIZZO")) livello = "SOTTOUTILIZZO";

    return { timestamp, usage, velocita, proiezione, livello };
  } catch { return null; }
}

function countTasksByStatus(): TaskCount[] {
  try {
    if (!fs.existsSync(TASKS_DIR)) return [];
    const files = fs.readdirSync(TASKS_DIR).filter(f => f.startsWith("task-") && f.endsWith(".md"));
    const counts: Record<string, number> = {};

    for (const file of files) {
      try {
        const content = fs.readFileSync(path.join(TASKS_DIR, file), "utf-8");
        const stato = content.match(/^stato:\s*(.+)$/m)?.[1]?.trim() ?? "unknown";
        counts[stato] = (counts[stato] ?? 0) + 1;
      } catch { /* skip */ }
    }

    return Object.entries(counts).map(([stato, count]) => ({ stato, count }));
  } catch { return []; }
}

function detectDeployUrl(): string | null {
  try {
    const vercelJson = path.join(process.cwd(), "web", ".vercel", "project.json");
    if (fs.existsSync(vercelJson)) {
      const data = JSON.parse(fs.readFileSync(vercelJson, "utf-8"));
      if (data.projectName) return `${data.projectName}.vercel.app`;
    }
  } catch { /* ignore */ }
  return null;
}

// ── Render helpers ────────────────────────────────────────────────

function budgetBar(usage: number, width: number = 20): string {
  const filled = Math.round((usage / 100) * width);
  const empty = width - filled;
  const bar = "\u2588".repeat(filled) + "\u2591".repeat(empty);
  const colorFn = usage >= 80 ? theme.error : usage >= 60 ? theme.warning : theme.success;
  return colorFn(bar);
}

function budgetLevelColor(livello: string): (t: string) => string {
  switch (livello) {
    case "CRITICO":       return theme.error;
    case "ATTENZIONE":    return theme.warning;
    case "SOTTOUTILIZZO": return theme.accentSoft;
    default:              return theme.success;
  }
}

function statusColor(stato: string): (t: string) => string {
  switch (stato) {
    case "done": case "merged":      return theme.success;
    case "in-progress":              return theme.warning;
    case "rejected": case "blocked": return theme.error;
    default:                         return theme.dim;
  }
}

// ── Dashboard Panel ───────────────────────────────────────────────

export class DashboardPanel extends Container {
  refresh(): void {
    this.clear();

    const hr = theme.border("  " + "\u2500".repeat(60));

    this.add(theme.header("  \u25A0 DASHBOARD"));
    this.add(hr);

    // ── Budget Sentinella ──
    this.add(theme.accent("  BUDGET SENTINELLA"));
    const s = parseSentinel();
    if (s) {
      const levelFn = budgetLevelColor(s.livello);
      this.add(`  ${budgetBar(s.usage)} ${theme.bold(`${s.usage}%`)}  ${levelFn(s.livello)}`);
      this.add(`  ${theme.dim("vel:")} ${theme.text(s.velocita)}  ${theme.dim("proiezione:")} ${theme.text(s.proiezione)}`);
      this.add(`  ${theme.dim(s.timestamp)}`);
    } else {
      this.add(`  ${theme.dim("nessun log sentinella")}`);
    }
    this.add("");

    // ── Deploy ──
    this.add(theme.accent("  DEPLOY"));
    const deployUrl = detectDeployUrl();
    if (deployUrl) {
      this.add(`  ${theme.success("\u25CF")} ${theme.text(deployUrl)}`);
    } else {
      this.add(`  ${theme.dim("\u25CB nessun deploy rilevato")}`);
    }
    this.add("");

    // ── Task Riepilogo ──
    const taskCounts = countTasksByStatus();
    const total = taskCounts.reduce((sum, t) => sum + t.count, 0);
    this.add(`${theme.accent("  TASK")} ${theme.dim(`(${total} totali)`)}`);

    if (taskCounts.length === 0) {
      this.add(`  ${theme.dim("nessun task trovato")}`);
    } else {
      for (const { stato, count } of taskCounts) {
        const colorFn = statusColor(stato);
        this.add(`  ${colorFn(stato.padEnd(14))} ${theme.text(String(count))}`);
      }
    }

    this.add(hr);
    this.add(theme.dim("  /dashboard | /tasks per dettaglio | auto-refresh 10s"));
  }

  private add(text: string) {
    this.addChild(new Text(text, 0, 0));
  }
}
