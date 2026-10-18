import { describe, expect, it } from "vitest";
import { describeError } from "../lib/error-catalog";
import type { TeamStatusFields, TeamStatusReading } from "../lib/existing-team-status";
import { EXISTING_TEAM_STATUS_TEXT } from "../pages/existing-team/existing-team-status.i18n";
import { tagOf } from "./status";
import { officeFromTeamProbe } from "./readonly";

// The office of an existing team read over its VPS: what the Squadra page's
// probe knows, drawn without inventing anything. Synthetic data only.
const LOCALES = ["it", "en", "de", "es", "fr", "hu", "pt"] as const;
const AT = Date.UTC(2026, 9, 18, 21, 0, 0);
const FIELDS: TeamStatusFields = {
  runtimeInstalled: true,
  containerRunning: true,
  providerConfigured: true,
  providerAuthenticated: true,
  profileReady: true,
  assistantWelcomed: true,
};
const read = (over: Partial<TeamStatusFields> = {}): TeamStatusReading => ({ kind: "read", at: AT, fields: { ...FIELDS, ...over } });
const CONNECTION = { at: AT - 60_000, captainRunning: true, assistantRunning: true };

describe("officeFromTeamProbe", () => {
  it("draws the captain and the assistant when their sessions are up, each of unknown status", () => {
    const office = officeFromTeamProbe(read(), CONNECTION, "it");
    expect(office.snapshot.roster.map((a) => a.uid)).toEqual(["capitano", "assistente"]);
    expect(office.snapshot.teamOnline).toBe(true);
    expect(office.statuses).toEqual({ at: CONNECTION.at, agents: { capitano: { status: "unknown" }, assistente: { status: "unknown" } } });
    // a session being up says nothing about work: the tag is grey, never WORKING or WAITING
    const tag = tagOf(office.statuses!.agents.capitano);
    expect(tag.label).toBe("UNKNOWN");
    expect(tag.color).not.toBe(tagOf({ status: "working" }).color);
    expect(tag.color).not.toBe(tagOf({ status: "idle" }).color);
  });

  it("knows nothing else: piles unknown, no position moving, no other agent", () => {
    const { snapshot } = officeFromTeamProbe(read(), CONNECTION, "it");
    expect(Object.values(snapshot.piles)).toEqual([null, null, null, null, null]);
    expect(snapshot.transitions).toEqual([]);
    expect(snapshot.heartbeatAt).toBeNull();
  });

  it("draws only the sessions that are up", () => {
    const captainOnly = officeFromTeamProbe(read(), { ...CONNECTION, assistantRunning: false }, "it");
    expect(captainOnly.snapshot.roster.map((a) => a.uid)).toEqual(["capitano"]);
    expect(Object.keys(captainOnly.statuses!.agents)).toEqual(["capitano"]);
    const assistantOnly = officeFromTeamProbe(read(), { ...CONNECTION, captainRunning: false }, "it");
    expect(assistantOnly.snapshot.roster.map((a) => a.uid)).toEqual(["assistente"]);
  });

  it("says which time the sessions' values are from, and that it is the connection's", () => {
    const office = officeFromTeamProbe(read(), CONNECTION, "it");
    expect(office.notice).toEqual({
      text: EXISTING_TEAM_STATUS_TEXT.it.atConnection.replace("{time}", new Date(CONNECTION.at).toLocaleString("it", { dateStyle: "short", timeStyle: "medium" })),
      alert: false,
    });
    const afterStart = officeFromTeamProbe(read(), { ...CONNECTION, source: "assistant_start" }, "it");
    expect(afterStart.notice!.text).toContain("verifica dopo l’avvio dell’assistente");
  });

  it("a team that is off has an empty office and the Squadra page's own sentence", () => {
    for (const locale of LOCALES) {
      const office = officeFromTeamProbe(read({ containerRunning: false }), CONNECTION, locale);
      expect(office.snapshot.roster, locale).toEqual([]);
      expect(office.snapshot.teamOnline, locale).toBe(false);
      expect(office.statuses, locale).toBeNull();
      expect(office.notice, locale).toEqual({ text: EXISTING_TEAM_STATUS_TEXT[locale].fields.containerRunning.no, alert: false });
    }
  });

  it("a container that is up with no value from the connection draws nobody and says why", () => {
    const office = officeFromTeamProbe(read(), null, "it");
    expect(office.snapshot.roster).toEqual([]);
    expect(office.snapshot.teamOnline).toBe(true);
    expect(office.notice!.text).toBe(EXISTING_TEAM_STATUS_TEXT.it.noConnectionValue);
  });

  it("a container up with no session up says so", () => {
    const office = officeFromTeamProbe(read(), { ...CONNECTION, captainRunning: false, assistantRunning: false }, "it");
    expect(office.snapshot.roster).toEqual([]);
    expect(office.notice!.text).toBe(EXISTING_TEAM_STATUS_TEXT.it.fields.captainRunning.no);
  });

  it("a failed read empties the office and tells why with the catalog's sentence, in every language", () => {
    for (const locale of LOCALES) {
      const failure = describeError("ssh_unavailable", { fallback: "existing_team_unavailable", locale });
      const office = officeFromTeamProbe({ kind: "error", at: AT, code: "ssh_unavailable" }, CONNECTION, locale);
      expect(office.snapshot.roster, locale).toEqual([]);
      expect(office.statuses, locale).toBeNull();
      expect(office.notice!.alert, locale).toBe(true);
      expect(office.notice!.text, locale).toContain(failure.text);
      expect(office.notice!.text, locale).toContain(failure.action);
      expect(office.notice!.text, locale).toContain("(ssh_unavailable)");
    }
  });

  it("a code the catalog does not have falls back to the team-unreachable sentence, never to the bare code", () => {
    const fallback = describeError("existing_team_unavailable", { locale: "it" });
    const office = officeFromTeamProbe({ kind: "error", at: AT, code: "colpa_del_gatto" }, CONNECTION, "it");
    expect(office.notice!.text).toContain(fallback.text);
  });

  it("before any read the office is empty and the page says nothing was read", () => {
    const office = officeFromTeamProbe({ kind: "unknown" }, CONNECTION, "it");
    expect(office.snapshot.roster).toEqual([]);
    expect(office.snapshot.teamOnline).toBeNull();
    expect(office.notice!.text).toBe(EXISTING_TEAM_STATUS_TEXT.it.unknown);
  });

  it("no sentence is left with a placeholder, in any language", () => {
    for (const locale of LOCALES) {
      for (const office of [
        officeFromTeamProbe(read(), CONNECTION, locale),
        officeFromTeamProbe(read(), { ...CONNECTION, source: "assistant_start" }, locale),
        officeFromTeamProbe(read({ containerRunning: false }), CONNECTION, locale),
        officeFromTeamProbe(read(), null, locale),
      ]) {
        expect(office.notice!.text, locale).not.toMatch(/\{[a-z]+\}/);
        expect(office.notice!.text.length, locale).toBeGreaterThan(5);
      }
    }
  });
});
