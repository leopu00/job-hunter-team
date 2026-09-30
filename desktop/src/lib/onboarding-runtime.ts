import { Channel, invoke, isTauri } from "@tauri-apps/api/core";
import type {
  ExecutionHost,
  OnboardingRuntimeSnapshot,
  OnboardingSubmission,
  OperationalStage,
} from "./onboarding";

export interface OnboardingNativeProgress {
  stage: OperationalStage;
  message: string;
}

export type OnboardingInteractiveEvent =
  | { kind: "output"; text: string }
  | { kind: "exit"; code: number | null };

function desktopOnly(): never { throw { code: "desktop_only" }; }

export async function prepareOnboardingRuntime(
  submission: OnboardingSubmission,
  pairingToken: string | null,
  accountEmail: string,
  onProgress: (progress: OnboardingNativeProgress) => void,
): Promise<OnboardingRuntimeSnapshot> {
  if (!isTauri()) desktopOnly();
  const channel = new Channel<OnboardingNativeProgress>();
  channel.onmessage = onProgress;
  return invoke("onboarding_prepare", { submission, pairingToken, accountEmail, onProgress: channel });
}

export async function startOnboardingProviderLogin(
  host: ExecutionHost,
  onEvent: (event: OnboardingInteractiveEvent) => void,
): Promise<string> {
  if (!isTauri()) desktopOnly();
  const channel = new Channel<OnboardingInteractiveEvent>();
  channel.onmessage = onEvent;
  const result = await invoke<{ sessionId: string }>("onboarding_provider_login", { host, onEvent: channel });
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
  const channel = new Channel<OnboardingNativeProgress>();
  channel.onmessage = onProgress;
  return invoke("onboarding_team_start", { host, onProgress: channel });
}

export async function readOnboardingSnapshot(host: ExecutionHost): Promise<OnboardingRuntimeSnapshot> {
  if (!isTauri()) desktopOnly();
  return invoke("onboarding_snapshot", { host });
}

export async function openOnboardingAssistant(host: ExecutionHost): Promise<OnboardingRuntimeSnapshot> {
  if (!isTauri()) desktopOnly();
  return invoke("onboarding_assistant_open", { host });
}
