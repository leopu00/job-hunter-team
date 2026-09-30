import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VoiceInputBridge, VoiceInputSnapshot, VoiceTranscriptEvent } from "../lib/voice-input";
import { VoiceInputControl } from "./VoiceInputControl";

const IDLE: VoiceInputSnapshot = {
  available: true,
  phase: "idle",
  microphonePermission: "unknown",
  speechPermission: "unknown",
  transcript: "",
  error: null,
};

class FakeBridge implements VoiceInputBridge {
  snapshot = IDLE;
  start = vi.fn().mockResolvedValue(undefined);
  stop = vi.fn().mockResolvedValue(undefined);
  cancel = vi.fn().mockResolvedValue(undefined);
  stateListeners = new Set<(state: VoiceInputSnapshot) => void>();
  transcriptListeners = new Set<(event: VoiceTranscriptEvent) => void>();

  status = vi.fn(async () => this.snapshot);
  async onState(listener: (state: VoiceInputSnapshot) => void) {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }
  async onTranscript(listener: (event: VoiceTranscriptEvent) => void) {
    this.transcriptListeners.add(listener);
    return () => this.transcriptListeners.delete(listener);
  }
  state(next: VoiceInputSnapshot) {
    this.snapshot = next;
    this.stateListeners.forEach((listener) => listener(next));
  }
  transcript(event: VoiceTranscriptEvent) {
    this.transcriptListeners.forEach((listener) => listener(event));
  }
}

function Harness({ bridge, onSend = vi.fn(), initial = "" }: { bridge: VoiceInputBridge; onSend?: (text: string) => void; initial?: string }) {
  const [value, setValue] = useState(initial);
  return (
    <div>
      <textarea aria-label="Messaggio" value={value} onChange={(event) => setValue(event.target.value)} />
      <VoiceInputControl value={value} onChange={setValue} locale="it-IT" bridge={bridge} />
      <button type="button" onClick={() => onSend(value)}>Invia</button>
    </div>
  );
}

async function flush() {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

describe("VoiceInputControl", () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
  afterEach(() => vi.useRealTimers());

  it("shows an explicit unsupported fallback and never starts capture", async () => {
    const bridge = new FakeBridge();
    bridge.snapshot = { ...IDLE, available: false, error: "unsupported" };
    render(<Harness bridge={bridge} />);
    await flush();

    expect(screen.getByRole("alert")).toHaveTextContent(/non è disponibile/i);
    expect(screen.queryByRole("button", { name: /detta un messaggio/i })).not.toBeInTheDocument();
    expect(bridge.start).not.toHaveBeenCalled();
  });

  it("shows permission, recording timer and explicit stop/cancel controls", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const bridge = new FakeBridge();
    render(<Harness bridge={bridge} />);
    await flush();

    await user.click(screen.getByRole("button", { name: /detta un messaggio/i }));
    expect(bridge.start).toHaveBeenCalledWith("it-IT");
    act(() => bridge.state({ ...IDLE, phase: "requesting-permission" }));
    expect(screen.getByRole("status")).toHaveTextContent(/attendo i permessi/i);
    act(() => bridge.state({ ...IDLE, phase: "recording", microphonePermission: "granted", speechPermission: "granted" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(2250); });
    expect(screen.getByRole("status")).toHaveTextContent("00:02");

    await user.click(screen.getByRole("button", { name: /ferma e trascrivi/i }));
    expect(bridge.stop).toHaveBeenCalledOnce();
  });

  it("places only the final transcript in the editable composer and never sends it", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const bridge = new FakeBridge();
    const onSend = vi.fn();
    render(<Harness bridge={bridge} onSend={onSend} initial="Nota:" />);
    await flush();

    act(() => bridge.transcript({ text: "trova ruoli remoti", isFinal: false }));
    expect(screen.getByLabelText("Messaggio")).toHaveValue("Nota:");
    expect(screen.getByText("trova ruoli remoti")).toBeInTheDocument();
    act(() => bridge.transcript({ text: "trova ruoli remoti", isFinal: true }));
    expect(screen.getByLabelText("Messaggio")).toHaveValue("Nota: trova ruoli remoti");
    expect(onSend).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText("Messaggio"), " in Europa");
    expect(screen.getByLabelText("Messaggio")).toHaveValue("Nota: trova ruoli remoti in Europa");
    expect(onSend).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Invia" }));
    expect(onSend).toHaveBeenCalledWith("Nota: trova ruoli remoti in Europa");
  });

  it("cancels without changing the composer or leaving preview text", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const bridge = new FakeBridge();
    render(<Harness bridge={bridge} initial="Testo esistente" />);
    await flush();
    act(() => {
      bridge.state({ ...IDLE, phase: "recording" });
      bridge.transcript({ text: "bozza vocale", isFinal: false });
    });
    await user.click(screen.getByRole("button", { name: "Annulla" }));

    expect(bridge.cancel).toHaveBeenCalledOnce();
    expect(screen.getByLabelText("Messaggio")).toHaveValue("Testo esistente");
    expect(screen.queryByText("bozza vocale")).not.toBeInTheDocument();
  });

  it("fails closed when microphone permission is denied", async () => {
    const bridge = new FakeBridge();
    render(<Harness bridge={bridge} />);
    await flush();
    act(() => bridge.state({
      ...IDLE,
      phase: "error",
      microphonePermission: "denied",
      error: "microphone_permission_denied",
    }));

    expect(screen.getByRole("alert")).toHaveTextContent(/permesso del microfono è negato/i);
    expect(screen.queryByRole("button", { name: /riprova/i })).not.toBeInTheDocument();
  });

  it("fails closed when on-device recognition is unavailable", async () => {
    const bridge = new FakeBridge();
    render(<Harness bridge={bridge} />);
    await flush();
    act(() => bridge.state({ ...IDLE, available: false, phase: "error", error: "on_device_unsupported" }));

    expect(screen.getByRole("alert")).toHaveTextContent(/riconoscimento sul dispositivo non è disponibile/i);
    expect(screen.queryByRole("button", { name: /detta un messaggio/i })).not.toBeInTheDocument();
    expect(bridge.start).not.toHaveBeenCalled();
  });
});
