/**
 * I mazzi di /swipe oltre il tetto di PostgREST: una risposta non porta mai
 * più di 1000 righe, anche se la query chiede `.limit(10000)`.
 *
 * Il client finto imita quel tetto e applica davvero le finestre inclusive di
 * `.range()`. I filtri `in`/`is` vengono applicati; l'ordine no: le righe sono
 * già nell'ordine che la query chiede. Le prove guardano i mazzi restituiti,
 * non soltanto le chiamate.
 *
 * Dati sintetici: nessuna posizione vera.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { getSwipeDecksCloud } from "@/lib/swipe-decks";

type Row = Record<string, any>;
type QueryCall = {
  table: string;
  ops: Array<[string, unknown[]]>;
  ranges: Array<[number, number]>;
};

const SERVER_MAX_ROWS = 1000;

let positionRows: Row[] = [];
let feedbackRows: Row[] = [];

function fakeClient() {
  const calls: QueryCall[] = [];
  const client = {
    from(table: string) {
      const call: QueryCall = { table, ops: [], ranges: [] };
      calls.push(call);
      const filters: Array<(row: Row) => boolean> = [];
      const embedded: Array<(row: Row) => Row> = [];
      let window: [number, number] | null = null;
      let limit: number | null = null;
      const builder: Record<string, any> = {};
      for (const name of ["select", "order"]) {
        builder[name] = (...args: unknown[]) => {
          call.ops.push([name, args]);
          return builder;
        };
      }
      builder.in = (column: string, values: unknown[]) => {
        call.ops.push(["in", [column, values]]);
        filters.push((row) => values.includes(row[column]));
        return builder;
      };
      builder.is = (column: string, value: unknown) => {
        call.ops.push(["is", [column, value]]);
        const [rel, field] = column.split(".");
        if (field === undefined) {
          filters.push((row) => (row[column] ?? null) === value);
        } else {
          // Una relazione inclusa senza !inner: il filtro toglie il figlio, non la riga.
          embedded.push((row) => ({
            ...row,
            [rel]: [row[rel]]
              .flat()
              .filter(
                (child) => child != null && (child[field] ?? null) === value,
              ),
          }));
        }
        return builder;
      };
      builder.limit = (n: number) => {
        call.ops.push(["limit", [n]]);
        limit = n;
        return builder;
      };
      builder.range = (from: number, to: number) => {
        call.ops.push(["range", [from, to]]);
        call.ranges.push([from, to]);
        window = [from, to];
        return builder;
      };
      builder.then = (
        ok: (result: { data: Row[]; error: null }) => unknown,
        ko?: (error: unknown) => unknown,
      ) => {
        const source =
          table === "position_feedback" ? feedbackRows : positionRows;
        const matching = source
          .map((row) => embedded.reduce((r, filter) => filter(r), row))
          .filter((row) => filters.every((f) => f(row)));
        const [from, to] = window ?? [0, (limit ?? Infinity) - 1];
        // Il tetto del server: vale anche quando `.limit()` chiede di più.
        const data = matching.slice(from, to + 1).slice(0, SERVER_MAX_ROWS);
        return Promise.resolve({ data, error: null }).then(ok, ko);
      };
      return builder;
    },
  };
  return { client, calls };
}

function position(legacyId: number, status: string): Row {
  return {
    id: `pos-${legacyId}`,
    legacy_id: legacyId,
    title: `Posizione ${legacyId}`,
    company: "Azienda Esempio",
    location: "Città Esempio",
    remote_type: "hybrid",
    salary_declared_min: null,
    salary_declared_max: null,
    salary_declared_currency: null,
    salary_estimated_min: null,
    salary_estimated_max: null,
    salary_estimated_currency: null,
    url: null,
    source: "example",
    found_at: new Date(Date.UTC(2026, 0, 1, 0, 0, legacyId)).toISOString(),
    status,
    score: null,
    role_family: "engineering",
    loc_country: "IT",
    loc_city: "Città Esempio",
    deleted_at: null,
    scores: [{ total_score: 70 }],
  };
}

// Registro dal più recente al più vecchio, come lo ordina la query.
function feedback(legacyIds: number[], action = "like"): Row[] {
  return legacyIds.map((legacyId, i) => ({
    id: `fb-${i}`,
    position_legacy_id: String(legacyId),
    action,
    score: 4,
    created_at: new Date(Date.UTC(2026, 5, 1) - i * 1000).toISOString(),
  }));
}

let supa: ReturnType<typeof fakeClient>;

beforeEach(() => {
  positionRows = [];
  feedbackRows = [];
  supa = fakeClient();
});

function orders(table: string) {
  const call = supa.calls.find((c) => c.table === table)!;
  return call.ops.filter(([name]) => name === "order").map(([, args]) => args);
}

describe("feedback oltre la riga 1000", () => {
  it("una posizione giudicata alla riga 1201 del registro non torna nel mazzo da giudicare", async () => {
    // 1500 feedback su posizioni che non sono più nel mazzo, e quello della
    // posizione 7 cade alla riga 1201: nella seconda pagina.
    const others = Array.from({ length: 1500 }, (_, i) => 10_000 + i);
    others[1200] = 7;
    feedbackRows = feedback(others);
    positionRows = [position(5, "ready"), position(7, "scored")];

    const { pending, reviewed } = await getSwipeDecksCloud(supa.client as any);

    expect(pending.map((p) => p.legacy_id)).toEqual([5]);
    expect(reviewed.map((r) => r.position.legacy_id)).toEqual([7]);
    expect(reviewed[0]).toMatchObject({ action: "like", fb_score: 4 });

    const call = supa.calls.find((c) => c.table === "position_feedback")!;
    expect(call.ranges).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
    expect(orders("position_feedback")).toEqual([
      ["created_at", { ascending: false }],
      ["position_legacy_id", { ascending: true }],
      ["action", { ascending: true }],
    ]);
  });

  it("l'evento più recente vince anche quando il più vecchio è in un'altra pagina", async () => {
    const ids = Array.from({ length: 1500 }, (_, i) => 10_000 + i);
    ids[1100] = 7;
    feedbackRows = feedback(ids);
    feedbackRows[1300] = {
      ...feedback([7], "dislike")[0],
      id: "fb-old",
      created_at: feedbackRows[1300].created_at,
    };
    positionRows = [position(7, "ready")];

    const { pending, reviewed } = await getSwipeDecksCloud(supa.client as any);

    expect(pending).toEqual([]);
    expect(reviewed.map((r) => r.action)).toEqual(["like"]);
  });
});

describe("posizioni oltre la riga 1000", () => {
  it("una posizione valutata dopo 1100 escluse entra nel mazzo reviewed", async () => {
    // Le escluse senza feedback occupano le prime righe per found_at: con la
    // lettura a risposta singola la valutata recente restava fuori.
    positionRows = [
      ...Array.from({ length: 1100 }, (_, i) => position(i, "excluded")),
      position(1150, "ready"),
      position(1199, "ready"),
    ];
    feedbackRows = feedback([1150]);

    const { pending, reviewed } = await getSwipeDecksCloud(supa.client as any);

    expect(reviewed.map((r) => r.position.legacy_id)).toEqual([1150]);
    expect(pending.map((p) => p.legacy_id)).toEqual([1199]);

    const call = supa.calls.find((c) => c.table === "positions")!;
    expect(call.ranges).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
    expect(call.ops).toContainEqual([
      "in",
      ["status", ["scored", "ready", "excluded"]],
    ]);
    expect(call.ops.map(([name]) => name)).not.toContain("limit");
    expect(orders("positions")).toEqual([
      ["found_at", { ascending: true }],
      ["id", { ascending: true }],
    ]);
  });

  it("limit vale per ciascun mazzo: 1200 da giudicare non tolgono posto alle giudicate", async () => {
    positionRows = [
      ...Array.from({ length: 1200 }, (_, i) => position(i, "ready")),
      ...Array.from({ length: 50 }, (_, i) => position(2000 + i, "scored")),
    ];
    feedbackRows = feedback(Array.from({ length: 50 }, (_, i) => 2000 + i));

    const { pending, reviewed } = await getSwipeDecksCloud(supa.client as any);

    // Il mazzo da giudicare si ferma a limit (1000), le più vecchie per prime.
    expect(pending).toHaveLength(1000);
    expect(pending[0].legacy_id).toBe(0);
    expect(pending.at(-1)?.legacy_id).toBe(999);
    expect(reviewed).toHaveLength(50);
    expect(reviewed[0].position.legacy_id).toBe(2000);
  });
});

describe("quante righe si leggono", () => {
  it("si ferma quando i due mazzi sono pieni, senza scaricare tutte le posizioni", async () => {
    // 5000 posizioni, una su due giudicata: con limit 10 i due mazzi sono
    // pieni alla ventesima riga, e la prima pagina basta.
    positionRows = Array.from({ length: 5000 }, (_, i) =>
      position(i, "scored"),
    );
    feedbackRows = feedback(Array.from({ length: 2500 }, (_, i) => 2 * i + 1));

    const { pending, reviewed } = await getSwipeDecksCloud(
      supa.client as any,
      10,
    );

    expect(pending.map((p) => p.legacy_id)).toEqual([
      0, 2, 4, 6, 8, 10, 12, 14, 16, 18,
    ]);
    expect(reviewed.map((r) => r.position.legacy_id)).toEqual([
      1, 3, 5, 7, 9, 11, 13, 15, 17, 19,
    ]);
    const call = supa.calls.find((c) => c.table === "positions")!;
    expect(call.ranges).toEqual([[0, 999]]);
  });

  it("una posizione cancellata non entra in nessun mazzo", async () => {
    positionRows = [
      position(1, "scored"),
      { ...position(2, "scored"), deleted_at: "2026-09-01T00:00:00Z" },
      { ...position(3, "scored"), deleted_at: "2026-09-01T00:00:00Z" },
    ];
    feedbackRows = feedback([3]);

    const { pending, reviewed } = await getSwipeDecksCloud(supa.client as any);

    expect(pending.map((p) => p.legacy_id)).toEqual([1]);
    expect(reviewed).toEqual([]);
  });
});

describe("relazioni incluse", () => {
  it("uno score cancellato non dà il punteggio alla card", async () => {
    positionRows = [
      {
        ...position(1, "scored"),
        scores: [{ total_score: 90, deleted_at: "2026-09-01T00:00:00Z" }],
      },
      position(2, "scored"),
    ];

    const { pending } = await getSwipeDecksCloud(supa.client as any);

    expect(pending.map((p) => [p.legacy_id, p.score])).toEqual([
      [1, undefined],
      [2, 70],
    ]);
  });
});
