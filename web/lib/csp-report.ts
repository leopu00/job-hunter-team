/**
 * Il rapporto di violazione della CSP (JHT «web capace», W6), ridotto a UNA riga di log.
 *
 * Il browser lo manda a `/api/csp-report` e chiunque può mandare quello che vuole: qui si tiene solo ciò
 * che serve a capire cosa la politica stretta bloccherebbe, in una forma che non può portare altro. Niente
 * query string, niente frammento, niente contenuto della pagina, niente testo libero: la direttiva da una
 * lista chiusa di caratteri, il bloccato come origin o come parola chiave, la pagina come solo percorso.
 *
 * Modulo puro, senza Next: lo prova un test.
 */

const KEYWORDS = new Set([
  "inline",
  "eval",
  "wasm-eval",
  "data",
  "blob",
  "filesystem",
  "self",
  "trusted-types-policy",
]);
const DIRECTIVE = /^[a-z][a-z-]{2,39}$/;
const MAX_PATH = 120;

function pick(report: Record<string, unknown>, ...names: string[]): unknown {
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(report, name)) return report[name];
  }
  return undefined;
}

/** `https://cdn.example/x.js?token=1` -> `https://cdn.example`; una parola chiave nota resta tale; il resto è `other`. */
export function blockedLabel(value: unknown): string {
  if (typeof value !== "string" || value === "") return "none";
  const text = value.trim().toLowerCase();
  if (KEYWORDS.has(text)) return text;
  try {
    const url = new URL(value);
    if (
      url.protocol === "https:" ||
      url.protocol === "http:" ||
      url.protocol === "wss:" ||
      url.protocol === "ws:"
    ) {
      return url.origin.slice(0, 120).replace(/[^A-Za-z0-9:/.\-_\[\]]/g, "");
    }
    if (KEYWORDS.has(url.protocol.replace(":", "")))
      return url.protocol.replace(":", "");
  } catch {
    /* non è un indirizzo */
  }
  return "other";
}

/** Solo il percorso della pagina, senza query né frammento, con caratteri da percorso. */
export function pathLabel(value: unknown): string {
  if (typeof value !== "string") return "-";
  try {
    const path = new URL(value).pathname;
    return (
      path.slice(0, MAX_PATH).replace(/[^A-Za-z0-9/_\-.~\[\]%]/g, "") || "/"
    );
  } catch {
    return "-";
  }
}

function one(report: unknown): string | null {
  if (report === null || typeof report !== "object" || Array.isArray(report))
    return null;
  const r = report as Record<string, unknown>;
  const directive = pick(
    r,
    "effective-directive",
    "effectiveDirective",
    "violated-directive",
    "violatedDirective",
  );
  if (typeof directive !== "string") return null;
  const name = directive.trim().split(/\s+/)[0].toLowerCase();
  if (!DIRECTIVE.test(name)) return null;
  const blocked = blockedLabel(
    pick(r, "blocked-uri", "blockedURL", "blockedUri"),
  );
  const doc = pathLabel(pick(r, "document-uri", "documentURL", "documentUri"));
  return `directive=${name} blocked=${blocked} doc=${doc}`;
}

/**
 * Il corpo di un POST di rapporto -> le righe da registrare (al più 10). Due forme: la vecchia
 * `{"csp-report": {...}}` di `report-uri` e quella della Reporting API, una lista di
 * `{type: "csp-violation", body: {...}}`.
 */
export function digestReports(payload: unknown): string[] {
  const lines: string[] = [];
  const add = (report: unknown) => {
    const line = one(report);
    if (line && lines.length < 10) lines.push(line);
  };
  if (Array.isArray(payload)) {
    for (const item of payload.slice(0, 10)) {
      if (
        item &&
        typeof item === "object" &&
        (item as Record<string, unknown>).type === "csp-violation"
      ) {
        add((item as Record<string, unknown>).body);
      }
    }
  } else if (payload && typeof payload === "object") {
    add((payload as Record<string, unknown>)["csp-report"]);
  }
  return lines;
}
