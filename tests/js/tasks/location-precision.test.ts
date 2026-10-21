/**
 * [JHT-T04] Il livello di precisione del luogo decide cosa è un ufficio sulla mappa.
 *
 * Fino a oggi un solo flag, `office_verified`, distingueva «indirizzo con civico» da «tutto il
 * resto», e un centro città salvato come ufficio sembrava un ufficio: 42 posizioni di 33 aziende
 * sullo stesso punto di Roma. `location_precision` (address | street | district | city | country |
 * remote) lo dice. Qui, in due strati:
 *
 * - `resolveCityPins`: solo `address` fa un pin alle coordinate; tutto il resto va nella griglia
 *   della sua città, come una posizione senza coordinate; coordinate condivise da >= 3 aziende
 *   restano declassate anche se dichiarate `address`;
 * - il push al cloud: manda un livello dell'insieme chiuso (il CHECK della migrazione 095) o quello
 *   che flag e coordinate danno, mai un valore che il CHECK rifiuterebbe — un valore solo fuori
 *   insieme farebbe rifiutare l'intero upsert (precedente: cloud_push_status, 18/08).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  LOCATION_PRECISIONS,
  effectivePrecision,
  resolveCityPins,
  type GeoRow,
} from "@/lib/city-coords";

const row = (over: Partial<GeoRow>): GeoRow => ({
  loc_country: "Italy",
  loc_city: "Rome",
  office_lat: null,
  office_lon: null,
  ...over,
});

// A point that is the middle of Rome, and one that is an office in it.
const CENTRE = { office_lat: 41.8933, office_lon: 12.4829 };
const OFFICE = { office_lat: 41.9028, office_lon: 12.4964 };

describe("effectivePrecision", () => {
  it("takes the level that is written, when it is one of the closed set", () => {
    for (const level of LOCATION_PRECISIONS) {
      expect(effectivePrecision(row({ ...OFFICE, location_precision: level, office_verified: false }))).toBe(level);
    }
  });

  it("reads a level the set does not have as «not classified», and derives it from the flag", () => {
    for (const unknown of ["building", "ADDRESS", "", " city", "region"]) {
      expect(effectivePrecision(row({ ...OFFICE, location_precision: unknown, office_verified: true }))).toBe("address");
      expect(effectivePrecision(row({ ...OFFICE, location_precision: unknown, office_verified: false }))).toBe("city");
    }
  });

  it("gives a row with coordinates the level the migration gives it", () => {
    expect(effectivePrecision(row({ ...OFFICE, office_verified: true }))).toBe("address");
    expect(effectivePrecision(row({ ...OFFICE, office_verified: 1 }))).toBe("address");
    expect(effectivePrecision(row({ ...OFFICE, office_verified: false }))).toBe("city");
    expect(effectivePrecision(row({ ...OFFICE, office_verified: null }))).toBe("city");
    expect(effectivePrecision(row({ ...OFFICE, office_verified: 0 }))).toBe("city");
  });

  it("leaves the coordinates as an office for a caller that reads neither the level nor the flag", () => {
    expect(effectivePrecision(row({ ...OFFICE }))).toBe("address");
  });

  it("says remote for a full remote with no place, and nothing for the rest", () => {
    expect(effectivePrecision(row({ remote_type: "full_remote" }))).toBe("remote");
    expect(effectivePrecision(row({ remote_type: "onsite" }))).toBeNull();
    expect(effectivePrecision(row({}))).toBeNull();
  });
});

describe("resolveCityPins", () => {
  it("puts an address at its coordinates", () => {
    const [pin] = resolveCityPins([row({ ...OFFICE, location_precision: "address" })]);
    expect(pin).toEqual({ lat: OFFICE.office_lat, lon: OFFICE.office_lon });
  });

  it.each(["street", "district", "city", "country"] as const)(
    "never makes an exact pin of a %s",
    (level) => {
      const [pin] = resolveCityPins([row({ ...CENTRE, location_precision: level })]);
      expect(pin).not.toBeNull();
      expect(pin).not.toEqual({ lat: CENTRE.office_lat, lon: CENTRE.office_lon });
    },
  );

  it("puts the positions of a city that are not addresses on that city's grid, together", () => {
    const rows = [
      row({ ...CENTRE, location_precision: "city", id: "a", score: 90 }),
      row({ ...CENTRE, location_precision: "street", id: "b", score: 80 }),
      row({ ...CENTRE, location_precision: "district", id: "c", score: 70 }),
    ];
    const pins = resolveCityPins(rows);
    const keys = new Set(pins.map((p) => `${p!.lat.toFixed(5)}|${p!.lon.toFixed(5)}`));
    expect(keys.size).toBe(3);          // each its own slot, none of them the centre
    for (const p of pins) expect(p!.lat).toBeGreaterThan(CENTRE.office_lat + 0.05); // north of the centre, ~10 km
  });

  it("a city-level position without a city is not placed at all: its coordinate is no office", () => {
    expect(resolveCityPins([row({ ...CENTRE, loc_city: null, location_precision: "city" })])).toEqual([null]);
    expect(resolveCityPins([row({ ...CENTRE, loc_city: null, location_precision: "country" })])).toEqual([null]);
  });

  it("keeps declassing a coordinate shared by three companies, even when it is declared an address", () => {
    const shared = ["Acme", "Beta", "Gamma"].map((company, i) =>
      row({ ...CENTRE, company, id: String(i), location_precision: "address" }),
    );
    const pins = resolveCityPins(shared);
    for (const p of pins) expect(p).not.toEqual({ lat: CENTRE.office_lat, lon: CENTRE.office_lon });
    // while two companies on one point stay plausible (a coworking)
    const two = resolveCityPins(shared.slice(0, 2));
    for (const p of two) expect(p).toEqual({ lat: CENTRE.office_lat, lon: CENTRE.office_lon });
  });

  it("a position from a caller that does not read the level is placed as it always was", () => {
    const [pin] = resolveCityPins([row({ ...OFFICE })]);
    expect(pin).toEqual({ lat: OFFICE.office_lat, lon: OFFICE.office_lon });
  });

  it("a flag that is false makes the coordinates a city's, whatever else the row says", () => {
    const [pin] = resolveCityPins([row({ ...OFFICE, office_verified: false })]);
    expect(pin).not.toEqual({ lat: OFFICE.office_lat, lon: OFFICE.office_lon });
  });
});

// ── the push ─────────────────────────────────────────────────────────────────

const userId = "00000000-0000-0000-0000-0000000000a4";
let upserted: Record<string, any>[] = [];

function fakeSupabase() {
  return {
    from(table: string) {
      let operation = "select";
      let payload: any = null;
      const builder: Record<string, any> = {
        select: () => builder,
        eq: () => builder,
        is: () => builder,
        in: () => builder,
        update(value: any) {
          operation = "update";
          payload = value;
          return builder;
        },
        upsert(value: any) {
          operation = "upsert";
          payload = value;
          return builder;
        },
        maybeSingle: () => Promise.resolve({ data: null, error: null }),
        then(ok: (value: any) => unknown, ko?: (error: unknown) => unknown) {
          const finish = async () => {
            if (operation === "upsert" && table === "positions") {
              upserted = payload;
              return { data: payload.map((p: any) => ({ id: `uuid-${p.legacy_id}`, legacy_id: p.legacy_id })), error: null };
            }
            return { data: null, error: null };
          };
          return finish().then(ok, ko);
        },
      };
      return builder;
    },
    rpc: vi.fn(async () => ({ data: 1, error: null })),
  };
}

let supabase = fakeSupabase();

vi.mock("@/lib/workspace", () => ({ isSupabaseConfigured: true }));
vi.mock("@/lib/cloud-sync/auth", () => ({
  verifyBearerToken: vi.fn(async () => ({ ok: true, data: { userId, tokenId: "synthetic-token-id", admin: supabase } })),
}));
vi.mock("@/lib/cloud-sync/rate-limit", () => ({
  checkCloudSyncRateLimit: vi.fn(async () => ({ allowed: true, retryAfterSec: 0 })),
}));
vi.mock("@/lib/cloud-sync/onboarding-milestones", () => ({
  teamProducedWork: vi.fn(() => false),
  firstTeamRunPatch: vi.fn(() => null),
}));
vi.mock("@/lib/team-state/sync-freshness", () => ({ syncRequestIsPending: vi.fn(() => false) }));
vi.mock("@/lib/auth", () => ({ requireAuth: vi.fn(async () => null) }));
vi.mock("@/lib/demo/data", () => ({ isDemoLegacyId: vi.fn(() => false) }));
vi.mock("@/lib/demo/mode", () => ({ activeDemoPersona: vi.fn(async () => null) }));

const { POST: pushPost } = await import("@/app/api/cloud-sync/push/route");

async function push(position: Record<string, unknown>) {
  const response = await pushPost(
    new Request("http://localhost/api/cloud-sync/push", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ positions: [{ id: 5, title: "Engineer", company: "Acme", status: "checked", ...position }] }),
    }) as any,
  );
  expect(response.status).toBe(200);
  return upserted[0];
}

beforeEach(() => {
  upserted = [];
  supabase = fakeSupabase();
});

describe("the push to the cloud", () => {
  it("sends a level of the closed set as it is", async () => {
    for (const level of LOCATION_PRECISIONS) {
      expect((await push({ location_precision: level })).location_precision).toBe(level);
    }
  });

  it("never sends the cloud a value its CHECK would refuse: a level the server does not know is derived", async () => {
    // from a client newer than this server, or a bad one
    for (const unknown of ["building", "ADDRESS", "", "region", 7, true, { a: 1 }]) {
      const verified = await push({ location_precision: unknown, office_lat: 41.9, office_lon: 12.5, office_verified: 1 });
      expect(verified.location_precision).toBe("address");
      const approx = await push({ location_precision: unknown, office_lat: 41.9, office_lon: 12.5, office_verified: 0 });
      expect(approx.location_precision).toBe("city");
      const none = await push({ location_precision: unknown });
      expect(none.location_precision).toBeNull();
      for (const sent of [verified, approx, none]) {
        expect([...LOCATION_PRECISIONS, null]).toContain(sent.location_precision);
      }
    }
  });

  it("derives the level for a client that sends only the flag", async () => {
    expect((await push({ office_lat: 41.9, office_lon: 12.5, office_verified: true })).location_precision).toBe("address");
    expect((await push({ office_lat: 41.9, office_lon: 12.5 })).location_precision).toBe("city");
    expect((await push({ remote_type: "full_remote" })).location_precision).toBe("remote");
    expect((await push({ remote_type: "onsite" })).location_precision).toBeNull();
  });
});
