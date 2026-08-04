import { describe, expect, it } from "vitest";
import {
  RECORDING_PROFILE_ALIASES,
  buildRecordingProfileDataset,
  recordingUuid,
} from "@/lib/recording-profile";

describe("profili riprese — dataset reale e ripetibile", () => {
  it("copre quattro utenti fittizi con contenuti professionali diversi", () => {
    expect(RECORDING_PROFILE_ALIASES).toEqual([
      "software",
      "marketing",
      "finance",
      "design",
    ]);
    const datasets = RECORDING_PROFILE_ALIASES.map((alias) =>
      buildRecordingProfileDataset(alias),
    );
    expect(datasets.every((d) => d.positions.length === 56)).toBe(true);
    expect(new Set(datasets.map((d) => d.candidateProfile.target_role)).size).toBe(4);
    expect(new Set(datasets.flatMap((d) => d.positions.map((p) => p.role_family))).size)
      .toBeGreaterThan(12);
  });

  it("ricrea byte-per-byte lo stesso scenario alla stessa ancora", () => {
    const first = buildRecordingProfileDataset("software");
    const second = buildRecordingProfileDataset("software");
    expect(second).toEqual(first);
  });

  it("usa chiavi UUID stabili e non gli id riconoscibili della demo", () => {
    const data = buildRecordingProfileDataset("design");
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    for (const row of [
      ...data.positions,
      ...data.scores,
      ...data.applications,
      ...data.highlights,
      ...data.companies,
    ]) {
      expect(row.id).toMatch(uuid);
    }
    expect(recordingUuid("design", "position:9301")).toBe(
      recordingUuid("design", "position:9301"),
    );
  });

  it("mantiene pieni tutti gli stadi e le superfici mostrate nei video", () => {
    for (const alias of RECORDING_PROFILE_ALIASES) {
      const data = buildRecordingProfileDataset(alias);
      const statuses = new Set(data.positions.map((p) => p.status));
      expect(statuses).toEqual(
        new Set([
          "new",
          "checked",
          "scored",
          "writing",
          "review",
          "ready",
          "applied",
          "response",
          "excluded",
        ]),
      );
      expect(data.scores.length).toBeGreaterThan(0);
      expect(data.applications.length).toBeGreaterThan(0);
      expect(data.highlights.length).toBeGreaterThan(0);
      expect(data.positions.some((p) => p.office_lat != null)).toBe(true);
      expect(data.chatTurns).toHaveLength(6);
      expect(new Set(data.chatTurns.map((turn) => turn.agent))).toEqual(
        new Set(["assistente", "mentor", "capitano"]),
      );
      expect(new Set(data.chatTurns.map((turn) => turn.author))).toEqual(
        new Set(["user", "agent"]),
      );
    }
  });

  it("non trasferisce cookie, contatti o segnali di ambiente demo/test", () => {
    for (const alias of RECORDING_PROFILE_ALIASES) {
      const data = buildRecordingProfileDataset(alias);
      expect(data.candidateProfile.email).toBeNull();
      for (const p of data.positions) {
        expect(String(p.id)).not.toContain("demo");
        expect(p.url).toBeNull();
        expect(String(p.source)).not.toMatch(/^(jht demo|showroom|mock|test)$/i);
        expect(String(p.found_by)).not.toMatch(/^(showroom|mock|test)$/i);
      }
      for (const c of data.companies) expect(c.website).toBeNull();
      expect(JSON.stringify(data.chatTurns)).not.toMatch(
        /\b(demo mode|modalità demo|showroom|mock data)\b/i,
      );
    }
  });
});
