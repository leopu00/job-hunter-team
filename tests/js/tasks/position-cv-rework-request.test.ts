// [JHT-CV-REWORK] A CV request on an application that was never sent.
//
// Seen live: an unsent application whose CV PDF fails the layout check could
// not be sent back to the Scrittore — the route answered "application already
// exists" (status scored) or "only from scored" (status ready). The dashboard
// now accepts the request on a never-sent application of a scored or ready
// position, locally and in the cloud; the box decides on the PDF
// (`db_query.py next-for-scrittore`). A sent application is still refused.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

const repo = join(__dirname, "../../..");
const requireFromWeb = createRequire(join(repo, "web/package.json"));
const Database = requireFromWeb("better-sqlite3");
const home = mkdtempSync(join(tmpdir(), "jht-cv-rework-request-"));
process.env.JHT_HOME = home;

const db = new Database(join(home, "jobs.db"));
db.exec(`
  CREATE TABLE positions (
    id INTEGER PRIMARY KEY, title TEXT, company TEXT, status TEXT,
    write_requested INTEGER DEFAULT 0, write_requested_at TEXT,
    write_request_kind TEXT, updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE scores (position_id INTEGER UNIQUE, total_score INTEGER);
  CREATE TABLE applications (
    id INTEGER PRIMARY KEY, position_id INTEGER UNIQUE, applied INTEGER DEFAULT 0,
    cv_path TEXT, cv_pdf_path TEXT
  );
  CREATE TABLE email_application_attempts (
    id INTEGER PRIMARY KEY, position_id INTEGER, state TEXT
  );
`);

vi.mock("@/lib/auth", () => ({ requireAuth: vi.fn(async () => null) }));
vi.mock("@/lib/team-state/auth", () => ({ resolveUser: vi.fn() }));
vi.mock("@/lib/local-token", () => ({
  LOCAL_TOKEN_COOKIE: "jht_local_token",
  isLocalTokenAuthenticated: vi.fn(() => true),
}));
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: vi.fn() })),
}));

const route =
  await import("@/app/api/positions/[legacyId]/write-request/route");

function seed(
  id: number,
  status: string,
  application: "none" | "unsent" | "sent",
) {
  db.prepare(
    "INSERT INTO positions (id, title, company, status) VALUES (?, 'Synthetic role', 'Synthetic company', ?)",
  ).run(id, status);
  db.prepare(
    "INSERT INTO scores (position_id, total_score) VALUES (?, 96)",
  ).run(id);
  if (application !== "none") {
    db.prepare(
      "INSERT INTO applications (position_id, applied, cv_path, cv_pdf_path) VALUES (?, ?, '/synthetic/cv.md', '/synthetic/cv.pdf')",
    ).run(id, application === "sent" ? 1 : 0);
  }
}

beforeEach(() => {
  db.exec(
    "DELETE FROM positions; DELETE FROM scores; DELETE FROM applications; DELETE FROM email_application_attempts;",
  );
});

afterAll(() => {
  db.close();
  rmSync(home, { recursive: true, force: true });
});

describe("CV request on a never-sent application", () => {
  it.each([
    ["scored", 1170],
    ["ready", 1833],
  ])("is accepted locally on a %s position", (status, id) => {
    seed(id as number, status as string, "unsent");

    const result = route.toggleViaLocal(id as number, true, "cv");

    expect(result.ok).toBe(true);
    const row = db
      .prepare(
        "SELECT write_requested, write_request_kind, status FROM positions WHERE id = ?",
      )
      .get(id);
    expect(row).toEqual({
      write_requested: 1,
      write_request_kind: "cv",
      status,
    });
  });

  it("is refused locally on a sent application", () => {
    seed(42, "ready", "sent");

    const result = route.toggleViaLocal(42, true, "cv");

    expect(result.ok).toBe(false);
    expect(
      db.prepare("SELECT write_requested FROM positions WHERE id = 42").get(),
    ).toEqual({ write_requested: 0 });
  });

  it("is refused locally once an email send has started", () => {
    seed(43, "ready", "unsent");
    db.prepare(
      "INSERT INTO email_application_attempts (position_id, state) VALUES (43, 'send_outcome_unknown')",
    ).run();

    expect(route.toggleViaLocal(43, true, "cv").ok).toBe(false);
  });

  it("keeps refusing other statuses and positions without an application outside 'scored'", () => {
    seed(44, "review", "unsent");
    seed(45, "ready", "none");

    expect(route.toggleViaLocal(44, true, "cv").ok).toBe(false);
    expect(route.toggleViaLocal(45, true, "cv").ok).toBe(false);
  });

  it("follows the same rule on the cloud path", () => {
    expect(route.validateRequested("cv", "ready", true, false)).toEqual({
      ok: true,
    });
    expect(route.validateRequested("cv", "scored", true, false)).toEqual({
      ok: true,
    });
    expect(route.validateRequested("cv", "ready", true, true).ok).toBe(false);
    expect(route.validateRequested("cv", "scored", true, true).ok).toBe(false);
    expect(route.validateRequested("cv", "applied", true, false).ok).toBe(
      false,
    );
    expect(route.validateRequested("cv", "scored", false, false)).toEqual({
      ok: true,
    });
  });
});
