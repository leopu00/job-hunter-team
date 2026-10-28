import { afterEach, describe, expect, it } from "vitest";
import {
  forgetLocalProfileUnlinked,
  leaveLocalProfileUnlinked,
  localProfileLeftUnlinked,
  type UnlinkedStore,
} from "./unlinked-local-profile";

function memory(): UnlinkedStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => { data.set(key, value); },
    removeItem: (key) => { data.delete(key); },
  };
}

afterEach(() => localStorage.clear());

describe("the choice of leaving a local profile unlinked", () => {
  it("is kept for that profile and for no other, and holds nothing but the profile's id", () => {
    const store = memory();
    expect(localProfileLeftUnlinked("profile-a", store)).toBe(false);
    expect(leaveLocalProfileUnlinked("profile-a", store)).toBe(true);
    expect(localProfileLeftUnlinked("profile-a", store)).toBe(true);
    expect(localProfileLeftUnlinked("profile-b", store)).toBe(false);
    expect([...store.data.values()]).toEqual(['{"profileId":"profile-a"}']);
  });

  it("is taken back, and taking back another profile's choice leaves it", () => {
    const store = memory();
    leaveLocalProfileUnlinked("profile-a", store);
    forgetLocalProfileUnlinked("profile-b", store);
    expect(localProfileLeftUnlinked("profile-a", store)).toBe(true);
    forgetLocalProfileUnlinked("profile-a", store);
    expect(localProfileLeftUnlinked("profile-a", store)).toBe(false);
    expect(store.data.size).toBe(0);
  });

  it("uses the app's own storage when none is given", () => {
    leaveLocalProfileUnlinked("profile-a");
    expect(localProfileLeftUnlinked("profile-a")).toBe(true);
    forgetLocalProfileUnlinked("profile-a");
    expect(localProfileLeftUnlinked("profile-a")).toBe(false);
  });

  it("says no, and does not throw, when the storage cannot be read, written or understood", () => {
    const broken: UnlinkedStore = {
      getItem: () => { throw new Error("blocked"); },
      setItem: () => { throw new Error("blocked"); },
      removeItem: () => { throw new Error("blocked"); },
    };
    expect(localProfileLeftUnlinked("profile-a", broken)).toBe(false);
    expect(leaveLocalProfileUnlinked("profile-a", broken)).toBe(false);
    expect(() => forgetLocalProfileUnlinked("profile-a", broken)).not.toThrow();
    for (const raw of ["not json", "null", "[]", '{"profileId":7}', '{"other":"profile-a"}']) {
      const store = memory();
      store.setItem("jht.desktop.unlinked-local-profile.v1", raw);
      expect(localProfileLeftUnlinked("profile-a", store), raw).toBe(false);
    }
    expect(leaveLocalProfileUnlinked("profile-a", null)).toBe(false);
  });
});
