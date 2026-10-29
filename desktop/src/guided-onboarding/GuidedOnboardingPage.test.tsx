import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProfileProgress } from "./deps";
import GuidedOnboardingPage from "./GuidedOnboardingPage";
import { GUIDED_MOMENT_LINE } from "./guided.i18n";
import { TEAM_START_PATIENCE_MS, type FirstRunSignal, type GuidedMoment } from "./moments";

// The card is somebody else's: here it is a stand-in whose count the test sets.
const card = vi.hoisted(() => ({ filled: 0, total: 8 }));
vi.mock("./deps", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./deps")>()),
  useProfileProgress: (): ProfileProgress => ({ state: "ready", fields: [], filled: card.filled, total: card.total }),
}));

const MOMENTS: GuidedMoment[] = ["interview", "confirm", "plan", "team", "started"];
const BURST = (workers: number): FirstRunSignal => ({ phase: "burst", workers, planDeclared: true });

// What the machine says, for each moment.
const MACHINE: Record<GuidedMoment, { filled: number; profileReady: boolean; captainRunning: boolean; firstRun: FirstRunSignal | null }> = {
  interview: { filled: 3, profileReady: false, captainRunning: true, firstRun: null },
  confirm: { filled: 8, profileReady: false, captainRunning: true, firstRun: null },
  plan: { filled: 8, profileReady: true, captainRunning: true, firstRun: { phase: "awaiting_profile", workers: 0, planDeclared: false } },
  team: { filled: 8, profileReady: true, captainRunning: true, firstRun: BURST(0) },
  started: { filled: 8, profileReady: true, captainRunning: true, firstRun: BURST(2) },
};

function page(moment: GuidedMoment, onContinueLater = vi.fn(), patienceMs?: number) {
  document.cookie = "NEXT_LOCALE=en; path=/";
  const { filled, ...machine } = MACHINE[moment];
  card.filled = filled;
  return {
    onContinueLater,
    ...render(
      <GuidedOnboardingPage {...machine} onContinueLater={onContinueLater} patienceMs={patienceMs}>
        <section data-testid="the-chat">chat</section>
      </GuidedOnboardingPage>,
    ),
  };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  document.cookie = "NEXT_LOCALE=; path=/; max-age=0";
});

describe("the screen after the setup", () => {
  it("puts the profile card on the left and the chat with the Assistant on the right", () => {
    page("interview");
    const profile = screen.getByRole("complementary");
    expect(profile).toContainElement(screen.getByTestId("profile-progress"));
    const assistant = screen.getByRole("region", { name: "Chat with the Assistant" });
    expect(assistant).toContainElement(screen.getByTestId("the-chat"));
    expect(assistant).toContainElement(screen.getByTestId("assistant-portrait"));
    expect(profile).not.toContainElement(screen.getByTestId("the-chat"));
  });

  it("says in one line the moment the machine puts the person at, in the person's language", () => {
    for (const moment of MOMENTS) {
      cleanup();
      page(moment);
      expect(screen.getByTestId("guided-moment-line"), moment).toHaveTextContent(GUIDED_MOMENT_LINE[moment].en);
      expect(screen.getByTestId("guided-onboarding")).toHaveAttribute("data-moment", moment);
    }
  });

  it("offers «continue later» in EVERY moment, and it calls the way out", () => {
    for (const moment of MOMENTS) {
      cleanup();
      const { onContinueLater } = page(moment);
      fireEvent.click(screen.getByTestId("guided-continue-later"));
      expect(onContinueLater, moment).toHaveBeenCalledTimes(1);
    }
  });

  it("says the team is late only in the team moment, and only after the patience", () => {
    vi.useFakeTimers();
    page("team");
    expect(screen.queryByTestId("guided-team-late")).toBeNull();
    act(() => vi.advanceTimersByTime(TEAM_START_PATIENCE_MS - 1));
    expect(screen.queryByTestId("guided-team-late")).toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByTestId("guided-team-late")).toHaveTextContent("continue later");
    // the way out is still there next to it
    expect(screen.getByTestId("guided-continue-later")).toBeInTheDocument();
  });

  it("never says the team is late in another moment, however long it takes", () => {
    vi.useFakeTimers();
    for (const moment of MOMENTS.filter((m) => m !== "team")) {
      cleanup();
      page(moment);
      act(() => vi.advanceTimersByTime(TEAM_START_PATIENCE_MS * 10));
      expect(screen.queryByTestId("guided-team-late"), moment).toBeNull();
    }
  });

  it("takes the late notice back when the team starts", () => {
    vi.useFakeTimers();
    const { rerender } = page("team", vi.fn(), 1_000);
    act(() => vi.advanceTimersByTime(1_000));
    expect(screen.getByTestId("guided-team-late")).toBeInTheDocument();
    const machine = MACHINE.started;
    rerender(
      <GuidedOnboardingPage profileReady={machine.profileReady} captainRunning={machine.captainRunning} firstRun={machine.firstRun} onContinueLater={vi.fn()} patienceMs={1_000}>
        <section data-testid="the-chat">chat</section>
      </GuidedOnboardingPage>,
    );
    expect(screen.queryByTestId("guided-team-late")).toBeNull();
    expect(screen.getByTestId("guided-moment-line")).toHaveTextContent(GUIDED_MOMENT_LINE.started.en);
  });

  it("has every line in all seven languages", () => {
    for (const locale of ["en", "it", "hu", "es", "de", "fr", "pt"] as const) {
      for (const moment of MOMENTS) expect(GUIDED_MOMENT_LINE[moment][locale], `${moment} ${locale}`).toBeTruthy();
    }
  });
});
