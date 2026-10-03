import { Channel, invoke, isTauri } from "@tauri-apps/api/core";
import type {
  ExecutionHost,
  OnboardingRuntimeSnapshot,
  OnboardingSubmission,
} from "./onboarding";

export type OnboardingNativeProgressStage = "engine" | "runtime" | "container" | "provider" | "login" | "team" | "assistant";
export type OnboardingNativeProgressStatus = "start" | "progress" | "done" | "error";

export interface OnboardingNativeProgress {
  stage: OnboardingNativeProgressStage;
  status: OnboardingNativeProgressStatus;
  message: string;
  sequence: number;
  elapsedMs: number;
  code: string | null;
  retryable: boolean | null;
}

export type OnboardingInteractiveEvent =
  | { kind: "output"; text: string }
  | { kind: "exit"; code: number | null };

export interface SshHostKeyProbe {
  status: "pinned" | "confirmation_required";
  algorithm: "ssh-ed25519";
  fingerprint: `SHA256:${string}`;
}

function desktopOnly(): never { throw { code: "desktop_only" }; }

const PROGRESS_STAGES = new Set<OnboardingNativeProgressStage>(["engine", "runtime", "container", "provider", "login", "team", "assistant"]);
const PROGRESS_STATUSES = new Set<OnboardingNativeProgressStatus>(["start", "progress", "done", "error"]);
const SAFE_CODE = /^[a-z][a-z0-9_]{0,63}$/;
const UNSAFE_ACTIVITY_TEXT = /[\r\n\0/\\]|https?:\/\/|\b(?:token|password|secret|credential|credenzial|bearer|authorization)\b|\b\d{1,3}(?:\.\d{1,3}){3}\b|\b(?:[a-f0-9]{0,4}:){2,}[a-f0-9:]+\b|\b(?:[a-z0-9-]+\.)+[a-z]{2,}\b|@/i;
const FALLBACK_PROGRESS_MESSAGE: Record<OnboardingNativeProgressStage, string> = {
  engine: "Verifico l’ambiente di esecuzione.",
  runtime: "Preparo il runtime verificato.",
  container: "Preparo il container del team.",
  provider: "Configuro il provider selezionato.",
  login: "Verifico l’accesso al provider.",
  team: "Avvio e verifico le sessioni del team.",
  assistant: "Apro e verifico l’Assistente.",
};

export function parseOnboardingNativeProgress(value: unknown): OnboardingNativeProgress | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.stage !== "string" || !PROGRESS_STAGES.has(row.stage as OnboardingNativeProgressStage) ||
      typeof row.status !== "string" || !PROGRESS_STATUSES.has(row.status as OnboardingNativeProgressStatus) ||
      !Number.isSafeInteger(row.sequence) || (row.sequence as number) < 1 ||
      !Number.isSafeInteger(row.elapsedMs) || (row.elapsedMs as number) < 0) return null;
  const stage = row.stage as OnboardingNativeProgressStage;
  const status = row.status as OnboardingNativeProgressStatus;
  const rawMessage = typeof row.message === "string" ? row.message.trim() : "";
  const message = rawMessage && rawMessage.length <= 180 && !UNSAFE_ACTIVITY_TEXT.test(rawMessage)
    ? rawMessage
    : FALLBACK_PROGRESS_MESSAGE[stage];
  const code = row.code === null ? null : typeof row.code === "string" && SAFE_CODE.test(row.code) ? row.code : undefined;
  const retryable = row.retryable === null || typeof row.retryable === "boolean" ? row.retryable : undefined;
  if (code === undefined || retryable === undefined) return null;
  if (status === "error" ? code === null || typeof retryable !== "boolean" : code !== null || retryable !== null) return null;
  return { stage, status, message, sequence: row.sequence as number, elapsedMs: row.elapsedMs as number, code, retryable };
}

function progressChannel(onProgress: (progress: OnboardingNativeProgress) => void): Channel<unknown> {
  const channel = new Channel<unknown>();
  channel.onmessage = (value) => {
    const progress = parseOnboardingNativeProgress(value);
    if (progress) onProgress(progress);
  };
  return channel;
}

export async function probeOnboardingSshHostKey(host: ExecutionHost): Promise<SshHostKeyProbe> {
  if (!isTauri()) desktopOnly();
  return invoke<SshHostKeyProbe>("onboarding_ssh_host_key_probe", { host });
}

export async function confirmOnboardingSshHostKey(
  host: ExecutionHost,
  probe: Pick<SshHostKeyProbe, "algorithm" | "fingerprint">,
): Promise<void> {
  if (!isTauri()) desktopOnly();
  await invoke("onboarding_ssh_host_key_confirm", {
    host,
    algorithm: probe.algorithm,
    fingerprint: probe.fingerprint,
  });
}

export async function prepareOnboardingRuntime(
  submission: OnboardingSubmission,
  pairingToken: string | null,
  onProgress: (progress: OnboardingNativeProgress) => void,
): Promise<OnboardingRuntimeSnapshot> {
  if (!isTauri()) desktopOnly();
  const channel = progressChannel(onProgress);
  return invoke("onboarding_prepare", { submission, pairingToken, onProgress: channel });
}

export async function startOnboardingProviderLogin(
  host: ExecutionHost,
  onEvent: (event: OnboardingInteractiveEvent) => void,
  onProgress: (progress: OnboardingNativeProgress) => void,
): Promise<string> {
  if (!isTauri()) desktopOnly();
  const channel = new Channel<OnboardingInteractiveEvent>();
  channel.onmessage = onEvent;
  const result = await invoke<{ sessionId: string }>("onboarding_provider_login", {
    host,
    onEvent: channel,
    onProgress: progressChannel(onProgress),
  });
  return result.sessionId;
}

export async function sendOnboardingProviderInput(sessionId: string, input: string): Promise<void> {
  if (!isTauri()) desktopOnly();
  await invoke("onboarding_provider_login_input", { sessionId, input });
}

export async function closeOnboardingProviderLogin(sessionId: string): Promise<void> {
  if (!isTauri()) desktopOnly();
  await invoke("onboarding_provider_login_close", { sessionId });
}

export async function startOnboardingTeam(
  host: ExecutionHost,
  onProgress: (progress: OnboardingNativeProgress) => void,
): Promise<OnboardingRuntimeSnapshot> {
  if (!isTauri()) desktopOnly();
  const channel = progressChannel(onProgress);
  return invoke("onboarding_team_start", { host, onProgress: channel });
}

export async function readOnboardingSnapshot(host: ExecutionHost): Promise<OnboardingRuntimeSnapshot> {
  if (!isTauri()) desktopOnly();
  return invoke("onboarding_snapshot", { host });
}

/** Re-reads the privately persisted native host without exposing it to the webview. */
export async function resumeOnboardingSnapshot(): Promise<OnboardingRuntimeSnapshot> {
  if (!isTauri()) desktopOnly();
  return invoke("onboarding_resume_snapshot");
}

/** Starts only missing team sessions from the account-scoped persisted host. */
export async function resumeOnboardingTeamStart(
  onProgress: (progress: OnboardingNativeProgress) => void,
): Promise<OnboardingRuntimeSnapshot> {
  if (!isTauri()) desktopOnly();
  return invoke("onboarding_resume_team_start", { onProgress: progressChannel(onProgress) });
}

export async function openOnboardingAssistant(
  host: ExecutionHost,
  onProgress: (progress: OnboardingNativeProgress) => void,
): Promise<OnboardingRuntimeSnapshot> {
  if (!isTauri()) desktopOnly();
  return invoke("onboarding_assistant_open", { host, onProgress: progressChannel(onProgress) });
}
