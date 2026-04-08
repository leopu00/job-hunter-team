/**
 * Dashboard Panel — profilo utente, stato team, info utili.
 * Pattern: Container con figli Text (come TaskPanel).
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { Container, Text } from "@mariozechner/pi-tui";
import { theme } from "../tui-theme.js";
import { loadProfile, loadWorkspacePath, isProfileComplete, formatProfile, getMissingProfileFields } from "../tui-profile.js";
import { listJhtSessions } from "../tui-tmux.js";

// ── Paths ─────────────────────────────────────────────────────────

const TASKS_DIR = path.join(os.homedir(), ".jht-dev", "tasks");

// ── Helpers ───────────────────────────────────────────────────────

function countTasks(): { active: number; done: number; total: number } {
  try {
    if (!fs.existsSync(TASKS_DIR)) return { active: 0, done: 0, total: 0 };
    const files = fs.readdirSync(TASKS_DIR).filter(f => f.startsWith("task-") && f.endsWith(".md"));
    let active = 0;
    let done = 0;
    for (const file of files) {
      try {
        const content = fs.readFileSync(path.join(TASKS_DIR, file), "utf-8");
        const stato = content.match(/^stato:\s*(.+)$/m)?.[1]?.trim() ?? "";
        if (stato === "in-progress") active++;
        else if (stato === "done" || stato === "merged") done++;
      } catch { /* skip */ }
    }
    return { active, done, total: files.length };
  } catch { return { active: 0, done: 0, total: 0 }; }
}

// ── Dashboard Panel ───────────────────────────────────────────────

export class DashboardPanel extends Container {
  refresh(): void {
    this.clear();

    const hr = theme.border("  " + "\u2500".repeat(60));

    this.add(theme.header("  \u25A0 DASHBOARD"));
    this.add(hr);

    const workspacePath = loadWorkspacePath();
    this.add(theme.accent("  CARTELLA DI LAVORO"));
    this.add(`  ${workspacePath || theme.dim("(non impostata)")}`);
    this.add("");

    // ── Profilo Utente ──
    const profile = loadProfile();
    const missingFields = getMissingProfileFields(profile);
    if (!isProfileComplete(profile)) {
      this.add(theme.warning("  ⚠ PROFILO NON CONFIGURATO"));
      this.add(theme.dim(`  Mancano: ${missingFields.join(", ") || "dati profilo"}`));
      this.add(theme.dim("  Completa il profilo con /profile prima di usare il team."));
      this.add("");
    }

    this.add(theme.accent("  IL TUO PROFILO"));
    if (profile.nome) {
      for (const line of formatProfile(profile)) this.add(line);
      if (isProfileComplete(profile)) {
        this.add(`  ${theme.success("\u2713")} ${theme.dim("Profilo completo")}`);
      } else {
        this.add(`  ${theme.warning("\u26A0")} ${theme.dim("Incompleto — usa /profile per completarlo")}`);
      }
    } else {
      this.add(`  ${theme.dim("Profilo non configurato — usa /profile")}`);
    }
    this.add("");

    // ── Stato Team ──
    const sessions = listJhtSessions();
    this.add(theme.accent("  STATO TEAM"));
    if (sessions.length > 0) {
      this.add(`  ${theme.success("\u25CF")} ${theme.bold(String(sessions.length))} agenti attivi`);
      for (const s of sessions.slice(0, 6)) {
        this.add(`    ${theme.text(s.name)} ${s.attached ? theme.success("(collegato)") : theme.dim("(background)")}`);
      }
      if (sessions.length > 6) {
        this.add(theme.dim(`    … e altri ${sessions.length - 6}`));
      }
    } else {
      this.add(`  ${theme.dim("\u25CB Nessun agente attivo")}`);
      this.add(theme.dim("  Usa /start <agente> per avviarne uno"));
    }
    this.add("");

    // ── Attivita' Team ──
    const tasks = countTasks();
    this.add(theme.accent("  ATTIVITA'"));
    this.add(`  Task attivi:    ${theme.warning(String(tasks.active))}`);
    this.add(`  Completati:     ${theme.success(String(tasks.done))}`);
    this.add(`  Totale:         ${theme.text(String(tasks.total))}`);

    this.add(hr);
    this.add(theme.dim("  /profile — modifica profilo | /tasks — dettaglio task | /ai — chat AI"));
  }

  private add(text: string) {
    this.addChild(new Text(text, 0, 0));
  }
}
