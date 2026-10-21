/**
 * JHT-T05: il motivo del feedback è un codice del vocabolario chiuso, la nota
 * è dell'utente e non arriva a nessun agente.
 *
 * Qui: il vocabolario (una fonte sola, in tutte e 7 le lingue), le route che
 * scrivono (motivo fuori vocabolario rifiutato, nota ≤ 200), e la regola
 * delle proposte di esclusione, provata sulla STESSA tabella di casi del test
 * Python (`tests/fixtures/feedback-proposals.json`).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  NOTE_MAX,
  PROPOSAL_MIN_POSITIONS,
  REASON_KEYS,
  acceptReason,
  cleanNote,
  exclusionProposals,
  isFactualReason,
  isProposableReason,
  normalizeReason,
} from "../../../web/lib/feedback-reasons";
import { visibleProposals } from "../../../web/lib/exclusion-proposals";
import { REASON_LABELS, REASON_ORDER, negativeSignalFor } from "../../../web/app/(protected)/positions/[id]/exclusion-reasons";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");
const CATALOG = JSON.parse(fs.readFileSync(path.join(ROOT, "shared/feedback-reasons.json"), "utf8")) as {
  reasons: string[];
  factual: string[];
  proposable: string[];
  note_max_chars: number;
  proposal_min_positions: number;
};
const CASES = JSON.parse(
  fs.readFileSync(path.join(ROOT, "tests/fixtures/feedback-proposals.json"), "utf8"),
) as Array<{ name: string; events: never[]; expected: unknown }>;

describe("il vocabolario chiuso", () => {
  it("è quello di shared/feedback-reasons.json, e l'UI li offre tutti e dieci", () => {
    expect([...REASON_KEYS]).toEqual(CATALOG.reasons);
    expect([...REASON_ORDER]).toEqual(CATALOG.reasons);
    expect(NOTE_MAX).toBe(200);
    expect(PROPOSAL_MIN_POSITIONS).toBe(3);
  });

  it("ha un'etichetta per ogni codice in tutte e sette le lingue", () => {
    const locales = ["it", "en", "es", "fr", "de", "hu", "pt"] as const;
    for (const locale of locales) {
      for (const key of CATALOG.reasons) {
        expect(REASON_LABELS[locale][key as keyof (typeof REASON_LABELS)["it"]], `${locale}.${key}`).toBeTruthy();
      }
      expect(Object.keys(REASON_LABELS[locale]).sort()).toEqual([...CATALOG.reasons].sort());
    }
  });

  it("i fattuali, i proponibili e «other» coprono i dieci codici senza sovrapporsi", () => {
    expect([...CATALOG.factual, ...CATALOG.proposable, "other"].sort()).toEqual([...CATALOG.reasons].sort());
    for (const reason of CATALOG.factual) {
      expect(isFactualReason(reason)).toBe(true);
      expect(isProposableReason(reason)).toBe(false);
    }
    expect(isProposableReason("other")).toBe(false);
  });

  it("un testo libero non è un codice; un codice del vecchio elenco vale other", () => {
    expect(acceptReason("troppo senior")).toBeNull();
    expect(acceptReason("")).toBeNull();
    expect(acceptReason(42)).toBeNull();
    expect(acceptReason("too_senior")).toBe("too_senior");
    for (const legacy of ["not_interested", "mismatch", "conditions"]) {
      expect(acceptReason(legacy), legacy).toBe("other");
    }
    expect(acceptReason("__proto__")).toBeNull();
    expect(normalizeReason("troppo senior")).toBe("other");
  });

  it("la nota tiene ZWJ e ZWNJ, con cui si scrive, e toglie i comandi che riscrivono la lettura", () => {
    const family = "ciao \u{1F468}‍\u{1F469}‍\u{1F467} abc";
    expect(cleanNote(family)).toBe(family);
    const persian = "می‌خواهم";
    expect(cleanNote(persian)).toBe(persian);
    expect(cleanNote("a‮b⁦c​d﻿e")).toBe("abcde");
  });

  it("la nota si ripulisce e il motivo non pretende più un testo", () => {
    expect(cleanNote("sede\u202e  sba\n glia\u200bta")).toBe("sede sba gliata");
    for (const key of REASON_ORDER) {
      const signal = negativeSignalFor(key, "");
      expect(signal.kind, key).toBe("exclude");
    }
    const taste = negativeSignalFor("too_senior", " ruolo da lead ");
    expect(taste).toEqual({
      kind: "exclude",
      reason: "too_senior",
      note: "ruolo da lead",
      feedback: { reason: "too_senior", note: "ruolo da lead" },
    });
    // un motivo fattuale non insegna niente allo Scout
    expect(negativeSignalFor("scam_or_gone", "x")).toEqual({ kind: "exclude", reason: "scam_or_gone", note: "x" });
  });
});

describe("la proposta di esclusione (stessa tabella di casi di Python)", () => {
  for (const c of CASES) {
    it(c.name, () => {
      expect(exclusionProposals(c.events)).toEqual(c.expected);
    });
  }

  it("una proposta accettata non torna; una rifiutata torna dopo altre tre posizioni", () => {
    const rejected = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        legacy_id: String(i + 1),
        action: "dislike",
        reason: "too_senior",
        created_at: "2026-10-01T10:00:00Z",
      }));
    expect(visibleProposals(rejected(3), [])).toHaveLength(1);
    expect(visibleProposals(rejected(3), [{ reason: "too_senior", status: "accepted", positions_at_decision: 3 }])).toEqual([]);
    const dismissed = [{ reason: "too_senior", status: "dismissed" as const, positions_at_decision: 3 }];
    expect(visibleProposals(rejected(5), dismissed)).toEqual([]);
    expect(visibleProposals(rejected(6), dismissed)).toHaveLength(1);
  });
});

// ── le route che scrivono ───────────────────────────────────────────────

const teamAuth = vi.hoisted(() => ({ resolveUser: vi.fn() }));
vi.mock("@/lib/team-state/auth", () => teamAuth);
vi.mock("@/lib/demo/data", () => ({ isDemoLegacyId: () => false }));
vi.mock("@/lib/demo/mode", () => ({
  activeDemoPersona: async () => false,
  parseDemoFeedback: () => ({}),
  serializeDemoFeedback: () => "",
  DEMO_FEEDBACK_COOKIE: "jht_demo_feedback",
}));
vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({ get: vi.fn(), set: vi.fn() })) }));
vi.mock("@/lib/workspace", () => ({ isSupabaseConfigured: true }));
// JHT-T46: the write of the decision is the desktop's (the website's session is refused: see
// profile-exclusions-write-desktop-only.test.ts). Here the gate lets the write through, so the rules
// of the route (codes, states, the user's own row) are what is tested.
vi.mock("@/lib/auth", () => ({ requireLocalWrite: async () => null }));

import { POST as postFeedback } from "@/app/api/positions/[legacyId]/feedback/route";
import { GET as getProfileExclusions, POST as postProfileExclusion } from "@/app/api/profile-exclusions/route";

function recordingDb() {
  const inserted: Record<string, unknown>[] = [];
  const upserted: Record<string, unknown>[] = [];
  const selects: string[] = [];
  const builder = {
    select: vi.fn((cols?: string) => {
      if (cols) selects.push(cols);
      return builder;
    }),
    single: vi.fn(async () => ({ data: { id: "x" }, error: null })),
    insert: vi.fn((row: Record<string, unknown>) => {
      inserted.push(row);
      return builder;
    }),
    upsert: vi.fn((row: Record<string, unknown>) => {
      upserted.push(row);
      return builder;
    }),
    eq: vi.fn(() => Promise.resolve({ data: [], error: null })),
  };
  return { supabase: { from: vi.fn(() => builder) }, inserted, upserted, selects };
}

function as(source: "session" | "token", db: ReturnType<typeof recordingDb>) {
  teamAuth.resolveUser.mockResolvedValue({
    ok: true,
    user: { source, userId: "user-1", supabase: db.supabase, token: {} },
  });
}

const post = (body: unknown) =>
  postFeedback(
    new Request("http://x/api/positions/42/feedback", { method: "POST", body: JSON.stringify(body) }) as never,
    { params: Promise.resolve({ legacyId: "42" }) },
  );

describe("la route del feedback", () => {
  beforeEach(() => teamAuth.resolveUser.mockReset());

  it("rifiuta un motivo fuori vocabolario e non scrive niente", async () => {
    const db = recordingDb();
    as("session", db);
    const res = await post({ action: "dislike", reason: "troppo senior" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "reason_invalid" });
    expect(db.inserted).toEqual([]);
  });

  it("rifiuta una nota oltre 200 caratteri", async () => {
    const db = recordingDb();
    as("session", db);
    const res = await post({ action: "dislike", reason: "too_senior", note: "x".repeat(201) });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "note_too_long" });
  });

  it("scrive il codice e la nota ripulita, e il vecchio campo commento non esiste più", async () => {
    const db = recordingDb();
    as("token", db);
    const res = await post({ action: "dislike", reason: "too_senior", comment: " ruolo\u202e da lead " });
    expect(res.status).toBe(200);
    expect(db.inserted[0]).toMatchObject({ reason: "too_senior", note: "ruolo da lead" });
    expect(db.inserted[0]).not.toHaveProperty("comment");
    // la risposta e la lettura non riportano la nota
    expect(db.selects.join(" ")).not.toMatch(/\bnote\b|\bcomment\b/);
  });

  it("un codice del vecchio elenco passa come other", async () => {
    const db = recordingDb();
    as("session", db);
    expect((await post({ action: "dislike", reason: "not_interested" })).status).toBe(200);
    expect(db.inserted[0]).toMatchObject({ reason: "other" });
  });
});

describe("la preferenza sull'esclusione del profilo", () => {
  beforeEach(() => teamAuth.resolveUser.mockReset());

  const req = (body: unknown) =>
    new Request("http://x/api/profile-exclusions", { method: "POST", body: JSON.stringify(body) }) as never;

  it("la prende solo dalla sessione dell'utente, mai da un token", async () => {
    const db = recordingDb();
    as("token", db);
    expect((await postProfileExclusion(req({ reason: "too_senior", status: "accepted", positions: 3 }))).status).toBe(403);
    expect((await getProfileExclusions(new Request("http://x/api/profile-exclusions") as never)).status).toBe(403);
    expect(db.upserted).toEqual([]);
  });

  it("registra codice, stato e posizioni; rifiuta other, i fattuali e uno stato inventato", async () => {
    const db = recordingDb();
    as("session", db);
    const ok = await postProfileExclusion(req({ reason: "too_senior", status: "dismissed", positions: 4 }));
    expect(ok.status).toBe(200);
    expect(db.upserted[0]).toMatchObject({ user_id: "user-1", reason: "too_senior", status: "dismissed", positions_at_decision: 4 });
    for (const reason of ["other", "closed", "scam_or_gone", "nope"]) {
      expect((await postProfileExclusion(req({ reason, status: "accepted" }))).status, reason).toBe(400);
    }
    expect((await postProfileExclusion(req({ reason: "too_senior", status: "maybe" }))).status).toBe(400);
  });
});
