import { Container, Text, TUI } from "@mariozechner/pi-tui";
import { AgentList } from "./components/agent-list.js";
import { StatusBar } from "./components/status-bar.js";
import { theme } from "./tui-theme.js";
import type { JhtAgent, JhtTuiState } from "./tui-types.js";

export type ChatPanel = {
  getNode(): Text | Container;
  setAgent(agent: JhtAgent | null): void;
};

export type JhtLayout = {
  root: Container;
  agentList: AgentList;
  statusBar: StatusBar;
  chatPanelSlot: Container;
  updateHeader(state: JhtTuiState): void;
  updateStatusBar(state: JhtTuiState): void;
};

function buildHeader(): Text {
  const header = new Text("", 1, 0);
  header.setText(theme.header(" JHT — Job Hunter Team TUI"));
  return header;
}

function buildDivider(char = "─", width = 0): Text {
  const line = width > 0 ? char.repeat(width) : char.repeat(80);
  return new Text(theme.border(line), 1, 0);
}

/**
 * Crea il layout a 3 zone:
 *   [header]
 *   [agentList (sinistra) | chatPanel (destra)]
 *   [statusBar (basso)]
 */
export function createJhtLayout(_tui: TUI): JhtLayout {
  const root = new Container();

  // Header
  const header = buildHeader();
  root.addChild(header);
  root.addChild(buildDivider());

  // Zona centrale: lista agenti + pannello chat (affiancati)
  // pi-tui usa layout verticale nativo — simuliamo il pannello affiancato
  // con un Container che wrappa entrambi i blocchi di testo.
  const centerRow = new Container();

  const agentList = new AgentList();
  centerRow.addChild(agentList.getNode());

  const chatPanelSlot = new Container();
  const chatPlaceholder = new Text(
    theme.dim("  [pannello chat]"),
    0,
    0,
  );
  chatPanelSlot.addChild(chatPlaceholder);
  centerRow.addChild(chatPanelSlot);

  root.addChild(centerRow);
  root.addChild(buildDivider());

  // Barra inferiore
  const statusBar = new StatusBar();
  root.addChild(statusBar.getNode());

  const updateHeader = (state: JhtTuiState) => {
    const sel = state.agents.find((a) => a.id === state.selectedAgentId);
    const agentLabel = sel ? `${sel.name} (${sel.role})` : "—";
    header.setText(
      theme.header(` JHT TUI  │  agente: ${agentLabel}  │  ${state.connectionStatus}`),
    );
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

  return {
    root,
    agentList,
    statusBar,
    chatPanelSlot,
    updateHeader,
    updateStatusBar,
  };
}
