/**
 * HomePanel — pagina Config iniziale della TUI.
 * Lista navigabile di opzioni di configurazione.
 */
import { Container, Text } from "@mariozechner/pi-tui";
import { theme } from "../tui-theme.js";
import type { TmuxSession } from "../tui-tmux.js";
import { getMissingProfileFields, getProfileCompletion, isProfileComplete, loadProfile, loadWorkspacePath } from "../tui-profile.js";
import { loadApiKey, loadProviderConfig } from "../tui-client.js";

const DEFAULT_TERMINAL_WIDTH = 100;

function getTerminalWidth(): number {
  return Math.max(process.stdout.columns ?? DEFAULT_TERMINAL_WIDTH, 60);
}

type ConfigItem = {
  id: string;
  label: string;
  status: "done" | "todo" | "optional";
  value?: string;
};

export class HomePanel extends Container {
  private items: ConfigItem[] = [];
  private selectedIndex = 0;

  refresh(_sessions: TmuxSession[]) {
    this.clear();
    this.items = this.buildItems();

    const terminalWidth = getTerminalWidth();
    const contentWidth = Math.max(terminalWidth - 8, 24);

    this.add("");
    this.add(`  ${theme.accent("Configurazione")}`);
    this.add("");

    for (let i = 0; i < this.items.length; i++) {
      const item = this.items[i];
      const isSelected = i === this.selectedIndex;
      const line = this.renderItem(item, isSelected, contentWidth);
      this.add(line);
    }

    this.add("");
    this.add(`  ${theme.dim("↑↓ seleziona  •  Enter modifica  •  1-7 cambia vista")}`);
  }

  private buildItems(): ConfigItem[] {
    const workspace = loadWorkspacePath();
    const providerConfig = loadProviderConfig();
    const apiKey = loadApiKey();
    const profile = loadProfile();
    const profileComplete = isProfileComplete(profile);
    const profileCompletion = getProfileCompletion(profile);

    return [
      {
        id: "workspace",
        label: "Cartella di lavoro",
        status: workspace ? "done" : "todo",
        value: workspace || undefined,
      },
      {
        id: "provider",
        label: "Provider AI",
        status: providerConfig ? "done" : "todo",
        value: providerConfig?.provider,
      },
      {
        id: "apikey",
        label: "Autenticazione",
        status: apiKey ? "done" : "todo",
        value: apiKey === "__subscription__" ? "Abbonamento" : apiKey ? "API Key" : undefined,
      },
      {
        id: "profile",
        label: "Profilo",
        status: profileComplete ? "done" : profileCompletion.percent > 0 ? "optional" : "todo",
        value: profileComplete ? "Completato" : `${profileCompletion.percent}%`,
      },
    ];
  }

  private renderItem(item: ConfigItem, isSelected: boolean, _width: number): string {
    const icon = item.status === "done" ? theme.accent("[✓]") : item.status === "optional" ? theme.dim("[~]") : theme.dim("[ ]");
    const label = isSelected ? theme.bold(theme.accent("> " + item.label)) : "  " + item.label;
    const value = item.value ? theme.dim(` (${item.value})`) : "";
    
    return `  ${icon} ${label}${value}`;
  }

  moveSelection(delta: number): boolean {
    const newIndex = this.selectedIndex + delta;
    if (newIndex >= 0 && newIndex < this.items.length) {
      this.selectedIndex = newIndex;
      return true;
    }
    return false;
  }

  getSelectedItem(): { type: string; label: string } | null {
    const item = this.items[this.selectedIndex];
    if (!item) return null;
    return { type: item.id, label: item.label };
  }

  private add(text: string) {
    this.addChild(new Text(text, 0, 0));
  }
}
