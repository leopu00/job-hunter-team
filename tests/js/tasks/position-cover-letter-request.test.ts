import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { locales } from "../../../web/i18n/config";
import {
  IconCoverLetter,
  IconFileText,
  IconMapPin,
  IconOpenCheck,
  IconRefresh,
} from "../../../web/app/(protected)/positions/[id]/ActionRow";

const repo = join(__dirname, "../../..");
const requireFromWeb = createRequire(join(repo, "web/package.json"));
const Database = requireFromWeb("better-sqlite3");
const { renderToStaticMarkup } = requireFromWeb("react-dom/server") as {
  renderToStaticMarkup: (element: unknown) => string;
};
const home = mkdtempSync(join(tmpdir(), "jht-cover-letter-request-"));
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
    id INTEGER PRIMARY KEY, position_id INTEGER UNIQUE,
    cv_path TEXT, cv_pdf_path TEXT, cl_path TEXT, cl_pdf_path TEXT
  );
  INSERT INTO positions (id, title, company, status, write_requested)
    VALUES (643, 'Synthetic role', 'Synthetic company', 'ready', 1);
  INSERT INTO scores (position_id, total_score) VALUES (643, 80);
  INSERT INTO applications (id, position_id, cv_path)
    VALUES (1, 643, '/synthetic/cv.md');
`);

vi.mock("@/lib/auth", () => ({ requireAuth: vi.fn(async () => null) }));
vi.mock("@/lib/team-state/auth", () => ({
  resolveUser: vi.fn(() => {
    throw new Error("cloud path must not run for local-token requests");
  }),
}));
vi.mock("@/lib/local-token", () => ({
  LOCAL_TOKEN_COOKIE: "jht_local_token",
  isLocalTokenAuthenticated: vi.fn(() => true),
}));
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: vi.fn() })),
}));

const route =
  await import("@/app/api/positions/[legacyId]/write-request/route");
function request(method: "POST" | "DELETE") {
  return route.toggleViaLocal(643, method === "POST", "cover_letter");
}

beforeEach(() => {
  db.exec(`
    UPDATE positions
       SET write_requested = 1,
           write_requested_at = '2026-01-01 00:00:00',
           write_request_kind = NULL
     WHERE id = 643;
    INSERT OR IGNORE INTO applications (id, position_id, cv_path)
      VALUES (1, 643, '/synthetic/cv.md');
  `);
});

afterAll(() => {
  db.close();
  rmSync(home, { recursive: true, force: true });
});

describe("cover letter nella pipeline Writer-on-demand", () => {
  it("converte il flag CV completato, deduplica senza cambiare FIFO e annulla", async () => {
    const first = request("POST");
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error("local request unexpectedly rejected");
    expect(first.outcome.position).toMatchObject({
      write_requested: true,
      write_request_kind: "cover_letter",
    });
    const firstAt = first.outcome.position.write_requested_at;

    const duplicate = request("POST");
    if (!duplicate.ok) throw new Error("duplicate unexpectedly rejected");
    expect(duplicate.outcome.position.write_requested_at).toBe(firstAt);
    expect(duplicate.outcome.position.write_request_kind).toBe("cover_letter");

    const cancelled = request("DELETE");
    expect(cancelled).toMatchObject({
      ok: true,
      outcome: {
        position: {
          write_requested: false,
          write_requested_at: expect.any(String),
          write_request_kind: null,
        },
      },
    });
    if (!cancelled.ok) throw new Error("cancel unexpectedly rejected");
    expect(cancelled.outcome.position.write_requested_at! > firstAt!).toBe(
      true,
    );
  });

  it("rifiuta prima della scrittura quando non esiste una application", async () => {
    db.prepare("DELETE FROM applications WHERE position_id = 643").run();
    const response = request("POST");
    expect(response).toMatchObject({ ok: false, status: 409 });
    expect(
      db
        .prepare(
          "SELECT write_request_kind AS kind FROM positions WHERE id = 643",
        )
        .get(),
    ).toEqual({ kind: null });
  });

  it("una DELETE cover stantia non spegne una richiesta CV", () => {
    const stale = request("DELETE");
    expect(stale).toMatchObject({
      ok: true,
      outcome: {
        position: {
          write_requested: true,
          write_request_kind: null,
        },
      },
    });
  });
});

describe("mapping, lingue e iconografia O-82/O-83", () => {
  it("espone testo completo EN+6", () => {
    const source = readFileSync(
      join(
        repo,
        "web/app/(protected)/positions/[id]/CoverLetterRequestButton.tsx",
      ),
      "utf8",
    );
    for (const locale of locales) {
      expect(source).toContain(`${locale}: {`);
    }
    expect(source.match(/invalidResponse:/g)).toHaveLength(locales.length + 1);
  });

  it("usa un glifo distinto per ogni action row del pannello", () => {
    const icons = [
      IconMapPin,
      IconOpenCheck,
      IconRefresh,
      IconFileText,
      IconCoverLetter,
    ].map((Icon) => renderToStaticMarkup(Icon()));
    expect(new Set(icons).size).toBe(icons.length);
    expect(icons.join(" ")).toContain('data-action-icon="open-check"');
    expect(icons.join(" ")).toContain('data-action-icon="cover-letter"');
  });

  it("mappa UI, sync e Writer sulla stessa coda durevole", () => {
    const paths = [
      "web/app/(protected)/positions/[id]/CoverLetterRequestButton.tsx",
      "web/app/api/positions/[legacyId]/write-request/route.ts",
      "web/app/api/cloud-sync/push/route.ts",
      "web/app/api/cloud-sync/pull-desired-state/route.ts",
      "web/app/api/local/sync/route.ts",
      "cli/src/commands/cloud.js",
      "cli/src/lib/supabase-direct.js",
      "shared/skills/db_query.py",
    ];
    for (const path of paths) {
      expect(readFileSync(join(repo, path), "utf8")).toContain(
        "write_request_kind",
      );
    }
    const button = readFileSync(join(repo, paths[0]), "utf8");
    const routeSource = readFileSync(join(repo, paths[1]), "utf8");
    expect(button).toContain("acknowledged");
    expect(button).toContain("JSON.stringify({ kind: KIND })");
    expect(routeSource).toContain('"cv", "cover_letter"');
    expect(routeSource).toContain("request_state_changed");
    expect(routeSource).toContain(".maybeSingle()");
    for (const suffix of ["", ".it", ".es", ".fr", ".de", ".hu", ".pt"]) {
      const prompt = readFileSync(
        join(repo, `agents/scrittore/scrittore${suffix}.md`),
        "utf8",
      );
      expect(prompt).toContain("request_kind=cover_letter");
      expect(prompt).toContain("db_update.py application");
      expect(prompt).toContain("cl_path");
      expect(prompt).toContain("cv_path");
    }
  });
});
