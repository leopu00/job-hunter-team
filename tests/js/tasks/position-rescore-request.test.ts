import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import {
  activeRescoreTicket,
  RESCORE_TICKET_KIND,
} from "../../../web/lib/rescore-ticket";
import type { PositionTicket } from "../../../web/lib/types";

const repo = join(__dirname, "../../..");
const requireFromWeb = createRequire(join(repo, "web/package.json"));
const Database = requireFromWeb("better-sqlite3");
const home = mkdtempSync(join(tmpdir(), "jht-rescore-ticket-"));
process.env.JHT_HOME = home;

const db = new Database(join(home, "jobs.db"));
db.exec(`
  CREATE TABLE positions (id INTEGER PRIMARY KEY, title TEXT, company TEXT, status TEXT NOT NULL DEFAULT 'new');
  CREATE TABLE position_tickets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    position_id INTEGER NOT NULL,
    request_text TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'custom',
    status TEXT NOT NULL DEFAULT 'open',
    assigned_agent TEXT,
    response_text TEXT,
    cloud_id INTEGER,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    assigned_at TEXT,
    resolved_at TEXT,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE UNIQUE INDEX idx_position_tickets_active_rescore
    ON position_tickets(position_id, kind)
    WHERE kind = 'rescore' AND status IN ('open', 'assigned');
  INSERT INTO positions (id, title, company) VALUES (643, 'Role', 'Company');
`);

vi.mock("@/lib/auth", () => ({ requireAuth: vi.fn(async () => null) }));
vi.mock("@/lib/team-state/auth", () => ({
  resolveUser: vi.fn(() => {
    throw new Error("il path cloud non deve essere chiamato nel test locale");
  }),
}));
vi.mock("@/lib/local-token", () => ({
  LOCAL_TOKEN_COOKIE: "jht_local_token",
  isLocalTokenAuthenticated: vi.fn(() => false),
}));
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: vi.fn() })),
}));

const { POST } = await import("@/app/api/positions/[legacyId]/ticket/route");

function request(kind = RESCORE_TICKET_KIND) {
  return POST(
    new Request("http://localhost/api/positions/643/ticket", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind,
        request_text: "Re-evaluate this position with the Scorer.",
      }),
    }) as never,
    { params: Promise.resolve({ legacyId: "643" }) },
  );
}

function ticketRows() {
  return db
    .prepare("SELECT id, kind, status FROM position_tickets ORDER BY id ASC")
    .all() as Array<{ id: number; kind: string; status: string }>;
}

beforeEach(() => {
  db.exec("DELETE FROM position_tickets");
});

afterAll(() => {
  db.close();
  rmSync(home, { recursive: true, force: true });
});

describe("richiesta di rivalutazione tramite position_tickets", () => {
  it("crea un ticket rescore open sulla pipeline esistente", async () => {
    const res = await request();

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      status: "open",
      deduplicated: false,
      source: "local",
    });
    expect(ticketRows()).toEqual([{ id: 1, kind: "rescore", status: "open" }]);
  });

  it("deduplica sia open sia assigned restituendo l'identita' gia' attiva", async () => {
    const first = await request();
    const firstBody = await first.json();
    db.prepare(
      "UPDATE position_tickets SET status = 'assigned' WHERE id = ?",
    ).run(Number(firstBody.id));

    const duplicate = await request();
    expect(duplicate.status).toBe(200);
    await expect(duplicate.json()).resolves.toMatchObject({
      id: firstBody.id,
      status: "assigned",
      deduplicated: true,
    });
    expect(ticketRows()).toHaveLength(1);
  });

  it("dopo resolved consente una nuova rivalutazione senza cancellare la storia", async () => {
    const first = await request();
    const firstBody = await first.json();
    db.prepare(
      "UPDATE position_tickets SET status = 'resolved' WHERE id = ?",
    ).run(Number(firstBody.id));

    const next = await request();
    await expect(next.json()).resolves.toMatchObject({
      status: "open",
      deduplicated: false,
    });
    expect(ticketRows().map(({ status }) => status)).toEqual([
      "resolved",
      "open",
    ]);
  });

  it("non applica il dedup specializzato ai ticket custom", async () => {
    await request("custom");
    await request("custom");
    expect(ticketRows()).toHaveLength(2);
  });
});

describe("stato e wiring della quarta azione", () => {
  const ticket = (overrides: Partial<PositionTicket>): PositionTicket => ({
    id: "1",
    position_id: "643",
    request_text: "request",
    kind: RESCORE_TICKET_KIND,
    status: "open",
    assigned_agent: null,
    response_text: null,
    created_at: null,
    resolved_at: null,
    ...overrides,
  });

  it("considera attivi solo rescore open/assigned, mai i resolved", () => {
    expect(activeRescoreTicket([ticket({ status: "open" })])?.status).toBe(
      "open",
    );
    expect(activeRescoreTicket([ticket({ status: "assigned" })])?.status).toBe(
      "assigned",
    );
    expect(activeRescoreTicket([ticket({ status: "resolved" })])).toBeNull();
    expect(
      activeRescoreTicket([ticket({ kind: "custom", status: "open" })]),
    ).toBeNull();
  });

  it("collega pagina, bottone, route, sync e Capitano allo stesso kind", () => {
    const page = readFileSync(
      join(repo, "web/app/(protected)/positions/[id]/page.tsx"),
      "utf8",
    );
    const button = readFileSync(
      join(repo, "web/app/(protected)/positions/[id]/RescoreRequestButton.tsx"),
      "utf8",
    );
    const route = readFileSync(
      join(repo, "web/app/api/positions/[legacyId]/ticket/route.ts"),
      "utf8",
    );
    const cloudSync = readFileSync(
      join(repo, "web/app/api/cloud-sync/tickets/route.ts"),
      "utf8",
    );
    const cliSync = readFileSync(
      join(repo, "cli/src/commands/cloud.js"),
      "utf8",
    );

    expect(page).toContain("<RescoreRequestButton");
    expect(page).toContain("activeRescoreTicket(tickets)");
    expect(button).toContain("kind: RESCORE_TICKET_KIND");
    expect(button).toContain('body.status !== "open"');
    expect(route).toContain("BEGIN IMMEDIATE");
    expect(route).toContain('rpc("create_position_ticket"');
    expect(cloudSync).toContain('rpc("sync_create_position_ticket"');
    expect(cliSync).toContain("findActiveRescore");

    for (const suffix of ["", ".it", ".es", ".fr", ".de", ".hu", ".pt"]) {
      const prompt = readFileSync(
        join(repo, `agents/capitano/capitano${suffix}.md`),
        "utf8",
      );
      expect(prompt).toContain("[RESCORE-TICKET]");
      expect(prompt).toContain("--action rescore");
      expect(prompt).toContain("scores.scored_at");
    }
  });
});
