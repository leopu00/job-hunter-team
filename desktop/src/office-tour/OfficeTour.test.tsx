import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OfficeAgent, OfficeClick } from "../office/contract";
import OfficeTour from "./OfficeTour";
import { readTour, TOUR_STOPS, writeTour, type TourStore } from "./tour";
import { TOUR_ROLE_NAME, TOUR_SPEECH } from "./tour-speech.i18n";
import * as words from "./tour.i18n";

const LOCALES = ["en", "it", "hu", "es", "de", "fr", "pt"] as const;

function memory(initial?: unknown): TourStore & { value: string | null } {
  const box = { value: initial === undefined ? null : JSON.stringify(initial) } as TourStore & { value: string | null };
  box.getItem = () => box.value;
  box.setItem = (_key, value) => { box.value = value; };
  return box;
}

const ROSTER: OfficeAgent[] = [
  { uid: "assistente-1", role: "assistente", sheet: "" },
  { uid: "mentor-1", role: "mentor", sheet: "" },
  { uid: "capitano-1", role: "capitano", sheet: "" },
];

function tour(store: TourStore, roster: readonly OfficeAgent[] = ROSTER) {
  document.cookie = "NEXT_LOCALE=en; path=/";
  const onFocus = vi.fn<(target: OfficeClick | null) => void>();
  const view = render(<OfficeTour roster={roster} onFocus={onFocus} store={store} />);
  return { onFocus, ...view };
}

const click = (id: string) => act(() => { fireEvent.click(screen.getByTestId(id)); });

afterEach(() => {
  cleanup();
  document.cookie = "NEXT_LOCALE=; path=/; max-age=0";
});

describe("the invitation", () => {
  it("is the Assistant's, with her portrait, and does not touch the camera before the person says yes", () => {
    const { onFocus } = tour(memory());
    expect(screen.getByTestId("office-tour")).toHaveAttribute("data-status", "offer");
    expect(screen.getByTestId("assistant-portrait")).toBeInTheDocument();
    expect(screen.getByTestId("office-tour-line")).toHaveTextContent(TOUR_SPEECH.assistente.greet.en);
    expect(onFocus).not.toHaveBeenCalled();
  });

  it("«not now» keeps a way back in the office, and taking it from there starts the tour", () => {
    const store = memory();
    tour(store);
    click("office-tour-later");
    expect(readTour(store).status).toBe("later");
    expect(screen.getByTestId("office-tour")).toHaveAttribute("data-status", "later");
    click("office-tour-resume");
    expect(screen.getByTestId("office-tour")).toHaveAttribute("data-status", "running");
    expect(screen.getByTestId("office-tour")).toHaveAttribute("data-stop", "assistente");
  });
});

describe("the stops", () => {
  it("the Assistant says where the person is, and the colleague answers by their name", () => {
    tour(memory());
    click("office-tour-start");
    click("office-tour-next");
    expect(screen.getByTestId("office-tour")).toHaveAttribute("data-stop", "scout");
    expect(screen.getByTestId("office-tour-line")).toHaveTextContent(TOUR_SPEECH.scout.greet.en);
    expect(screen.getByTestId("office-tour-reply")).toHaveTextContent(`${TOUR_ROLE_NAME.scout.en}: ${TOUR_SPEECH.scout.reply!.en}`);
    expect(screen.getByTestId("office-tour-counter")).toHaveTextContent("Stop 2 of 8");
  });

  it("brings the camera to each stop: a department's zone, then a seat", () => {
    const { onFocus } = tour(memory());
    click("office-tour-start");
    expect(onFocus).toHaveBeenLastCalledWith({ kind: "agent", uid: "assistente-1", role: "assistente" });
    click("office-tour-next");
    expect(onFocus).toHaveBeenLastCalledWith({ kind: "department", dept: "scout" });
    for (let i = 2; i < TOUR_STOPS.indexOf("mentor"); i++) click("office-tour-next");
    click("office-tour-next");
    expect(screen.getByTestId("office-tour")).toHaveAttribute("data-stop", "mentor");
    expect(onFocus).toHaveBeenLastCalledWith({ kind: "agent", uid: "mentor-1", role: "mentor" });
  });

  it("a stop whose role is not in the office is told all the same, and the camera is left where it is", () => {
    const { onFocus } = tour(memory({ status: "paused", index: TOUR_STOPS.indexOf("mentor") }), []);
    click("office-tour-resume");
    expect(screen.getByTestId("office-tour-reply")).toBeInTheDocument();
    expect(onFocus).toHaveBeenLastCalledWith(null);
  });

  it("the last stop closes the tour, and nothing of it is left on the screen", () => {
    const store = memory({ status: "paused", index: TOUR_STOPS.length - 1 });
    const { onFocus } = tour(store);
    click("office-tour-resume");
    expect(screen.getByTestId("office-tour-next")).toHaveTextContent(words.TOUR_FINISH_BUTTON.en);
    click("office-tour-next");
    expect(screen.queryByTestId("office-tour")).toBeNull();
    expect(readTour(store).status).toBe("done");
    expect(onFocus).toHaveBeenLastCalledWith(null);
  });
});

