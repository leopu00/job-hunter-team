import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import GuidedOnboardingPage from "./GuidedOnboardingPage";
import { GUIDED_MOMENT_LINE } from "./guided.i18n";
import { TEAM_START_PATIENCE_MS, type GuidedMoment } from "./moments";

const MOMENTS: GuidedMoment[] = ["interview", "confirm", "plan", "team", "started"];

function page(moment: GuidedMoment, teamWaitedMs = 0, onContinueLater = vi.fn()) {
  document.cookie = "NEXT_LOCALE=en; path=/";
  return {
    onContinueLater,
    ...render(
      <GuidedOnboardingPage moment={moment} teamWaitedMs={teamWaitedMs} onContinueLater={onContinueLater}>
        <section data-testid="the-chat">chat</section>
      </GuidedOnboardingPage>,
    ),
  };
}

afterEach(() => {
  cleanup();
  document.cookie = "NEXT_LOCALE=; path=/; max-age=0";
});

describe("the screen after the setup", () => {
  it("puts the profile card on the left and the chat with the Assistant on the right", () => {
    page("interview");
    const profile = screen.getByRole("complementary");
    expect(profile).toContainElement(screen.getByTestId("profile-progress-stub"));
    const assistant = screen.getByRole("region", { name: "Chat with the Assistant" });
    expect(assistant).toContainElement(screen.getByTestId("the-chat"));
    expect(assistant).toContainElement(screen.getByTestId("assistant-portrait-stub"));
    expect(profile).not.toContainElement(screen.getByTestId("the-chat"));
  });

  it("says in one line the moment the person is at, in the person's language", () => {
    for (const moment of MOMENTS) {
      cleanup();
      page(moment);
      expect(screen.getByTestId("guided-moment-line")).toHaveTextContent(GUIDED_MOMENT_LINE[moment].en);
      expect(screen.getByTestId("guided-onboarding")).toHaveAttribute("data-moment", moment);
    }
  });

  it("offers «continue later» in EVERY moment, and it calls the way out", () => {
    for (const moment of MOMENTS) {
      cleanup();
      const { onContinueLater } = page(moment, TEAM_START_PATIENCE_MS * 3);
      fireEvent.click(screen.getByTestId("guided-continue-later"));
      expect(onContinueLater, moment).toHaveBeenCalledTimes(1);
    }
  });

  it("says the team is late only in the team moment, and only after the patience", () => {
    page("team", TEAM_START_PATIENCE_MS - 1);
    expect(screen.queryByTestId("guided-team-late")).toBeNull();
    cleanup();
    page("team", TEAM_START_PATIENCE_MS);
    expect(screen.getByTestId("guided-team-late")).toHaveTextContent("continue later");
    // the way out is still there next to it
    expect(screen.getByTestId("guided-continue-later")).toBeInTheDocument();
    for (const moment of MOMENTS.filter((m) => m !== "team")) {
      cleanup();
      page(moment, TEAM_START_PATIENCE_MS * 10);
      expect(screen.queryByTestId("guided-team-late"), moment).toBeNull();
    }
  });

  it("speaks the person's language, all seven", () => {
    for (const locale of ["en", "it", "hu", "es", "de", "fr", "pt"] as const) {
      for (const moment of MOMENTS) expect(GUIDED_MOMENT_LINE[moment][locale], `${moment} ${locale}`).toBeTruthy();
    }
  });
});
