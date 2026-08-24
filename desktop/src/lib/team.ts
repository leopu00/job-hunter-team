import { Channel, invoke, isTauri } from "@tauri-apps/api/core";

export interface TeamProgress {
  stage: "podman" | "credentials" | "image" | "team";
  message: string;
  role?: TeamRole;
  agentId?: string;
  status?: "working" | "completed";
  positionTitle?: string;
}

export type TeamRole =
  "captain" | "scout" | "analyst" | "scorer" | "writer" | "critic" | "sentinel";

export interface TeamAgentActivity extends TeamProgress {
  role: TeamRole;
  agentId: string;
  status: "working" | "completed";
}

export interface TeamPosition {
  sourceId: string;
  title: string;
  company: string;
  score: number;
  state: string;
  criticScore: number | null;
  criticVerdict: string | null;
  cvMarkdown: string | null;
}

export interface TeamAgentResult {
  agentId: string;
  role: TeamRole;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
}

export interface TeamTimelineEvent {
  sequence: number;
  sourceId: string | null;
  actor: string;
  event: string;
  from: string | null;
  to: string | null;
}

export interface TeamStartResult {
  runId: string;
  scored: number;
  reviewed: number;
  spentUsd: number;
  agentCount: number;
  positions: TeamPosition[];
  agents: TeamAgentResult[];
  timeline: TeamTimelineEvent[];
  workspacePath: string;
}

export function isTeamAgentActivity(
  progress: TeamProgress,
): progress is TeamAgentActivity {
  return Boolean(progress.role && progress.agentId && progress.status);
}

export async function startApiTeam(
  apiKey: string,
  onProgress: (progress: TeamProgress) => void,
): Promise<TeamStartResult> {
  if (!isTauri()) throw { code: "desktop_only" };
  const channel = new Channel<TeamProgress>();
  channel.onmessage = onProgress;
  return invoke<TeamStartResult>("start_api_team", {
    apiKey,
    onProgress: channel,
  });
}
