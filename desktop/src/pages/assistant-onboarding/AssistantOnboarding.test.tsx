import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  VoiceInputBridge,
  VoiceInputSnapshot,
  VoiceTranscriptEvent,
} from "../../lib/voice-input";
import AssistantOnboarding from "./AssistantOnboarding";
import type { AssistantOnboardingPath, AssistantOnboardingState } from "./contract";

const PATHS: Array<{ button: string; path: AssistantOnboardingPath; finalTitle: string }> = [
  { button: "Fammi fare il tour", path: "tour", finalTitle: "Continua con parole tue" },
  { button: "Che cosa serve per iniziare?", path: "requirements", finalTitle: "Poi si parte da una domanda" },
  { button: "Preferisco esplorare", path: "explore", finalTitle: "Completa il giro a modo tuo" },
];

const complete = () => vi.fn(async () => undefined);

const VOICE_IDLE: VoiceInputSnapshot = {
  available: true,
  phase: "idle",
  microphonePermission: "unknown",
  speechPermission: "unknown",
  transcript: "",
  error: null,
};

function voiceBridge() {
  const transcriptListeners = new Set<(event: VoiceTranscriptEvent) => void>();
  const bridge: VoiceInputBridge = {
    status: vi.fn(async () => VOICE_IDLE),
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    cancel: vi.fn().mockResolvedValue(undefined),
    onState: vi.fn(async () => () => undefined),
    onTranscript: vi.fn(async (listener) => {
      transcriptListeners.add(listener);
      return () => transcriptListeners.delete(listener);
    }),
  };
  return {
    bridge,
    transcript: (event: VoiceTranscriptEvent) =>
      transcriptListeners.forEach((listener) => listener(event)),
  };
}

function viewport(width: number, height: number, zoom: string) {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: height });
  document.documentElement.style.setProperty("--zoom", zoom);
}

afterEach(() => {
  document.documentElement.style.removeProperty("--zoom");
});

