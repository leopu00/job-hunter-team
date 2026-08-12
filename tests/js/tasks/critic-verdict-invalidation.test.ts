/** O-64 — il sync non deve ripubblicare un verdetto piu' vecchio del CV. */
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { invalidateStaleCriticVerdict } from "../../../web/lib/sync-vocabulary";
import { readSqliteTableCompatible } from "../../../web/lib/sqlite-compatible-read";

const reviewed = {
  status: "ready",
  written_at: "2026-08-11 00:58:00",
  critic_verdict: "PASS",
  critic_score: 7.5,
  critic_notes: "Feedback sulla prima versione",
  critic_round: 3,
  reviewed_by: "critico-test",
  critic_reviewed_at: "2026-07-14 16:20:00",
};

describe("invalidazione verdetto Critico al confine sync", () => {
  it("azzera tutto il giudizio stale e riapre una candidatura ready", () => {
    expect(invalidateStaleCriticVerdict(reviewed)).toEqual({
      ...reviewed,
      status: "review",
      critic_verdict: null,
      critic_score: null,
      critic_notes: null,
      critic_round: null,
      reviewed_by: null,
      critic_reviewed_at: null,
    });
  });

  it("lascia intatto un verdetto successivo al testo", () => {
    const current = {
      ...reviewed,
      critic_reviewed_at: "2026-08-11 01:20:00",
    };
    expect(invalidateStaleCriticVerdict(current)).toEqual(current);
  });

  it("non inventa un backfill quando manca la cronologia necessaria", () => {
    const unknown = { ...reviewed, critic_reviewed_at: null };
    expect(invalidateStaleCriticVerdict(unknown)).toEqual(unknown);
  });

  it.each(["applied", "response"])(
    "non perde lo stato post-invio %s, ma rimuove il giudizio stale",
    (status) => {
      const saved = invalidateStaleCriticVerdict({
        ...reviewed,
        status,
      });
      expect(saved.status).toBe(status);
      expect(saved.critic_verdict).toBeNull();
      expect(saved.critic_score).toBeNull();
    },
  );

  it("critic_round attraversa tutti i percorsi di sync insieme agli altri campi", () => {
    const root = resolve(import.meta.dirname, "../../..");
    const paths = [
      "cli/src/commands/cloud.js",
      "shared/skills/db_to_supabase.py",
      "desktop/app-payload/shared/skills/db_to_supabase.py",
      "web/app/api/cloud-sync/push/route.ts",
      "web/app/api/local/sync/route.ts",
    ];
    for (const path of paths) {
      expect(readFileSync(resolve(root, path), "utf8"), path).toContain(
        "critic_round",
      );
    }
  });

  it("il sync locale legge senza errore un vero schema pre-critic_round", () => {
    const dir = mkdtempSync(resolve(tmpdir(), "jht-o64-legacy-sync-"));
    const db = new DatabaseSync(resolve(dir, "jobs.db"));
    try {
      db.exec(`
        CREATE TABLE applications (
          position_id INTEGER PRIMARY KEY,
          status TEXT, critic_score REAL, critic_verdict TEXT,
          critic_notes TEXT, written_at TEXT, reviewed_by TEXT,
          critic_reviewed_at TEXT
        );
        INSERT INTO applications VALUES (
          42, 'ready', 7.5, 'PASS', 'feedback legacy',
          '2026-08-11 00:58:00', 'critico-test', '2026-07-14 16:20:00'
        );
      `);
      const rows = readSqliteTableCompatible<Record<string, unknown>>(
        db,
        "applications",
        [
          "position_id",
          "status",
          "critic_score",
          "critic_verdict",
          "critic_notes",
          "critic_round",
          "written_at",
          "reviewed_by",
          "critic_reviewed_at",
        ],
        new Set(["critic_round"]),
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]).not.toHaveProperty("critic_round");
      expect(rows[0]).toMatchObject({
        position_id: 42,
        critic_verdict: "PASS",
      });
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
