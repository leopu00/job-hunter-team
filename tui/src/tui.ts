/**
 * JHT TUI — Job Hunter Team Terminal User Interface
 *
 * Layout:
 *   ┌─────────────────────────────────────────────────────────┐
 *   │  JHT TUI  │  agente: scout (scout)  │  connected        │
 *   ├──────────────┬──────────────────────────────────────────┤
 *   │ AGENTI       │  [chat / log agente selezionato]         │
 *   │ ──────────── │                                          │
 *   │ > ● scout    │                                          │
 *   │   ◐ analista │                                          │
 *   │   ✗ critico  │                                          │
 *   │   ○ alfa     │                                          │
 *   ├──────────────┴──────────────────────────────────────────┤
 *   │  connected │ 1/4 attivi │ [scout] tok 12k  │  idle      │
 *   │  Tab agente  Ctrl+C esci  Ctrl+O tool  Ctrl+L modello   │
 *   └─────────────────────────────────────────────────────────┘
 */

import { Key, matchesKey, ProcessTerminal, TUI } from "@mariozechner/pi-tui";
import { createJhtLayout } from "./tui-layout.js";
import type { JhtAgent, JhtTuiState, TuiOptions } from "./tui-types.js";

// Agenti di default — in produzione arriveranno dal backend
const KNOWN_AGENTS: JhtAgent[] = [
  { id: "scout", name: "scout", role: "scout", status: "idle" },
  { id: "analista", name: "analista", role: "analista", status: "idle" },
  { id: "assistente", name: "assistente", role: "assistente", status: "idle" },
  { id: "critico", name: "critico", role: "critico", status: "idle" },
  { id: "scorer", name: "scorer", role: "scorer", status: "idle" },
  { id: "scrittore", name: "scrittore", role: "scrittore", status: "idle" },
  { id: "sentinella", name: "sentinella", role: "sentinella", status: "idle" },
  { id: "alfa", name: "alfa", role: "alfa", status: "idle" },
];

export async function runJhtTui(opts: TuiOptions = {}) {
  const state: JhtTuiState = {
    agents: KNOWN_AGENTS,
    selectedAgentId: KNOWN_AGENTS[0]?.id ?? null,
    messages: [],
    connectionStatus: opts.url ? "connecting" : "standalone",
    activityStatus: "idle",
    toolsExpanded: false,
    isConnected: false,
  };

  const tui = new TUI(new ProcessTerminal());
  const layout = createJhtLayout(tui);

  tui.addChild(layout.root);

  // Render iniziale
  layout.agentList.setAgents(state.agents);
  layout.agentList.setSelectedAgent(state.selectedAgentId);
  layout.updateHeader(state);
  layout.updateStatusBar(state);

  let exitRequested = false;

  const requestExit = () => {
    if (exitRequested) return;
    exitRequested = true;
    try {
      tui.stop();
    } catch {
      // ignorato
    }
    process.exit(0);
  };

  // Input handling: navigazione agenti con Tab/↑/↓, uscita con Ctrl+C
  tui.addInputListener((data) => {
    // Tab — seleziona agente successivo
    if (matchesKey(data, Key.tab)) {
      const nextId = layout.agentList.selectNext();
      if (nextId) {
        state.selectedAgentId = nextId;
        layout.updateHeader(state);
        layout.updateStatusBar(state);
        tui.requestRender();
      }
      return { consume: true };
    }

    // Arrow up — agente precedente
    if (matchesKey(data, Key.up)) {
      const prevId = layout.agentList.selectPrev();
      if (prevId) {
        state.selectedAgentId = prevId;
        layout.updateHeader(state);
        layout.updateStatusBar(state);
        tui.requestRender();
      }
      return { consume: true };
    }

    // Arrow down — agente successivo
    if (matchesKey(data, Key.down)) {
      const nextId = layout.agentList.selectNext();
      if (nextId) {
        state.selectedAgentId = nextId;
        layout.updateHeader(state);
        layout.updateStatusBar(state);
        tui.requestRender();
      }
      return { consume: true };
    }

    // Ctrl+C — esci
    if (matchesKey(data, Key.ctrl("c"))) {
      requestExit();
      return { consume: true };
    }

    // Ctrl+O — toggle tool expanded
    if (matchesKey(data, Key.ctrl("o"))) {
      state.toolsExpanded = !state.toolsExpanded;
      state.activityStatus = state.toolsExpanded ? "tool espansi" : "tool compressi";
      layout.updateStatusBar(state);
      tui.requestRender();
      return { consume: true };
    }

    return undefined;
  });

  const sigintHandler = () => requestExit();
  const sigtermHandler = () => requestExit();
  process.on("SIGINT", sigintHandler);
  process.on("SIGTERM", sigtermHandler);

  tui.start();

  await new Promise<void>((resolve) => {
    process.once("exit", () => {
      process.removeListener("SIGINT", sigintHandler);
      process.removeListener("SIGTERM", sigtermHandler);
      resolve();
    });
  });
}

// Entry point diretto
runJhtTui().catch(console.error);
