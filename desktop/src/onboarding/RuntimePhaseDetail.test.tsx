import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OnboardingFlowProps } from "../lib/onboarding";
import { OnboardingFlow } from "./OnboardingFlow";
import { ONBOARDING_TEXT } from "./onboarding.i18n";
import RuntimePhaseDetail, { bytesText, type PhaseInfo } from "./RuntimePhaseDetail";

// The phase detail against stand-in events of the shape agreed with the native side
// (`phase`, and `pull` for the image download). Synthetic data only.
const t = ONBOARDING_TEXT.en;
const GIB = 1024 ** 3;
const MIB = 1024 ** 2;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-24T20:00:00Z"));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const detail = (info: PhaseInfo, phaseKey: string, now = Date.now()) => (
  <RuntimePhaseDetail t={t} locale="en" info={info} phaseKey={phaseKey} now={now} />
);

describe("the phase detail under the step's heading", () => {
  it("shows how long the phase has lasted, and restarts the clock when the phase changes", () => {
    const view = render(detail({ phase: "podman_install" }, "podman_install"));
    expect(screen.getByTestId("onboarding-phase-clock")).toHaveTextContent("In this phase for 00:00");
    view.rerender(detail({ phase: "podman_install" }, "podman_install", Date.now() + 65_000));
    expect(screen.getByTestId("onboarding-phase-clock")).toHaveTextContent("In this phase for 01:05");
    vi.setSystemTime(Date.now() + 70_000);
    view.rerender(detail({ phase: "runtime_download" }, "runtime_download", Date.now() + 3_000));
    expect(screen.getByTestId("onboarding-phase-clock")).toHaveTextContent("In this phase for 00:03");
    // a phase with nothing more to say is its clock alone
    expect(screen.queryByTestId("onboarding-pull-long")).toBeNull();
    expect(screen.queryByTestId("onboarding-pull-bytes")).toBeNull();
    expect(screen.queryByTestId("onboarding-pull-layers")).toBeNull();
  });

  it("says the image download is long, and shows a bar and a percentage only when it said both byte counts", () => {
    render(detail({ phase: "image_pull", pull: { blobsDone: 4, bytesDone: 512 * MIB, bytesTotal: GIB } }, "image_pull"));
    expect(screen.getByTestId("onboarding-pull-long")).toHaveTextContent("can take several minutes");
    const bytes = screen.getByTestId("onboarding-pull-bytes");
    expect(bytes).toHaveTextContent("512 MiB of 1 GiB · 50%");
    expect(bytes.querySelector("progress")).toHaveAttribute("value", "50");
    // with the bytes the layers are not repeated
    expect(screen.queryByTestId("onboarding-pull-layers")).toBeNull();
  });

  it("says only how many layers are done when the bytes are not known, and makes up no percentage", () => {
    render(detail({ phase: "image_pull", pull: { blobsDone: 3, bytesDone: null, bytesTotal: null } }, "image_pull"));
    expect(screen.getByTestId("onboarding-pull-layers")).toHaveTextContent("3 layers downloaded");
    expect(screen.queryByTestId("onboarding-pull-bytes")).toBeNull();
    expect(document.body).not.toHaveTextContent("%");
    cleanup();
    render(detail({ phase: "image_pull", pull: { blobsDone: 1, bytesDone: 10, bytesTotal: null } }, "image_pull"));
    expect(screen.getByTestId("onboarding-pull-layers")).toHaveTextContent("1 layer downloaded");
    expect(screen.queryByTestId("onboarding-pull-bytes")).toBeNull();
  });

  it("ignores a pull that does not belong to the image download, and never goes past 100%", () => {
    render(detail({ phase: "podman_machine_start", pull: { blobsDone: 9, bytesDone: 5, bytesTotal: 10 } }, "podman_machine_start"));
    expect(screen.queryByTestId("onboarding-pull-bytes")).toBeNull();
    expect(screen.queryByTestId("onboarding-pull-layers")).toBeNull();
    cleanup();
    render(detail({ phase: "image_pull", pull: { blobsDone: 9, bytesDone: 2 * GIB, bytesTotal: GIB } }, "image_pull"));
    expect(screen.getByTestId("onboarding-pull-bytes").querySelector("progress")).toHaveAttribute("value", "100");
  });

  it("writes sizes with the biggest unit that keeps them above one", () => {
    expect(bytesText(0, "en")).toBe("0 B");
    expect(bytesText(1536, "en")).toBe("1.5 KiB");
    expect(bytesText(Math.round(3.4 * GIB), "en")).toBe("3.4 GiB");
  });

  it("is in every language, with the plural and the numbers in place", () => {
    for (const locale of ["it", "en", "de", "es", "fr", "hu", "pt"] as const) {
      const text = ONBOARDING_TEXT[locale];
      expect(text.phaseSince("01:05"), locale).toContain("01:05");
      expect(text.pullBytes("12 MiB", "1 GiB"), locale).toContain("12 MiB");
      expect(text.pullLayersCount(3), locale).toContain("3");
      expect(text.pullLayersCount(1), locale).not.toBe(text.pullLayersCount(3));
      expect(text.pullLong.length, locale).toBeGreaterThan(20);
    }
  });
});

describe("in the setup card while a step works", () => {
  function renderWorking(current: Record<string, unknown>) {
    const props: OnboardingFlowProps = {
      account: { displayName: "Ada" },
      platform: "windows",
      runtime: { status: "working", stage: "runtime", message: "Preparo il runtime." },
      activity: {
        startedAt: Date.now() - 20_000, invocation: 1, lastSequence: 3, current: current as never, events: [current as never],
      },
      onSubmit: vi.fn(), onRuntimeAction: vi.fn(), providerLogin: null, sshHostKey: null, onConfirmHostKey: vi.fn(), onCancelHostKey: vi.fn(),
      onProviderInput: vi.fn(), onProviderClose: vi.fn(), onProviderRestart: vi.fn(), onRetry: vi.fn(), onRestart: vi.fn(), onExitFailure: vi.fn(),
      locale: "en",
    };
    return render(<OnboardingFlow {...props} />);
  }
  const entry = (extra: Record<string, unknown>) => ({
    id: "1:runtime:3", invocation: 1, nativeStage: "runtime", sequence: 3, stage: "runtime", name: "Runtime preparation",
    description: "Downloading the team image: it is the longest part", elapsedMs: 20_000, stageElapsedMs: 20_000, updatedAt: Date.now(), status: "active",
    ...extra,
  });

  it("shows the phase's clock and the download's progress from the current event", () => {
    renderWorking(entry({ phase: "image_pull", pull: { blobsDone: 2, bytesDone: 256 * MIB, bytesTotal: GIB } }));
    expect(screen.getByTestId("onboarding-phase-detail")).toBeInTheDocument();
    expect(screen.getByTestId("onboarding-pull-bytes")).toHaveTextContent("256 MiB of 1 GiB · 25%");
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(screen.getByTestId("onboarding-phase-clock")).toHaveTextContent(/In this phase for 00:0[45]/);
  });

  it("still shows a clock for an event that carries no phase (as events did before)", () => {
    renderWorking(entry({}));
    expect(screen.getByTestId("onboarding-phase-clock")).toBeInTheDocument();
    expect(screen.queryByTestId("onboarding-pull-bytes")).toBeNull();
    expect(screen.queryByTestId("onboarding-pull-long")).toBeNull();
  });
});
