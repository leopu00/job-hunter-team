import { beforeEach, describe, expect, it, vi } from "vitest";
import { deliver, NOTIFY_ASKED_KEY, type NotifyDeps } from "./sender";

const deps = (granted: boolean, answer = "granted") => ({
  isPermissionGranted: vi.fn(async () => granted),
  requestPermission: vi.fn(async () => answer),
  sendNotification: vi.fn(),
}) satisfies NotifyDeps;
const note = [{ title: "Job Hunter Team", body: "New position found" }];

beforeEach(() => localStorage.clear());

describe("deliver", () => {
  it("asks the system's permission once, the first time there is something to show", async () => {
    const d = deps(false, "granted");
    expect(await deliver(note, d)).toBe("sent");
    expect(d.requestPermission).toHaveBeenCalledTimes(1);
    expect(d.sendNotification).toHaveBeenCalledWith(note[0]);
    expect(localStorage.getItem(NOTIFY_ASKED_KEY)).toBe("1");
  });

  it("refused: shows nothing, and never asks again", async () => {
    const d = deps(false, "denied");
    expect(await deliver(note, d)).toBe("denied");
    expect(await deliver(note, d)).toBe("denied");
    expect(d.requestPermission).toHaveBeenCalledTimes(1);
    expect(d.sendNotification).not.toHaveBeenCalled();
  });

  it("with nothing to show asks nothing", async () => {
    const d = deps(false);
    expect(await deliver([], d)).toBe("none");
    expect(d.isPermissionGranted).not.toHaveBeenCalled();
  });
});
