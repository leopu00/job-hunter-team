import { describe, expect, it } from "vitest";
import { DEFAULT_MAX_WORKERS, maxWorkers } from "../vitest.workers.ts";

describe("the cap of test workers", () => {
  it("is half of the cores and at most four when nothing asks for another", () => {
    expect(maxWorkers({}, 12)).toBe(DEFAULT_MAX_WORKERS);
    expect(maxWorkers({}, 8)).toBe(4);
    expect(maxWorkers({}, 4)).toBe(2);
    expect(maxWorkers({}, 2)).toBe(1);
    expect(maxWorkers({}, 1)).toBe(1);
  });

  it("follows VITEST_MAX_WORKERS first, then VITEST_MAX_FORKS, then VITEST_MAX_THREADS", () => {
    expect(maxWorkers({ VITEST_MAX_WORKERS: "3", VITEST_MAX_FORKS: "6" }, 12)).toBe(3);
    expect(maxWorkers({ VITEST_MAX_FORKS: "6", VITEST_MAX_THREADS: "2" }, 12)).toBe(6);
    expect(maxWorkers({ VITEST_MAX_THREADS: "2" }, 12)).toBe(2);
    expect(maxWorkers({ VITEST_MAX_WORKERS: " 5 " }, 12)).toBe(5);
  });

  it("ignores what is not a positive whole number", () => {
    for (const bad of ["", "0", "-2", "2.5", "many", "50%"]) {
      expect(maxWorkers({ VITEST_MAX_WORKERS: bad }, 12), bad).toBe(4);
    }
  });
});
