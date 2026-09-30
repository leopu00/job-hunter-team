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

async function cancelForCleanup(bridge: VoiceInputBridge): Promise<void> {
  try {
    await bridge.cancel();
  } catch (error) {
    // An idle native session is already in the cleanup state we need. Other
    // failures cannot be rendered after teardown, but are caught so cleanup
    // never creates an unhandled rejection.
    if (voiceInputErrorCode(error) === "not_recording") return;
  }
}

export function useVoiceInput({ value, onChange, locale, bridge = nativeVoiceInput }: UseVoiceInputOptions) {
  const [state, setState] = useState<VoiceInputSnapshot>(CHECKING_VOICE_INPUT);
  const [preview, setPreview] = useState("");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  const lifecycleRef = useRef(0);
  const cleanupRef = useRef<Promise<void>>(Promise.resolve());
  valueRef.current = value;
  onChangeRef.current = onChange;

  useEffect(() => {
    let alive = true;
    const lifecycle = ++lifecycleRef.current;
    const unlisteners: Array<() => void> = [];
    const current = () => alive && lifecycleRef.current === lifecycle;
    const previousCleanup = cleanupRef.current;
    setState(CHECKING_VOICE_INPUT);
    setPreview("");

    void previousCleanup.then(() => {
      if (!current()) return;
      void bridge.status(locale).then((next) => { if (current()) setState(next); }).catch((error) => {
        if (current()) setState((snapshot) => stateWithError(snapshot, error));
      });
      void bridge.onState((next) => { if (current()) setState(next); }).then((unlisten) => {
        if (current()) unlisteners.push(unlisten); else unlisten();
      });
      void bridge.onTranscript((event) => {
        if (!current()) return;
        if (!event.isFinal) {
          setPreview(event.text);
          return;
        }
        const text = event.text.trim();
        setPreview("");
        if (!text) return;
        const composer = valueRef.current.trimEnd();
        onChangeRef.current(composer ? `${composer} ${text}` : text);
      }).then((unlisten) => {
        if (current()) unlisteners.push(unlisten); else unlisten();
      });
    });
    return () => {
      alive = false;
      lifecycleRef.current += 1;
      unlisteners.forEach((unlisten) => unlisten());
      cleanupRef.current = cleanupRef.current.then(() => cancelForCleanup(bridge));
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
    const lifecycle = lifecycleRef.current;
    setPreview("");
    setState((current) => ({ ...current, phase: "requesting-permission", error: null }));
    try { await bridge.start(locale); } catch (error) {
      if (lifecycleRef.current === lifecycle) setState((current) => stateWithError(current, error));
    }
  }, [bridge, locale]);
  const stop = useCallback(async () => {
    const lifecycle = lifecycleRef.current;
    try { await bridge.stop(); } catch (error) {
      if (lifecycleRef.current === lifecycle) setState((current) => stateWithError(current, error));
    }
  }, [bridge]);
  const cancel = useCallback(async () => {
    const lifecycle = lifecycleRef.current;
    setPreview("");
    try { await bridge.cancel(); } catch (error) {
      if (lifecycleRef.current === lifecycle) setState((current) => stateWithError(current, error));
    }
  }, [bridge]);

  return { state, preview, elapsedSeconds, start, stop, cancel };
}
