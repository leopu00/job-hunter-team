/**
 * Validazione e resa di una segnalazione in arrivo dall'app desktop.
 *
 * Sta fuori dalla route handler per un motivo pratico: qui non c'è niente di
 * Next, quindi si può testare davvero — con input veri e asserzioni sul
 * risultato — invece che a colpi di grep sul sorgente della route.
 */
import { redact } from "./redact";

/** Oltre questa soglia non è una segnalazione: il bundle del client sta sotto
 *  i 200 KB con i log al massimo della coda. */
export const MAX_BODY_BYTES = 512 * 1024;
export const MAX_STORY_CHARS = 4000;
export const MAX_DIAGNOSTICS_CHARS = 200_000;

export interface Report {
  client: string;
  /** Oggetto scritto da chi invia (modulo di contatto del sito). Vuoto per
   *  l'app desktop, che non lo chiede. */
  subject: string;
  /** Che tipo di messaggio è: "bug", "domanda", "altro". Lo manda il modulo
   *  di contatto del sito; l'app desktop lo lascia vuoto. */
  kind: string;
  appVersion: string;
  locale: string;
  platform: string;
  doing: string;
  happened: string;
  expected: string;
  diagnostics: string;
}

function field(value: unknown, max: number): string {
  return typeof value === "string" ? value.slice(0, max).trim() : "";
}

const KNOWN_CLIENTS = new Set([
  "godot-desktop",
  "web-dashboard",
  "web-contact",
]);
const KNOWN_KINDS = new Set([
  "bug",
  "supporto",
  "domanda",
  "collaborazione",
  "privacy",
  "altro",
]);
const PLATFORM_ALIASES: Record<string, string> = {
  windows: "Windows",
  macos: "macOS",
  linux: "Linux",
  android: "Android",
  ios: "iOS",
  web: "Web",
  unknown: "unknown",
};
const WEB_CONTACT_CONTEXTS = new Set(["Public web report: /contact"]);

/**
 * La redazione deve accadere prima di qualunque canale di consegna. Questa è
 * la seconda linea per client vecchi o costruiti da terzi: nessuno di loro può
 * trasformare l'endpoint in un inoltro di dati personali.
 */
function safeNarrative(value: unknown, max: number): string {
  return redact(field(value, max));
}

function safeClient(value: unknown): string {
  const client = field(value, 60);
  return KNOWN_CLIENTS.has(client) ? client : "unknown";
}

function safeKind(value: unknown): string {
  const kind = field(value, 40).toLowerCase();
  return KNOWN_KINDS.has(kind) ? kind : "";
}

function safeVersion(value: unknown): string {
  const version = field(value, 40);
  return /^(?:dev|v?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)$/.test(version)
    ? version
    : "unknown";
}

function safeLocale(value: unknown): string {
  const locale = field(value, 10);
  return /^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(locale) ? locale : "it";
}

function safePlatform(value: unknown): string {
  return PLATFORM_ALIASES[field(value, 40).toLowerCase()] ?? "unknown";
}

function safeDoing(client: string, value: unknown): string {
  if (client !== "web-contact") return safeNarrative(value, MAX_STORY_CHARS);
  // L'unico contesto tecnico pubblico mostrato dal modulo corrente. Lasciarlo
  // passare rende fedele l'anteprima; qualsiasi altra frase (in particolare il
  // vecchio "Modulo di contatto — <nome>") torna al valore anonimo.
  const context = field(value, MAX_STORY_CHARS);
  return WEB_CONTACT_CONTEXTS.has(context) ? context : "Modulo di contatto web";
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
  const client = safeClient(body.client);
  return {
    client,
    subject: safeNarrative(body.subject, 120),
    kind: safeKind(body.kind),
    appVersion: safeVersion(body.app_version),
    locale: safeLocale(body.locale),
    platform: safePlatform(body.platform),
    // Il vecchio modulo pubblico inseriva il nome nel contesto. I nomi non
    // sono riconoscibili con una regex affidabile, quindi questo client ha un
    // contesto fisso: nessuna versione vecchia puo' trasformare il canale
    // tecnico anonimo in un inoltro di dati personali.
    doing: safeDoing(client, body.doing),
    happened: redact(happened),
    expected: safeNarrative(body.expected, MAX_STORY_CHARS),
    // Client aggiornati non lo inviano; in un client vecchio resta nel JSON
    // ricevuto, ma non entra mai nel Report e quindi non lascia l'endpoint.
    diagnostics: safeNarrative(body.diagnostics, MAX_DIAGNOSTICS_CHARS),
  };
}

/**
 * Trappola per i bot: un campo che un umano non vede e non compila mai.
 *
 * Un modulo pubblico senza difese diventa in poche settimane una macchina per
 * spam puntata sulla casella del progetto. Il rate limit ferma i volumi, non
 * i singoli invii automatici — questo li riconosce.
 */
export function sembraSpam(raw: unknown): boolean {
  if (typeof raw !== "object" || raw === null) return false;
  const esca = (raw as Record<string, unknown>).website;
  return typeof esca === "string" && esca.trim().length > 0;
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

/** Oggetto della mail che arriva in casella. */
export function emailSubject(report: Report, ticket: string): string {
  // Quello che ha scritto chi invia batte sempre il troncamento automatico
  // del messaggio: sintetizza meglio, e senza si finisce con una casella
  // piena di mail intitolate "Ciao".
  const summary =
    report.subject || report.happened.split("\n")[0].slice(0, 80).trim();
  // Il tipo in oggetto fa la differenza fra una casella che si smista a
  // colpo d'occhio e una in cui bisogna aprire tutto per capire cosa c'è.
  const tipo = report.kind ? `(${report.kind}) ` : "";
  return `[${ticket}] ${tipo}${summary || "segnalazione dall'app"}`;
}

/**
 * Il corpo della mail: testo semplice, non HTML.
 *
 * La segnalazione va letta, non ammirata — e il testo semplice si legge
 * ovunque, si cita nelle risposte e non porta con sé il rischio di rendere
 * cliccabile qualcosa che un estraneo ha scritto in un campo libero.
 */
export function emailText(report: Report, ticket: string): string {
  const story = (text: string) =>
    text ? neutralize(redact(text)) : "(non indicato)";
  const righe = [
    `Segnalazione ${ticket}`,
    "",
    "COSA STAVO FACENDO",
    story(report.doing),
    "",
    "COSA È SUCCESSO",
    story(report.happened),
    "",
    "COSA MI ASPETTAVO",
    story(report.expected),
    "",
    "CONTESTO",
    `  client:      ${report.client}`,
    `  versione:    ${report.appVersion}`,
    `  piattaforma: ${report.platform}`,
    `  lingua:      ${report.locale}`,
    "",
  ];
  if (report.diagnostics) {
    righe.push(
      "DIAGNOSTICA (già ripulita dai dati personali)",
      "─".repeat(60),
      redact(report.diagnostics),
    );
  }
  return righe.join("\n");
}

export function issueBody(report: Report, ticket: string): string {
  // Seconda passata di redazione: il client sanifica già, questa copre le
  // versioni vecchie e i client non nostri. Tutti i campi testuali passano
  // dalla redazione completa: una issue pubblica non è mai una destinazione
  // lecita per PII.
  const story = (text: string) =>
    text ? neutralize(redact(text)) : "_non indicato_";
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
  lines.push(
    "> Inviata dalla sezione «Segnala un problema» dell'app desktop.",
    "> Il report non include contatti o altri dati personali dell'utente.",
  );
  return lines.join("\n");
}
