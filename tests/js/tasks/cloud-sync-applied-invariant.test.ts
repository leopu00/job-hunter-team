import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
// La funzione del CLIENT, non una sua copia: e' l'altra meta' del seam che in
// #163 si e' rotto, e un test che ricalcola l'id per conto suo non lo vede.
import { quarantineIdentity } from "../../../cli/src/lib/cloud-push-quarantine.js";

type Call = {
  kind: "upsert" | "rpc";
  table?: string;
  payload?: any;
  options?: any;
  name?: string;
  args?: any;
};

let calls: Call[] = [];
// Every query the route builds, with the filters it puts on it, in order: a
// read the fake answers without looking at its filters would stay green with
// the tenant filter removed from the route.
type Query = {
  table: string;
  operation: string;
  filters: { method: string; column: string; value: unknown }[];
};
let queries: Query[] = [];
let rpcError: string | { code: string; message: string } | null = null;
let upsertError: { code: string; message: string } | null = null;
let applicationReceipts: unknown[] | null = null;
let selectedPositions: { id: string; legacy_id: number }[] = [];
let scorePersistedParents: string[] | null = null;
let scorePersistedLegacyOverride: number | null = null;
let pendingPersistedRows: any[] = [];
let pendingRpcCountOverride: number | null = null;
// Cosa il cloud RESTITUISCE quando la route rilegge le righe per verificarle.
// Di default e' quello che la RPC ha ricevuto — cioe' la riga c'e' ed e'
// identica; i test di #163 lo sostituiscono per fare mancare una riga o per
// farla tornare diversa.
let pendingPersistedOverride: ((rows: any[]) => any[]) | null = null;
// I `position_legacy_id` che il finto cloud NON restituisce dopo l'upsert.
let transitionsMissing: number[] = [];
// The applications the fake cloud already holds, as the route reads them back
// for a position that came applied without its application.
let cloudApplications: any[] | null = null;

/** La resa di un `timestamptz` da parte di PostgREST: `2026-08-16T18:24:28+00:00`. */
function postgrestInstant(value: string) {
  const naive = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(
    value,
  );
  const ms = Date.parse(naive ? `${value.replace(" ", "T")}Z` : value);
  return new Date(ms).toISOString().replace("Z", "+00:00");
}
let profileRpcData: unknown = { changed: true };
// La candidatura che il cloud oppone a un downgrade: `maybeSingle()` la
// restituisce come farebbe la SELECT con la join sulle applications.
let stalePositionRow: unknown = null;

function fakeAdmin() {
  return {
    from(table: string) {
      let operation = "select";
      let writtenPayload: any = null;
      const equalFilters = new Map<string, unknown>();
      const inFilters = new Map<string, unknown[]>();
      const query: Query = { table, operation, filters: [] };
      queries.push(query);
      const builder: Record<string, any> = {
        select() {
          return builder;
        },
        eq(column: string, value: unknown) {
          equalFilters.set(column, value);
          query.filters.push({ method: "eq", column, value });
          return builder;
        },
        is(column: string, value: unknown) {
          query.filters.push({ method: "is", column, value });
          return builder;
        },
        in(column: string, values: unknown[]) {
          inFilters.set(column, values);
          query.filters.push({ method: "in", column, value: values });
          return builder;
        },
        update() {
          operation = "update";
          query.operation = operation;
          return builder;
        },
        upsert(payload: any, options: any) {
          operation = "upsert";
          query.operation = operation;
          writtenPayload = payload;
          calls.push({ kind: "upsert", table, payload, options });
          return builder;
        },
        maybeSingle() {
          return Promise.resolve({
            data:
              operation === "select" && table === "positions"
                ? stalePositionRow
                : null,
            error: null,
          });
        },
        then(ok: (value: any) => unknown, ko?: (error: unknown) => unknown) {
          const data =
            operation === "upsert" && table === "positions"
              ? [{ id: "position-uuid-73", legacy_id: 73 }]
              : operation === "upsert" && table === "companies"
                ? writtenPayload.map((row: any) => ({
                    id: `company-uuid-${row.legacy_id}`,
                    legacy_id: row.legacy_id,
                  }))
                : operation === "upsert" && table === "scores"
                  ? (
                      scorePersistedParents ??
                      writtenPayload.map((row: any) => row.position_id)
                    ).map((position_id: string) => ({
                      position_id,
                      legacy_id:
                        scorePersistedLegacyOverride ??
                        writtenPayload.find(
                          (row: any) => row.position_id === position_id,
                        )?.legacy_id,
                    }))
                  : operation === "upsert" && table === "applications"
                    ? [{ id: "application-uuid-73" }]
                    : operation === "upsert" && table === "position_highlights"
                      ? writtenPayload.map((row: any) => ({
                          legacy_id: row.legacy_id,
                        }))
                      : operation === "upsert" &&
                          table === "position_transitions"
                        ? writtenPayload
                            .filter(
                              (row: any) =>
                                !transitionsMissing.includes(
                                  row.position_legacy_id,
                                ),
                            )
                            .map((row: any) => ({
                              position_legacy_id: row.position_legacy_id,
                              // Come rende un timestamptz il driver, non come
                              // gliel'abbiamo passato: e' la differenza che ha
                              // fermato 271 transizioni (#163), e un finto
                              // database che restituisce la stringa in
                              // ingresso non l'avrebbe mai fatta vedere.
                              ts: postgrestInstant(row.ts),
                              by_agent: row.by_agent,
                              to_state: row.to_state,
                              from_state: row.from_state ?? null,
                              notes: row.notes ?? null,
                            }))
                        : operation === "update" && table === "positions"
                          ? [{ legacy_id: equalFilters.get("legacy_id") }]
                          : operation === "update" &&
                              (table === "scores" || table === "applications")
                            ? [{ position_id: equalFilters.get("position_id") }]
                            : operation === "select" &&
                                table === "pending_user_messages"
                              ? pendingPersistedRows.filter((row) =>
                                  (inFilters.get("legacy_id") ?? []).includes(
                                    row.legacy_id,
                                  ),
                                )
                              : operation === "select" && table === "positions"
                                ? selectedPositions
                                : operation === "select" &&
                                    table === "applications"
                                  ? // What the filters let through, as
                                    // PostgREST would: a row of another
                                    // user comes back only if the route
                                    // forgets to ask for its own.
                                    (cloudApplications?.filter((row) =>
                                      query.filters.every((filter) =>
                                        filter.method === "eq"
                                          ? row[filter.column] === filter.value
                                          : filter.method === "in"
                                            ? (
                                                filter.value as unknown[]
                                              ).includes(row[filter.column])
                                            : true,
                                      ),
                                    ) ?? null)
                                  : null;
          return Promise.resolve({
            data: upsertError ? null : data,
            error: operation === "upsert" ? upsertError : null,
          }).then(ok, ko);
        },
      };
      return builder;
    },
    rpc: vi.fn(async (name: string, args: any) => {
      calls.push({ kind: "rpc", name, args });
      if (rpcError) {
        return {
          data: null,
          error:
            typeof rpcError === "string" ? { message: rpcError } : rpcError,
        };
      }
      if (name === "sync_upsert_applications") {
        return {
          data:
            applicationReceipts ??
            args.p_applications.map(
              (application: any) => application._receipt_id,
            ),
          error: null,
        };
      }
      if (name === "upsert_pending_user_messages_merge") {
        pendingPersistedRows = args.p_rows.map((row: any) => ({ ...row }));
        if (pendingPersistedOverride) {
          pendingPersistedRows = pendingPersistedOverride(pendingPersistedRows);
        }
        return {
          data: pendingRpcCountOverride ?? args.p_rows.length,
          error: null,
        };
      }
      if (name === "sync_candidate_profile_atomic") {
        return { data: profileRpcData, error: null };
      }
      return { data: 1, error: null };
    }),
  };
}

