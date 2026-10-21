import { beforeEach, describe, expect, it, vi } from "vitest";
import { NOTIFY_PREFS_EVENT, NOTIFY_PREFS_KEY, readNotifyPrefs, writeNotifyPrefs } from "./prefs";

beforeEach(() => localStorage.clear());

describe("the notifications' switch", () => {
  it("is off until the person turns it on", () => {
    expect(readNotifyPrefs()).toEqual({ enabled: false, details: false });
    localStorage.setItem(NOTIFY_PREFS_KEY, "not json");
    expect(readNotifyPrefs()).toEqual({ enabled: false, details: false });
  });

  it("turned on, it starts without details; the details only when asked; off forgets them", () => {
    const heard = vi.fn();
    window.addEventListener(NOTIFY_PREFS_EVENT, heard);
    expect(writeNotifyPrefs({ enabled: true })).toEqual({ enabled: true, details: false });
    expect(readNotifyPrefs()).toEqual({ enabled: true, details: false });
    writeNotifyPrefs({ enabled: true, details: true });
    expect(readNotifyPrefs()).toEqual({ enabled: true, details: true });
    writeNotifyPrefs({ enabled: false, details: true });
    expect(readNotifyPrefs()).toEqual({ enabled: false, details: false });
    expect(heard).toHaveBeenCalledTimes(3);
    window.removeEventListener(NOTIFY_PREFS_EVENT, heard);
  });
});
