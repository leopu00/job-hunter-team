import { describe, expect, it } from "vitest";
import { describeError } from "../lib/error-catalog";
import type { TeamStatusFields, TeamStatusReading } from "../lib/existing-team-status";
import { EXISTING_TEAM_STATUS_TEXT } from "../pages/existing-team/existing-team-status.i18n";
import type { TeamAgent, TeamAgentsReading } from "../lib/existing-team-agents";
import { EXISTING_TEAM_AGENTS_TEXT } from "../pages/agents/readonly.i18n";
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

  it("carries the piles it is given, wherever the team is on, and unknown ones otherwise", () => {
    const piles = { scout: 3, analisti: 0, scorer: 2, scrittori: 1, critici: 0 };
    expect(officeFromTeamProbe(read(), CONNECTION, "it", piles).snapshot.piles).toEqual(piles);
    expect(officeFromTeamProbe(read(), null, "it", piles).snapshot.piles).toEqual(piles);
    expect(officeFromTeamProbe(read(), CONNECTION, "it").snapshot.piles).toEqual({ scout: null, analisti: null, scorer: null, scrittori: null, critici: null });
    // a team that is off, or a probe that failed, has no piles to show
    expect(Object.values(officeFromTeamProbe(read({ containerRunning: false }), CONNECTION, "it", piles).snapshot.piles)).toEqual([null, null, null, null, null]);
    expect(Object.values(officeFromTeamProbe({ kind: "error", at: AT, code: "x" }, CONNECTION, "it", piles).snapshot.piles)).toEqual([null, null, null, null, null]);
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

describe("officeFromTeamProbe with the team's agents (the Agents page's read)", () => {
  const agent = (name: string, role: string, state: TeamAgent["state"] = { state: "sconosciuto" }): TeamAgent => ({
    name, role, instance: null, created: null, activity: null, identity: null, state,
  });
  const agentsRead = (agents: TeamAgent[], statesKnown = true): TeamAgentsReading => ({
    kind: "read", at: AT, read: { agents, roles: [], statesKnown },
  });
  const TEAM = [
    agent("CAPITANO", "capitano", { state: "lavora", since: AT - 60_000 }),
    agent("SCOUT-1", "scout", { state: "bloccato", reason: "limite_5h", until: AT + 600_000 }),
    agent("SCOUT-2", "scout", { state: "idle" }),
    agent("CRITICO-S3", "critico", { state: "sconosciuto" }),
    agent("CLOSER-1", "closer", { state: "lavora" }),
    agent("DOTTORE", "dottore", { state: "idle" }),
  ];

  it("draws every agent that is up and has a character, by role and instance, with the team's state", () => {
    const office = officeFromTeamProbe(read(), CONNECTION, "it", null, agentsRead(TEAM));
    // the closer and the doctor have no character in the office: not drawn
    expect(office.snapshot.roster).toEqual([
      { uid: "capitano", role: "capitano", sheet: "" },
      { uid: "scout-1", role: "scout", sheet: "" },
      { uid: "scout-2", role: "scout", sheet: "" },
      { uid: "critico-s3", role: "critico", sheet: "" },
    ]);
    const agents = office.statuses!.agents;
    expect(office.statuses!.at).toBe(AT);
    expect(agents.capitano).toEqual({ status: "unknown", state: "lavora", since: AT - 60_000 });
    expect(agents["scout-1"]).toEqual({ status: "unknown", state: "bloccato", reason: "limite_5h", until: AT + 600_000 });
    // a state the team could not compute stays grey
    expect(agents["critico-s3"]).toEqual({ status: "unknown" });
    expect(tagOf(agents["critico-s3"]!).label).toBe("UNKNOWN");
    expect(office.notice?.text).toContain(EXISTING_TEAM_AGENTS_TEXT.it.officeReadAt.split("{time}")[0]!);
  });

  it("without the team's own state every agent is grey, never working, and the sentence says why", () => {
    const office = officeFromTeamProbe(read(), CONNECTION, "it", null, agentsRead(TEAM, false));
    for (const status of Object.values(office.statuses!.agents)) {
      expect(status).toEqual({ status: "unknown" });
      expect(tagOf(status).label).toBe("UNKNOWN");
    }
    expect(office.notice?.text).toContain(EXISTING_TEAM_AGENTS_TEXT.it.statesUnknown);
  });

  it("with no agent to draw says so, and a list that could not be read falls back to the connection's two sessions", () => {
    const none = officeFromTeamProbe(read(), CONNECTION, "it", null, agentsRead([agent("CLOSER-1", "closer")]));
    expect(none.snapshot.roster).toEqual([]);
    expect(none.notice?.text).toContain(EXISTING_TEAM_AGENTS_TEXT.it.officeNoneUp);
    const failed = officeFromTeamProbe(read(), CONNECTION, "it", null, { kind: "error", at: AT, code: "agents_unavailable" });
    expect(failed.snapshot.roster.map((a) => a.uid)).toEqual(["capitano", "assistente"]);
    // a team that is off has an empty office whatever the list says
    expect(officeFromTeamProbe(read({ containerRunning: false }), CONNECTION, "it", null, agentsRead(TEAM)).snapshot.roster).toEqual([]);
  });

  it("says above the scene how the team is: the counts by state the team computes, and who has no seat", () => {
    const office = officeFromTeamProbe(read(), CONNECTION, "it", null, agentsRead(TEAM));
    // CAPITANO and CLOSER-1 work, SCOUT-1 is blocked, SCOUT-2 and DOTTORE are free; CRITICO-S3 is not known
    expect(office.notice?.text).toContain("▶ lavora 2 · ⏸ bloccato 1 · ○ libero 2");
    expect(office.notice?.text).toContain("CLOSER-1, DOTTORE");
    // without the team's own state, no count: only who has no seat
    const unknown = officeFromTeamProbe(read(), CONNECTION, "it", null, agentsRead(TEAM, false));
    expect(unknown.notice?.text).not.toContain("▶");
    expect(unknown.notice?.text).toContain("CLOSER-1, DOTTORE");
  });

  it("no sentence of the agents' office is left with a placeholder, in any language", () => {
    for (const locale of LOCALES) {
      const office = officeFromTeamProbe(read(), CONNECTION, locale, null, agentsRead(TEAM, false));
      expect(office.notice?.text).not.toMatch(/\{[a-z]+\}/);
    }
  });
});
