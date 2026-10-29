import { describe, expect, it } from "vitest";
import type { OfficeAgent } from "../office/contract";
import {
  nextStop,
  pauseTour,
  postponeTour,
  readTour,
  resumeTour,
  startTour,
  stopTarget,
  TOUR_START,
  TOUR_STOPS,
  writeTour,
  type TourState,
  type TourStore,
} from "./tour";

function memory(initial?: string): TourStore & { value: string | null } {
  const box = { value: initial ?? null } as TourStore & { value: string | null };
  box.getItem = () => box.value;
  box.setItem = (_key, value) => { box.value = value; };
  return box;
}

const running = (index: number): TourState => ({ status: "running", index });

describe("the tour's state", () => {
  it("starts as an invitation, and begins at the first stop", () => {
    expect(TOUR_START).toEqual({ status: "offer", index: 0 });
    expect(startTour(TOUR_START)).toEqual(running(0));
    expect(TOUR_STOPS[0]).toBe("assistente");
  });

  it("goes stop by stop and is done after the last one", () => {
    let state = startTour(TOUR_START);
    const seen = [TOUR_STOPS[state.index]];
    while (state.status === "running") {
      state = nextStop(state);
      if (state.status === "running") seen.push(TOUR_STOPS[state.index]);
    }
    expect(seen).toEqual([...TOUR_STOPS]);
    expect(state.status).toBe("done");
  });

  it("pauses at the stop it is on and resumes there, not at the start", () => {
    const paused = pauseTour(running(3));
    expect(paused).toEqual({ status: "paused", index: 3 });
    expect(resumeTour(paused)).toEqual(running(3));
  });

  it("«not now» leaves a way back, and taking the tour from there begins at the first stop", () => {
    const later = postponeTour(TOUR_START);
    expect(later.status).toBe("later");
    expect(startTour(later)).toEqual(running(0));
  });

  it("does not move on a state that cannot take the step", () => {
    expect(nextStop(TOUR_START)).toBe(TOUR_START);
    expect(pauseTour(TOUR_START)).toBe(TOUR_START);
    expect(resumeTour(running(2))).toEqual(running(2));
    const paused = pauseTour(running(2));
    expect(postponeTour(paused)).toBe(paused);
    expect(startTour(paused)).toBe(paused);
    const done: TourState = { status: "done", index: TOUR_STOPS.length - 1 };
    expect(startTour(done)).toBe(done);
  });
});

describe("where the camera goes at a stop", () => {
  const roster: OfficeAgent[] = [
    { uid: "assistente-1", role: "assistente", sheet: "" },
    { uid: "mentor-1", role: "mentor", sheet: "" },
    { uid: "capitano-1", role: "capitano", sheet: "" },
  ];

  it("a department's zone for the five departments, in the order of the pipeline", () => {
    expect(["scout", "analista", "scorer", "scrittore", "critico"].map((s) => stopTarget(s as never, []))).toEqual([
      { kind: "department", dept: "scout" },
      { kind: "department", dept: "analisti" },
      { kind: "department", dept: "scorer" },
      { kind: "department", dept: "scrittori" },
      { kind: "department", dept: "critici" },
    ]);
  });

  it("the seat of the Assistant, the Mentor and the Coordinator, found by role", () => {
    expect(stopTarget("assistente", roster)).toEqual({ kind: "agent", uid: "assistente-1", role: "assistente" });
    expect(stopTarget("mentor", roster)).toEqual({ kind: "agent", uid: "mentor-1", role: "mentor" });
    expect(stopTarget("capitano", roster)).toEqual({ kind: "agent", uid: "capitano-1", role: "capitano" });
  });

  it("no target when the role is not in the office: the stop is told, the camera stays", () => {
    expect(stopTarget("mentor", [])).toBeNull();
  });
});

describe("what is kept", () => {
  it("writes and reads the state back", () => {
    const store = memory();
    expect(writeTour(pauseTour(running(4)), store)).toBe(true);
    expect(readTour(store)).toEqual({ status: "paused", index: 4 });
  });

  it("a tour that was running when the window closed comes back paused at the same stop", () => {
    const store = memory();
    writeTour(running(5), store);
    expect(readTour(store)).toEqual({ status: "paused", index: 5 });
  });

  it("nothing kept, or something unreadable, is the invitation", () => {
    expect(readTour(memory())).toEqual(TOUR_START);
    for (const raw of ["not json", "{}", '{"status":"flying","index":1}', '{"status":"paused","index":99}', '{"status":"paused","index":-1}', '{"status":"paused","index":1.5}', "null"]) {
      expect(readTour(memory(raw)), raw).toEqual(TOUR_START);
    }
    expect(readTour(null)).toEqual(TOUR_START);
  });

  it("says when the state could not be kept", () => {
    expect(writeTour(running(1), null)).toBe(false);
    const failing: TourStore = { getItem: () => null, setItem: () => { throw new Error("full"); } };
    expect(writeTour(running(1), failing)).toBe(false);
  });
});