describe("AssistantOnboarding", () => {
  it("presents the Assistant and the three honest entry choices at 0/4", () => {
    render(<AssistantOnboarding onComplete={complete()} />);

    expect(screen.getByRole("heading", { name: "Assistente" })).toBeInTheDocument();
    expect(screen.getByText("0/4")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Avanzamento onboarding Assistente" })).toHaveAttribute("aria-valuenow", "0");
    const choices = screen.getByRole("group", { name: "Scegli il percorso di onboarding" });
    for (const { button } of PATHS) expect(within(choices).getByRole("button", { name: new RegExp(button) })).toBeInTheDocument();
    expect(screen.getByText(/non legge lo stato del team e non mostra dati simulati/i)).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Dialogo guidato con Assistente" })).toBeInTheDocument();
  });

  it.each(PATHS)("completes every step of $path and hands off to free chat", async ({ button, path, finalTitle }) => {
    const user = userEvent.setup();
    const onStateChange = vi.fn();
    const onComplete = complete();
    render(<AssistantOnboarding onStateChange={onStateChange} onComplete={onComplete} />);

    await user.click(screen.getByRole("button", { name: new RegExp(button) }));
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "1");
    expect(onStateChange).toHaveBeenLastCalledWith({ path, step: 1 });

    for (const step of [2, 3, 4]) {
      await user.click(screen.getByRole("button", { name: "Avanti" }));
      expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", String(step));
      expect(onStateChange).toHaveBeenLastCalledWith({ path, step });
    }

    expect(screen.getByRole("heading", { name: finalTitle })).toHaveFocus();
    const firstMessage = screen.getByRole("textbox", { name: /primo messaggio all’assistente/i });
    expect(screen.getByRole("button", { name: /Passa alla chat libera/ })).toBeDisabled();
    await user.type(firstMessage, "Vorrei iniziare dalle opportunità più adatte.");
    await user.click(screen.getByRole("button", { name: /Passa alla chat libera/ }));
    expect(onComplete).toHaveBeenCalledWith(
      { path, step: 4 },
      "Vorrei iniziare dalle opportunità più adatte.",
    );
  });

  it("moves back within a path and returns to the initial choices", async () => {
    const user = userEvent.setup();
    const onStateChange = vi.fn();
    render(<AssistantOnboarding onStateChange={onStateChange} onComplete={complete()} />);

    await user.click(screen.getByRole("button", { name: /Fammi fare il tour/ }));
    await user.click(screen.getByRole("button", { name: "Avanti" }));
    expect(screen.getByText("2/4")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Indietro/ }));
    expect(screen.getByText("1/4")).toBeInTheDocument();
    expect(onStateChange).toHaveBeenLastCalledWith({ path: "tour", step: 1 });
    await user.click(screen.getByRole("button", { name: /Indietro/ }));
    expect(screen.getByText("0/4")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Preferisco esplorare/ })).toBeInTheDocument();
    expect(onStateChange).toHaveBeenLastCalledWith({ path: null, step: 0 });
  });

  it("resumes from a serializable state and uses the caller's Assistant name", () => {
    render(
      <AssistantOnboarding
        assistantName="Jeeves"
        initialState={{ path: "requirements", step: 3 }}
        onComplete={complete()}
      />,
    );

    expect(screen.getByRole("heading", { name: "Jeeves" })).toBeInTheDocument();
    expect(screen.getByText("3/4")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Indicazioni su ciò che cerchi" })).toHaveFocus();
  });

  it("waits for durable completion and retries safely after a rejection", async () => {
    const user = userEvent.setup();
    let release!: () => void;
    const onComplete = vi
      .fn<(state: AssistantOnboardingState, firstMessage: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error("native marker unavailable"))
      .mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve; }));
    render(
      <AssistantOnboarding
        initialState={{ path: "tour", step: 4 }}
        onComplete={onComplete}
      />,
    );

    await user.type(
      screen.getByRole("textbox", { name: /primo messaggio all’assistente/i }),
      "  Cominciamo dalle candidature.  ",
    );
    await user.click(screen.getByRole("button", { name: /Passa alla chat libera/ }));
    expect(await screen.findByText(/non è stato segnato come completato/i)).toBeInTheDocument();
    expect(screen.queryByText("native marker unavailable")).toBeNull();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "4");

    await user.click(screen.getByRole("button", { name: /Riprova e apri la chat/ }));
    expect(screen.getByRole("button", { name: /Apro la chat/ })).toBeDisabled();
    expect(onComplete).toHaveBeenLastCalledWith(
      { path: "tour", step: 4 },
      "Cominciamo dalle candidature.",
    );
    release();
    await waitFor(() => expect(screen.getByRole("button", { name: /Passa alla chat libera/ })).toBeEnabled());
  });

  it("keeps the final voice transcript editable and hands it off only on confirmation", async () => {
    const user = userEvent.setup();
    const voice = voiceBridge();
    const onComplete = vi.fn(async () => undefined);
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    render(
      <AssistantOnboarding
        initialState={{ path: "tour", step: 4 }}
        onComplete={onComplete}
        voiceInputBridge={voice.bridge}
      />,
    );
    await screen.findByRole("button", { name: /detta un messaggio/i });

    act(() => voice.transcript({ text: "iniziamo dalle candidature remote", isFinal: true }));

    const composer = screen.getByRole("textbox", { name: /primo messaggio all’assistente/i });
    expect(composer).toHaveValue("iniziamo dalle candidature remote");
    expect(onComplete).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();

    await user.type(composer, " in Europa");
    expect(onComplete).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: /passa alla chat libera/i }));
    expect(onComplete).toHaveBeenCalledWith(
      { path: "tour", step: 4 },
      "iniziamo dalle candidature remote in Europa",
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each([
    [1440, 900, "1"],
    [820, 620, "1.15"],
    [480, 420, "1.4"],
  ])("confines the reusable surface at %sx%s with zoom %s", (width, height, zoom) => {
    viewport(Number(width), Number(height), String(zoom));
    render(<AssistantOnboarding onComplete={complete()} />);

    const shell = screen.getByTestId("assistant-onboarding-shell");
    expect(shell).toHaveStyle({ height: "calc(100svh / var(--zoom, 1) - 3.5rem)" });
    expect(shell.className).toBe("assistant-onboarding");
    expect(shell.querySelector(".assistant-onboarding__body")).toHaveStyle({ overflowY: "auto" });
    expect(shell.querySelector(".assistant-onboarding__header")).toBeInTheDocument();
  });

});
