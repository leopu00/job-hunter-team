import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { describeError } from "../lib/error-catalog";
import { stateText } from "../lib/onboarding-state.i18n";
import { resumeOnboardingTeamStart } from "../lib/onboarding-runtime";
import { StartTeamAction } from "./StartTeamAction";
import { TEAM_OFF_TEXT } from "./team-off.i18n";

vi.mock("../lib/onboarding-runtime", () => ({ resumeOnboardingTeamStart: vi.fn() }));

afterEach(() => {
  cleanup();
  document.cookie = "NEXT_LOCALE=; path=/; max-age=0";
  vi.mocked(resumeOnboardingTeamStart).mockReset();
});

describe("«Start the team» where a page says the team is stopped", () => {
  it("runs the resume's start, says it is starting, and tells the page when the team is up", async () => {
    let finish!: () => void;
    vi.mocked(resumeOnboardingTeamStart).mockReturnValue(new Promise((done) => { finish = () => done({} as never); }));
    const onStarted = vi.fn();
    render(<StartTeamAction onStarted={onStarted} />);
    fireEvent.click(screen.getByTestId("start-team"));
    expect(resumeOnboardingTeamStart).toHaveBeenCalledOnce();
    expect(screen.getByTestId("start-team")).toBeDisabled();
    expect(screen.getByTestId("start-team-action")).toHaveTextContent(stateText().startingContainerAndAgents);
    expect(onStarted).not.toHaveBeenCalled();
    finish();
    await waitFor(() => expect(onStarted).toHaveBeenCalledOnce());
    expect(screen.getByTestId("start-team")).not.toBeDisabled();
  });

  it("a refusal is told with the catalog's sentence and the page is not told the team is up", async () => {
    document.cookie = "NEXT_LOCALE=en; path=/";
    vi.mocked(resumeOnboardingTeamStart).mockRejectedValue({ code: "operation_in_progress" });
    const onStarted = vi.fn();
    render(<StartTeamAction onStarted={onStarted} />);
    fireEvent.click(screen.getByTestId("start-team"));
    const failed = await screen.findByTestId("start-team-failed");
    expect(failed).toHaveTextContent(describeError("operation_in_progress", { locale: "en" }).text);
    expect(failed).not.toHaveTextContent("operation_in_progress");
    expect(onStarted).not.toHaveBeenCalled();
    expect(screen.getByTestId("start-team")).not.toBeDisabled();
  });

  it.each(Object.keys(TEAM_OFF_TEXT) as (keyof typeof TEAM_OFF_TEXT)[])("is labelled as the banner's «Start the team» in %s", (locale) => {
    document.cookie = `NEXT_LOCALE=${locale}; path=/`;
    render(<StartTeamAction onStarted={() => undefined} />);
    expect(screen.getByTestId("start-team")).toHaveTextContent(TEAM_OFF_TEXT[locale].start);
  });
});
