import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { locales } from "@/i18n/config";
import type { TeamUpdateOutcome } from "../lib/team-update";
import TeamUpdateRun from "./TeamUpdateRun";
import { TEAM_UPDATE_RUN_TEXT, whereKey } from "./TeamUpdateRun.i18n";
import { TEAM_UPDATE_PHASES, TEAM_UPDATE_REASONS } from "../lib/team-update";

const setLang = (lang: string) => {
  localStorage.setItem("jht-lang", lang);
  document.cookie = `NEXT_LOCALE=${lang}; path=/`;
};
beforeEach(() => setLang("en"));
afterEach(() => {
  cleanup();
  localStorage.removeItem("jht-lang");
  document.cookie = "NEXT_LOCALE=; path=/; max-age=0";
});

const outcome = (overrides: Partial<TeamUpdateOutcome> = {}): TeamUpdateOutcome => ({
  ok: true, changed: true, phase: "complete", reason: null, rolledBack: false, restartRequired: false,
  previousVersion: "0.4.0", currentVersion: "0.4.1", imageId: "", mode: "upgrade", ...overrides,
});

describe("«Update the team» done by the app", () => {
  it("asks first, and runs nothing until the person confirms", () => {
    const apply = vi.fn(async () => outcome());
    render(<TeamUpdateRun apply={apply} onClose={() => {}} />);
    expect(screen.getByTestId("team-update-confirm")).toHaveTextContent("the team stops for a few minutes");
    expect(apply).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("team-update-start"));
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it("cancelling closes it and runs nothing", () => {
    const apply = vi.fn(async () => outcome());
    const onClose = vi.fn();
    render(<TeamUpdateRun apply={apply} onClose={onClose} />);
    fireEvent.click(screen.getByTestId("team-update-close"));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(apply).not.toHaveBeenCalled();
  });

  it("shows the wait, then the outcome with the two versions", async () => {
    let finish: (value: TeamUpdateOutcome) => void = () => {};
    const apply = () => new Promise<TeamUpdateOutcome>((resolve) => { finish = resolve; });
    const onDone = vi.fn();
    render(<TeamUpdateRun apply={apply} onClose={() => {}} onDone={onDone} />);
    fireEvent.click(screen.getByTestId("team-update-start"));
    expect(screen.getByTestId("team-update-running")).toHaveTextContent("Do not close the app.");
    expect(screen.queryByTestId("team-update-close")).toBeNull();
    finish(outcome());
    await waitFor(() => expect(screen.getByTestId("team-update-done")).toHaveTextContent("Team updated."));
    expect(screen.getByTestId("team-update-done")).toHaveTextContent("From version 0.4.0 to 0.4.1.");
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("says when the team was already up to date, and when it must be started by hand", async () => {
    const first = render(<TeamUpdateRun apply={async () => outcome({ changed: false })} onClose={() => {}} />);
    fireEvent.click(screen.getByTestId("team-update-start"));
    await waitFor(() => expect(screen.getByTestId("team-update-done")).toHaveTextContent("The team was already up to date."));
    first.unmount();
    render(<TeamUpdateRun apply={async () => outcome({ restartRequired: true })} onClose={() => {}} />);
    fireEvent.click(screen.getByTestId("team-update-start"));
    await waitFor(() => expect(screen.getByTestId("team-update-done")).toHaveTextContent("start it from the Team page"));
  });

  it("tells a failed update where it stopped, why, and that the version that worked is back", async () => {
    const apply = async () => outcome({ ok: false, changed: false, phase: "verify", reason: "download_failed", rolledBack: true });
    render(<TeamUpdateRun apply={apply} onClose={() => {}} />);
    fireEvent.click(screen.getByTestId("team-update-start"));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("The update did not succeed."));
    expect(screen.getByRole("alert")).toHaveTextContent("It stopped during the check.");
    expect(screen.getByTestId("team-update-reason")).toHaveTextContent("I could not download the new version");
    expect(screen.getByTestId("team-update-rollback")).toHaveTextContent("The previous version is back");
  });

  it("does not promise a rollback that did not happen, and lets the person try again", async () => {
    const apply = vi.fn(async () => outcome({ ok: false, changed: false, phase: "activate", rolledBack: false }));
    render(<TeamUpdateRun apply={apply} onClose={() => {}} />);
    fireEvent.click(screen.getByTestId("team-update-start"));
    await waitFor(() => expect(screen.getByTestId("team-update-rollback")).toHaveTextContent("I cannot tell whether the team started again"));
    expect(screen.queryByTestId("team-update-reason")).toBeNull();
    fireEvent.click(screen.getByTestId("team-update-retry"));
    expect(screen.getByTestId("team-update-confirm")).toBeInTheDocument();
  });

  it("tells an error of the native side with the catalog's words", async () => {
    const apply = async () => { throw { code: "team_update_channel_mismatch" }; };
    render(<TeamUpdateRun apply={apply} onClose={() => {}} />);
    fireEvent.click(screen.getByTestId("team-update-start"));
    await waitFor(() => expect(screen.getByTestId("team-update-error")).toHaveTextContent("two different builds"));
  });

  it("hands over to the guide when the host cannot be updated from the app", async () => {
    const onGuide = vi.fn();
    const apply = async () => { throw { code: "team_update_wrapper_outdated" }; };
    render(<TeamUpdateRun apply={apply} onClose={() => {}} onGuide={onGuide} />);
    fireEvent.click(screen.getByTestId("team-update-start"));
    await waitFor(() => expect(onGuide).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId("team-update-error")).toBeNull();
  });

  it("speaks every language, with a sentence for every reason and every place it can stop", () => {
    for (const locale of locales) {
      const text = TEAM_UPDATE_RUN_TEXT[locale];
      for (const reason of TEAM_UPDATE_REASONS) expect(text.reasons[reason], `${locale} ${reason}`).toBeTruthy();
      for (const key of ["start", "download", "switch", "verify"] as const) expect(text.where[key], `${locale} ${key}`).toBeTruthy();
      expect(text.doneVersions).toContain("{from}");
      expect(text.doneVersions).toContain("{to}");
      expect(text.stoppedAt).toContain("{where}");
    }
    for (const phase of TEAM_UPDATE_PHASES) {
      const key = whereKey(phase);
      expect(key === null || key in TEAM_UPDATE_RUN_TEXT.it.where, phase).toBe(true);
    }
  });
});
