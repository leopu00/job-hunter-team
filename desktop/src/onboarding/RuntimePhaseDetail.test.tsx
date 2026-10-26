import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OnboardingFlowProps } from "../lib/onboarding";
import { OnboardingFlow } from "./OnboardingFlow";
import { ONBOARDING_TEXT } from "./onboarding.i18n";
import RuntimePhaseDetail, { bytesText, minutesLeftAtLeast, pullBar, type PhaseInfo } from "./RuntimePhaseDetail";

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

  it("draws the image download as a bar of the bytes done over the bytes found so far, never as a percentage", () => {
    render(detail({ phase: "image_pull", pull: { blobsDone: 4, bytesDone: 1 * GIB, bytesTotal: 4 * GIB } }, "image_pull"));
    expect(screen.getByTestId("onboarding-pull-long")).toHaveTextContent("can take several minutes");
    // the total only grows while podman finds the layers: it is said «of at least», and no number is a percentage
    expect(screen.getByTestId("onboarding-pull-bytes")).toHaveTextContent("1 GiB downloaded of at least 4 GiB · 4 layers");
    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", String(GIB));
    expect(bar).toHaveAttribute("aria-valuemax", String(4 * GIB));
    expect(bar).toHaveAttribute("aria-valuetext", "1 GiB downloaded of at least 4 GiB");
    expect(bar.querySelector("i")).toHaveStyle({ width: "25.0%" });
    expect(document.body).not.toHaveTextContent("%");
    expect(screen.queryByTestId("onboarding-pull-layers")).toBeNull();
  });

  it("keeps the bar from going back when the total grows, and stops it short of the end", () => {
    const view = render(detail({ phase: "image_pull", pull: { blobsDone: 1, bytesDone: 500 * MIB, bytesTotal: GIB } }, "image_pull"));
    const width = () => (screen.getByRole("progressbar").querySelector("i") as HTMLElement).style.width;
    expect(width()).toBe("48.8%");
    // podman found more layers: the share would fall to 25%, the bar stays where it was
    view.rerender(detail({ phase: "image_pull", pull: { blobsDone: 1, bytesDone: 520 * MIB, bytesTotal: 2 * GIB } }, "image_pull"));
    expect(width()).toBe("48.8%");
    expect(screen.getByTestId("onboarding-pull-bytes")).toHaveTextContent("520 MiB downloaded of at least 2 GiB");
    // everything found is downloaded: still not full, the step says when it is done
    view.rerender(detail({ phase: "image_pull", pull: { blobsDone: 6, bytesDone: 2 * GIB, bytesTotal: 2 * GIB } }, "image_pull"));
    expect(width()).toBe("95%");
    // a new phase starts from zero
    view.rerender(detail({ phase: "team_restart" }, "team_restart"));
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("draws no bar without both bytes, with a total of zero, or with more done than the total", () => {
    for (const pull of [
      { blobsDone: 2, bytesDone: 5 * MIB, bytesTotal: null },
      { blobsDone: 2, bytesDone: null, bytesTotal: null },
      { blobsDone: 2, bytesDone: 0, bytesTotal: 0 },
      { blobsDone: 2, bytesDone: 2 * MIB, bytesTotal: MIB },
    ]) {
      expect(pullBar({ phase: "image_pull", pull })).toBeNull();
    }
    expect(pullBar({ phase: "podman_install", pull: { blobsDone: 1, bytesDone: MIB, bytesTotal: 2 * MIB } })).toBeNull();
    expect(pullBar({ phase: "image_pull", pull: { blobsDone: 1, bytesDone: MIB, bytesTotal: 2 * MIB } })).toEqual({ done: MIB, total: 2 * MIB });
  });

  it("estimates the time left as a lower bound: in whole minutes rounded down, and not before it means anything", () => {
    // 100 MiB in 60 s, 500 MiB found: 400 MiB left at 100 MiB/min = 4 min at least
    expect(minutesLeftAtLeast(100 * MIB, 500 * MIB, 60_000)).toBe(4);
    // 2.9 minutes left says 2, never 3
    expect(minutesLeftAtLeast(100 * MIB, 390 * MIB, 60_000)).toBe(2);
    // under a minute left: nothing is said
    expect(minutesLeftAtLeast(100 * MIB, 150 * MIB, 60_000)).toBeNull();
    // too early, or too little downloaded to know the speed
    expect(minutesLeftAtLeast(100 * MIB, 500 * MIB, 10_000)).toBeNull();
    expect(minutesLeftAtLeast(2 * MIB, 500 * MIB, 60_000)).toBeNull();
  });

  it("says the time left, as at least, only once the phase has a speed to go on", () => {
    const pull = { blobsDone: 1, bytesDone: 100 * MIB, bytesTotal: 500 * MIB };
    const view = render(detail({ phase: "image_pull", pull }, "image_pull", Date.now() + 5_000));
    expect(screen.queryByTestId("onboarding-pull-estimate")).toBeNull();
    view.rerender(detail({ phase: "image_pull", pull }, "image_pull", Date.now() + 60_000));
    expect(screen.getByTestId("onboarding-pull-estimate")).toHaveTextContent("At this speed: at least 4 min to go");
  });

  it("tells which phase of the installer it is", () => {
    render(detail({ phase: "image_pull" }, "image_pull"));
    expect(screen.getByTestId("onboarding-phase-step")).toHaveTextContent("Phase 6 of 7");
    cleanup();
    render(detail({}, "something"));
    expect(screen.queryByTestId("onboarding-phase-step")).toBeNull();
  });

  it("says only how many layers are done when the bytes are not known", () => {
    render(detail({ phase: "image_pull", pull: { blobsDone: 3, bytesDone: null, bytesTotal: null } }, "image_pull"));
    expect(screen.getByTestId("onboarding-pull-layers")).toHaveTextContent("3 layers downloaded");
    expect(screen.queryByTestId("onboarding-pull-bytes")).toBeNull();
    expect(document.body).not.toHaveTextContent("%");
    cleanup();
    render(detail({ phase: "image_pull", pull: { blobsDone: 1, bytesDone: null, bytesTotal: null } }, "image_pull"));
    expect(screen.getByTestId("onboarding-pull-layers")).toHaveTextContent("1 layer downloaded");
  });

  it("says the bytes before a first layer is done, and ignores a pull that is not the image download", () => {
    render(detail({ phase: "image_pull", pull: { blobsDone: 0, bytesDone: 20 * MIB, bytesTotal: 100 * MIB } }, "image_pull"));
    expect(screen.getByTestId("onboarding-pull-bytes")).toHaveTextContent(/^20 MiB downloaded of at least 100 MiB$/);
    cleanup();
    render(detail({ phase: "podman_machine_start", pull: { blobsDone: 9, bytesDone: 5, bytesTotal: 10 } }, "podman_machine_start"));
    expect(screen.queryByTestId("onboarding-pull-bytes")).toBeNull();
    expect(screen.queryByTestId("onboarding-pull-layers")).toBeNull();
  });

  it("shows no bytes for a count that is negative or not a number, and keeps the layers", () => {
    render(detail({ phase: "image_pull", pull: { blobsDone: 2, bytesDone: -5, bytesTotal: GIB } }, "image_pull"));
    expect(screen.queryByTestId("onboarding-pull-bytes")).toBeNull();
    expect(screen.getByTestId("onboarding-pull-layers")).toHaveTextContent("2 layers downloaded");
    cleanup();
    render(detail({ phase: "image_pull", pull: { blobsDone: 2, bytesDone: Number.NaN, bytesTotal: GIB } }, "image_pull"));
    expect(screen.queryByTestId("onboarding-pull-bytes")).toBeNull();
    expect(document.body).not.toHaveTextContent("NaN");
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
      expect(text.pullBytesDone("12 MiB"), locale).toContain("12 MiB");
      expect(text.pullLayersShort(3), locale).toContain("3");
      expect(text.pullLayersShort(1), locale).not.toBe(text.pullLayersShort(3));
      expect(text.pullLayersCount(3), locale).toContain("3");
      expect(text.pullLayersCount(1), locale).not.toBe(text.pullLayersCount(3));
      expect(text.pullLong.length, locale).toBeGreaterThan(20);
      expect(text.pullBytesOfAtLeast("12 MiB", "40 MiB"), locale).toMatch(/12 MiB.*40 MiB/);
      expect(text.pullEstimate(4), locale).toContain("4");
      expect(text.phaseStep(6, 7), locale).toMatch(/6.*7/);
      expect(text.pullBarAria.length, locale).toBeGreaterThan(10);
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
    expect(screen.getByTestId("onboarding-pull-bytes")).toHaveTextContent("256 MiB downloaded of at least 1 GiB · 2 layers");
    // the true bar replaces the one that only says «working»
    expect(screen.getByTestId("onboarding-pull-bar")).toBeInTheDocument();
    expect(document.querySelector(".onboarding-runtime-progress__indeterminate")).toBeNull();
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
    // no bytes, no true bar: the one that says «working» stays
    expect(screen.queryByTestId("onboarding-pull-bar")).toBeNull();
    expect(document.querySelector(".onboarding-runtime-progress__indeterminate")).not.toBeNull();
  });
});
