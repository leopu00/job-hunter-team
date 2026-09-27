import { invoke, isTauri } from "@tauri-apps/api/core";

/**
 * What the API team of this computer spent: the answer of the Tauri command
 * api_team_spend (src-tauri/src/spend.rs), which reads the database its runs
 * leave in the app's data folder, read only.
 */
export interface SpendRun {
  runId: string;
  status: "running" | "completed" | "failed" | string;
  budgetUsd: number;
  spentUsd: number;
  createdAt: string;
  updatedAt: string;
}

export interface SpendAgent {
  runId: string;
  /** api-worker's role names: captain, scout, sentinel, analyst, scorer, writer, critic */
  role: string;
  /** null for a task nobody claimed yet */
  agentId: string | null;
  /** team_agent_runs' status; null for the pipeline roles, summed over their tasks */
  status: string | null;
  tasks: number;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  lastError: string | null;
  updatedAt: string;
}

export interface SpendReport {
  /** false: no run has written a database on this computer yet */
  found: boolean;
  teamCapUsd: number;
  agentCapUsd: number;
  runs: SpendRun[];
  agents: SpendAgent[];
}

export type SpendRead =
  | { state: "ready"; report: SpendReport }
  /** outside the Tauri app (vite in a browser): there is no local database to read */
  | { state: "unavailable" }
  | { state: "failed" };

export async function readSpend(): Promise<SpendRead> {
  if (!isTauri()) return { state: "unavailable" };
  try {
    return { state: "ready", report: await invoke<SpendReport>("api_team_spend") };
  } catch {
    return { state: "failed" };
  }
}
