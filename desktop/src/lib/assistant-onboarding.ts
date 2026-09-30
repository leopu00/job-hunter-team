import {
  ASSISTANT_ONBOARDING_PATHS,
  type AssistantOnboardingState,
} from "../pages/assistant-onboarding/contract";

export interface AssistantOnboardingStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export class AssistantOnboardingStoreError extends Error {
  constructor() {
    super("assistant-onboarding-state-failed");
    this.name = "AssistantOnboardingStoreError";
  }
}

const STATE_PREFIX = "jht.desktop.assistant-onboarding.";
const PATHS = new Set<string>(ASSISTANT_ONBOARDING_PATHS);

function key(userId: string): string {
  return `${STATE_PREFIX}${userId}`;
}

function valid(value: unknown): value is AssistantOnboardingState {
  if (!value || typeof value !== "object") return false;
  const state = value as Partial<AssistantOnboardingState>;
  if (!Number.isInteger(state.step)) return false;
  if (state.path === null) return state.step === 0;
  return typeof state.path === "string" && PATHS.has(state.path) &&
    (state.step ?? 0) >= 1 && (state.step ?? 5) <= 4;
}

export function loadAssistantOnboardingState(
  userId: string,
  store: AssistantOnboardingStore = localStorage,
): AssistantOnboardingState | undefined {
  try {
    const raw = store.getItem(key(userId));
    if (!raw) return undefined;
    const parsed: unknown = JSON.parse(raw);
    return valid(parsed) ? { path: parsed.path, step: parsed.step } : undefined;
  } catch {
    return undefined;
  }
}

export function saveAssistantOnboardingState(
  userId: string,
  state: AssistantOnboardingState,
  store: AssistantOnboardingStore = localStorage,
): void {
  if (!valid(state)) throw new AssistantOnboardingStoreError();
  try {
    const serialized = JSON.stringify({ path: state.path, step: state.step });
    store.setItem(key(userId), serialized);
    if (store.getItem(key(userId)) !== serialized) throw new Error("state was not persisted");
  } catch {
    throw new AssistantOnboardingStoreError();
  }
}

/** Stable across retries/reloads so the native chat bridge can de-duplicate a confirmed send. */
export async function assistantOnboardingMessageId(
  userId: string,
  state: AssistantOnboardingState,
  message: string,
): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new AssistantOnboardingStoreError();
  const input = new TextEncoder().encode(JSON.stringify([userId, state.path, state.step, message.trim()]));
  const digest = await subtle.digest("SHA-256", input);
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `assistant-onboarding-${hex}`;
}
