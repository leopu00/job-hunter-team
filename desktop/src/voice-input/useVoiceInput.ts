import { useCallback, useEffect, useRef, useState } from "react";
import {
  CHECKING_VOICE_INPUT,
  nativeVoiceInput,
  voiceInputErrorCode,
  type VoiceInputBridge,
  type VoiceInputSnapshot,
} from "../lib/voice-input";

export interface UseVoiceInputOptions {
  value: string;
  onChange: (value: string) => void;
  locale?: string;
  bridge?: VoiceInputBridge;
}

function stateWithError(current: VoiceInputSnapshot, error: unknown): VoiceInputSnapshot {
  const code = voiceInputErrorCode(error);
  return { ...current, available: code === "unsupported" || code === "on_device_unsupported" ? false : current.available, phase: "error", error: code };
}

export function useVoiceInput({ value, onChange, locale, bridge = nativeVoiceInput }: UseVoiceInputOptions) {
  const [state, setState] = useState<VoiceInputSnapshot>(CHECKING_VOICE_INPUT);
  const [preview, setPreview] = useState("");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  valueRef.current = value;
  onChangeRef.current = onChange;

  useEffect(() => {
    let alive = true;
    const unlisteners: Array<() => void> = [];
    void bridge.status(locale).then((next) => { if (alive) setState(next); }).catch((error) => {
      if (alive) setState((current) => stateWithError(current, error));
    });
    void bridge.onState((next) => { if (alive) setState(next); }).then((unlisten) => {
      if (alive) unlisteners.push(unlisten); else unlisten();
    });
    void bridge.onTranscript((event) => {
      if (!alive) return;
      if (!event.isFinal) {
        setPreview(event.text);
        return;
      }
      const text = event.text.trim();
      setPreview("");
      if (!text) return;
      const current = valueRef.current.trimEnd();
      onChangeRef.current(current ? `${current} ${text}` : text);
    }).then((unlisten) => {
      if (alive) unlisteners.push(unlisten); else unlisten();
    });
    return () => {
      alive = false;
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, [bridge, locale]);

  useEffect(() => {
    if (state.phase !== "recording") {
      if (state.phase === "idle" || state.phase === "error") setElapsedSeconds(0);
      return;
    }
    const startedAt = Date.now();
    setElapsedSeconds(0);
    const timer = window.setInterval(() => setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000)), 250);
    return () => window.clearInterval(timer);
  }, [state.phase]);

  const start = useCallback(async () => {
    setPreview("");
    setState((current) => ({ ...current, phase: "requesting-permission", error: null }));
    try { await bridge.start(locale); } catch (error) { setState((current) => stateWithError(current, error)); }
  }, [bridge, locale]);
  const stop = useCallback(async () => {
    try { await bridge.stop(); } catch (error) { setState((current) => stateWithError(current, error)); }
  }, [bridge]);
  const cancel = useCallback(async () => {
    setPreview("");
    try { await bridge.cancel(); } catch (error) { setState((current) => stateWithError(current, error)); }
  }, [bridge]);

  return { state, preview, elapsedSeconds, start, stop, cancel };
}
