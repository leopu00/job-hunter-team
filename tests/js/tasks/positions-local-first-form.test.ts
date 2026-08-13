import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * O-24 — le scritture su posizione condividono UNA forma local-first.
 *
 * Il difetto che previene: la sequenza (desktop nativo → solo SQLite; browser
 * col box acceso → SQLite + mirror best-effort; box spento → solo Supabase)
 * era copiata a mano in ogni route, e una delle copie era già sbagliata —
 * `positions/feedback/route.ts` scrive solo su Supabase, quindi non funziona a
 * cloud spento (O-15). Con quattro copie, il prossimo difetto si paga quattro
 * volte.
 *
 * Il test guarda i SORGENTI perché è lì che vive l'invariante: una route può
 * benissimo funzionare reimplementando i rami a mano, ed è esattamente il caso
 * che vogliamo far fallire.
 */
const ROOT = resolve(__dirname, "../../..");
const FORM = "web/lib/positions/local-first-write.ts";

/** Route che scrivono una posizione per conto dell'utente. */
const WRITERS = [
  "web/app/api/positions/[legacyId]/user-exclude/route.ts",
  "web/app/api/positions/[legacyId]/mark-applied/route.ts",
];

const CLOUD_GUARDED_ENDPOINTS = [
  "web/app/api/positions/[legacyId]/ticket/route.ts",
  "web/app/api/positions/[legacyId]/write-request/route.ts",
  "web/app/api/positions/[legacyId]/geocode-request/route.ts",
  "web/app/api/positions/[legacyId]/recheck-request/route.ts",
];

/**
 * Ancora fuori, e dichiarato: è il difetto O-15, non una svista di questo
 * lavoro. Quando verrà convertita, esce da qui — e se qualcuno la converte
 * prima, il test lo dice invece di restare muto.
 */
const KNOWN_OUTSIDE = "web/app/api/positions/feedback/route.ts";

function read(rel: string): string {
  return readFileSync(resolve(ROOT, rel), "utf-8");
}

describe("forma local-first delle scritture su posizione", () => {
  it("la forma comune esiste e copre i tre rami", () => {
    const src = read(FORM);
    expect(src).toContain("isLocalTokenAuthenticated");
    expect(src).toContain("JHT_DB_PATH");
    expect(src).toContain("resolveUser");
    // Il mirror non deve poter far fallire una scrittura locale già avvenuta.
    expect(src).toMatch(/catch\s*\{\s*cloudOk = false;/);
  });

  it("su deploy cloud non sceglie SQLite anche se il file locale esiste", () => {
    const src = read(FORM);
    expect(src).toContain("isCloudDeploy");
    expect(src).toContain("shouldUseLocalFirst");
  });

  it.each(CLOUD_GUARDED_ENDPOINTS)(
    "%s non sceglie SQLite su deploy cloud",
    (rel) => {
      const src = read(rel);
      expect(src).toContain("isCloudDeploy");
      expect(src).toMatch(
        /!isCloudDeploy\(\)\s*&&\s*fs\.existsSync\(JHT_DB_PATH\)/,
      );
    },
  );

  it("gli endpoint non espongono dettagli architetturali nelle risposte", () => {
    for (const rel of CLOUD_GUARDED_ENDPOINTS) {
      expect(read(rel).toLowerCase()).not.toContain("team locale");
      expect(read(rel).toLowerCase()).not.toContain("localhost");
    }
    const panel = read("web/app/(protected)/positions/[id]/TicketPanel.tsx");
    expect(panel).toContain("attachmentUnavailable");
    expect(panel.match(/attachmentUnavailable:/g)).toHaveLength(8);
    expect(panel).toContain('b?.error === "attachment_unavailable"');
  });

  it("l'errore candidatura è azionabile e non espone dettagli interni", () => {
    const src = read("web/app/(protected)/positions/[id]/FeedbackButtons.tsx");
    const messages = [
      ...src.matchAll(/markAppliedError:\s*(?:\n\s*)?"([^"]+)"/g),
    ].map(([, message]) => message);
    expect(messages).toHaveLength(7);
    for (const message of messages) {
      expect(message.toLowerCase()).toMatch(
        /riprova|try again|prób|inténtalo|erneut|réessay|tente/,
      );
      expect(message.toLowerCase()).not.toMatch(
        /team|localhost|session|path|code|db/,
      );
    }
  });

  it("il branch cloud con SQLite presente seleziona il trasporto cloud", async () => {
    const { shouldUseLocalFirst } =
      await import("@/lib/positions/local-first-write");
    expect(shouldUseLocalFirst(true, true)).toBe(false);
    expect(shouldUseLocalFirst(true, false)).toBe(true);
  });

  it("un 2xx local-first senza mirror confermato non è un successo", async () => {
    const { applicationAckAccepted } =
      await import("@/lib/positions/application-ack");
    expect(applicationAckAccepted({})).toBe(false);
    expect(applicationAckAccepted(null)).toBe(false);
    expect(applicationAckAccepted({ source: "cloud" })).toBe(false);
    expect(
      applicationAckAccepted({ source: "cloud", cloud_synced: false }),
    ).toBe(false);
    expect(
      applicationAckAccepted({ source: "local", cloud_synced: false }),
    ).toBe(false);
    expect(
      applicationAckAccepted({ source: "cloud", cloud_synced: true }),
    ).toBe(true);
    expect(
      applicationAckAccepted({ source: "local", cloud_synced: null }),
    ).toBe(true);
  });

  it.each(WRITERS)("%s usa la forma invece di ricopiarla", (rel) => {
    const src = read(rel);
    expect(src).toContain("localFirstWrite");
    // I rami non si reimplementano: se ricompaiono qui, la forma è stata
    // aggirata e siamo tornati alle copie.
    expect(src).not.toContain("isLocalTokenAuthenticated");
    expect(src).not.toContain("LOCAL_TOKEN_COOKIE");
  });

  it("mark-applied distingue CHI ha mandato la candidatura", () => {
    const src = read(WRITERS[1]);
    // È il punto del ticket: senza applied_via il team non sa se la
    // candidatura l'ha mandata lui o l'utente.
    expect(src).toContain("applied_via");
    expect(src).toContain("user_manual");
    // Stato e riga applications insieme, o il team legge due verità diverse.
    expect(src).toContain("db.transaction");
    expect(src).toMatch(/status = 'applied'/);
    expect(
      read("web/app/(protected)/positions/[id]/FeedbackButtons.tsx"),
    ).toContain("cloud_sync_unconfirmed");
  });

  it("il caso ancora fuori resta dichiarato, non dimenticato", () => {
    if (!existsSync(resolve(ROOT, KNOWN_OUTSIDE))) return;
    const src = read(KNOWN_OUTSIDE);
    const converted = src.includes("localFirstWrite");
    expect(
      converted || src.includes("supabase"),
      "feedback/route.ts non è più né local-first né cloud-only: aggiorna questo test",
    ).toBe(true);
  });
});