describe("pause and resume", () => {
  it("pausing takes the ring away and keeps the stop; resuming goes back to the same stop", () => {
    const store = memory();
    const { onFocus } = tour(store);
    click("office-tour-start");
    click("office-tour-next");
    click("office-tour-next");
    click("office-tour-pause");
    expect(onFocus).toHaveBeenLastCalledWith(null);
    expect(screen.getByTestId("office-tour")).toHaveAttribute("data-status", "paused");
    expect(readTour(store)).toEqual({ status: "paused", index: 2 });
    click("office-tour-resume");
    expect(screen.getByTestId("office-tour")).toHaveAttribute("data-stop", "analista");
    expect(onFocus).toHaveBeenLastCalledWith({ kind: "department", dept: "analisti" });
  });

  it("a window closed in the middle opens on the pill to resume, at the stop it was", () => {
    const store = memory();
    writeTour({ status: "running", index: 4 }, store);
    tour(store);
    expect(screen.getByTestId("office-tour")).toHaveAttribute("data-status", "paused");
    click("office-tour-resume");
    expect(screen.getByTestId("office-tour")).toHaveAttribute("data-stop", "scrittore");
  });

  it("a finished tour does not come back", () => {
    tour(memory({ status: "done", index: TOUR_STOPS.length - 1 }));
    expect(screen.queryByTestId("office-tour")).toBeNull();
  });
});

describe("the words", () => {
  it("every stop is told, in all seven languages, and the controls too", () => {
    for (const stop of TOUR_STOPS) {
      for (const locale of LOCALES) {
        expect(TOUR_SPEECH[stop].greet[locale], `${stop} greet ${locale}`).toMatch(/\S/);
        if (stop !== "assistente") expect(TOUR_SPEECH[stop].reply?.[locale], `${stop} reply ${locale}`).toMatch(/\S/);
        expect(TOUR_ROLE_NAME[stop][locale], `${stop} name ${locale}`).toMatch(/\S/);
        expect(TOUR_SPEECH[stop].greet[locale]).not.toContain("%s");
      }
    }
    for (const [name, dict] of Object.entries(words)) {
      for (const locale of LOCALES) expect((dict as Record<string, string>)[locale], `${name} ${locale}`).toMatch(/\S/);
    }
  });

  it("the tour says nothing in the person's language without that language being the one set", () => {
    document.cookie = "NEXT_LOCALE=it; path=/";
    const onFocus = vi.fn();
    render(<OfficeTour roster={ROSTER} onFocus={onFocus} store={memory()} />);
    expect(screen.getByTestId("office-tour-line")).toHaveTextContent(TOUR_SPEECH.assistente.greet.it);
    expect(screen.getByTestId("office-tour-start")).toHaveTextContent(words.TOUR_START_BUTTON.it);
  });
});
