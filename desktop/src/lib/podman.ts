import { invoke, isTauri } from "@tauri-apps/api/core";

export interface PodmanStatus {
  installed: boolean;
  ready: boolean;
  version: string | null;
  issue: string | null;
}

export async function checkPodman(): Promise<PodmanStatus | null> {
  if (!isTauri()) return null;
  return invoke<PodmanStatus>("check_podman");
}
