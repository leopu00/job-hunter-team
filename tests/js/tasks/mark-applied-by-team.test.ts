import { beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

const requireFromWeb = createRequire(
  join(__dirname, "../../../web/package.json"),
);
const Database = requireFromWeb("better-sqlite3");

/**
 * «Mi sono candidato» su una candidatura che ha mandato il TEAM.
 *
 * Il POST riscriveva `applied_via` come `user_manual`, e l'annullamento (che rifiuta le candidature del team)
 * poi la riportava a bozza: una candidatura vera diventava una candidatura «a mano» cancellabile. Ora il POST la
 * rifiuta con `already_applied` e non scrive niente; il click ripetuto sulla propria candidatura resta valido.
 * Qui gira il SQL vero della route, su un SQLite di prova.
 */
let db: InstanceType<typeof Database>;

vi.mock("@/lib/auth", () => ({ requireAuth: vi.fn(async () => null) }));
vi.mock("@/lib/demo/data", () => ({ isDemoLegacyId: vi.fn(() => false) }));
vi.mock("@/lib/demo/mode", () => ({
  activeDemoPersona: vi.fn(async () => null),
}));
vi.mock("@/lib/positions/local-first-write", () => ({
  localFirstWrite: vi.fn(async (_req: unknown, opts: any) => {
    const step = opts.local(db);
    if (!step.ok) return Response.json(step.body, { status: step.status });
    return Response.json({ ...step.outcome, source: "local" });
  }),
}));

const { POST } =
  await import("@/app/api/positions/[legacyId]/mark-applied/route");

function call() {
  return POST(
    new Request("http://localhost/x", {
      method: "POST",
      body: JSON.stringify({}),
    }) as any,
    { params: Promise.resolve({ legacyId: "1" }) },
  );
}

beforeEach(() => {
  db = new Database(join(mkdtempSync(join(tmpdir(), "jht-by-team-")), "t.db"));
  db.exec(`
    CREATE TABLE positions (id INTEGER PRIMARY KEY, title TEXT, company TEXT,
      status TEXT, last_actor TEXT);
    CREATE TABLE applications (position_id INTEGER PRIMARY KEY, status TEXT,
      applied INTEGER, applied_at TEXT, applied_via TEXT, critic_notes TEXT, updated_at TEXT);
    CREATE TABLE position_state_transitions (id INTEGER PRIMARY KEY AUTOINCREMENT,
      position_id INTEGER, from_state TEXT, to_state TEXT, by_agent TEXT, notes TEXT);
    INSERT INTO positions (id, title, company, status) VALUES (1, 't', 'c', 'applied');
  `);
});

const application = () =>
  db.prepare("SELECT applied, applied_at, applied_via FROM applications WHERE position_id=1").get();

describe("segnare «mi sono candidato» su una candidatura già inviata", () => {
  it("rifiuta quella che ha mandato il team e non scrive niente", async () => {
    db.prepare(
      "INSERT INTO applications (position_id, status, applied, applied_at, applied_via) VALUES (1, 'applied', 1, '2026-08-10T10:00:00Z', 'closer')",
    ).run();
    const res = await call();
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({ error: "already_applied", applied_via: "closer" });
    expect(application()).toEqual({ applied: 1, applied_at: "2026-08-10T10:00:00Z", applied_via: "closer" });
    expect(db.prepare("SELECT COUNT(*) AS n FROM position_state_transitions").get()).toEqual({ n: 0 });
  });

  it("accetta di nuovo la propria candidatura a mano", async () => {
    db.prepare(
      "INSERT INTO applications (position_id, status, applied, applied_at, applied_via) VALUES (1, 'applied', 1, '2026-08-10T10:00:00Z', 'user_manual')",
    ).run();
    const res = await call();
    expect(res.status).toBe(200);
    expect((application() as any).applied_via).toBe("user_manual");
  });

  it("accetta una posizione che non ha ancora una candidatura", async () => {
    db.prepare("UPDATE positions SET status = 'scored' WHERE id = 1").run();
    const res = await call();
    expect(res.status).toBe(200);
    expect(application()).toMatchObject({ applied: 1, applied_via: "user_manual" });
  });
});
