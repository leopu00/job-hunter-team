/**
 * HomePanel — pagina Config iniziale della TUI.
 * Mostra solo gli elementi necessari per completare il setup.
 */
import { Container, Text } from "@mariozechner/pi-tui";
import { theme } from "../tui-theme.js";
import type { TmuxSession } from "../tui-tmux.js";
import { getMissingProfileFields, getProfileCompletion, isProfileComplete, loadProfile, loadWorkspacePath } from "../tui-profile.js";
import { loadApiKey, loadProviderConfig } from "../tui-client.js";

const DEFAULT_TERMINAL_WIDTH = 100;
const MAX_BOX_WIDTH = 54;

function getTerminalWidth(): number {
  return Math.max(process.stdout.columns ?? DEFAULT_TERMINAL_WIDTH, 60);
}

function truncatePath(value: string, width: number): string {
  if (width <= 0) return "";
  if (value.length <= width) return value;
  if (width === 1) return "…";
  return `…${value.slice(-(width - 1))}`;
}

function wrapPlain(value: string, width: number): string[] {
  if (width <= 0) return [""];
  const words = value.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];

  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= width) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    current = word;
  }
  if (current) lines.push(current);
  return lines;
}

function padPlain(value: string, width: number): string {
  if (value.length >= width) return value;
  return value + " ".repeat(width - value.length);
}

function createWorkspaceBox(workspace: string, isSelected: boolean, maxWidth: number): string[] {
  const title = isSelected ? "❯ 📁 Cartella di lavoro" : "📁 Cartella di lavoro";
  const workspaceText = workspace ? truncatePath(workspace, maxWidth) : "(non impostata)";
  const innerWidth = Math.max(title.length, workspaceText.length);
  const border = isSelected ? theme.borderSelected : theme.border;
  const titleText = isSelected
    ? theme.bold(theme.accent(padPlain(title, innerWidth)))
    : theme.accent(padPlain(title, innerWidth));
  return [
    ` ${border("┌" + "─".repeat(innerWidth + 2) + "┐")}`,
    ` ${border("│")} ${titleText} ${border("│")}`,
    ` ${border("├" + "─".repeat(innerWidth + 2) + "┤")}`,
    ` ${border("│")} ${theme.dim(padPlain(workspaceText, innerWidth))} ${border("│")}`,
    ` ${border("└" + "─".repeat(innerWidth + 2) + "┘")}`,
  ];
}

function checklistRow(done: boolean, label: string): string {
  const icon = done ? theme.accent("✓") : theme.dim("○");
  const text = done ? theme.text(label) : theme.dim(label);
  return `     ${icon} ${text}`;
}

export class HomePanel extends Container {
  refresh(_sessions: TmuxSession[]) {
    this.clear();

    const workspace = loadWorkspacePath();
    const profile = loadProfile();
    const profileCompletion = getProfileCompletion(profile);
    const profileComplete = isProfileComplete(profile);
    const missingFields = getMissingProfileFields(profile);
    const providerConfig = loadProviderConfig();
    const apiConfigured = Boolean(loadApiKey());
    const terminalWidth = getTerminalWidth();
    const contentWidth = Math.max(terminalWidth - 8, 24);
    const boxWidth = Math.min(MAX_BOX_WIDTH, Math.max(contentWidth - 4, 28));

    this.add("");
    for (const line of createWorkspaceBox(workspace, true, boxWidth)) {
      this.add(line);
    }
    this.add("");

    this.add(`  ${theme.accent("Setup")}`);
    this.add(checklistRow(Boolean(workspace), "Cartella di lavoro configurata"));
    this.add(checklistRow(Boolean(providerConfig), providerConfig ? `Provider ${providerConfig.provider} configurato` : "Provider AI configurato"));
    this.add(checklistRow(apiConfigured, "API key configurata per questa cartella"));
    this.add(checklistRow(profileComplete, profileComplete ? "Profilo completo" : `Profilo ${profileCompletion.percent}%`));

    if (!providerConfig || !apiConfigured) {
      this.add(`       ${theme.dim("Usa il wizard setup per completare provider e chiave")}`);
    }
    if (!profileComplete) {
      this.add(`       ${theme.dim("Usa /profile per completare il profilo")}`);
      for (const line of wrapPlain(`Manca: ${missingFields.join(", ")}`, contentWidth - 7)) {
        this.add(`       ${theme.dim(line)}`);
      }
    }
  }

  moveSelection(_delta: number): boolean {
    return false;
  }

  getSelectedItem():
    | { type: "workspace"; label: string }
    | null {
    return { type: "workspace", label: "cambia cartella" };
  }

  private add(text: string) {
    this.addChild(new Text(text, 0, 0));
  }
}
