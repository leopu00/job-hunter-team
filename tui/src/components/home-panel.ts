/**
 * HomePanel — landing iniziale della TUI.
 * Mostra profilo, cartella di lavoro e menu rapido.
 */
import { Container, Text } from "@mariozechner/pi-tui";
import { theme } from "../tui-theme.js";
import type { TmuxSession } from "../tui-tmux.js";
import { getMissingProfileFields, isProfileComplete, loadProfile, loadWorkspacePath } from "../tui-profile.js";

type AgentDef = { id: string; label: string; emoji: string; aliases: string[] };

const AGENTS: AgentDef[] = [
  { id: "scout", label: "Scout", emoji: "🕵️", aliases: ["scout"] },
  { id: "analista", label: "Analista", emoji: "👨‍🔬", aliases: ["analista"] },
  { id: "assistente", label: "Assistente", emoji: "🧑‍💼", aliases: ["assistente"] },
  { id: "critico", label: "Critico", emoji: "👨‍⚖️", aliases: ["critico"] },
  { id: "scorer", label: "Scorer", emoji: "👨‍💻", aliases: ["scorer"] },
  { id: "scrittore", label: "Scrittore", emoji: "👨‍🏫", aliases: ["scrittore"] },
  { id: "sentinella", label: "Sentinella", emoji: "💂", aliases: ["sentinella"] },
  { id: "alfa", label: "Alfa", emoji: "👨‍✈️", aliases: ["alfa"] },
];

const ACTIONS = [
  { id: "profile", label: "👤 Configura profilo", cmd: "/profile" },
  { id: "dashboard", label: "📊 Dashboard", cmd: "/dashboard" },
  { id: "team", label: "👥 Team", cmd: "/team" },
  { id: "assistente", label: "🤖 Assistente", cmd: "/start assistente" },
  { id: "scout", label: "🔍 Scout", cmd: "/start scout" },
] as const;

const LEFT_COL_WIDTH = 28;
const MERGE_GAP = "    ";

function calcProfilePercent(): number {
  const profile = loadProfile();
  let filled = 0;
  if (profile.nome.trim()) filled++;
  if (profile.cognome.trim()) filled++;
  if (profile.dataNascita.trim()) filled++;
  if (profile.competenze.length > 0) filled++;
  if (profile.zona.trim()) filled++;
  if (profile.tipoLavoro.trim()) filled++;
  return Math.round((filled / 6) * 100);
}

function stripAnsi(value: string): string {
  return value.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, "");
}

function visibleLength(value: string): number {
  return stripAnsi(value).length;
}

function padVisible(value: string, width: number): string {
  const len = visibleLength(value);
  if (len >= width) return value;
  return value + " ".repeat(width - len);
}

function padPlain(value: string, width: number): string {
  if (value.length >= width) return value;
  return value + " ".repeat(width - value.length);
}

function createWorkspaceBox(workspace: string, isSelected: boolean): string[] {
  const title = isSelected ? "❯ 📁 Cartella di lavoro" : "📁 Cartella di lavoro";
  const innerWidth = Math.max(title.length, (workspace || "(non impostata)").length);
  const border = isSelected ? theme.borderSelected : theme.border;
  const titleText = isSelected
    ? theme.bold(theme.accent(padPlain(title, innerWidth)))
    : theme.accent(padPlain(title, innerWidth));
  return [
    ` ${border("┌" + "─".repeat(innerWidth + 2) + "┐")}`,
    ` ${border("│")} ${titleText} ${border("│")}`,
    ` ${border("├" + "─".repeat(innerWidth + 2) + "┤")}`,
    ` ${border("│")} ${theme.dim(padPlain(workspace || "(non impostata)", innerWidth))} ${border("│")}`,
    ` ${border("└" + "─".repeat(innerWidth + 2) + "┘")}`,
  ];
}

function mergeColumns(leftLines: string[], rightLines: string[]): string[] {
  const rows = Math.max(leftLines.length, rightLines.length);
  const out: string[] = [];
  for (let i = 0; i < rows; i++) {
    const left = padVisible(leftLines[i] ?? "", LEFT_COL_WIDTH);
    const right = rightLines[i] ?? "";
    out.push(`${left}${MERGE_GAP}${right}`.trimEnd());
  }
  return out;
}

export class HomePanel extends Container {
  private selectedIndex = 0;

  refresh(sessions: TmuxSession[]) {
    this.clear();

    const workspace = loadWorkspacePath();
    const profile = loadProfile();
    const profilePct = calcProfilePercent();
    const profileComplete = isProfileComplete(profile);
    const missing = getMissingProfileFields(profile);
    const sessionSet = new Set(sessions.map((s) => s.agentId));

    const profileColor = profileComplete ? theme.success : profilePct > 50 ? theme.warning : theme.dim;
    const profileSummary = profileComplete
      ? `${theme.accent("Profilo")} ${profileColor(`${profilePct}%`)} ${theme.success("✓ Completato")}`
      : `${theme.accent("Profilo")} ${profileColor(`${profilePct}%`)}`;
    const profileLines = [
      "",
      `  ${profileSummary}`,
      profileComplete ? "" : `     ${theme.dim("Manca: " + missing.join(", "))}`,
    ];
    const workspaceBox = createWorkspaceBox(workspace, this.selectedIndex === 0);
    for (const line of mergeColumns(profileLines, workspaceBox)) {
      this.add(line);
    }
    this.add("");
    this.add("");

    this.add(`  ${theme.accent("Menu")}`);
    for (let i = 0; i < ACTIONS.length; i++) {
      const act = ACTIONS[i];
      const selected = i + 1 === this.selectedIndex;
      const prefix = selected ? "❯ " : "  ";
      this.add(`     ${prefix}${selected ? theme.bold(act.label) : theme.dim(act.label)}`);
    }
    this.add("");

    this.add(`  ${theme.accent("Team Snapshot")}`);
    const agentLine = AGENTS.map((a) => {
      const active = sessionSet.has(a.id);
      const status = active ? theme.success("●") : theme.dim("○");
      return `${status} ${a.emoji} ${active ? theme.text(a.label) : theme.dim(a.label)}`;
    }).join("  ");
    this.add(`     ${agentLine}`);
  }

  moveSelection(delta: number): boolean {
    const next = this.selectedIndex + delta;
    if (next < 0 || next > ACTIONS.length) return false;
    this.selectedIndex = next;
    return true;
  }

  getSelectedItem():
    | { type: "workspace"; label: string }
    | { type: "action"; id: string; label: string; cmd: string }
    | null {
    if (this.selectedIndex === 0) return { type: "workspace", label: "cambia cartella" };
    const action = ACTIONS[this.selectedIndex - 1];
    return action ? { type: "action", ...action } : null;
  }

  private add(text: string) {
    this.addChild(new Text(text, 0, 0));
  }
}
