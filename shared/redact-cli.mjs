#!/usr/bin/env node
/**
 * redact-cli — filtro stdin→stdout che ripulisce il testo in USCITA.
 *
 * Serve al canale verso Telegram: quello che esce va a un terzo, e lì resta.
 * Non è una difesa contro un attacco — nessuno attacca da dentro il container
 * — è la perdita accidentale: un agente che incolla un traceback contenente
 * una chiave la manderebbe fuori in chiaro (O-175).
 *
 * Le regole NON stanno qui: `shared/redaction-rules.js` è la fonte unica,
 * la stessa che usa il web. È il punto dell'esercizio — una regola aggiunta
 * per un canale protegge l'altro senza che nessuno debba ricordarsene.
 *
 * Vive accanto alle regole e non in `agents/_tools/` di proposito: non è un
 * comando che un agente invoca dal suo prompt, è l'adattatore da riga di
 * comando della fonte unica. Chi cerca le regole trova anche il filtro.
 *
 * Uso:
 *   printf '%s' "$text" | node shared/redact-cli.mjs            # tutto
 *   printf '%s' "$text" | node shared/redact-cli.mjs --secrets  # solo segreti
 *   node shared/redact-cli.mjs --selftest                       # canarino
 *
 * Exit:
 *   0 → testo ripulito su stdout
 *   1 → non è stato possibile ripulire (regole non caricabili, I/O)
 *
 * ⚠️ FAIL-CLOSED: se le regole non si caricano NON si stampa il testo. Un
 * filtro che in caso di guasto lascia passare l'originale è peggio di nessun
 * filtro, perché chi lo ha messo in mezzo smette di guardare. Il chiamante
 * deve decidere cosa fare di un exit 1 — e `jht-telegram-send` non invia.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Le stesse regole del web, accanto a questo file. Il secondo candidato è il
 *  container, dove `shared/` è montato sotto `/app`. */
const CANDIDATES = [
  path.resolve(HERE, "redaction-rules.js"),
  "/app/shared/redaction-rules.js",
];

async function loadRules() {
  const tried = [];
  for (const candidate of CANDIDATES) {
    try {
      readFileSync(candidate);
    } catch {
      tried.push(candidate);
      continue;
    }
    const mod = await import(`file://${candidate}`);
    if (
      !Array.isArray(mod.REDACTION_RULES) ||
      mod.REDACTION_RULES.length === 0
    ) {
      throw new Error(`empty rule set in ${candidate}`);
    }
    return mod.REDACTION_RULES;
  }
  throw new Error(`rules not found; looked in: ${tried.join(", ")}`);
}

function readStdin() {
  try {
    // `/dev/stdin` non è affidabile ovunque; il fd 0 sì.
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function apply(rules, text, onlySecrets) {
  let out = text;
  for (const rule of rules) {
    if (onlySecrets && rule.family !== "secret") continue;
    out = out.replace(rule.pattern, rule.replace);
  }
  return out;
}

async function main() {
  const args = process.argv.slice(2);
  const onlySecrets = args.includes("--secrets");
  let rules;
  try {
    rules = await loadRules();
  } catch (err) {
    process.stderr.write(`redact-cli: ${err.message}\n`);
    process.exit(1);
  }

  if (args.includes("--selftest")) {
    // Un canarino, non una suite: dice che il filtro è raggiungibile e che le
    // regole mordono. La suite vera è `tests/js/validators/redact.test.ts`.
    const sample = "Authorization: Bearer abcdefghijklmnop";
    const cleaned = apply(rules, sample, true);
    if (cleaned.includes("abcdefghijklmnop")) {
      process.stderr.write(
        "redact-cli: selftest FAILED (nothing was redacted)\n",
      );
      process.exit(1);
    }
    process.stdout.write(`redact-cli ok — ${rules.length} rules\n`);
    return;
  }

  process.stdout.write(apply(rules, readStdin(), onlySecrets));
}

await main();
