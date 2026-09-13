import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";

// Una riga senza identità di ricevuta NON deve fermare il push delle altre.
// Fino a qui un solo `ReceiptKeyInvalid` abortiva l'intero convoglio — tutte
// le tabelle, a ogni giro, per sempre — e un `catch {}` lo riduceva a un
// messaggio generico che non diceva né la tabella né il campo. Sulla VPS di
// produzione: 32856 fallimenti consecutivi per due righe su 1182.
//
// La causa vera di quelle due righe erano turni nati nella chat web: il box li
// importa con `cloud_legacy_id` NEGATIVO e il full-push li rimandava con
// quell'id. Per contratto (mig 060) il full-push non manda le righe native del
// cloud: la merge RPC le scarta e il cloud ne ha già la versione vera.

const dirs: string[] = [];
let previousHome: string | undefined;

const WEB_TURN_ID = -1_755_000_000_000;

function fixture() {
  previousHome = process.env.JHT_HOME;
  const home = mkdtempSync(join(tmpdir(), "jht-invalid-identity-"));
  dirs.push(home);
  process.env.JHT_HOME = home;
  writeFileSync(
    join(home, "cloud.json"),
    JSON.stringify({
      enabled: true,
      base_url: "https://cloud.example.test",
      token: "jht_sync_synthetic-test-token",
    }),
  );
  const dbPath = join(home, "jobs.db");
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE scores (
      id INTEGER, position_id INTEGER, total_score INTEGER,
      experience_fit INTEGER, salary_fit INTEGER, stack_match INTEGER,
      remote_fit INTEGER, strategic_fit INTEGER, breakdown TEXT, notes TEXT,
      scored_by TEXT, scored_at TEXT, updated_at TEXT
    );
    INSERT INTO scores (id, position_id, total_score, updated_at) VALUES
      (1, 1, 70, '2026-08-13 10:00:00'),
      (NULL, 2, 71, '2026-08-13 10:01:00'),
      (3, 3, 72, '2026-08-13 10:02:00');

    CREATE TABLE position_state_transitions (
      id INTEGER PRIMARY KEY, position_id INTEGER, from_state TEXT,
      to_state TEXT, ts TEXT, by_agent TEXT, notes TEXT
    );
    INSERT INTO position_state_transitions
      (position_id, from_state, to_state, ts, by_agent) VALUES
      (1, 'new', 'scored', '2026-08-13 10:00:00', 'scorer'),
      (2, 'new', 'scored', '2026-08-13 10:01:00', ''),
      (3, 'new', 'scored', '2026-08-13 10:02:00', 'scorer');

    CREATE TABLE pending_user_messages (
      id INTEGER PRIMARY KEY, agent TEXT, body TEXT, kind TEXT,
      related_position_id INTEGER, delivered_via TEXT, delivered_at TEXT,
      acknowledged_at TEXT, user_reply TEXT, user_reply_at TEXT,
      agent_seen_reply_at TEXT, created_at TEXT, author TEXT, chat_ts REAL,
      cloud_legacy_id INTEGER
    );
    INSERT INTO pending_user_messages
      (id, agent, body, kind, author, created_at, chat_ts, delivered_via, cloud_legacy_id)
    VALUES
      (1, 'capitano', 'synthetic agent turn', 'notification', 'agent', '2026-08-13 10:00:00', NULL, NULL, NULL),
      (2, 'capitano', 'synthetic web turn', 'notification', 'user', '2026-08-13 10:01:00', 1755000000, 'web', ${WEB_TURN_ID});
  `);
  db.close();
  return { home, dbPath };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

type WireRow = Record<string, unknown> & { _receipt_id?: string };

function acknowledgingFetch(sent: Record<string, WireRow[]>) {
  return vi.fn(async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body || "{}"));
    const table = Object.keys(body)[0];
    const rows = (
      table === "profile" ? [body.profile] : body[table]
    ) as WireRow[];
    (sent[table] ||= []).push(...rows);
    return jsonResponse({
      receipts: { [table]: rows.map((row) => row._receipt_id) },
      [table]: { upserted: rows.length },
    });
  });
}

function captureErrors() {
  const lines: string[] = [];
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  });
  return lines;
}

function readCursor(home: string) {
  return JSON.parse(readFileSync(join(home, ".cloud-sync-cursor.json"), "utf8"));
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.doUnmock("../../../cli/src/lib/cloud-push-quarantine.js");
  vi.resetModules();
  process.exitCode = undefined;
  if (previousHome === undefined) delete process.env.JHT_HOME;
  else process.env.JHT_HOME = previousHome;
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

describe("cloud push — a row without identity does not stop the others", () => {
  it("delivers valid rows, excludes and names the bad ones, and sends them once fixed", async () => {
    const { home, dbPath } = fixture();
    const sent: Record<string, WireRow[]> = {};
    vi.stubGlobal("fetch", acknowledgingFetch(sent));
    const errors = captureErrors();
    vi.resetModules();
    const { handlePush } = await import("../../../cli/src/commands/cloud.js");

    await expect(handlePush({ db: dbPath })).resolves.toMatchObject({
      ok: true,
      invalidIdentity: 2,
    });

    expect(sent.scores?.map((row) => row.legacy_id)).toEqual([1, 3]);
    expect(sent.position_transitions?.map((row) => row.by_agent)).toEqual([
      "scorer",
      "scorer",
    ]);
    // Il turno nato sul web non viaggia: il cloud ne ha già la riga nativa.
    expect(sent.pending_user_messages?.map((row) => row.id)).toEqual([1]);

    const log = errors.join("\n");
    expect(log).toContain("scores.legacy_id");
    expect(log).toContain("position_transitions.by_agent");
    expect(log).not.toContain("synthetic");

    // Il cursore non scavalca la riga esclusa: resta sull'ultima prima di lei.
    expect(readCursor(home)).toMatchObject({
      scores: "2026-08-13 10:00:00",
      transitions: "2026-08-13 10:00:00",
    });

    // La riga corretta in locale riparte al giro dopo, senza --full.
    const db = new DatabaseSync(dbPath);
    db.exec(`
      UPDATE scores SET id = 2 WHERE id IS NULL;
      UPDATE position_state_transitions SET by_agent = 'analista' WHERE by_agent = '';
    `);
    db.close();
    for (const table of Object.keys(sent)) delete sent[table];

    await expect(handlePush({ db: dbPath })).resolves.toMatchObject({
      ok: true,
      invalidIdentity: 0,
    });
    expect(sent.scores?.map((row) => row.legacy_id)).toEqual([2, 3]);
    expect(sent.position_transitions?.map((row) => row.by_agent)).toEqual([
      "analista",
      "scorer",
    ]);
    expect(readCursor(home)).toMatchObject({
      scores: "2026-08-13 10:02:00",
      transitions: "2026-08-13 10:02:00",
    });
  });

  it("keeps a non-identity failure a failure, with the real error in the log", async () => {
    const { home, dbPath } = fixture();
    // Solo righe valide: il fallimento deve venire dal lock, non dall'identità.
    const db = new DatabaseSync(dbPath);
    db.exec(`
      DELETE FROM scores WHERE id IS NULL;
      DELETE FROM position_state_transitions WHERE by_agent = '';
      DELETE FROM pending_user_messages WHERE cloud_legacy_id IS NOT NULL;
    `);
    db.close();
    // Un lock fresco della quarantena: la persistenza dell'ACK scade dopo 2s.
    writeFileSync(join(home, ".cloud-push-quarantine.json.lock"), "");
    vi.stubGlobal("fetch", acknowledgingFetch({}));
    const errors = captureErrors();
    vi.resetModules();
    const { handlePush } = await import("../../../cli/src/commands/cloud.js");

    await expect(handlePush({ db: dbPath })).resolves.toMatchObject({
      ok: false,
    });
    expect(errors.join("\n")).toContain("cloud push quarantine lock timeout");
    expect(existsSync(join(home, ".cloud-sync-cursor.json"))).toBe(false);
  }, 15_000);

  it("reports the real error when partitioning fails for a reason other than identity", async () => {
    const { dbPath } = fixture();
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const errors = captureErrors();
    vi.resetModules();
    vi.doMock(
      "../../../cli/src/lib/cloud-push-quarantine.js",
      async (importOriginal) => ({
        ...(await importOriginal<object>()),
        partitionQuarantinedRows: () => {
          throw new Error("synthetic partition failure");
        },
      }),
    );
    const { handlePush } = await import("../../../cli/src/commands/cloud.js");

    await expect(handlePush({ db: dbPath })).resolves.toMatchObject({
      ok: false,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(errors.join("\n")).toContain("synthetic partition failure");
  });
});
