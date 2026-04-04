/**
 * Layout TUI — struttura ispirata a OpenClaw.
 * Header → mainSlot (view switching) → statusBar.
 * Supporta viste multiple: team, chat, tasks, ai.
 */
import { Container, Text, TUI } from "@mariozechner/pi-tui";
import { StatusBar } from "./components/status-bar.js";
import { theme } from "./tui-theme.js";
import type { JhtTuiState, TuiView } from "./tui-types.js";

const VIEW_LABELS: Record<TuiView, string> = {
  team: "Team",
  chat: "Chat",
  tasks: "Tasks",
  ai: "AI",
};

export type JhtLayout = {
  root: Container;
  mainSlot: Container;
  statusBar: StatusBar;
  updateHeader(state: JhtTuiState): void;
  updateStatusBar(state: JhtTuiState): void;
};

export function createJhtLayout(_tui: TUI): JhtLayout {
  const root = new Container();

  // Header
  const header = new Text("", 1, 0);
  root.addChild(header);

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
    const activeCount = state.activeTmuxCount;
    const connLabel = state.isConnected ? theme.success("API") : theme.dim("no API");
    header.setText(
      theme.header(` JHT Control Panel`) +
      theme.dim(` \u2502 `) +
      connLabel +
      theme.dim(` \u2502 ${activeCount} agenti attivi`),
    );

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
      totalAgents: state.agents.length,
      workingAgents: state.activeTmuxCount,
    });
  };

  return { root, mainSlot, statusBar, updateHeader, updateStatusBar };
}
