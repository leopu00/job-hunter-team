import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type VoiceInputPhase = "checking" | "idle" | "requesting-permission" | "recording" | "transcribing" | "error";
export type VoicePermission = "unknown" | "granted" | "denied";

export interface VoiceInputSnapshot {
  available: boolean;
  phase: VoiceInputPhase;
  microphonePermission: VoicePermission;
  speechPermission: VoicePermission;
  transcript: string;
  error: string | null;
}

export interface VoiceTranscriptEvent {
  text: string;
  isFinal: boolean;
}

export interface VoiceInputBridge {
  status(locale?: string): Promise<VoiceInputSnapshot>;
  start(locale?: string): Promise<void>;
  stop(): Promise<void>;
  cancel(): Promise<void>;
  onState(listener: (state: VoiceInputSnapshot) => void): Promise<UnlistenFn>;
  onTranscript(listener: (transcript: VoiceTranscriptEvent) => void): Promise<UnlistenFn>;
}

export const UNSUPPORTED_VOICE_INPUT: VoiceInputSnapshot = {
  available: false,
  phase: "idle",
  microphonePermission: "unknown",
  speechPermission: "unknown",
  transcript: "",
  error: "unsupported",
};

export const CHECKING_VOICE_INPUT: VoiceInputSnapshot = {
  ...UNSUPPORTED_VOICE_INPUT,
  phase: "checking",
  error: null,
};

function unavailable(): Promise<never> {
  return Promise.reject({ code: "unsupported" });
}

export const nativeVoiceInput: VoiceInputBridge = {
  status(locale) {
    if (!isTauri()) return Promise.resolve(UNSUPPORTED_VOICE_INPUT);
    return invoke<VoiceInputSnapshot>("voice_input_status", { locale });
  },
  start(locale) {
    if (!isTauri()) return unavailable();
    return invoke("voice_input_start", { locale });
  },
  stop() {
    if (!isTauri()) return unavailable();
    return invoke("voice_input_stop");
  },
  cancel() {
    if (!isTauri()) return unavailable();
    return invoke("voice_input_cancel");
  },
  async onState(listener) {
    if (!isTauri()) return () => undefined;
    return listen<VoiceInputSnapshot>("voice-input://state", (event) => listener(event.payload));
  },
  async onTranscript(listener) {
    if (!isTauri()) return () => undefined;
    return listen<VoiceTranscriptEvent>("voice-input://transcript", (event) => listener(event.payload));
  },
};

export function voiceInputErrorCode(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error && typeof error.code === "string") {
    return error.code;
  }
  return "native_failed";
}
