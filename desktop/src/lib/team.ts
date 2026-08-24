import { Channel, invoke, isTauri } from "@tauri-apps/api/core";

export interface TeamProgress {
  stage: "podman" | "credentials" | "image" | "team";
  message: string;
}

export interface TeamPosition {
  title: string;
  company: string;
  score: number;
  state: string;
  criticScore: number | null;
  criticVerdict: string | null;
}

export interface TeamStartResult {
  runId: string;
  scored: number;
  reviewed: number;
  spentUsd: number;
  agentCount: number;
  positions: TeamPosition[];
  workspacePath: string;
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
