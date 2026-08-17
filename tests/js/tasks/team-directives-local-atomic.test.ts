import { afterEach, describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

const root = resolve(__dirname, "../../..");
const requireFromWeb = createRequire(join(root, "web/package.json"));
const Database = requireFromWeb(
  "better-sqlite3",
) as typeof import("better-sqlite3");
const worker = join(root, "tests/js/fixtures/o80-sqlite-worker.ts");
const tsx = join(root, "web/node_modules/tsx/dist/cli.mjs");
// C'era anche una riga `desktop`, sulla copia in `desktop/app-payload/`:
// #177 l'ha rimossa (residuo dell'app Electron, non buildato). I casi restano
// tutti, sull'helper che gira davvero.
const helpers = [
  ["web", join(root, "web/lib/team-directives-local.ts")],
] as const;
const temporary: string[] = [];

afterEach(() => {
  for (const directory of temporary.splice(0))
    rmSync(directory, { recursive: true });
});

async function loadHelper(path: string) {
  return await import(pathToFileURL(path).href);
}

function newDatabase(helper: any) {
  const directory = mkdtempSync(join(tmpdir(), "jht-o80-sqlite-"));
  temporary.push(directory);
  const path = join(directory, "jobs.db");
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  helper.ensureLocalDirectiveMutationSchema(db);
  db.exec(`
    CREATE TABLE mutation_audit(action TEXT NOT NULL);
    CREATE TRIGGER audit_directive_insert AFTER INSERT ON team_directives
      BEGIN INSERT INTO mutation_audit VALUES('created'); END;
    CREATE TRIGGER audit_directive_edit AFTER UPDATE OF body ON team_directives
      BEGIN INSERT INTO mutation_audit VALUES('edited'); END;
    CREATE TRIGGER audit_directive_archive AFTER UPDATE OF status ON team_directives
      WHEN NEW.status='archived'
      BEGIN INSERT INTO mutation_audit VALUES('archived'); END;
  `);
  return { directory, path, db };
}

function assertOneAtomicTuple(db: any, requestId: string, action: string) {
  const ledger = db
    .prepare(
      "SELECT action,payload,result FROM team_directive_request_ledger WHERE request_id=?",
    )
    .get(requestId);
  expect(ledger.action).toBe(action);
  const result = JSON.parse(ledger.result);
  expect(result).toMatchObject({
    ok: true,
    request_id: requestId,
    action,
    captain_event: { status: "queued" },
  });
  const event = db
    .prepare(
      "SELECT body,source_action,source_payload,source_directive_id FROM pending_user_messages WHERE source_id=?",
    )
    .get(`team-directive:${requestId}`);
  expect(event.body).toBe(`[TEAM-DIRECTIVE] ${action}`);
  expect(event.source_action).toBe(action);
  expect(event.source_directive_id).toBe(Number(result.id));
  expect(event.source_payload).toBe(
    action === "created" ? JSON.parse(ledger.payload).body : ledger.payload,
  );
  if (event.source_payload?.length > 1)
    expect(event.body).not.toContain(event.source_payload);
}

describe.each(helpers)(
  "%s SQLite directive exact-once",
  (_name, helperPath) => {
    it("binds replay to the complete payload and permits semantic repeats", async () => {
      const helper = await loadHelper(helperPath);
      const { db } = newDatabase(helper);
      const create = {
        requestId: "create-1",
        action: "created",
        id: 0,
        body: "same words",
        kind: "strategy",
      };
      const first = helper.mutateLocalTeamDirective(db, create);
      expect(helper.mutateLocalTeamDirective(db, create)).toEqual(first);
      expect(() =>
        helper.mutateLocalTeamDirective(db, { ...create, kind: "note" }),
      ).toThrow("request id payload mismatch");
      const repeated = helper.mutateLocalTeamDirective(db, {
        ...create,
        requestId: "create-2",
      });
      expect(repeated.id).not.toBe(first.id);

      const id = Number(first.id);
      for (const [requestId, body] of [
        ["edit-b-1", "B"],
        ["edit-c", "C"],
        ["edit-b-2", "B"],
      ]) {
        const input = { requestId, action: "edited", id, body };
        const result = helper.mutateLocalTeamDirective(db, input);
        expect(helper.mutateLocalTeamDirective(db, input)).toEqual(result);
      }
      expect(
        db.prepare("SELECT body FROM team_directives WHERE id=?").get(id).body,
      ).toBe("B");
      expect(() =>
        helper.mutateLocalTeamDirective(db, {
          requestId: "edit-b-2",
          action: "edited",
          id,
          body: "different",
        }),
      ).toThrow("request id payload mismatch");

      const archive = {
        requestId: "archive-1",
        action: "archived",
        id,
        body: null,
      };
      const archived = helper.mutateLocalTeamDirective(db, archive);
      expect(helper.mutateLocalTeamDirective(db, archive)).toEqual(archived);
      expect(() =>
        helper.mutateLocalTeamDirective(db, {
          ...archive,
          requestId: "archive-2",
        }),
      ).toThrow("directive not found");
      expect(
        db
          .prepare(
            "SELECT count(*) n FROM team_directive_request_ledger WHERE request_id='archive-2'",
          )
          .get().n,
      ).toBe(0);
      expect(() =>
        helper.mutateLocalTeamDirective(db, {
          ...archive,
          id: Number(repeated.id),
        }),
      ).toThrow("request id payload mismatch");
      expect(
        db.prepare("SELECT status FROM team_directives WHERE id=?").get(id)
          .status,
      ).toBe("archived");
      for (const [requestId, action] of [
        ["create-1", "created"],
        ["edit-b-1", "edited"],
        ["edit-c", "edited"],
        ["edit-b-2", "edited"],
        ["archive-1", "archived"],
      ])
        assertOneAtomicTuple(db, requestId, action);
      db.close();
    });

    it.each(["created", "edited", "archived"] as const)(
      "rolls claim, %s effect, event and result back together",
      async (action) => {
        const helper = await loadHelper(helperPath);
        const { db } = newDatabase(helper);
        let id = 0;
        if (action !== "created") {
          id = Number(
            helper.mutateLocalTeamDirective(db, {
              requestId: `seed-${action}`,
              action: "created",
              id: 0,
              body: "before",
              kind: "order",
            }).id,
          );
        }
        db.exec(`CREATE TRIGGER fail_o80_event BEFORE INSERT ON pending_user_messages
        WHEN NEW.source_id='team-directive:will-rollback'
        BEGIN SELECT RAISE(ABORT, 'synthetic event failure'); END;`);
        expect(() =>
          helper.mutateLocalTeamDirective(db, {
            requestId: "will-rollback",
            action,
            id,
            body:
              action === "archived"
                ? null
                : action === "edited"
                  ? "after"
                  : "new",
            kind: action === "created" ? "order" : undefined,
          }),
        ).toThrow("synthetic event failure");
        expect(
          db
            .prepare(
              "SELECT count(*) n FROM team_directive_request_ledger WHERE request_id='will-rollback'",
            )
            .get().n,
        ).toBe(0);
        expect(
          db
            .prepare(
              "SELECT count(*) n FROM pending_user_messages WHERE source_id='team-directive:will-rollback'",
            )
            .get().n,
        ).toBe(0);
        if (action === "created") {
          expect(
            db.prepare("SELECT count(*) n FROM team_directives").get().n,
          ).toBe(0);
        } else {
          expect(
            db
              .prepare("SELECT body,status FROM team_directives WHERE id=?")
              .get(id),
          ).toMatchObject({
            body: "before",
            status: "active",
          });
        }
        db.close();
      },
    );

    it.each(["created", "edited", "archived"] as const)(
      "serializes two real connections for concurrent %s",
      async (action) => {
        const helper = await loadHelper(helperPath);
        const { directory, path, db } = newDatabase(helper);
        let id = 0;
        if (action !== "created") {
          id = Number(
            helper.mutateLocalTeamDirective(db, {
              requestId: `seed-concurrent-${action}`,
              action: "created",
              id: 0,
              body: "before",
              kind: "order",
            }).id,
          );
          db.prepare("DELETE FROM mutation_audit").run();
        }
        const requestId = `concurrent-${action}`;
        const input = {
          requestId,
          action,
          id,
          body:
            action === "archived"
              ? null
              : action === "edited"
                ? "after"
                : "new",
          kind: action === "created" ? "order" : undefined,
        };
        const barrier = join(directory, "go");
        const encoded = Buffer.from(JSON.stringify(input)).toString(
          "base64url",
        );
        const run = () =>
          new Promise<{ code: number | null; stdout: string; stderr: string }>(
            (resolveRun) => {
              const child = spawn(process.execPath, [
                tsx,
                worker,
                helperPath,
                path,
                barrier,
                encoded,
              ]);
              let stdout = "";
              let stderr = "";
              child.stdout.on("data", (chunk) => (stdout += chunk));
              child.stderr.on("data", (chunk) => (stderr += chunk));
              child.on("close", (code) => resolveRun({ code, stdout, stderr }));
            },
          );
        const first = run();
        const second = run();
        writeFileSync(barrier, "go");
        const results = await Promise.all([first, second]);
        expect(results.map((entry) => entry.code)).toEqual([0, 0]);
        expect(JSON.parse(results[0].stdout)).toEqual(
          JSON.parse(results[1].stdout),
        );
        expect(
          db
            .prepare("SELECT count(*) n FROM mutation_audit WHERE action=?")
            .get(action).n,
        ).toBe(1);
        assertOneAtomicTuple(db, requestId, action);
        db.close();
      },
      20000,
    );

    it("lets one concurrent mismatched create win without a hybrid effect", async () => {
      const helper = await loadHelper(helperPath);
      const { directory, path, db } = newDatabase(helper);
      const barrier = join(directory, "go-mismatch");
      const inputs = ["winner-a", "winner-b"].map((body) => ({
        requestId: "concurrent-mismatch",
        action: "created",
        id: 0,
        body,
        kind: "order",
      }));
      const run = (input: object) =>
        new Promise<{ code: number | null; stdout: string; stderr: string }>(
          (resolveRun) => {
            const encoded = Buffer.from(JSON.stringify(input)).toString(
              "base64url",
            );
            const child = spawn(process.execPath, [
              tsx,
              worker,
              helperPath,
              path,
              barrier,
              encoded,
            ]);
            let stdout = "";
            let stderr = "";
            child.stdout.on("data", (chunk) => (stdout += chunk));
            child.stderr.on("data", (chunk) => (stderr += chunk));
            child.on("close", (code) => resolveRun({ code, stdout, stderr }));
          },
        );
      const races = inputs.map(run);
      writeFileSync(barrier, "go");
      const results = await Promise.all(races);
      expect(results.map((entry) => entry.code).sort()).toEqual([0, 2]);
      expect(results.find((entry) => entry.code === 2)?.stderr).toContain(
        "request id payload mismatch",
      );
      expect(db.prepare("SELECT count(*) n FROM team_directives").get().n).toBe(
        1,
      );
      expect(db.prepare("SELECT count(*) n FROM mutation_audit").get().n).toBe(
        1,
      );
      assertOneAtomicTuple(db, "concurrent-mismatch", "created");
      db.close();
    }, 20000);

    it("rolls the whole operation back if persisting the result fails", async () => {
      const helper = await loadHelper(helperPath);
      const { db } = newDatabase(helper);
      db.exec(`CREATE TRIGGER fail_o80_result BEFORE UPDATE OF result
        ON team_directive_request_ledger WHEN NEW.result IS NOT NULL
        BEGIN SELECT RAISE(ABORT, 'synthetic result failure'); END;`);
      expect(() =>
        helper.mutateLocalTeamDirective(db, {
          requestId: "result-rollback",
          action: "created",
          id: 0,
          body: "must disappear",
          kind: "order",
        }),
      ).toThrow("synthetic result failure");
      expect(
        db.prepare("SELECT count(*) n FROM team_directive_request_ledger").get()
          .n,
      ).toBe(0);
      expect(db.prepare("SELECT count(*) n FROM team_directives").get().n).toBe(
        0,
      );
      expect(
        db.prepare("SELECT count(*) n FROM pending_user_messages").get().n,
      ).toBe(0);
      db.close();
    });

    it("never exposes an unknown internal error in the public response", async () => {
      const helper = await loadHelper(helperPath);
      const secret =
        "/synthetic/private/path session=synth-session token=synth-token";
      const response = helper.publicDirectiveError(new Error(secret));
      expect(response).toEqual({ error: "directive_not_queued", status: 503 });
      expect(JSON.stringify(response)).not.toContain(secret);
    });
  },
);
