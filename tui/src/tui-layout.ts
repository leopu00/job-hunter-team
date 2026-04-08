/**
 * Layout TUI — struttura ispirata a OpenClaw.
 * Header → mainSlot (view switching) → statusBar.
 * Supporta viste multiple: home, team, chat, tasks, ai.
 */
import { Container, Text, TUI } from "@mariozechner/pi-tui";
import { StatusBar } from "./components/status-bar.js";
import { theme } from "./tui-theme.js";
import type { JhtTuiState, TuiView } from "./tui-types.js";

const VIEW_LABELS: Record<TuiView, string> = {
  home: "Config",
  team: "Team",
  chat: "Chat",
  tasks: "Tasks",
  dashboard: "Dashboard",
  profile: "Profile",
  ai: "AI",
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
    // Tab bar: evidenzia la vista corrente
    const tabs = (Object.keys(VIEW_LABELS) as TuiView[]).map((v) => {
      const label = VIEW_LABELS[v];
      if (v === state.currentView) return theme.accent(`[${label}]`);
      return theme.dim(` ${label} `);
    });
    tabBar.setText(theme.border("  ") + tabs.join(theme.dim(" \u2502 ")));
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
