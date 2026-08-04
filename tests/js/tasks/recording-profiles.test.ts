import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  RECORDING_PROFILE_ALIASES,
  buildRecordingProfileDataset,
  isRecordingAccountMetadata,
  redactRecordingError,
  recordingUuid,
} from "@/lib/recording-profile";

describe("profili riprese — dataset reale e ripetibile", () => {
  it("accetta soltanto metadata del profilo e alias attesi", () => {
    expect(
      isRecordingAccountMetadata(
        { purpose: "recording-profile", alias: "software" },
        "software",
      ),
    ).toBe(true);
    expect(
      isRecordingAccountMetadata(
        { purpose: "recording-profile", alias: "design" },
        "software",
      ),
    ).toBe(false);
    expect(isRecordingAccountMetadata({}, "software")).toBe(false);
    expect(isRecordingAccountMetadata(null, "software")).toBe(false);
  });

  it("redige path, account, URL e identificativi dagli errori", () => {
    const raw =
      "ENOENT /private/operator/recording/software/jobs.db for " +
      "recording-software-123@example.invalid user " +
      "123e4567-e89b-42d3-a456-426614174000 at " +
      "https://service.invalid/path?token=opaque";
    const redacted = redactRecordingError(raw, ["/private/operator"]);
    expect(redacted).toContain("ENOENT");
    expect(redacted).not.toContain("/private/operator");
    expect(redacted).not.toContain("example.invalid");
    expect(redacted).not.toContain("123e4567");
    expect(redacted).not.toContain("service.invalid");
  });

  it("verify fallisce su artifact e superfici locali mancanti", () => {
    const repo = resolve(process.cwd(), "../..");
    const privateRoot = mkdtempSync(join(tmpdir(), "jht-recording-verify-"));
    const env = {
      ...process.env,
      XDG_CONFIG_HOME: join(privateRoot, "config"),
      XDG_DATA_HOME: join(privateRoot, "data"),
    };
    const command = join(repo, "web", "node_modules", ".bin", "tsx");
    const script = join(repo, "web", "scripts", "recording-profile.ts");
    const run = (action: "reset" | "verify", localOnly = true) =>
      spawnSync(command, [
        script,
        action,
        "software",
        ...(localOnly ? ["--local-only"] : []),
      ], {
        cwd: join(repo, "web"),
        env,
        encoding: "utf8",
      });
    const profileRoot = join(
      env.XDG_DATA_HOME,
      "jht",
      "recording-profiles",
      "software",
    );
    const canonicalDump = () => {
      const db = new DatabaseSync(join(profileRoot, "jobs.db"), {
        readOnly: true,
      });
      const dump = Object.fromEntries(
        [
          "companies",
          "positions",
          "scores",
          "applications",
          "position_highlights",
          "pending_user_messages",
        ].map((table) => [
          table,
          db.prepare(`SELECT * FROM ${table} ORDER BY id`).all(),
        ]),
      );
      db.close();
      return JSON.stringify(dump);
    };
    try {
      expect(run("reset").status).toBe(0);
      expect(
        JSON.parse(readFileSync(join(profileRoot, "preferences.json"), "utf8")),
      ).toMatchObject({ theme: "light" });
      const firstDump = canonicalDump();
      expect(run("reset").status).toBe(0);
      expect(canonicalDump()).toBe(firstDump);

      unlinkSync(join(profileRoot, "profile", "ready.flag"));
      const missingReady = run("verify");
      expect(missingReady.status).toBe(1);
      expect(missingReady.stderr).toContain("artifact locale");
      expect(missingReady.stderr).not.toContain(privateRoot);

      expect(run("reset").status).toBe(0);
      writeFileSync(join(profileRoot, "preferences.json"), "{}\n", "utf8");
      expect(run("verify").status).toBe(1);

      expect(run("reset").status).toBe(0);
      unlinkSync(join(profileRoot, "host.env"));
      expect(run("verify").status).toBe(1);

      for (const table of ["applications", "position_highlights"]) {
        expect(run("reset").status).toBe(0);
        const db = new DatabaseSync(join(profileRoot, "jobs.db"));
        db.exec(`DELETE FROM ${table}`);
        db.close();
        const missingRows = run("verify");
        expect(missingRows.status).toBe(1);
        expect(missingRows.stderr).toContain(table);
      }

      expect(run("reset").status).toBe(0);
      const offlineVerify = run("verify", false);
      expect(offlineVerify.status).toBe(1);
      expect(offlineVerify.stderr).toContain("verify non crea account");
      expect(
        existsSync(
          join(
            env.XDG_CONFIG_HOME,
            "jht",
            "recording-profiles",
            "software.env",
          ),
        ),
      ).toBe(false);
    } finally {
      rmSync(privateRoot, { recursive: true, force: true });
    }
  }, 300_000);

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
      expect(data.candidateProfile).not.toHaveProperty("contacts");
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