let admin = fakeAdmin();

vi.mock("@/lib/workspace", () => ({ isSupabaseConfigured: true }));
vi.mock("@/lib/cloud-sync/auth", () => ({
  verifyBearerToken: vi.fn(async () => ({
    ok: true,
    data: {
      userId: "00000000-0000-0000-0000-000000000073",
      tokenId: "synthetic-token-id",
      admin,
    },
  })),
}));
vi.mock("@/lib/cloud-sync/rate-limit", () => ({
  checkCloudSyncRateLimit: vi.fn(async () => ({
    allowed: true,
    retryAfterSec: 0,
  })),
}));
vi.mock("@/lib/cloud-sync/onboarding-milestones", () => ({
  teamProducedWork: vi.fn(() => false),
  firstTeamRunPatch: vi.fn(() => null),
}));
vi.mock("@/lib/team-state/sync-freshness", () => ({
  syncRequestIsPending: vi.fn(() => false),
}));

const { POST } = await import("@/app/api/cloud-sync/push/route");

function receiptId(table: string, sourceKey: unknown | unknown[]) {
  const key = Array.isArray(sourceKey) ? sourceKey : [sourceKey];
  return `q_${createHash("sha256")
    .update(`${table}\0${JSON.stringify(key)}`)
    .digest("hex")
    .slice(0, 24)}`;
}

function push(application: Record<string, unknown>, includePosition = true) {
  return POST(
    new Request("http://localhost/api/cloud-sync/push", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        positions: includePosition
          ? [
              {
                id: 73,
                title: "Synthetic role",
                company: "Example",
                status: "applied",
              },
            ]
          : [],
        applications: [
          { legacy_id: 193, position_legacy_id: 73, ...application },
        ],
      }),
    }) as any,
  );
}

function pushBody(body: Record<string, unknown>) {
  return POST(
    new Request("http://localhost/api/cloud-sync/push", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }) as any,
  );
}

beforeEach(() => {
  calls = [];
  queries = [];
  rpcError = null;
  upsertError = null;
  stalePositionRow = null;
  applicationReceipts = null;
  selectedPositions = [{ id: "position-uuid-73", legacy_id: 73 }];
  scorePersistedParents = null;
  scorePersistedLegacyOverride = null;
  pendingPersistedRows = [];
  pendingRpcCountOverride = null;
  pendingPersistedOverride = null;
  transitionsMissing = [];
  cloudApplications = null;
  profileRpcData = { changed: true };
  admin = fakeAdmin();
});

