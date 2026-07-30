/**
 * Forma unica del 400 «body non parsabile» [WEB-API-ERROR-SHAPES].
 *
 * Lo stesso identico errore — `await req.json()` che solleva — viveva in 32
 * punti sotto `app/api/` con SETTE stringhe diverse (`"body non valido"`,
 * `"Body non valido"`, `"JSON body invalido"`, `"body JSON non valido"`,
 * `"JSON body atteso"`, `"JSON non valido"`, `"invalid JSON body"`) e DUE
 * envelope (`{ error }` e `{ ok: false, error }`). Un client che voglia
 * distinguere «il mio body è rotto» da qualunque altro 400 doveva quindi
 * conoscere sette frasi in due lingue: di fatto nessuno lo faceva.
 *
 * Envelope scelto: `{ error }`.
 *   - È quello che produce `lib/error-response.ts:sanitizedError()`, cioè il
 *     modulo che il repo ha già eletto a via unica per gli errori: scegliere
 *     `{ ok: false, error }` avrebbe reso i due incompatibili.
 *   - `ok: false` duplica lo status HTTP, che è già non-2xx.
 *   - Verificato sui consumatori reali prima di togliere `ok`: la CLI legge
 *     `body.error` per stampare (`cli/src/commands/cloud.js`) e quando guarda
 *     `ok` lo fa in forma falsy (`if (!data || !data.ok)`, `result.ok === true`),
 *     quindi un `ok` assente ricade nello stesso ramo di `ok: false`. Idem per
 *     `CronForm.tsx` e `credentials/page.tsx` lato web.
 *
 * Il valore è un CODICE, non una frase: le frasi le compone il client, che
 * sa in che lingua sta parlando all'utente.
 */
import { NextResponse } from "next/server";

/** Codice stabile del 400 «body non parsabile». */
export const INVALID_JSON_BODY = "invalid_json_body";

/** 400 canonico da usare nel `catch` intorno a `await req.json()`. */
export function invalidJsonBody(): NextResponse {
  return NextResponse.json({ error: INVALID_JSON_BODY }, { status: 400 });
}
