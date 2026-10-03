import { beforeEach, describe, expect, it } from "vitest";
import {
  clearGoogleIdentitySelection,
  googleIdentitySelected,
  selectGoogleIdentity,
} from "./identity-choice";

beforeEach(() => {
  sessionStorage.clear();
});

describe("Google identity choice", () => {
  it("is absent on a fresh window and survives only same-window page navigation", () => {
    expect(googleIdentitySelected()).toBe(false);
    selectGoogleIdentity();
    expect(googleIdentitySelected()).toBe(true);
    clearGoogleIdentitySelection();
    expect(googleIdentitySelected()).toBe(false);
  });
});
