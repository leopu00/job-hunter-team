import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { toCloudRow } from "../../../cli/src/lib/chat-sync.js";

/**
 * O-16 — la corsia chat rapida perdeva ogni riga e la marcava consegnata.
 *
 * Il client costruiva `legacy_id` senza `id`; la route filtra con
 * `typeof m.id === "number"`. Il payload usciva vuoto, l'upsert non
 * avveniva, e la route rispondeva 200 perché dal suo punto di vista non era
 * fallito niente.
 *
 * Il test che c'era asseriva `expect(cloud.legacy_id).toBe(7)` — cioè
 * verificava esattamente la forma sbagliata, e passava: controllava che il
 * codice facesse quello che il codice faceva. Perché questo non ripeta lo
 * stesso errore, il predicato NON è riscritto qui: è estratto dal sorgente
 * della route. Se un giorno la route cambia criterio, questo test cambia
 * con lei o diventa rosso — che è il punto.
 */
const ROUTE_PATH = resolve(
  __dirname,
  "../../../web/app/api/cloud-sync/push/route.ts",
);

/** Il filtro applicato a `pending_user_messages`, preso dalla route. */
function pendingMessagesFilterSource(): string {
  const src = readFileSync(ROUTE_PATH, "utf-8");
  const anchor = src.indexOf("const payload = pendingMessages");
  expect(anchor, "il blocco pending_user_messages non è più nella route").toBeGreaterThan(-1);
  const filterAt = src.indexOf(".filter(", anchor);
  expect(filterAt, "la route non filtra più pending_user_messages").toBeGreaterThan(-1);
  const open = src.indexOf("(", filterAt + ".filter".length);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "(") depth++;
    else if (src[i] === ")") {
      depth--;
      if (depth === 0) return src.slice(open + 1, i).trim();
    }
  }
  throw new Error("filtro non bilanciato nella route");
}

function routeAccepts(row: Record<string, unknown>): boolean {
  // eslint-disable-next-line no-new-func
  const predicate = new Function(
    "m",
    `return Boolean((${pendingMessagesFilterSource()})(m));`,
  ) as (m: unknown) => boolean;
  return predicate(row);
}

const LOCAL_ROW = {
  id: 233,
  agent: "capitano",
  body: "the deck is ready",
  kind: "notification",
  author: "agent",
  created_at: "2026-08-10 09:00:00",
};

describe("O-16 — chat push contract between client and route", () => {
  it("the row built by toCloudRow survives the route's own filter", () => {
    const cloud = toCloudRow(LOCAL_ROW, "user-uuid") as Record<string, unknown>;
    expect(routeAccepts(cloud)).toBe(true);
  });

  it("keeps the numeric id the filter selects on, next to legacy_id", () => {
    const cloud = toCloudRow(LOCAL_ROW, "user-uuid") as Record<string, unknown>;
    // Entrambi: la route seleziona su `id` e ricostruisce lei `legacy_id`,
    // ma altri consumatori del payload leggono `legacy_id`.
    expect(cloud.id).toBe(233);
    expect(cloud.legacy_id).toBe(233);
  });

  it("a row without a numeric id is rejected — the shape that shipped", () => {
    const { id: _dropped, ...withoutId } = toCloudRow(
      LOCAL_ROW,
      "user-uuid",
    ) as Record<string, unknown>;
    // È esattamente ciò che il client mandava prima del fix: se un giorno
    // questa tornasse ad essere accettata, il filtro è cambiato e la
    // garanzia va ripensata, non il test.
    expect(routeAccepts(withoutId)).toBe(false);
  });
});

describe("O-16 — a message born on the web keeps one identity", () => {
  const WEB_BORN = {
    id: 232, // id LOCALE, assegnato dal box all'import
    cloud_legacy_id: -1786356560153, // identità che aveva già sul cloud
    agent: "capitano",
    body: "written from the web",
    author: "user",
    created_at: "2026-08-10 09:31:56",
  };

  it("pushes the cloud identity, not the local id", () => {
    const cloud = toCloudRow(WEB_BORN, "user-uuid") as Record<string, unknown>;
    // Se qui tornasse 232, l'upsert su (user_id, legacy_id) creerebbe un
    // secondo record dello stesso messaggio: è il duplicato di O-16.
    expect(cloud.id).toBe(-1786356560153);
    expect(cloud.legacy_id).toBe(-1786356560153);
    expect(routeAccepts(cloud)).toBe(true);
  });

  it("a row born locally still travels under its local id", () => {
    const cloud = toCloudRow(LOCAL_ROW, "user-uuid") as Record<string, unknown>;
    // NULL/assente = nata in locale. È il caso di ogni riga preesistente
    // alla migrazione: non deve cambiare identità.
    expect(cloud.id).toBe(233);
  });
});
