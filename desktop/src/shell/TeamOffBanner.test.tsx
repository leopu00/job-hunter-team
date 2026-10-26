import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TeamOffContext, type TeamOff } from "../lib/team-off";
import { TeamOffBanner } from "./TeamOffBanner";
import { TEAM_OFF_TEXT } from "./team-off.i18n";

function renderBanner(teamOff: TeamOff | null, locale: "it" | "en" = "it") {
  return render(
    <TeamOffContext.Provider value={teamOff}>
      <TeamOffBanner locale={locale} />
    </TeamOffContext.Provider>,
  );
}

describe("the banner of the app opened without the team", () => {
  it("shows nothing in the usual app", () => {
    renderBanner(null);
    expect(screen.queryByTestId("team-off-banner")).toBeNull();
  });

  it("says the team is off and wakes only the runtime, telling when it is on", async () => {
    let done!: () => void;
    const wakeRuntime = vi.fn(() => new Promise<void>((resolve) => { done = resolve; }));
    renderBanner({ teamOff: true, wakeRuntime });
    expect(screen.getByTestId("team-off-banner")).toHaveTextContent("La squadra è spenta");
    await userEvent.click(screen.getByTestId("team-off-wake"));
    expect(wakeRuntime).toHaveBeenCalledOnce();
    // while it wakes the button is taken and says so: no second wake, no silent wait
    expect(screen.getByTestId("team-off-wake")).toBeDisabled();
    expect(screen.getByTestId("team-off-wake")).toHaveTextContent("Riaccendo il runtime…");
    await act(async () => { done(); });
    expect(screen.getByTestId("team-off-woke")).toHaveTextContent("La squadra resta spenta: nessun agente è partito.");
    expect(screen.getByTestId("team-off-wake")).not.toBeDisabled();
  });

  it("tells a failed wake with the sentence of its code, not a generic one", async () => {
    const wakeRuntime = vi.fn().mockRejectedValue({ code: "local_container_not_attested" });
    renderBanner({ teamOff: true, wakeRuntime });
    await userEvent.click(screen.getByTestId("team-off-wake"));
    const failed = await screen.findByTestId("team-off-wake-failed");
    expect(failed.textContent?.trim().length).toBeGreaterThan(20);
    expect(screen.queryByTestId("team-off-woke")).toBeNull();
  });

  it("offers «Start the team» only where the mode has a way back to the start screen", async () => {
    const startTeam = vi.fn();
    const view = renderBanner({ teamOff: true, wakeRuntime: vi.fn(), startTeam });
    await userEvent.click(screen.getByTestId("team-off-start"));
    expect(startTeam).toHaveBeenCalledOnce();
    view.unmount();
    renderBanner({ teamOff: true, wakeRuntime: vi.fn() });
    expect(screen.queryByTestId("team-off-start")).toBeNull();
  });

  it("has the seven languages with every sentence", () => {
    for (const copy of Object.values(TEAM_OFF_TEXT)) {
      for (const value of Object.values(copy)) expect(value.length).toBeGreaterThan(3);
    }
    expect(Object.keys(TEAM_OFF_TEXT)).toHaveLength(7);
  });
});
