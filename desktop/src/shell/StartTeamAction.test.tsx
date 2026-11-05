import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { describeError } from "../lib/error-catalog";
import { resumeOnboardingTeamStart, type OnboardingNativeProgress } from "../lib/onboarding-runtime";
import { StartTeamAction } from "./StartTeamAction";
import { act } from "@testing-library/react";
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
    // the button gives its place to the progress: nothing to press again, and the screen says something is going on
    expect(screen.queryByTestId("start-team")).toBeNull();
    expect(screen.getByTestId("start-team-progress")).toBeInTheDocument();
    expect(onStarted).not.toHaveBeenCalled();
    finish();
    await waitFor(() => expect(onStarted).toHaveBeenCalledOnce());
    expect(screen.getByTestId("start-team")).not.toBeDisabled();
  });

  describe("shows the steps the start gives, and how long it has been", () => {
    const event = (over: Partial<OnboardingNativeProgress>): OnboardingNativeProgress => ({
      stage: "team", status: "progress", message: "x", sequence: 2, elapsedMs: 1000, code: null, retryable: null, ...over,
    });
    let emit!: (progress: OnboardingNativeProgress) => void;
    let finish!: () => void;
    let fail!: (error: unknown) => void;
    const begin = () => {
      document.cookie = "NEXT_LOCALE=en; path=/";
      vi.mocked(resumeOnboardingTeamStart).mockImplementation((onProgress) => {
        emit = (progress) => act(() => onProgress(progress));
        return new Promise((done, reject) => {
          finish = () => done({} as never);
          fail = reject;
        });
      });
      render(<StartTeamAction onStarted={() => undefined} />);
      fireEvent.click(screen.getByTestId("start-team"));
    };
    const line = () => screen.getByTestId("start-team-step").textContent;

    it("says it is getting ready until the first step, then «step n of m» with its name, the dots and no percentage", () => {
      begin();
      expect(line()).toBe("Getting ready to start");
      expect(screen.queryByTestId("start-team-dots")).toBeNull();
      // the machine and the container are off: three steps
      emit(event({ step: "machine", message: "Turning on the machine and the container" }));
      expect(line()).toBe("Step 1 of 3 · Turning on the machine and the container");
      expect(Array.from(screen.getByTestId("start-team-dots").children).map((dot) => dot.getAttribute("data-state"))).toEqual(["current", "todo", "todo"]);
      // the heartbeat repeats the step: nothing moves
      emit(event({ step: "machine", sequence: 3, elapsedMs: 5000 }));
      expect(line()).toBe("Step 1 of 3 · Turning on the machine and the container");
      emit(event({ step: "agents", sequence: 4 }));
      expect(line()).toBe("Step 2 of 3 · Starting the agents");
      expect(Array.from(screen.getByTestId("start-team-dots").children).map((dot) => dot.getAttribute("data-state"))).toEqual(["done", "current", "todo"]);
      emit(event({ step: "verify", sequence: 5 }));
      expect(line()).toBe("Step 3 of 3 · Checking that the team is up");
      expect(screen.getByTestId("start-team-progress").textContent).not.toMatch(/%/);
    });

    it("has two steps when the container was already up, and says so from the first event", () => {
      begin();
      emit(event({ step: "agents" }));
      expect(line()).toBe("Step 1 of 2 · Starting the agents");
      emit(event({ step: "verify", sequence: 3 }));
      expect(line()).toBe("Step 2 of 2 · Checking that the team is up");
    });

    it("ignores an event of another stage or with no step, and says the team is up once the native start is done", () => {
      begin();
      emit(event({ stage: "engine", step: "agents" }));
      expect(line()).toBe("Getting ready to start");
      emit(event({ message: "Restoring the team" }));
      expect(line()).toBe("Getting ready to start");
      emit(event({ step: "verify" }));
      emit(event({ status: "done", sequence: 9 }));
      expect(line()).toBe("Team is up: reading its data");
      expect(screen.queryByTestId("start-team-dots")).toBeNull();
    });

    it("counts the time itself, every second, as minutes and seconds", () => {
      vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
      try {
        begin();
        expect(screen.getByTestId("start-team-elapsed").textContent).toBe("0:00");
        act(() => { vi.advanceTimersByTime(7_000); });
        expect(screen.getByTestId("start-team-elapsed").textContent).toBe("0:07");
        act(() => { vi.advanceTimersByTime(58_000); });
        expect(screen.getByTestId("start-team-elapsed").textContent).toBe("1:05");
      } finally {
        vi.useRealTimers();
      }
    });

    it("says the step it stopped at, in its place among the steps, with the catalog's sentence and what to do", async () => {
      begin();
      emit(event({ step: "machine" }));
      emit(event({ step: "agents", sequence: 3 }));
      await act(async () => { fail({ code: "team_start_failed" }); });
      const failed = await screen.findByTestId("start-team-failed");
      const sentence = describeError("team_start_failed", { locale: "en" });
      expect(failed).toHaveTextContent(`It stopped at step 2 of 3: Starting the agents. ${sentence.text} ${sentence.action}`);
      expect(screen.queryByTestId("start-team-progress")).toBeNull();
      expect(screen.getByTestId("start-team")).not.toBeDisabled();
    });

    it("says it stopped before it began when no step had been said, and a new start begins from nothing", async () => {
      begin();
      await act(async () => { fail({ code: "operation_in_progress" }); });
      expect(await screen.findByTestId("start-team-failed")).toHaveTextContent("It stopped before it began.");
      fireEvent.click(screen.getByTestId("start-team"));
      expect(line()).toBe("Getting ready to start");
      expect(screen.queryByTestId("start-team-failed")).toBeNull();
    });

    it("is written in the seven languages, with the step in its place", async () => {
      for (const locale of ["it", "en", "de", "es", "fr", "hu", "pt"]) {
        cleanup();
        document.cookie = `NEXT_LOCALE=${locale}; path=/`;
        vi.mocked(resumeOnboardingTeamStart).mockImplementation((onProgress) => {
          emit = (progress) => act(() => onProgress(progress));
          return new Promise(() => undefined);
        });
        render(<StartTeamAction onStarted={() => undefined} />);
        fireEvent.click(screen.getByTestId("start-team"));
        emit(event({ step: "agents" }));
        expect(line(), locale).toMatch(/1.*2/);
        expect(line(), locale).not.toMatch(/[{}]/);
      }
    });
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

  describe("looks again by itself", () => {
    const quick = { after: [5, 5, 5], during: 5, duringMax: 3 } as const;

    it("up to three more times once the team is up, and stops when the page has its data", async () => {
      vi.mocked(resumeOnboardingTeamStart).mockResolvedValue({} as never);
      const onStarted = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(false).mockResolvedValue(true);
      render(<StartTeamAction onStarted={onStarted} waits={quick} />);
      fireEvent.click(screen.getByTestId("start-team"));
      await waitFor(() => expect(onStarted).toHaveBeenCalledTimes(3));
      await act(async () => { await new Promise((done) => setTimeout(done, 40)); });
      expect(onStarted).toHaveBeenCalledTimes(3);
      expect(screen.getByTestId("start-team")).not.toBeDisabled();
    });

    it("gives up after three more tries, never more", async () => {
      vi.mocked(resumeOnboardingTeamStart).mockResolvedValue({} as never);
      const onStarted = vi.fn().mockResolvedValue(false);
      render(<StartTeamAction onStarted={onStarted} waits={{ after: [5, 5, 5], during: 1_000, duringMax: 1 }} />);
      fireEvent.click(screen.getByTestId("start-team"));
      await waitFor(() => expect(onStarted).toHaveBeenCalledTimes(4));
      await act(async () => { await new Promise((done) => setTimeout(done, 60)); });
      expect(onStarted).toHaveBeenCalledTimes(4);
    });

    it("looks while the start is still running, and a page that answers ends the watching", async () => {
      let finish!: () => void;
      vi.mocked(resumeOnboardingTeamStart).mockReturnValue(new Promise((done) => { finish = () => done({} as never); }));
      const onStarted = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true);
      render(<StartTeamAction onStarted={onStarted} waits={quick} />);
      fireEvent.click(screen.getByTestId("start-team"));
      await waitFor(() => expect(onStarted).toHaveBeenCalledTimes(2));
      expect(screen.queryByTestId("start-team")).toBeNull();
      finish();
      await waitFor(() => expect(screen.getByTestId("start-team")).not.toBeDisabled());
      // once more after the start, then it stops: the page had its data
      await waitFor(() => expect(onStarted).toHaveBeenCalledTimes(3));
    });

    it("does not touch a page that went away", async () => {
      vi.mocked(resumeOnboardingTeamStart).mockResolvedValue({} as never);
      const onStarted = vi.fn().mockResolvedValue(false);
      const view = render(<StartTeamAction onStarted={onStarted} waits={{ after: [300, 300, 300], during: 5_000, duringMax: 1 }} />);
      fireEvent.click(screen.getByTestId("start-team"));
      await waitFor(() => expect(onStarted).toHaveBeenCalledTimes(1));
      view.unmount();
      await new Promise((done) => setTimeout(done, 1_000));
      expect(onStarted).toHaveBeenCalledTimes(1);
    });
  });
});
