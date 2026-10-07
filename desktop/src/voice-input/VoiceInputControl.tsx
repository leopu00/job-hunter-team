import { describeError } from "../lib/error-catalog";
import type { VoiceInputBridge } from "../lib/voice-input";
import { useVoiceInput } from "./useVoiceInput";
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
function voiceErrorCopy(code: string | null | undefined): string {
  const described = describeError(code ?? "unsupported", { fallback: "native_failed" });
  return `${described.text} ${described.action}`;
}

function timer(seconds: number) {
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

export function VoiceInputControl(props: VoiceInputControlProps) {
  const voice = useVoiceInput(props);
  const { state } = voice;
  const active = state.phase === "requesting-permission" || state.phase === "recording" || state.phase === "transcribing";
  const permissionDenied = state.error === "microphone_permission_denied" || state.error === "speech_permission_denied";
  const unavailable = state.phase !== "checking" && (!state.available || state.error === "unsupported" || state.error === "on_device_unsupported");
  const phaseAnnouncement = state.phase === "requesting-permission"
    ? "Richiesta dei permessi in corso."
    : state.phase === "recording"
      ? "Registrazione in corso."
      : state.phase === "transcribing"
        ? "Trascrizione in corso."
        : null;

  return (
    <div className={`voice-input${active ? " voice-input--active" : ""}${props.className ? ` ${props.className}` : ""}`}>
      {state.phase === "checking" && <span className="voice-input__hint" role="status">Verifico il dettato sul dispositivo…</span>}
      {phaseAnnouncement && <span className="voice-input__sr-status" role="status">{phaseAnnouncement}</span>}
      {state.phase === "idle" && state.available && (
        <button className="voice-input__mic" type="button" onClick={() => void voice.start()} disabled={props.disabled} aria-label="Detta un messaggio">
          <span aria-hidden="true">●</span>
        </button>
      )}

      {state.phase === "requesting-permission" && (
        <div className="voice-input__session">
          <span className="voice-input__pulse" aria-hidden="true" /><strong>Attendo i permessi…</strong>
          <button type="button" onClick={() => void voice.cancel()}>Annulla</button>
        </div>
      )}

      {state.phase === "recording" && (
        <div className="voice-input__session">
          <span className="voice-input__pulse" aria-hidden="true" /><strong>In ascolto</strong><time aria-hidden="true">{timer(voice.elapsedSeconds)}</time>
          <button type="button" onClick={() => void voice.stop()}>Ferma e trascrivi</button>
          <button className="voice-input__cancel" type="button" onClick={() => void voice.cancel()}>Annulla</button>
        </div>
      )}

      {state.phase === "transcribing" && (
        <div className="voice-input__session">
          <span className="voice-input__spinner" aria-hidden="true" /><strong>Trascrizione sul Mac…</strong>
          <button className="voice-input__cancel" type="button" onClick={() => void voice.cancel()}>Annulla</button>
        </div>
      )}

      {voice.preview && <p className="voice-input__preview" aria-live="polite">{voice.preview}</p>}

      {(state.phase === "error" || unavailable) && (
        <div className="voice-input__error" role="alert">
          <span>{voiceErrorCopy(state.error)}</span>
          {!unavailable && !permissionDenied && <button type="button" onClick={() => void voice.start()} disabled={props.disabled}>Riprova</button>}
        </div>
      )}

      {state.phase === "idle" && state.available && state.transcript && (
        <span className="voice-input__hint" role="status">Trascrizione inserita: rileggila prima di inviare.</span>
      )}
    </div>
  );
}
