/**
 * CSV di dati che non abbiamo scritto noi — copia per l'albero del payload.
 *
 * L'originale è `shared/export/csv.js` nell'albero vivo (#159). Qui ne serve
 * una seconda perché questo albero ha un `shared/` proprio: il payload è
 * autonomo, il CLI importa già `../../../shared/cron/index.js`, e un import
 * che uscisse da `desktop/app-payload/` legherebbe il payload a file che il
 * payload non porta con sé.
 *
 * Il motivo per cui questo file esiste è anche il motivo per cui era
 * vulnerabile: la funzione era copiata due volte in questo albero — nella
 * route `web/app/api/export/route.ts` e nel comando
 * `cli/src/commands/export.js` — e il fix di #159 non poteva raggiungerle.
 * Da qui in poi le due strade fanno la stessa domanda a una risposta sola, e
 * il confronto con l'originale è una diff sola.
 *
 * ⚠️ Se cambi questo file, cambia anche `shared/export/csv.js` nella radice
 * del repo, e viceversa: divergere è esattamente il difetto di #162.
 */

/**
 * I caratteri che, **in prima posizione**, fanno di una cella una formula
 * quando il file viene aperto in Excel, LibreOffice o Sheets.
 *
 * TAB e CR sono nell'elenco perché non sono innocui: il parser CSV li toglie
 * prima che il motore di calcolo veda il valore, quindi `\t=HYPERLINK(...)`
 * arriva alla cella come `=HYPERLINK(...)`. Sono il modo classico di passare
 * sotto un filtro che guarda solo i quattro simboli.
 */
const FORMULA_LEADERS = ['=', '+', '-', '@', '\t', '\r'];

/**
 * L'apostrofo iniziale è il marcatore di testo dei fogli di calcolo: la
 * cella resta il valore che era, ma non viene valutata.
 */
const TEXT_MARKER = "'";

/**
 * Un numero scritto per intero — `-5`, `+3.14`, `1e9` — non può essere una
 * formula: il motore lo legge come numero e si ferma lì. Restano fuori
 * dall'esenzione le cose che *iniziano* per numero e proseguono altrimenti
 * (`-1+cmd|'/c calc'!A0`), che è esattamente l'attacco.
 */
const PLAIN_NUMBER = /^[+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/;

/**
 * Il valore, reso inerte per un foglio di calcolo.
 *
 * @param {string} text
 * @returns {string}
 */
export function neutralizeFormula(text) {
  if (typeof text !== 'string' || text.length === 0) return text;
  if (!FORMULA_LEADERS.includes(text[0])) return text;
  if (PLAIN_NUMBER.test(text)) return text;
  return TEXT_MARKER + text;
}

/**
 * Quello che, dentro un campo non virgolettato, non è più un carattere del
 * dato ma una struttura del file.
 *
 * Il CR è il motivo per cui questo elenco non è solo `,"` e `\n`: RFC 4180
 * prescrive di virgolettare i campi che lo contengono, e i fogli di calcolo
 * un CR isolato lo leggono come **fine riga**. Un titolo
 * `Backend Engineer<CR>=1+1` senza virgolette non sposta soltanto le
 * colonne: apre una riga nuova la cui prima cella è `=1+1`, una cella che il
 * neutralizzatore non ha mai visto — lui guarda il primo carattere del campo
 * di partenza, e quello era `B`.
 */
const STRUCTURAL = /[",\n\r\t]/;

/**
 * Una cella pronta per il file: prima resa inerte, poi protetta secondo
 * RFC 4180.
 *
 * L'ordine conta e il contrario non funziona. Le virgolette RFC 4180 **non**
 * difendono da sole — il parser le toglie prima del motore di calcolo — ma
 * devono comunque avvolgere anche il marcatore, altrimenti un titolo con una
 * virgola sposta le colonne.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function csvCell(value) {
  const raw =
    value == null
      ? ''
      : typeof value === 'object'
        ? JSON.stringify(value)
        : String(value);
  const text = neutralizeFormula(raw);
  return STRUCTURAL.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * Le righe come file CSV, intestazione compresa.
 *
 * Anche le intestazioni passano dalla stessa cella: sono le chiavi del JSON
 * esportato, non un elenco che scriviamo noi.
 *
 * @param {Record<string, unknown>[]} rows
 * @returns {string}
 */
export function toCsv(rows) {
  if (rows.length === 0) return '';
  const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const header = keys.map(csvCell).join(',');
  const lines = rows.map((r) => keys.map((k) => csvCell(r[k])).join(','));
  return [header, ...lines].join('\n');
}
