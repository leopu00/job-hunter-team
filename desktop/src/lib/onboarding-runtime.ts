import { Channel, invoke, isTauri } from "@tauri-apps/api/core";
import {
  canonicalProviderLoginUrl,
  type OnboardingProviderLoginAction,
  type ExecutionHost,
  type OnboardingProviderLoginInputRequest,
  type OnboardingRuntimeSnapshot,
  type OnboardingSubmission,
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
  | {
      kind: "state";
      status: "needs_user_action";
      action: OnboardingProviderLoginAction | {
        kind: "device";
        requestId: string;
        actions: [
          Extract<OnboardingProviderLoginAction, { kind: "url" }>,
          Extract<OnboardingProviderLoginAction, { kind: "code" }>,
        ];
      };
    }
  | { kind: "invalid_action"; code: "provider_action_invalid" }
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
const SAFE_INTERACTIVE_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const UNSAFE_ACTIVITY_TEXT = /[\r\n\0/\\]|https?:\/\/|\b(?:token|password|secret|credential|credenzial|bearer|authorization)\b|\b\d{1,3}(?:\.\d{1,3}){3}\b|\b(?:[a-f0-9]{0,4}:){2,}[a-f0-9:]+\b|\b(?:[a-z0-9-]+\.)+[a-z]{2,}\b|@/i;
const UNSAFE_INTERACTIVE_TEXT = /[\r\n\0]|https?:\/\/|\b(?:token|password|secret|credential|credenzial|bearer|authorization)\b|\b\d{1,3}(?:\.\d{1,3}){3}\b|\b(?:[a-f0-9]{0,4}:){2,}[a-f0-9:]+\b|@/i;
const UNSAFE_USER_CODE = /[\u0000-\u001f\u007f-\u009f]/;
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

function safeInteractiveText(value: unknown, maximum: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text && text.length <= maximum && !UNSAFE_INTERACTIVE_TEXT.test(text) ? text : null;
}

function parseInputRequest(value: unknown): OnboardingProviderLoginInputRequest | null | undefined {
  if (value === undefined || value === null) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const id = typeof row.id === "string" && SAFE_INTERACTIVE_ID.test(row.id) ? row.id : null;
  const label = safeInteractiveText(row.label, 120);
  const description = row.description === undefined ? undefined : safeInteractiveText(row.description, 240);
  const submitLabel = row.submitLabel === undefined ? undefined : safeInteractiveText(row.submitLabel, 80);
  const secret = row.secret === undefined ? undefined : typeof row.secret === "boolean" ? row.secret : null;
  const inputMode = row.inputMode === undefined
    ? undefined
    : row.inputMode === "text" || row.inputMode === "numeric" ? row.inputMode : null;
  if (!Object.keys(row).every((key) => ["id", "label", "description", "submitLabel", "secret", "inputMode"].includes(key)) ||
      !id || !label || description === null || submitLabel === null ||
      secret === null || inputMode === null) return null;
  return { id, label, description, submitLabel, secret, inputMode };
}

function parseInteractiveAction(value: unknown): OnboardingProviderLoginAction | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const instruction = safeInteractiveText(row.instruction, 240);
  if (!instruction) return null;
  if (row.kind === "url" && Object.keys(row).every((key) => ["kind", "instruction", "safeUrl"].includes(key))) {
    if (typeof row.safeUrl !== "string" || row.safeUrl.length > 2_048) return null;
    try {
      const parsed = new URL(row.safeUrl);
      if (parsed.protocol !== "https:" || parsed.username || parsed.password) return null;
      return { kind: "url", instruction, safeUrl: parsed.toString() };
    } catch {
      return null;
    }
  }
  if (row.kind === "code" && Object.keys(row).every((key) => ["kind", "instruction", "userCode"].includes(key))) {
    return typeof row.userCode === "string" && row.userCode.length > 0 && row.userCode.length <= 128 &&
      !UNSAFE_USER_CODE.test(row.userCode)
      ? { kind: "code", instruction, userCode: row.userCode }
      : null;
  }
  if (row.kind === "input" && Object.keys(row).every((key) => ["kind", "instruction", "inputRequest"].includes(key))) {
    const inputRequest = parseInputRequest(row.inputRequest);
    return inputRequest ? { kind: "input", instruction, inputRequest } : null;
  }
  return null;
}

function parseDeviceAction(value: Record<string, unknown>): Extract<OnboardingInteractiveEvent, { kind: "state" }>["action"] | null {
  if (!Object.keys(value).every((key) => ["kind", "instruction", "requestId", "safeUrl", "userCode"].includes(key))) {
    return null;
  }
  const instruction = safeInteractiveText(value.instruction, 240);
  const requestId = typeof value.requestId === "string" && SAFE_INTERACTIVE_ID.test(value.requestId)
    ? value.requestId
    : null;
  const safeUrl = canonicalProviderLoginUrl("codex", value.safeUrl);
  const userCode = typeof value.userCode === "string" && value.userCode.length > 0 &&
    value.userCode.length <= 128 && !UNSAFE_USER_CODE.test(value.userCode)
    ? value.userCode
    : null;
  if (!instruction || !requestId || !safeUrl || !userCode) return null;
  return {
    kind: "device",
    requestId,
    actions: [
      { kind: "url", instruction, safeUrl },
      { kind: "code", instruction, userCode },
    ],
  };
}

/** Validates the native interactive boundary without deriving actions from PTY text. */
export function parseOnboardingInteractiveEvent(value: unknown): OnboardingInteractiveEvent | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (row.kind === "failure") {
    return row.code === "provider_action_invalid" &&
      Object.keys(row).every((key) => ["kind", "code"].includes(key))
      ? { kind: "invalid_action", code: "provider_action_invalid" }
      : null;
  }
  if (row.kind === "exit") {
    return row.code === null || (Number.isSafeInteger(row.code) && (row.code as number) >= -1)
      ? { kind: "exit", code: row.code as number | null }
      : null;
  }
  if (row.kind === "state" && row.status === "needs_user_action") {
    const actionRow = row.action && typeof row.action === "object" && !Array.isArray(row.action)
      ? row.action as Record<string, unknown>
      : null;
    if (actionRow?.kind === "device") {
      const action = parseDeviceAction(actionRow);
      return action
        ? { kind: "state", status: "needs_user_action", action }
        : { kind: "invalid_action", code: "provider_action_invalid" };
    }
    const action = parseInteractiveAction(row.action);
    return action ? { kind: "state", status: "needs_user_action", action } : null;
  }
  return null;
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

/**
 * Deletes the JHT Podman machine and creates it again with only the two JHT
 * folders. Called only after the person confirmed it.
 */
export async function recreateOnboardingPodmanMachine(): Promise<void> {
  if (!isTauri()) desktopOnly();
  await invoke("onboarding_podman_machine_recreate");
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
  const channel = new Channel<unknown>();
  channel.onmessage = (value) => {
    const event = parseOnboardingInteractiveEvent(value);
    if (event) onEvent(event);
  };
  const result = await invoke<{ sessionId: string }>("onboarding_provider_login", {
    host,
    onEvent: channel,
    onProgress: progressChannel(onProgress),
  });
  return result.sessionId;
}

export async function sendOnboardingProviderInput(
  sessionId: string,
  requestId: string,
  input: string,
): Promise<void> {
  if (!isTauri()) desktopOnly();
  await invoke("onboarding_provider_login_input", { sessionId, requestId, input });
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
