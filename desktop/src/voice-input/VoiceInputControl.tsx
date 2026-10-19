import { locales, type Locale } from "@/i18n/config";
import { appLocale } from "../lib/app-locale";
import { describeError } from "../lib/error-catalog";
import type { VoiceInputBridge } from "../lib/voice-input";
import { useVoiceInput } from "./useVoiceInput";
import { VOICE_INPUT_TEXT } from "./voice-input.i18n";
import "./voice-input.css";

export interface VoiceInputControlProps {
  value: string;
  onChange: (value: string) => void;
  locale?: string;
  disabled?: boolean;
  bridge?: VoiceInputBridge;
  className?: string;
}

/** The dictation error, told by the error catalog: what happened and what to do. */
function voiceErrorCopy(code: string | null | undefined, locale: Locale): string {
  const described = describeError(code ?? "unsupported", { fallback: "native_failed", locale });
  return `${described.text} ${described.action}`;
}

function timer(seconds: number) {
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

/** The control speaks the language it listens in; with none given, the app's. */
function languageOf(locale: string | undefined): Locale {
  const primary = locale?.trim().toLowerCase().split(/[-_]/)[0];
  return (locales as readonly string[]).includes(primary ?? "") ? (primary as Locale) : appLocale();
}

export function VoiceInputControl(props: VoiceInputControlProps) {
  const language = languageOf(props.locale);
  const t = VOICE_INPUT_TEXT[language];
  const voice = useVoiceInput(props);
  const { state } = voice;
  const active = state.phase === "requesting-permission" || state.phase === "recording" || state.phase === "transcribing";
  const permissionDenied = state.error === "microphone_permission_denied" || state.error === "speech_permission_denied";
  const unavailable = state.phase !== "checking" && (!state.available || state.error === "unsupported" || state.error === "on_device_unsupported");
  const phaseAnnouncement = state.phase === "requesting-permission"
    ? t.requestingPermission
    : state.phase === "recording"
      ? t.recording
      : state.phase === "transcribing"
        ? t.transcribing
        : null;

  return (
    <div className={`voice-input${active ? " voice-input--active" : ""}${props.className ? ` ${props.className}` : ""}`}>
      {state.phase === "checking" && <span className="voice-input__hint" role="status">{t.checking}</span>}
      {phaseAnnouncement && <span className="voice-input__sr-status" role="status">{phaseAnnouncement}</span>}
      {state.phase === "idle" && state.available && (
        <button className="voice-input__mic" type="button" onClick={() => void voice.start()} disabled={props.disabled} aria-label={t.dictate}>
          <span aria-hidden="true">●</span>
        </button>
      )}

      {state.phase === "requesting-permission" && (
        <div className="voice-input__session">
          <span className="voice-input__pulse" aria-hidden="true" /><strong>{t.waitingPermission}</strong>
          <button type="button" onClick={() => void voice.cancel()}>{t.cancel}</button>
        </div>
      )}

      {state.phase === "recording" && (
        <div className="voice-input__session">
          <span className="voice-input__pulse" aria-hidden="true" /><strong>{t.listening}</strong><time aria-hidden="true">{timer(voice.elapsedSeconds)}</time>
          <button type="button" onClick={() => void voice.stop()}>{t.stopAndTranscribe}</button>
          <button className="voice-input__cancel" type="button" onClick={() => void voice.cancel()}>{t.cancel}</button>
        </div>
      )}

      {state.phase === "transcribing" && (
        <div className="voice-input__session">
          <span className="voice-input__spinner" aria-hidden="true" /><strong>{t.transcribingOnMac}</strong>
          <button className="voice-input__cancel" type="button" onClick={() => void voice.cancel()}>{t.cancel}</button>
        </div>
      )}

      {voice.preview && <p className="voice-input__preview" aria-live="polite">{voice.preview}</p>}

      {(state.phase === "error" || unavailable) && (
        <div className="voice-input__error" role="alert">
          <span>{voiceErrorCopy(state.error, language)}</span>
          {!unavailable && !permissionDenied && <button type="button" onClick={() => void voice.start()} disabled={props.disabled}>{t.retry}</button>}
        </div>
      )}

      {state.phase === "idle" && state.available && state.transcript && (
        <span className="voice-input__hint" role="status">{t.transcriptInserted}</span>
      )}
    </div>
  );
}
