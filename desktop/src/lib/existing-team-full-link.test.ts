import { afterEach, describe, expect, it } from "vitest";
import {
  enterExistingTeamReadOnly,
  existingTeamConnectionKey,
  existingTeamReadOnly,
  existingTeamReadOnlyReason,
  existingTeamView,
  leaveExistingTeamReadOnly,
} from "./existing-team-readonly";
import { EXISTING_TEAM_READONLY_TEXT } from "./existing-team-readonly.i18n";

afterEach(() => leaveExistingTeamReadOnly());

describe("an existing team connected in full", () => {
  it("is the team's view for what reads and is not the read-only view for what writes", () => {
    enterExistingTeamReadOnly(true, null, "account:a|full", true);
    expect(existingTeamView()).toMatchObject({ full: true });
    expect(existingTeamReadOnly()).toBeNull();
    expect(existingTeamConnectionKey()).not.toBeNull();
  });

  it("keeps the kind of link when a new probe of the same opening arrives (the assistant's start)", () => {
    enterExistingTeamReadOnly(false, null, "account:a|full", true);
    enterExistingTeamReadOnly(true, { at: 1, captainRunning: true, assistantRunning: true, source: "assistant_start" });
    expect(existingTeamView()).toMatchObject({ full: true, assistantActive: true });
    expect(existingTeamReadOnly()).toBeNull();
  });

  it("is a new opening, with its own key, when the full connection follows the read-only view", () => {
    enterExistingTeamReadOnly(true, null, "account:a|k1");
    const readOnlyKey = existingTeamConnectionKey();
    expect(existingTeamReadOnly()).not.toBeNull();
    enterExistingTeamReadOnly(true, null, "account:a|full", true);
    expect(existingTeamConnectionKey()).not.toBe(readOnlyKey);
    expect(existingTeamReadOnly()).toBeNull();
  });

  it("a read-only view has no full flag, and the same probe again changes nothing", () => {
    enterExistingTeamReadOnly(true, null, "account:a|k1");
    const first = existingTeamView();
    enterExistingTeamReadOnly(true, null);
    expect(existingTeamView()).toBe(first);
    expect(existingTeamView()?.full).toBeUndefined();
  });

  it("leaving closes both", () => {
    enterExistingTeamReadOnly(true, null, "account:a|full", true);
    leaveExistingTeamReadOnly();
    expect(existingTeamView()).toBeNull();
    expect(existingTeamReadOnly()).toBeNull();
  });

  it("says in every language that the profile page shows the team's data and does not change it", () => {
    enterExistingTeamReadOnly(true, null, "account:a|full", true);
    const state = existingTeamView()!;
    const texts = Object.values(EXISTING_TEAM_READONLY_TEXT);
    expect(new Set(texts.map((text) => text.fullLinkShowsOnly)).size).toBe(texts.length);
    expect(existingTeamReadOnlyReason(state)).toBe(EXISTING_TEAM_READONLY_TEXT.it.fullLinkShowsOnly);
  });
});
