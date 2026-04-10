/**
 * Layout TUI — struttura a 3 livelli.
 * Header → mainSlot (view switching) → statusBar.
 * Supporta viste multiple: home, team, chat, tasks, ai.
 */
import { Container, Text, TUI } from "@mariozechner/pi-tui";
import { StatusBar } from "./components/status-bar.js";
import { theme } from "./tui-theme.js";
import type { JhtTuiState, TuiView } from "./tui-types.js";

const VIEW_LABELS: Record<TuiView, { label: string; num: string }> = {
  home: { label: "Config", num: "1" },
  team: { label: "Team", num: "2" },
  chat: { label: "Chat", num: "3" },
  tasks: { label: "Tasks", num: "4" },
  dashboard: { label: "Dashboard", num: "5" },
  profile: { label: "Profile", num: "6" },
  ai: { label: "AI", num: "7" },
};

export type JhtLayout = {
  root: Container;
  mainSlot: Container;
  statusBar: StatusBar;
  updateHeader(state: JhtTuiState): void;
  updateStatusBar(state: JhtTuiState): void;
};

const BANNER = [
  "     _  ___  ___   _  _ _   _ _  _ _____ ___ ___   _____ ___   _   __  __ ",
  "  _ | |/ _ \\| _ ) | || | | | | \\| |_   _| __| _ \\ |_   _| __| /_\\ |  \\/  |",
  " | || | (_) | _ \\ | __ | |_| | .` | | | | _||   /   | | | _| / _ \\| |\\/| |",
  "  \\__/ \\___/|___/ |_||_|\\___/|_|\\_| |_| |___|_|_\\   |_| |___/_/ \\_\\_|  |_|",
  "",
].join("\n");

export function createJhtLayout(_tui: TUI): JhtLayout {
  const root = new Container();

  // Big ASCII Banner
  const banner = new Text(theme.accent(BANNER), 1, 0);
  root.addChild(banner);

  // Divider + tab bar
  const tabBar = new Text("", 1, 0);
  root.addChild(tabBar);

  // Main content area (swapped based on view)
  const mainSlot = new Container();
  root.addChild(mainSlot);

  // Bottom divider
  const divider = new Text(theme.border("\u2500".repeat(80)), 1, 0);
  root.addChild(divider);

  // Status bar
  const statusBar = new StatusBar();
  root.addChild(statusBar.getNode());

  const updateHeader = (state: JhtTuiState) => {
    // Tab bar: evidenzia la vista corrente con numeri
    const tabs = (Object.keys(VIEW_LABELS) as TuiView[]).map((v) => {
      const { label, num } = VIEW_LABELS[v];
      const display = `${num}:${label}`;
      if (v === state.currentView) return theme.accent(`[${display}]`);
      return theme.dim(` ${display} `);
    });
    tabBar.setText(theme.border("  ") + tabs.join(theme.dim(" | ")));
  };

  const updateStatusBar = (state: JhtTuiState) => {
    const selectedAgent = state.agents.find((a) => a.id === state.selectedAgentId) ?? null;
    statusBar.update({
      connectionStatus: state.connectionStatus,
      activityStatus: state.activityStatus,
      selectedAgent,
      workingAgents: state.activeTmuxCount,
      currentView: state.currentView,
    });
  };

  return { root, mainSlot, statusBar, updateHeader, updateStatusBar };
}
