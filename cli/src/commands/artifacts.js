// Comando `jht artifact` — i documenti che attraversano il confine utente↔team
//
// Due verbi del BackendBus del gioco che dal CLI non esistevano:
// `fetch_artifact` (il CV che il team ha scritto) e `upload_user_document`
// (il CV che l'utente consegna). Erano gli ultimi due della riga "decidere"
// di [JHT-CLI-AGENT-PARITY] rimasti raggiungibili solo dall'ufficio Godot o
// dal browser: un agente poteva leggere `cv_path` in `jht positions show` e
// non aveva modo di leggere il file che quel campo nomina.
//
// Qui non c'è nessuna regola di sicurezza: stanno tutte in
// `shared/skills/artifact.py`, che è l'unico posto in cui il path non fidato
// del jobs.db viene giudicato. Questo file trasporta byte e propaga exit code.
//
// I byte viaggiano SEMPRE in base64 fra CLI e skill, in tutte e due le
// direzioni: la skill può girare dentro il container, e fra i due c'è
// `docker exec`, che è un canale di testo.

import { Command } from "commander";
import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { runSkillCaptured } from "./positions.js";
import { c } from "./_colors.js";

// Un documento vale al massimo 10 MB (tetto della skill), che in base64
// diventano ~13,4 MB, più la cornice JSON. 32 MB lasciano margine senza
// trasformare un file grande in un ENOBUFS che sembra un container rotto.
const MAX_BUFFER = 32 * 1024 * 1024;

// Exit code: 0 riuscito · 1 rifiutato dalla skill (path non valido, file
// mancante, estensione negata) · 2 il comando non è nemmeno partito (skill
// irraggiungibile, file locale illeggibile, uso sbagliato). Un comando che
// fallisce NON esce 0: è già stato un difetto vero su `jht download`.
const EXIT_USAGE = 2;

/**
 * L'unica riga JSON che la skill stampa. Cercarla invece di fare
 * `JSON.parse(stdout)` intero: sul canale del container possono arrivare
 * anche righe di avviso di Python, e una di quelle farebbe fallire il parse
 * con un errore che non c'entra niente col documento.
 */
function parseSkillJson(stdout) {
  for (const line of String(stdout).split("\n").reverse()) {
    const trimmed = line.trim();
    if (trimmed.startsWith("{")) {
      try {
        return JSON.parse(trimmed);
      } catch {
        return null;
      }
    }
  }
  return null;
}

function reportSkillFailure(result, parsed) {
  if (parsed && parsed.error) console.error(c.red(`: ${parsed.error}`));
  else if (result.stderr) process.stderr.write(result.stderr);
  else console.error(c.red(": the skill returned an unreadable answer"));
}

function fetchAction(path, options) {
  const result = runSkillCaptured(
    "artifact.py",
    ["fetch", String(path), "--kind", options.kind],
    { maxBuffer: MAX_BUFFER },
  );
  const parsed = parseSkillJson(result.stdout);
  if (result.code !== 0 || !parsed || !parsed.ok) {
    reportSkillFailure(result, parsed);
    // Il codice della skill quando c'è, altrimenti un fallimento di trasporto.
    process.exitCode = result.code === 0 ? EXIT_USAGE : result.code;
    return;
  }
  if (options.json) {
    console.log(JSON.stringify(parsed));
    return;
  }
  const data = Buffer.from(parsed.b64, "base64");
  if (options.out) {
    try {
      writeFileSync(options.out, data);
    } catch (error) {
      console.error(c.red(`: cannot write ${options.out}: ${error.message}`));
      process.exitCode = EXIT_USAGE;
      return;
    }
    console.log(`${options.out} — ${parsed.bytes} bytes`);
    return;
  }
  // Un PDF riversato in un terminale lo rende illeggibile e non serve a
  // nessuno: chi lo vuole lo chiede su file (--out) o in base64 (--json).
  if (options.kind === "pdf") {
    console.error(c.red(": a PDF is binary — use --out <file> or --json"));
    process.exitCode = EXIT_USAGE;
    return;
  }
  process.stdout.write(data.toString("utf8"));
}

/**
 * Carica un file attraverso la skill canonica senza decidere cosa farne dopo.
 * Anche `ticket open --attach` usa questa funzione: upload e ticket non hanno
 * due trasporti quasi uguali che possono divergere su limiti o path.
 */
export function uploadFileToTeam(file) {
  let data;
  try {
    data = readFileSync(file);
  } catch (error) {
    return {
      ok: false,
      code: EXIT_USAGE,
      error: c.red(`: cannot read ${file}: ${error.message}`),
    };
  }
  // Il nome viaggia separato dai byte: la skill decide se l'estensione è
  // ammessa, qui non si giudica niente.
  const result = runSkillCaptured(
    "artifact.py",
    ["upload", "--name", basename(file)],
    { input: data.toString("base64"), maxBuffer: MAX_BUFFER },
  );
  const parsed = parseSkillJson(result.stdout);
  if (result.code !== 0 || !parsed || !parsed.ok) {
    return {
      ok: false,
      code: result.code === 0 ? EXIT_USAGE : result.code,
      result,
      parsed,
    };
  }
  return { ok: true, code: 0, parsed };
}

export function reportUploadFailure(outcome) {
  if (outcome.error) console.error(outcome.error);
  else reportSkillFailure(outcome.result, outcome.parsed);
}

function uploadAction(file, options) {
  const outcome = uploadFileToTeam(file);
  if (!outcome.ok) {
    reportUploadFailure(outcome);
    process.exitCode = outcome.code;
    return;
  }
  const parsed = outcome.parsed;
  console.log(
    options.json
      ? JSON.stringify(parsed)
      : `${parsed.path} — ${parsed.bytes} bytes`,
  );
}

function rootsAction(options) {
  const result = runSkillCaptured("artifact.py", ["roots"]);
  const parsed = parseSkillJson(result.stdout);
  if (result.code !== 0 || !parsed || !parsed.ok) {
    reportSkillFailure(result, parsed);
    process.exitCode = result.code === 0 ? EXIT_USAGE : result.code;
    return;
  }
  if (options.json) {
    console.log(JSON.stringify(parsed));
    return;
  }
  for (const root of parsed.roots) console.log(root);
}

export function registerArtifactCommand(program) {
  const cmd = new Command("artifact").description(
    "Documents produced by the team, and documents you hand to it (proxy to artifact.py)",
  );

  cmd
    .command("fetch <path>")
    .description(
      "Read a document produced by the team (path from `jht positions show`)",
    )
    .requiredOption(
      "--kind <type>",
      "pdf | markdown — must match the file suffix",
    )
    .option(
      "-o, --out <file>",
      "write the bytes to this file instead of stdout",
    )
    .option("--json", "print the skill answer as-is (bytes in base64)")
    .action(fetchAction);

  cmd
    .command("upload <file>")
    .description("Hand a document (CV, cover letter) to the team drop-zone")
    .option("--json", "print the skill answer as-is")
    .action(uploadAction);

  cmd
    .command("roots")
    .description("The data areas a document can come from")
    .option("--json", "print the skill answer as-is")
    .action(rootsAction);

  program.addCommand(cmd);
}
