// L'indice dei file del box ha UNA riga per (user_id, name), ma il box ha tre
// cartelle (cv/, allegati/, output/) e lo stesso nome può stare in due: un CV
// PDF in cv/ e in output/. Il poller mandava entrambe le copie, la route le
// passava tutte a un upsert ON CONFLICT DO UPDATE e Postgres rispondeva 21000
// («cannot affect row a second time»): 500 a ogni giro, indice mai pubblicato
// e il DELETE dei file spariti, che viene dopo, mai eseguito.
//
// Regola: vince la PRIMA cartella nell'ordine del poller (cv, allegati,
// output), la stessa in cui il poller risolve un nome quando il web lo chiede.
// Il finto cloud qui sotto rifiuta come Postgres un upsert con due righe sulla
// stessa chiave: un test che accettasse qualunque payload resterebbe verde
// anche col difetto.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const USER_ID = "00000000-0000-0000-0000-0000000000f1";

const home = mkdtempSync(join(tmpdir(), "jht-file-index-home-"));
const userDir = mkdtempSync(join(tmpdir(), "jht-file-index-user-"));
// Letti dal poller quando il modulo si carica: vanno impostati prima dell'import.
process.env.JHT_HOME = home;
process.env.JHT_USER_DIR = userDir;

type Row = { user_id: string; name: string; location_on_vps: string | null };

let stored: Row[] = [];
let upserts: { rows: Row[]; onConflict: string }[] = [];
let deletes: { userId: unknown; names: string[] }[] = [];

function fakeAdmin() {
  return {
    from(table: string) {
      expect(table).toBe("candidate_files");
      let operation = "select";
      let upsertError: { code: string; message: string } | null = null;
      let userFilter: unknown = null;
      let inNames: string[] = [];
      const builder: Record<string, any> = {
        upsert(rows: Row[], options: { onConflict: string }) {
          operation = "upsert";
          upserts.push({ rows, onConflict: options.onConflict });
          const keys = options.onConflict.split(",");
          const seen = new Set<string>();
          for (const row of rows) {
            const key = JSON.stringify(keys.map((k) => (row as any)[k]));
            if (seen.has(key)) {
              upsertError = {
                code: "21000",
                message:
                  "ON CONFLICT DO UPDATE command cannot affect row a second time",
              };
              return builder;
            }
            seen.add(key);
          }
          for (const row of rows) {
            stored = stored.filter(
              (s) => !(s.user_id === row.user_id && s.name === row.name),
            );
            stored.push(row);
          }
          return builder;
        },
        select() {
          return builder;
        },
        delete() {
          operation = "delete";
          return builder;
        },
        eq(column: string, value: unknown) {
          if (column === "user_id") userFilter = value;
          return builder;
        },
        in(column: string, values: string[]) {
          if (column === "name") inNames = values;
          return builder;
        },
        then(ok: (value: any) => unknown, ko?: (error: unknown) => unknown) {
          let result: any = { data: null, error: null };
          if (operation === "upsert") {
            result = { data: null, error: upsertError };
          } else if (operation === "select") {
            result = {
              data: stored
                .filter((s) => s.user_id === userFilter)
                .map((s) => ({ name: s.name })),
              error: null,
            };
          } else if (operation === "delete") {
            deletes.push({ userId: userFilter, names: inNames });
            stored = stored.filter(
              (s) => !(s.user_id === userFilter && inNames.includes(s.name)),
            );
          }
          return Promise.resolve(result).then(ok, ko);
        },
      };
      return builder;
    },
  };
}

vi.mock("@/lib/cloud-sync/auth", () => ({
  verifyBearerToken: vi.fn(async () => ({
    ok: true,
    data: {
      userId: USER_ID,
      tokenId: "synthetic-token-id",
      admin: fakeAdmin(),
    },
  })),
}));

const { POST } = await import("@/app/api/cloud-sync/file-index/route");
const { buildIndex } = await import(
  "../../../cli/src/lib/file-bridge-poller.js"
);

function publish(files: unknown[]) {
  return POST(
    new Request("http://localhost/api/cloud-sync/file-index", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ files }),
    }) as any,
  );
}

beforeEach(() => {
  stored = [];
  upserts = [];
  deletes = [];
  rmSync(userDir, { recursive: true, force: true });
  mkdirSync(userDir, { recursive: true });
});

afterAll(() => {
  rmSync(home, { recursive: true, force: true });
  rmSync(userDir, { recursive: true, force: true });
});

describe("file-index route: same name in two folders", () => {
  // Rosso: in web/app/api/cloud-sync/file-index/route.ts sostituisci
  // `keepFirstEntryPerName(named)` con `named` (un box col poller vecchio).
  it("upserts one row per conflict key, the first folder wins, and the vanished file is still deleted", async () => {
    stored = [
      {
        user_id: USER_ID,
        name: "removed-from-disk.pdf",
        location_on_vps: "/synthetic/output/removed-from-disk.pdf",
      },
    ];

    const res = await publish([
      {
        name: "cv-example.pdf",
        category: "cv",
        location_on_vps: "/synthetic/cv/cv-example.pdf",
      },
      {
        name: "cover-letter-42.pdf",
        category: "other",
        location_on_vps: "/synthetic/output/cover-letter-42.pdf",
      },
      {
        name: "cv-example.pdf",
        category: "other",
        location_on_vps: "/synthetic/output/cv-example.pdf",
      },
    ]);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, indexed: 2 });

    expect(upserts).toHaveLength(1);
    const { rows, onConflict } = upserts[0];
    const keys = onConflict.split(",");
    const conflictKeys = rows.map((row) =>
      JSON.stringify(keys.map((k) => (row as any)[k])),
    );
    expect(new Set(conflictKeys).size).toBe(rows.length);
    expect(
      rows.find((row) => row.name === "cv-example.pdf")?.location_on_vps,
    ).toBe("/synthetic/cv/cv-example.pdf");

    expect(deletes).toEqual([
      { userId: USER_ID, names: ["removed-from-disk.pdf"] },
    ]);
    expect(stored.map((s) => s.name).sort()).toEqual([
      "cover-letter-42.pdf",
      "cv-example.pdf",
    ]);
  });
});

describe("file-bridge poller: buildIndex", () => {
  // Rosso: in cli/src/lib/file-bridge-poller.js togli la riga
  // `if (seenNames.has(e.name)) continue;` dentro buildIndex().
  it("sends one entry per name, the one in the folder the poller resolves first", async () => {
    mkdirSync(join(userDir, "cv"), { recursive: true });
    mkdirSync(join(userDir, "output"), { recursive: true });
    writeFileSync(join(userDir, "cv", "cv-example.pdf"), "synthetic cv copy");
    writeFileSync(
      join(userDir, "output", "cv-example.pdf"),
      "synthetic output copy, longer",
    );
    writeFileSync(
      join(userDir, "output", "cover-letter-42.pdf"),
      "synthetic letter",
    );

    const files = await buildIndex();

    expect(files.map((f: { name: string }) => f.name).sort()).toEqual([
      "cover-letter-42.pdf",
      "cv-example.pdf",
    ]);
    const cv = files.find(
      (f: { name: string }) => f.name === "cv-example.pdf",
    )!;
    expect(cv.category).toBe("cv");
    expect(cv.location_on_vps).toBe(join(userDir, "cv", "cv-example.pdf"));
    expect(cv.size).toBe("synthetic cv copy".length);

    // Il payload vero del poller passa dal finto cloud senza 21000.
    const res = await publish(files);
    expect(res.status).toBe(200);
  });
});
