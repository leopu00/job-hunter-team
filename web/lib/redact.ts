/**
 * Ripulitore PII lato server — gemello di `game/scripts/support/redactor.gd`.
 *
 * Il client desktop sanifica già tutto prima di spedire, e quello resta il
 * punto di difesa principale: è l'unico che vede i dati grezzi e può decidere
 * cosa non far uscire dalla macchina. Questo modulo è la seconda linea, e serve
 * per i casi che il client non copre: una versione vecchia dell'app con una
 * regola in meno, un report incollato a mano, un client terzo che parla con
 * l'endpoint pubblico. Un segreto che arriva fin qui non deve comunque
 * finire dentro una issue pubblica.
 *
 * Le due implementazioni vanno tenute allineate. I casi di prova stanno in
 * `tests/js/validators/redact.test.ts` e in `game/tools/redactor_selftest.gd`:
 * chi tocca una famiglia di regole tocca entrambi i test.
 *
 * Le REGOLE però non stanno più in questo file: `shared/redaction-rules.js` è
 * la fonte unica per i canali JS, e da lì le legge anche il filtro che ripulisce
 * i messaggi in uscita verso Telegram (O-175). Questo modulo resta l'API.
 */

import { REDACTION_RULES } from "../../shared/redaction-rules.js";

export type RedactFamily = "secret" | "personal";

interface Rule {
  key: string;
  family: RedactFamily;
  pattern: RegExp;
  replace: string;
}

/**
 * Le regole non vivono più qui: stanno in `shared/redaction-rules.js`, perché
 * il canale che ne aveva più bisogno — il testo che ESCE verso Telegram — è
 * bash e non poteva leggere un modulo TypeScript. Spostarle è ciò che rende
 * vera la frase «una regola aggiunta per un canale protegge l'altro» (O-175).
 */
const RULES = REDACTION_RULES as Rule[];

export interface RedactResult {
  text: string;
  counts: Record<string, number>;
}

/**
 * Ripulisce il testo e rendiconta quante sostituzioni per regola.
 *
 * @param families famiglie da applicare; vuoto o assente = tutte (il default
 *   sicuro: una chiamata distratta redige di più, mai di meno).
 */
export function redactWithReport(
  text: string,
  families?: RedactFamily[],
): RedactResult {
  const every = !families || families.length === 0;
  const counts: Record<string, number> = {};
  let out = text;
  for (const rule of RULES) {
    if (!every && !families!.includes(rule.family)) continue;
    const matches = out.match(rule.pattern);
    if (!matches || matches.length === 0) continue;
    counts[rule.key] = matches.length;
    out = out.replace(rule.pattern, rule.replace);
  }
  return { text: out, counts };
}

export function redact(text: string, families?: RedactFamily[]): string {
  return redactWithReport(text, families).text;
}

/** Solo credenziali e chiavi: il trattamento del testo scritto dall'utente. */
export function redactSecrets(text: string): string {
  return redactWithReport(text, ["secret"]).text;
}

/** Vero se resta qualcosa che somiglia a una credenziale. */
export function hasResidualSecret(text: string): boolean {
  return RULES.filter((r) => r.family === "secret").some((r) =>
    new RegExp(r.pattern.source, r.pattern.flags.replace("g", "")).test(text),
  );
}
