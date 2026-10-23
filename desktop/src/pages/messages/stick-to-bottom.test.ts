import { describe, expect, it } from "vitest";
import { afterScroll, arrivedSince, BOTTOM_SLACK_PX, distanceFromBottom } from "./stick-to-bottom";

const at = (scrollTop: number) => ({ scrollTop, scrollHeight: 1000, clientHeight: 400 });

describe("staying at the bottom of the conversation", () => {
  it("measures how far from the end the list is", () => {
    expect(distanceFromBottom(at(600))).toBe(0);
    expect(distanceFromBottom(at(500))).toBe(100);
    expect(distanceFromBottom({ scrollTop: 0, scrollHeight: 100, clientHeight: 400 })).toBe(0);
  });

  it("is at the bottom when it got there, within the slack", () => {
    expect(afterScroll(false, 0, at(600 - BOTTOM_SLACK_PX))).toBe(true);
    expect(afterScroll(false, 0, at(600 - BOTTOM_SLACK_PX - 1))).toBe(false);
  });

  it("leaves the bottom only when the person goes up; growing content or a scroll down does not", () => {
    expect(afterScroll(true, 500, at(400))).toBe(false);
    // the list grew under it: the top did not move up
    expect(afterScroll(true, 500, at(500))).toBe(true);
    // half way down a smooth scroll
    expect(afterScroll(true, 300, at(450))).toBe(true);
  });

  it("counts new lines only above the bottom, at least one", () => {
    expect(arrivedSince(true, 3, 7)).toBe(0);
    expect(arrivedSince(false, 3, 7)).toBe(4);
    expect(arrivedSince(false, 3, 3)).toBe(1);
  });
});
