/**
 * Test unitari per promptTelegramOptional — Telegram CONSIGLIATO ma OPZIONALE
 * nel wizard CLI (direction shift "interaction planes", 2026-06-16).
 *
 * Copre il ramo nuovo (skip) e la delega al flow obbligatorio quando l'utente
 * conferma. Niente rete: il mock prompter interrompe il flow Telegram al primo
 * input (userTag) cosi' il test resta unitario e veloce.
 *
 * Esecuzione: npx tsx --test tests/test_wizard_telegram_optional.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { promptTelegramOptional } from "../cli/wizard/setup-steps.js";

/**
 * Prompter finto minimale. `confirmAnswer` pilota la risposta al confirm
 * "Configurare Telegram adesso?". `text` lancia una sentinella per fermare il
 * flow di promptTelegramRequired appena parte (primo input = userTag), cosi'
 * non si tocca la rete Telegram.
 */
function makePrompter(confirmAnswer: boolean) {
  const calls = { confirm: 0, note: 0, text: 0, select: 0 };
  return {
    calls,
    confirm: async () => { calls.confirm++; return confirmAnswer; },
    note: async () => { calls.note++; },
    text: async () => { calls.text++; throw new Error("STOP_AT_USERTAG"); },
    select: async () => { calls.select++; return undefined; },
    progress: () => ({ stop() {} }),
  };
}

describe("promptTelegramOptional", () => {
  it("skip: confirm=false → ritorna null, mostra la nota e NON tocca Telegram", async () => {
    const p = makePrompter(false);
    const res = await promptTelegramOptional(p as any, {});
    assert.equal(res, null, "lo skip deve ritornare null (nessun canale)");
    assert.equal(p.calls.confirm, 1, "ha chiesto conferma una volta");
    assert.equal(p.calls.note, 1, "ha mostrato la nota 'saltato'");
    assert.equal(p.calls.text, 0, "non deve chiedere userTag/token quando si salta");
  });

  it("accetta: confirm=true → delega a promptTelegramRequired (chiede subito lo userTag)", async () => {
    const p = makePrompter(true);
    await assert.rejects(
      () => promptTelegramOptional(p as any, {}),
      /STOP_AT_USERTAG/,
      "con conferma deve entrare nel flow obbligatorio (che chiede lo userTag)",
    );
    assert.equal(p.calls.confirm, 1, "ha chiesto conferma una volta");
    assert.equal(p.calls.text, 1, "promptTelegramRequired ha chiesto lo userTag → delega avvenuta");
  });

  it("skip su channels pre-esistenti: resta null (non riusa i bot vecchi)", async () => {
    const p = makePrompter(false);
    const res = await promptTelegramOptional(p as any, {
      telegram: { bots: { capitano: { bot_token: "x", chat_id: "1" } } },
    });
    assert.equal(res, null);
  });
});