describe("push sync di una candidatura", () => {
  it("acka il profilo solo dopo la RPC atomica e rende visibile il no-op", async () => {
    const profileReceipt = receiptId("profile", "candidate_profile");
    const first = await pushBody({
      profile: {
        yaml: "name: Synthetic candidate\ntarget_role: Engineer\n",
        summaries: {},
        _receipt_id: profileReceipt,
      },
    });
    expect(first.status).toBe(200);
    await expect(first.json()).resolves.toMatchObject({
      profile: { upserted: true, error: null },
      receipts: { profile: [profileReceipt] },
    });
    expect(calls).toContainEqual(
      expect.objectContaining({
        kind: "rpc",
        name: "sync_candidate_profile_atomic",
        args: expect.objectContaining({ p_force: false }),
      }),
    );
    expect(
      calls.some(
        (call) =>
          call.kind === "upsert" && String(call.table).startsWith("candidate_"),
      ),
    ).toBe(false);

    calls = [];
    profileRpcData = { changed: false };
    const repeated = await pushBody({
      profile: {
        yaml: "name: Synthetic candidate\ntarget_role: Engineer\n",
        summaries: {},
        _receipt_id: profileReceipt,
      },
    });
    expect(repeated.status).toBe(200);
    await expect(repeated.json()).resolves.toMatchObject({
      profile: { upserted: false, error: null },
      receipts: { profile: [profileReceipt] },
    });

    calls = [];
    profileRpcData = { changed: true };
    const forced = await pushBody({
      profile: {
        yaml: "name: Synthetic candidate\ntarget_role: Engineer\n",
        summaries: {},
        force: true,
        _receipt_id: profileReceipt,
      },
    });
    expect(forced.status).toBe(200);
    expect(calls).toContainEqual(
      expect.objectContaining({
        kind: "rpc",
        name: "sync_candidate_profile_atomic",
        args: expect.objectContaining({ p_force: true }),
      }),
    );
  });

  it("non emette la receipt se la RPC non attesta changed", async () => {
    profileRpcData = null;
    const response = await pushBody({
      profile: {
        yaml: "name: Synthetic candidate\ntarget_role: Engineer\n",
        _receipt_id: receiptId("profile", "candidate_profile"),
      },
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      profile: { upserted: false, error: "profile_sync_result_invalid" },
      receipts: { profile: [] },
    });
  });

  it("preserva il tipo richiesta cloud quando un client legacy non lo invia", async () => {
    const legacy = await pushBody({
      positions: [
        {
          id: 73,
          title: "Synthetic role",
          company: "Example",
          status: "ready",
          write_requested: 1,
        },
      ],
    });
    expect(legacy.status).toBe(200);
    const legacyWrite = calls.find(
      (call) => call.kind === "upsert" && call.table === "positions",
    );
    expect(legacyWrite?.payload[0]).not.toHaveProperty("write_request_kind");
    expect(legacyWrite?.options).toMatchObject({ defaultToNull: false });

    calls = [];
    const modernResolution = await pushBody({
      positions: [
        {
          id: 73,
          title: "Synthetic role",
          company: "Example",
          status: "ready",
          write_requested: 0,
          write_request_kind: null,
        },
      ],
    });
    expect(modernResolution.status).toBe(200);
    const modernWrite = calls.find(
      (call) => call.kind === "upsert" && call.table === "positions",
    );
    expect(modernWrite?.payload[0]).toHaveProperty("write_request_kind", null);
  });

  it("classifica solo SQLSTATE row-data come rifiuto isolabile", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    upsertError = { code: "22P02", message: "synthetic invalid data" };
    admin = fakeAdmin();
    const rowData = await pushBody({
      positions: [{ id: 73, title: "Synthetic", company: "Example" }],
    });
    expect(rowData.status).toBe(500);
    await expect(rowData.json()).resolves.toMatchObject({
      error: "positions_upsert_failed",
      rejection_scope: "row",
    });
    expect(logged.mock.calls.flat().join(" ")).not.toContain(
      "synthetic invalid data",
    );

    calls = [];
    upsertError = { code: "42P01", message: "synthetic schema failure" };
    admin = fakeAdmin();
    const schema = await pushBody({
      positions: [{ id: 73, title: "Synthetic", company: "Example" }],
    });
    expect(schema.status).toBe(500);
    await expect(schema.json()).resolves.not.toHaveProperty("rejection_scope");
  });

  it("emette receipt causali per ogni tabella del convoglio", async () => {
    const deletedAt = "2026-08-13T10:00:00.000Z";
    const transitionAt = "2026-08-13T10:01:00.000Z";
    const response = await pushBody({
      companies: [{ id: 5, name: "Synthetic company" }],
      positions: [
        { id: 73, title: "Synthetic", company: "Example", company_id: 5 },
      ],
      position_highlights: [
        { id: 9, position_id: 73, type: "pro", text: "Synthetic benefit" },
      ],
      pending_user_messages: [
        { id: 11, agent: "SCOUT", body: "Synthetic notification" },
      ],
      position_transitions: [
        {
          position_legacy_id: 73,
          ts: transitionAt,
          by_agent: "SCOUT",
          to_state: "review",
        },
      ],
      tombstones: [
        { table_name: "positions", legacy_id: 73, deleted_at: deletedAt },
      ],
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      receipts: {
        companies: [receiptId("companies", 5)],
        positions: [receiptId("positions", 73)],
        position_highlights: [receiptId("position_highlights", 9)],
        pending_user_messages: [receiptId("pending_user_messages", 11)],
        position_transitions: [
          receiptId("position_transitions", [
            73,
            transitionAt,
            "SCOUT",
            "review",
          ]),
        ],
        tombstones: [receiptId("tombstones", ["positions", 73, deletedAt])],
      },
    });
  });

  /**
   * #163 — il push si fermava su 334 messaggi con `acknowledgement_mismatch`.
   *
   * La RPC di merge salta i no-op DI PROPOSITO (mig 060), quindi a regime
   * ritorna meno righe del payload su righe che sul cloud ci sono, identiche.
   * Le ricevute erano legate a quel numero: non ne usciva NESSUNA, e il push
   * falliva per sempre — anche bisezionando fino al singleton.
   *
   * ⚠️ La proprieta' che il test di prima difendeva («un count parziale non
   * diventa una ricevuta») resta, ma va detta sul fatto giusto: la ricevuta
   * non la autorizza il CONTEGGIO delle scritture, la autorizza la PROVA che
   * la riga e' sul cloud identica a quella mandata. Per questo i tre casi
   * stanno insieme: senza il secondo e il terzo, il primo sarebbe
   * indistinguibile da un ACK compiacente.
   */
  it("emette receipt per la riga verificata anche se la RPC non l'ha riscritta", async () => {
    pendingRpcCountOverride = 1;
    const response = await pushBody({
      pending_user_messages: [
        { id: 11, agent: "SCOUT", body: "Synthetic first" },
        { id: 12, agent: "SCOUT", body: "Synthetic second" },
      ],
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      receipts: {
        pending_user_messages: [
          quarantineIdentity("pending_user_messages", { id: 11 }),
          quarantineIdentity("pending_user_messages", { id: 12 }),
        ],
      },
    });
  });

  it("nega la receipt alla riga che dal cloud non torna affatto", async () => {
    pendingPersistedOverride = (rows) =>
      rows.filter((row) => row.legacy_id !== 12);
    const response = await pushBody({
      pending_user_messages: [
        { id: 11, agent: "SCOUT", body: "Synthetic first" },
        { id: 12, agent: "SCOUT", body: "Synthetic second" },
      ],
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      receipts: {
        pending_user_messages: [receiptId("pending_user_messages", 11)],
      },
    });
  });

  /**
   * #163, la parte che il fix di ieri non copre — e che rende la condizione
   * IMPOSSIBILE per costruzione, non «a volte sfortunata».
   *
   * `upsert_pending_user_messages_merge` è asimmetrica DI PROPOSITO (mig 057
   * e 060): sui campi che il cloud sa e il box no —  `delivered_via`,
   * `delivered_at`, `chat_ts`, `related_position_id`, `agent_seen_reply_at` —
   * fa `COALESCE(EXCLUDED.x, pending.x)`, cioè NON accetta il NULL del box.
   * È la scelta giusta: il postino che consegna sul web timbra là, e il box
   * quel timbro non ce l'ha.
   *
   * Ma la ricevuta rilegge la riga e pretende che TUTTI quei campi siano
   * uguali a quelli mandati. Su una riga consegnata dal web il confronto è
   * falso per costruzione, la ricevuta non esce mai, e il CLIENT si fabbrica
   * un 422 da un 200 del server: 4305 fallimenti consecutivi, le stesse righe
   * rispedite ogni 60 secondi, checkpoint fermo per sempre.
   *
   * Misurato sul cloud il 17/08, in aggregato: 698 righe, 698 con
   * `delivered_via` valorizzato, 686 con `delivered_at`.
   *
   * La ricevuta deve attestare ciò che il client può attestare — la SUA riga
   * è arrivata e persiste — non che il cloud non sappia niente di più.
   */
  it("emette receipt anche se il cloud sa più del box su quella riga", async () => {
    pendingPersistedOverride = (rows) =>
      rows.map((row) => ({
        ...row,
        delivered_via: "telegram",
        delivered_at: "2026-08-17T20:44:09+00:00",
      }));
    const response = await pushBody({
      pending_user_messages: [
        { id: 11, agent: "SCOUT", body: "Synthetic first" },
        { id: 12, agent: "SCOUT", body: "Synthetic second" },
      ],
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      receipts: {
        pending_user_messages: [
          receiptId("pending_user_messages", 11),
          receiptId("pending_user_messages", 12),
        ],
      },
    });
  });

  /**
   * La causa che teneva ferma la coda OGGI, misurata da HQ-VPS sulla macchina
   * e riprodotta qui: `chat_ts` è `double precision` e PostgREST legge con
   * `extra_float_digits = 0`, quindi il cloud rende quindici cifre
   * significative. `1786999449.694782` torna `1786999449.69478`, e non è lo
   * stesso double. Sul campo: 14 righe su 20 campionate, 223 su 384 nella
   * popolazione a rischio.
   */
  it("emette receipt quando il cloud rende chat_ts con meno cifre", async () => {
    pendingPersistedOverride = (rows) =>
      rows.map((row) => ({ ...row, chat_ts: 1786999449.69478 }));
    const response = await pushBody({
      pending_user_messages: [
        {
          id: 11,
          agent: "SCOUT",
          body: "Synthetic first",
          chat_ts: 1786999449.694782,
        },
      ],
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      receipts: {
        pending_user_messages: [receiptId("pending_user_messages", 11)],
      },
    });
  });

  /**
   * I tre controlli negativi che tengono onesto il fix appena fatto: allargare
   * un confronto è pericoloso proprio perché fa passare tutto, e una ricevuta
   * compiacente è peggio di nessuna ricevuta — il push direbbe «arrivata» a
   * una riga che sul cloud non c'è o è un'altra.
   */
  it("nega la receipt se chat_ts è un altro istante, non un'altra resa", async () => {
    pendingPersistedOverride = (rows) =>
      rows.map((row) => ({ ...row, chat_ts: 1786999450.694782 }));
    const response = await pushBody({
      pending_user_messages: [
        {
          id: 11,
          agent: "SCOUT",
          body: "Synthetic first",
          chat_ts: 1786999449.694782,
        },
      ],
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      receipts: { pending_user_messages: [] },
    });
  });

  it("nega la receipt se il cloud contraddice un valore che il client ha mandato", async () => {
    pendingPersistedOverride = (rows) =>
      rows.map((row) => ({ ...row, delivered_via: "web" }));
    const response = await pushBody({
      pending_user_messages: [
        {
          id: 11,
          agent: "SCOUT",
          body: "Synthetic first",
          delivered_via: "telegram",
        },
      ],
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      receipts: { pending_user_messages: [] },
    });
  });

  it("nega la receipt se l'autore sul cloud non è né il suo né l'utente", async () => {
    pendingPersistedOverride = (rows) =>
      rows.map((row) => ({ ...row, author: "sconosciuto" }));
    const response = await pushBody({
      pending_user_messages: [
        { id: 11, agent: "SCOUT", body: "Synthetic first" },
      ],
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      receipts: { pending_user_messages: [] },
    });
  });

  /**
   * L'indizio di HQ-VPS, chiuso per misura: il cloud ha 11 righe in più del
   * box, nate sul web. Se il server emettesse ricevute anche per quelle, il
   * multiset non combacerebbe MAI — sarebbe un difetto diverso, con un fix
   * diverso. Non è così: la rilettura filtra sui `legacy_id` che il client ha
   * mandato, quindi le righe altrui non entrano né fra le ricevute né nel
   * confronto.
   */
  it("le righe che il client non ha mandato non entrano nelle ricevute", async () => {
    pendingPersistedOverride = (rows) => [
      ...rows,
      {
        legacy_id: 900,
        agent: "ASSISTENTE",
        body: "Synthetic nata sul web",
        kind: "notification",
        author: "user",
        chat_ts: null,
        related_position_id: null,
        delivered_via: "web",
        delivered_at: null,
        agent_seen_reply_at: null,
      },
    ];
    const response = await pushBody({
      pending_user_messages: [
        { id: 11, agent: "SCOUT", body: "Synthetic first" },
      ],
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      receipts: {
        pending_user_messages: [receiptId("pending_user_messages", 11)],
      },
    });
  });

  it("nega la receipt alla riga che torna diversa da quella mandata", async () => {
    pendingPersistedOverride = (rows) =>
      rows.map((row) =>
        row.legacy_id === 12 ? { ...row, body: "Altro testo" } : row,
      );
    const response = await pushBody({
      pending_user_messages: [
        { id: 11, agent: "SCOUT", body: "Synthetic first" },
        { id: 12, agent: "SCOUT", body: "Synthetic second" },
      ],
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      receipts: {
        pending_user_messages: [receiptId("pending_user_messages", 11)],
      },
    });
  });

  /**
   * #163, l'altra meta': 271 transizioni ferme per il FORMATO di una data.
   *
   * SQLite scrive `2026-08-16 18:24:28` con CURRENT_TIMESTAMP, il cloud rende
   * lo stesso istante come `2026-08-16T18:24:28+00:00`. La ricevuta si
   * derivava da come lo rendeva il driver, quindi non coincideva MAI con
   * quella del client — che e' il vero motivo per cui riprovare non serviva a
   * niente.
   */
  it("la receipt di una transizione parla la lingua del client, non del driver", async () => {
    const sqliteTs = "2026-08-16 18:24:28";
    const response = await pushBody({
      positions: [{ id: 73, title: "Synthetic", company: "Example" }],
      position_transitions: [
        {
          position_legacy_id: 73,
          ts: sqliteTs,
          by_agent: "SCOUT",
          to_state: "review",
        },
      ],
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      receipts: {
        position_transitions: [
          quarantineIdentity("position_transitions", {
            position_legacy_id: 73,
            ts: sqliteTs,
            by_agent: "SCOUT",
            to_state: "review",
          }),
        ],
      },
    });
  });

  it("nega la receipt alla transizione che dal cloud non torna", async () => {
    transitionsMissing = [73];
    const response = await pushBody({
      positions: [{ id: 73, title: "Synthetic", company: "Example" }],
      position_transitions: [
        {
          position_legacy_id: 73,
          ts: "2026-08-16 18:24:28",
          by_agent: "SCOUT",
          to_state: "review",
        },
      ],
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      receipts: { position_transitions: [] },
    });
  });

  /**
   * O-97 — il rifiuto che insegna, invece di dire soltanto no.
   *
   * Il trigger `reject_stale_applied_position_downgrade` rifiuta di riportare
   * indietro una posizione che sul cloud ha una candidatura vera: il box ha una
   * fotografia più vecchia perché l'utente si è candidato dal sito. Senza la
   * fotografia nella risposta il box può solo riprovare identico, e il push
   * sbatte sullo stesso trigger a ogni tick.
   */
  it("la posizione rifiutata torna con la candidatura che il cloud conosce", async () => {
    upsertError = { code: "P0001", message: "stale_position_downgrade" };
    stalePositionRow = {
      legacy_id: 73,
      applications: {
        applied: true,
        applied_at: "2026-08-16T09:30:00+00:00",
        applied_via: "user_manual",
      },
    };

    const response = await pushBody({
      positions: [{ id: 73, title: "Synthetic", company: "Example" }],
    });

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "positions_upsert_failed",
      rejection_scope: "row",
      stale_position: {
        legacy_id: 73,
        applied: true,
        applied_at: "2026-08-16T09:30:00+00:00",
        applied_via: "user_manual",
      },
    });
  });

  it("con più righe nel batch la fotografia non c'è: quale sia la colpevole non si sa", async () => {
    /**
     * Il costo di indovinare sarebbe una riga corretta con i dati di un'altra.
     * La colpevole la trova la bisezione del client, che arriva sempre a una
     * riga sola — e allora la fotografia c'è.
     */
    upsertError = { code: "P0001", message: "stale_position_downgrade" };
    stalePositionRow = {
      legacy_id: 73,
      applications: {
        applied: true,
        applied_at: "x",
        applied_via: "user_manual",
      },
    };

    const response = await pushBody({
      positions: [
        { id: 73, title: "Synthetic", company: "Example" },
        { id: 74, title: "Synthetic two", company: "Example" },
      ],
    });

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).not.toHaveProperty("stale_position");
    // Resta comunque isolabile: è la voce nell'allow-list a dirlo.
    expect(body.rejection_scope).toBe("row");
  });

  it("isola solo i token P0001 row-data definiti dalla RPC 076", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    rpcError = { code: "P0001", message: "position_not_found" };
    const known = await push({ status: "draft" }, false);
    expect(known.status).toBe(500);
    await expect(known.json()).resolves.toMatchObject({
      error: "applications_upsert_failed",
      rejection_scope: "row",
    });
    expect(logged.mock.calls.flat().join(" ")).not.toContain(
      "position_not_found",
    );

    rpcError = { code: "P0001", message: "synthetic_unknown_failure" };
    const unknown = await push({ status: "draft" }, false);
    expect(unknown.status).toBe(500);
    await expect(unknown.json()).resolves.not.toHaveProperty("rejection_scope");
  });

  it("persiste application prima di pubblicare positions.status=applied", async () => {
    const response = await push({
      status: "applied",
      applied: true,
      applied_at: "2026-08-12T16:30:00.000Z",
      applied_via: "telegram",
    });
    expect(response.status).toBe(200);

    const position = calls.find(
      (call) => call.kind === "upsert" && call.table === "positions",
    );
    expect(position?.payload).toEqual([
      expect.not.objectContaining({ status: expect.anything() }),
    ]);
    expect(position?.options).toMatchObject({ defaultToNull: false });

    const applicationAt = calls.findIndex(
      (call) => call.kind === "rpc" && call.name === "sync_upsert_applications",
    );
    const confirmAt = calls.findIndex(
      (call) =>
        call.kind === "rpc" && call.name === "sync_confirm_positions_applied",
    );
    expect(applicationAt).toBeGreaterThan(-1);
    expect(calls[applicationAt].args.p_applications[0]).toMatchObject({
      legacy_id: 193,
      position_legacy_id: 73,
      _receipt_id: receiptId("applications", 193),
    });
    expect(calls[applicationAt].args.p_applications[0]).not.toHaveProperty(
      "position_id",
    );
    expect(confirmAt).toBeGreaterThan(applicationAt);
    expect(calls[confirmAt].args).toEqual({
      p_user_id: "00000000-0000-0000-0000-000000000073",
      p_position_legacy_ids: [73],
    });
    await expect(response.json()).resolves.toMatchObject({
      receipts: { applications: [receiptId("applications", 193)] },
    });
  });

  it("non risponde successo se la verifica atomica rifiuta l'application", async () => {
    rpcError = "incomplete_application";
    const response = await push({ status: "applied", applied: false });
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toMatchObject({ error: "applications_upsert_failed" });
    const position = calls.find(
      (call) => call.kind === "upsert" && call.table === "positions",
    );
    expect(position?.payload[0]).not.toHaveProperty("status");
  });

  describe("a position that comes applied without its application, as the box sends it", () => {
    // The box sends one table per request, positions before applications
    // (cli cloud.js performPush): the application is in the next request, or
    // already on the cloud. The collaudo's first push quarantined 47 positions
    // with application_state_invariant_failed for a state the next request
    // made true.
    const positionsOnly = () =>
      pushBody({
        positions: [
          { id: 73, title: "Synthetic role", company: "Example", status: "applied" },
        ],
      });
    const confirmCall = () =>
      calls.find(
        (call) =>
          call.kind === "rpc" && call.name === "sync_confirm_positions_applied",
      );
    const complete = {
      user_id: "00000000-0000-0000-0000-000000000073",
      position_id: "position-uuid-73",
      status: "applied",
      applied: true,
      applied_at: "2026-08-12T16:30:00+00:00",
      applied_via: "telegram",
    };

    it("with no application on the cloud yet, it is written unpublished and acked, not refused", async () => {
      // The RPC refuses what it cannot confirm, as the real one does.
      rpcError = { code: "P0001", message: "incomplete_application" };
      const response = await positionsOnly();
      expect(response.status).toBe(200);
      expect(confirmCall()).toBeUndefined();
      const position = calls.find(
        (call) => call.kind === "upsert" && call.table === "positions",
      );
      expect(position?.payload[0]).not.toHaveProperty("status");
      await expect(response.json()).resolves.toMatchObject({
        receipts: { positions: [receiptId("positions", 73)] },
      });
    });

    it("with its application still ready on the cloud (the team just applied), it waits for the applications request", async () => {
      rpcError = { code: "P0001", message: "incomplete_application" };
      cloudApplications = [
        { ...complete, status: "ready", applied: false, applied_at: null, applied_via: null },
      ];
      const response = await positionsOnly();
      expect(response.status).toBe(200);
      expect(confirmCall()).toBeUndefined();
    });

    it("with its application complete on the cloud, it is published now", async () => {
      cloudApplications = [complete];
      const response = await positionsOnly();
      expect(response.status).toBe(200);
      expect(confirmCall()?.args).toEqual({
        p_user_id: "00000000-0000-0000-0000-000000000073",
        p_position_legacy_ids: [73],
      });
    });

    it("an application with a blank channel is not complete", async () => {
      cloudApplications = [{ ...complete, applied_via: "  " }];
      const response = await positionsOnly();
      expect(response.status).toBe(200);
      expect(confirmCall()).toBeUndefined();
    });

    it("the application it waits for is looked up among the caller's rows only", async () => {
      // Another user's complete application on the same position uuid: the
      // fake answers as PostgREST would, so it comes back only if the route
      // does not filter by its own user.
      cloudApplications = [
        { ...complete, user_id: "00000000-0000-0000-0000-000000000099" },
      ];
      const response = await positionsOnly();
      expect(response.status).toBe(200);
      const lookup = queries.find(
        (query) =>
          query.table === "applications" && query.operation === "select",
      );
      expect(lookup?.filters).toContainEqual({
        method: "eq",
        column: "user_id",
        value: "00000000-0000-0000-0000-000000000073",
      });
      expect(confirmCall()).toBeUndefined();
      await expect(response.json()).resolves.toMatchObject({
        positions: { awaiting_application: [73], applied: [] },
      });
    });

    it("written without its status, it is listed as awaiting its application, not only acked", async () => {
      // The receipt alone moves the box's cursor on: if the application never
      // arrives complete the position stays unpublished, and this list is the
      // only trace of it the box gets (before, it went to quarantine).
      const waiting = await positionsOnly();
      expect(waiting.status).toBe(200);
      await expect(waiting.json()).resolves.toMatchObject({
        receipts: { positions: [receiptId("positions", 73)] },
        positions: { awaiting_application: [73], applied: [] },
      });

      calls = [];
      queries = [];
      cloudApplications = [complete];
      const published = await positionsOnly();
      await expect(published.json()).resolves.toMatchObject({
        positions: { awaiting_application: [], applied: [73] },
      });
    });

    it("the applications request that publishes it says so, which ends the box's wait", async () => {
      const response = await push(
        {
          status: "applied",
          applied: true,
          applied_at: "2026-08-12T16:30:00.000Z",
          applied_via: "telegram",
        },
        false,
      );
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        positions: { awaiting_application: [], applied: [73] },
      });
    });
  });

  describe("the flags the user sets from the web, pushed by an old box and by a new one", () => {
    // A box older than a flag does not send it. The route wrote it false (and
    // its time null): the push of a box older than 12/09 erased an
    // authorisation to apply given from the web; the same for the older flags.
    const FLAGS = {
      write_requested: ["write_requested_at"],
      geocode_requested: ["geocode_requested_at"],
      recheck_requested: ["recheck_requested_at"],
      salary_precise_requested: ["salary_precise_requested_at"],
      apply_requested: ["apply_requested_at", "apply_requested_by"],
    } as const;
    const upserts = () =>
      calls.filter((call) => call.kind === "upsert" && call.table === "positions");
    const position = (id: number, extra: Record<string, unknown> = {}) => ({
      id,
      title: "Synthetic role",
      company: "Example",
      status: "scored",
      ...extra,
    });

    it("a box that does not send them leaves the cloud's values as they are", async () => {
      const response = await pushBody({ positions: [position(73)] });
      expect(response.status).toBe(200);
      const [row] = upserts()[0]!.payload;
      for (const [flag, companions] of Object.entries(FLAGS)) {
        expect(row, flag).not.toHaveProperty(flag);
        for (const key of companions) expect(row, key).not.toHaveProperty(key);
      }
      expect(upserts()[0]!.options).toMatchObject({ defaultToNull: false });
    });

    it("an explicit value still changes them, 0 as false", async () => {
      const response = await pushBody({
        positions: [position(73, { apply_requested: 0, apply_requested_at: null, apply_requested_by: null, write_requested: 1, write_requested_at: "2026-09-28T00:00:00Z" })],
      });
      expect(response.status).toBe(200);
      const [row] = upserts()[0]!.payload;
      expect(row).toMatchObject({ apply_requested: false, apply_requested_at: null, apply_requested_by: null, write_requested: true });
      expect(row).not.toHaveProperty("geocode_requested");
    });

    it("rows with and without a flag never share an upsert, where the missing one would take the default", async () => {
      const response = await pushBody({
        positions: [position(73, { apply_requested: 1, apply_requested_at: "2026-09-28T00:00:00Z", apply_requested_by: "user_web" }), position(74)],
      });
      expect(response.status).toBe(200);
      expect(upserts()).toHaveLength(2);
      for (const call of upserts()) {
        const keys = call.payload.map((row: object) => Object.keys(row).sort().join(","));
        expect(new Set(keys).size).toBe(1);
      }
    });
  });

  it("non perde un'application delta quando la position non è nel batch", async () => {
    const response = await push(
      {
        status: "applied",
        applied: true,
        applied_at: "2026-08-12T16:30:00.000Z",
        applied_via: "telegram",
      },
      false,
    );
    expect(response.status).toBe(200);
    expect(
      calls.some(
        (call) =>
          call.kind === "rpc" && call.name === "sync_upsert_applications",
      ),
    ).toBe(true);
    expect(calls.at(-1)).toMatchObject({
      kind: "rpc",
      name: "sync_confirm_positions_applied",
    });
  });

  it("non conferma una application se la RPC non restituisce la sua identita'", async () => {
    applicationReceipts = ["q_999999999999999999999999"];
    const response = await push(
      {
        status: "draft",
      },
      false,
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "applications_receipt_mismatch",
    });
  });

  it("verifica il multiset delle receipt senza dipendere dall'ordine", async () => {
    applicationReceipts = [
      receiptId("applications", 194),
      receiptId("applications", 193),
    ];
    const response = await POST(
      new Request("http://localhost/api/cloud-sync/push", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          applications: [
            {
              legacy_id: 193,
              position_legacy_id: 73,
              _receipt_id: receiptId("applications", 193),
              status: "draft",
            },
            {
              legacy_id: 194,
              position_legacy_id: 74,
              _receipt_id: receiptId("applications", 194),
              status: "draft",
            },
          ],
        }),
      }) as any,
    );

    expect(response.status).toBe(200);
    const applicationCall = calls.find(
      (call) => call.kind === "rpc" && call.name === "sync_upsert_applications",
    );
    expect(applicationCall?.args.p_applications).toHaveLength(2);
  });

  it("rifiuta una sostituzione nel multiset anche quando il count coincide", async () => {
    applicationReceipts = [
      receiptId("applications", 193),
      receiptId("applications", 193),
    ];
    const response = await POST(
      new Request("http://localhost/api/cloud-sync/push", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          applications: [
            {
              legacy_id: 193,
              position_legacy_id: 73,
              _receipt_id: receiptId("applications", 193),
              status: "draft",
            },
            {
              legacy_id: 194,
              position_legacy_id: 74,
              _receipt_id: receiptId("applications", 194),
              status: "draft",
            },
          ],
        }),
      }) as any,
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "applications_receipt_mismatch",
    });
  });

  it("rifiuta identita' application incomplete prima della RPC", async () => {
    const response = await POST(
      new Request("http://localhost/api/cloud-sync/push", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          applications: [{ legacy_id: 193, status: "draft" }],
        }),
      }) as any,
    );

    expect(response.status).toBe(400);
    expect(
      calls.some(
        (call) =>
          call.kind === "rpc" && call.name === "sync_upsert_applications",
      ),
    ).toBe(false);
  });

  it("rifiuta receipt application e score non derivate dalla source identity", async () => {
    const application = await POST(
      new Request("http://localhost/api/cloud-sync/push", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          applications: [
            {
              legacy_id: 193,
              position_legacy_id: 73,
              _receipt_id: receiptId("applications", 999),
              status: "draft",
            },
          ],
        }),
      }) as any,
    );
    expect(application.status).toBe(400);

    const score = await POST(
      new Request("http://localhost/api/cloud-sync/push", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          scores: [
            {
              legacy_id: 88,
              position_id: 73,
              _receipt_id: receiptId("scores", 999),
              total_score: 81,
            },
          ],
        }),
      }) as any,
    );
    expect(score.status).toBe(400);
    expect(
      calls.some(
        (call) =>
          call.kind === "rpc" && call.name === "sync_upsert_applications",
      ),
    ).toBe(false);
    expect(
      calls.some((call) => call.kind === "upsert" && call.table === "scores"),
    ).toBe(false);
  });

  it("rifiuta uno score senza source identity prima del lookup o upsert", async () => {
    const response = await POST(
      new Request("http://localhost/api/cloud-sync/push", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          scores: [{ position_id: 73, total_score: 81 }],
        }),
      }) as any,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "invalid_score_identity",
    });
    expect(calls).toEqual([]);
  });

  it("classifica una receipt score forgiata come errore di protocollo", async () => {
    const response = await POST(
      new Request("http://localhost/api/cloud-sync/push", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          scores: [
            {
              legacy_id: 88,
              position_id: 73,
              _receipt_id: "q_ffffffffffffffffffffffff",
              total_score: 81,
            },
          ],
        }),
      }) as any,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "invalid_score_receipt_id",
    });
    expect(calls).toEqual([]);
  });

  it("esporta la receipt score solo dopo l'upsert osservato", async () => {
    const response = await POST(
      new Request("http://localhost/api/cloud-sync/push", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          positions: [
            {
              id: 73,
              title: "Synthetic",
              company: "Example",
              status: "scored",
            },
          ],
          scores: [
            {
              legacy_id: 88,
              position_id: 73,
              _receipt_id: receiptId("scores", 88),
              total_score: 81,
            },
          ],
        }),
      }) as any,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      scores: { upserted: 1 },
      receipts: { scores: [receiptId("scores", 88)] },
    });
  });

  it("risolve il parent di uno score orfano e fallisce chiuso se manca", async () => {
    const body = {
      scores: [
        {
          legacy_id: 88,
          position_id: 73,
          _receipt_id: receiptId("scores", 88),
          total_score: 81,
        },
      ],
    };
    const persisted = await POST(
      new Request("http://localhost/api/cloud-sync/push", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }) as any,
    );
    expect(persisted.status).toBe(200);
    await expect(persisted.json()).resolves.toMatchObject({
      receipts: { scores: [receiptId("scores", 88)] },
    });

    calls = [];
    selectedPositions = [];
    admin = fakeAdmin();
    const missing = await POST(
      new Request("http://localhost/api/cloud-sync/push", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }) as any,
    );
    expect(missing.status).toBe(400);
    await expect(missing.json()).resolves.toEqual({
      error: "scores_identity_unresolved",
      rejection_scope: "row",
    });
    expect(
      calls.some((call) => call.kind === "upsert" && call.table === "scores"),
    ).toBe(false);
  });

  it("non esporta ACK se l'upsert score non conferma ogni riga", async () => {
    scorePersistedParents = [];
    admin = fakeAdmin();
    const response = await POST(
      new Request("http://localhost/api/cloud-sync/push", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          positions: [
            {
              id: 73,
              title: "Synthetic",
              company: "Example",
              status: "scored",
            },
          ],
          scores: [
            {
              legacy_id: 88,
              position_id: 73,
              _receipt_id: receiptId("scores", 88),
              total_score: 81,
            },
          ],
        }),
      }) as any,
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "scores_receipt_mismatch",
    });
  });

  it("non esporta ACK se il legacy_id persistito non coincide", async () => {
    scorePersistedLegacyOverride = 999;
    admin = fakeAdmin();
    const response = await POST(
      new Request("http://localhost/api/cloud-sync/push", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          positions: [
            {
              id: 73,
              title: "Synthetic",
              company: "Example",
              status: "scored",
            },
          ],
          scores: [{ legacy_id: 88, position_id: 73, total_score: 81 }],
        }),
      }) as any,
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "scores_receipt_mismatch",
    });
  });
});
