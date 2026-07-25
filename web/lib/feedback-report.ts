/**
 * Validazione e resa di una segnalazione in arrivo dall'app desktop.
 *
 * Sta fuori dalla route handler per un motivo pratico: qui non c'è niente di
 * Next, quindi si può testare davvero — con input veri e asserzioni sul
 * risultato — invece che a colpi di grep sul sorgente della route.
 */
import { redact, redactSecrets } from "./redact";

/** Oltre questa soglia non è una segnalazione: il bundle del client sta sotto
 *  i 200 KB con i log al massimo della coda. */
export const MAX_BODY_BYTES = 512 * 1024;
export const MAX_STORY_CHARS = 4000;
export const MAX_DIAGNOSTICS_CHARS = 200_000;

export interface Report {
  client: string;
  appVersion: string;
  locale: string;
  platform: string;
  doing: string;
  happened: string;
  expected: string;
  contact: string;
  diagnostics: string;
}

function field(value: unknown, max: number): string {
  return typeof value === "string" ? value.slice(0, max).trim() : "";
}

/**
 * Neutralizza ciò che GitHub interpreterebbe.
 *
 * Un campo libero che finisce dentro una issue è un vettore di spam verso
 * terzi: `@qualcuno` notifica una persona vera, `#123` aggancia una issue a
 * caso, e i backtick tripli possono rompere il blocco che racchiude i log.
 * Lo zero-width space spezza il riferimento lasciando il testo leggibile.
 */
export function neutralize(text: string): string {
  return text
    .replace(/@(?=[A-Za-z0-9-]+)/g, "@​")
    .replace(/#(?=\d+)/g, "#​")
    .replace(/```/g, "'''");
}

/**
 * Valida il payload. `null` = non è una segnalazione utilizzabile.
 *
 * Il racconto di cosa è successo è l'unico campo obbligatorio: senza quello
 * non c'è niente da triagiare, con quello si lavora anche se il resto è vuoto.
 */
export function parseReport(raw: unknown): Report | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw))
    return null;
  const body = raw as Record<string, unknown>;
  const happened = field(body.happened, MAX_STORY_CHARS);
  if (happened.length < 5) return null;
  return {
    client: field(body.client, 60) || "unknown",
    appVersion: field(body.app_version, 40) || "unknown",
    locale: field(body.locale, 10) || "it",
    platform: field(body.platform, 40) || "unknown",
    doing: field(body.doing, MAX_STORY_CHARS),
    happened,
    expected: field(body.expected, MAX_STORY_CHARS),
    contact: field(body.contact, 200),
    diagnostics: field(body.diagnostics, MAX_DIAGNOSTICS_CHARS),
  };
}

/** Riferimento leggibile a voce e al telefono, non un UUID: l'utente lo
 *  ripete quando ci riscrive. */
export function newTicket(now: number = Date.now()): string {
  return `JHT-${now.toString(36).toUpperCase()}`;
}

export function issueTitle(report: Report): string {
  const summary = report.happened.split("\n")[0].slice(0, 90).trim();
  return `[in-app] ${summary || "segnalazione senza titolo"}`;
}

export function issueBody(report: Report, ticket: string): string {
  // Seconda passata di redazione: il client sanifica già, questa copre le
  // versioni vecchie e i client non nostri. I racconti perdono solo le
  // credenziali, la diagnostica passa da tutte le regole.
  const story = (text: string) =>
    text ? neutralize(redactSecrets(text)) : "_non indicato_";
  const lines = [
    `**Riferimento**: \`${ticket}\``,
    "",
    "### Cosa stavo facendo",
    "",
    story(report.doing),
    "",
    "### Cosa è successo",
    "",
    story(report.happened),
    "",
    "### Cosa mi aspettavo",
    "",
    story(report.expected),
    "",
    "### Contesto",
    "",
    `- **client**: ${report.client}`,
    `- **versione**: ${report.appVersion}`,
    `- **piattaforma**: ${report.platform}`,
    `- **lingua**: ${report.locale}`,
    `- **risposta a**: ${report.contact ? "sì, contatto allegato" : "nessun contatto lasciato"}`,
    "",
  ];
  if (report.diagnostics) {
    lines.push(
      "<details><summary>Diagnostica allegata</summary>",
      "",
      neutralize(redact(report.diagnostics)),
      "",
      "</details>",
      "",
    );
  }
  // Il contatto resta fuori dalla issue: è l'unico dato che l'utente ci dà
  // apposta, e finirebbe su una pagina pubblica indicizzabile.
  lines.push(
    "> Inviata dalla sezione «Segnala un problema» dell'app desktop.",
    "> Il contatto dell'utente NON è in questa issue: viaggia sul canale privato.",
  );
  return lines.join("\n");
}
