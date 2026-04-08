/**
 * Setup wizard — onboarding completo al primo avvio.
 * Step: cartella di lavoro → scelta configurazione → profilo manuale o assistito AI.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import * as readline from "node:readline";
import chalk from "chalk";
import {
  ensureWorkspaceInitialized,
  saveProfile,
  isProfileComplete,
  formatProfile,
  validateProfileField,
  loadWorkspacePath,
  saveWorkspacePath,
  validateWorkspacePath,
  type UserProfile,
} from "./tui-profile.js";

const CONFIG_DIR = join(homedir(), ".jht");
const CONFIG_PATH = join(CONFIG_DIR, "jht.config.json");
const SETUP_MODEL = "claude-sonnet-4-20250514";

type SetupMode = "manual" | "assistant";

type AssistantProfileDraft = {
  nome?: string;
  cognome?: string;
  dataNascita?: string;
  competenze?: string[];
  zona?: string;
  tipoLavoro?: string;
  followUpQuestion?: string;
  missing?: string[];
};

function printBanner() {
  const centerText = (value: string, width: number): string => {
    if (value.length >= width) return value;
    const totalPadding = width - value.length;
    const leftPadding = Math.floor(totalPadding / 2);
    const rightPadding = totalPadding - leftPadding;
    return `${" ".repeat(leftPadding)}${value}${" ".repeat(rightPadding)}`;
  };

  const logoLines = [
    "     ██╗██╗  ██╗████████╗",
    "     ██║██║  ██║╚══██╔══╝",
    "     ██║███████║   ██║   ",
    "██   ██║██╔══██║   ██║   ",
    "╚█████╔╝██║  ██║   ██║   ",
    " ╚════╝ ╚═╝  ╚═╝   ╚═╝   ",
  ];
  const titleLines = [
    "",
    "Job Hunter Team",
    "Setup Iniziale",
  ];
  const innerWidth = Math.max(
    ...logoLines.map((line) => line.length),
    ...titleLines.map((line) => line.length),
  );
  const frameRaw = (line: string) => `   ║ ${line.padEnd(innerWidth, " ")} ║`;
  const frameCentered = (line: string) => `   ║ ${centerText(line, innerWidth)} ║`;

  console.clear();
  console.log("");
  console.log(chalk.green(`   ╔${"═".repeat(innerWidth + 2)}╗`));
  for (const line of logoLines) {
    console.log(chalk.green(frameRaw(line)));
  }
  for (const line of titleLines) {
    console.log(chalk.green(frameCentered(line)));
  }
  console.log(chalk.green(`   ╚${"═".repeat(innerWidth + 2)}╝`));
  console.log("");
}

function formatWorkspaceInitSummary(init: ReturnType<typeof ensureWorkspaceInitialized>): string | null {
  const created: string[] = [];
  if (init.createdDb) created.push("database");
  if (init.createdProfileDir) created.push("cartella profilo");
  if (init.createdUploadsDir) created.push("cartella uploads");
  if (created.length === 0) return null;
  return created.join(", ");
}

function printWelcomeOverview() {
  console.log(chalk.white("  Benvenuto nel portale Job Hunter Team."));
  console.log(chalk.dim("  Qui completi la configurazione iniziale e poi puoi usare:"));
  console.log("");
  console.log(chalk.white("    • Dashboard") + chalk.dim("  riepilogo profilo, task e stato team"));
  console.log(chalk.white("    • Team") + chalk.dim("       agenti attivi e sessioni runtime"));
  console.log(chalk.white("    • Tasks") + chalk.dim("      ricerche e lavorazioni in corso"));
  console.log(chalk.white("    • AI") + chalk.dim("         assistente per CV, offerte e colloqui"));
  console.log("");
  console.log(chalk.dim("  I dati vengono salvati in ~/.jht/jht.config.json"));
  console.log("");
}

function printStep(n: number, total: number, text: string) {
  console.log(chalk.dim(`  [${n}/${total}]`) + " " + chalk.white(text));
}

function ask(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });
}

async function askChoice(
  rl: readline.Interface,
  question: string,
  allowed: string[],
  fallback?: string,
): Promise<string> {
  while (true) {
    const answer = (await ask(rl, question)) || (fallback ?? "");
    if (allowed.includes(answer)) return answer;
    console.log(chalk.yellow(`  Inserisci una scelta valida: ${allowed.join("/")}`));
  }
}

async function askWithDefault(
  rl: readline.Interface,
  label: string,
  fallback: string,
): Promise<string> {
  const suffix = fallback ? ` [${fallback}]` : "";
  const answer = await ask(rl, chalk.green(`  > ${label}${suffix}: `));
  return answer || fallback;
}

async function askValidatedField(
  rl: readline.Interface,
  field: "nome" | "cognome" | "dataNascita" | "competenze" | "zona" | "tipoLavoro",
  label: string,
  fallback: string,
): Promise<string | string[]> {
  while (true) {
    const raw = await askWithDefault(rl, label, fallback);
    const validation = validateProfileField(field, raw);
    if (validation.ok) return validation.value;
    console.log(chalk.yellow(`  ${validation.error}`));
  }
}

function openWorkspaceFolderPicker(initialPath: string): string | null {
  if (process.platform === "darwin") {
    const resolvedPath = resolve(initialPath);
    const scriptLines = [
      'tell application "Finder" to activate',
      ...(existsSync(resolvedPath)
        ? [
            `set startFolder to POSIX file ${JSON.stringify(resolvedPath)}`,
            'set selectedFolder to choose folder with prompt "Seleziona la cartella di lavoro" default location startFolder',
          ]
        : [
            'set selectedFolder to choose folder with prompt "Seleziona la cartella di lavoro"',
          ]),
      'POSIX path of selectedFolder',
    ];

    const result = spawnSync("osascript", scriptLines.flatMap((line) => ["-e", line]), {
      encoding: "utf-8",
      timeout: 120_000,
    });

    if (result.status !== 0) {
      return null;
    }

    const selected = result.stdout.trim();
    return selected || null;
  }

  if (process.platform !== "win32") {
    return null;
  }

  const escapedPath = initialPath.replace(/'/g, "''");
  const script = [
    "Add-Type -AssemblyName System.Windows.Forms",
    "$dialog = New-Object System.Windows.Forms.OpenFileDialog",
    "$dialog.Title = 'Seleziona la cartella di lavoro'",
    "$dialog.Filter = 'Cartelle|*.folder'",
    "$dialog.CheckFileExists = $false",
    "$dialog.CheckPathExists = $true",
    "$dialog.ValidateNames = $false",
    "$dialog.DereferenceLinks = $true",
    "$dialog.FileName = 'Seleziona questa cartella'",
    `$initialPath = '${escapedPath}'`,
    "if ($initialPath -and (Test-Path -LiteralPath $initialPath)) { $dialog.InitialDirectory = $initialPath }",
    "$result = $dialog.ShowDialog()",
    "if ($result -eq [System.Windows.Forms.DialogResult]::OK) {",
    "  $selected = Split-Path -Path $dialog.FileName -Parent",
    "  if (-not $selected) { $selected = $dialog.FileName }",
    "  Write-Output $selected",
    "}",
  ].join("; ");

  const result = spawnSync("powershell.exe", [
    "-NoLogo",
    "-NoProfile",
    "-STA",
    "-Command",
    script,
  ], {
    encoding: "utf-8",
    timeout: 120_000,
  });

  if (result.status !== 0) {
    return null;
  }

  const selected = result.stdout.trim();
  return selected || null;
}

async function promptWorkspacePath(rl: readline.Interface, fallback: string, reason?: string): Promise<string> {
  printBanner();
  console.log(chalk.white("  📁 Premi Enter per selezionare la tua cartella di lavoro."));
  if (reason) {
    console.log("");
    console.log(chalk.yellow(`  ${reason}`));
  }
  console.log("");

  while (true) {
    const answer = await ask(rl, chalk.green("  > "));
    const candidate = answer || openWorkspaceFolderPicker(fallback);
    if (!candidate) {
      console.log(chalk.yellow("  Nessuna cartella selezionata."));
      continue;
    }
    const normalizedCandidate = resolve(candidate);
    let initSummary: string | null = null;
    let validation = validateWorkspacePath(normalizedCandidate);
    if (!validation.ok && /cartella non trovata/i.test(validation.error)) {
      try {
        initSummary = formatWorkspaceInitSummary(ensureWorkspaceInitialized(normalizedCandidate));
        validation = validateWorkspacePath(normalizedCandidate);
      } catch (error) {
        const message = error instanceof Error ? error.message : "impossibile inizializzare la cartella";
        console.log(chalk.yellow(`  ${message}`));
        continue;
      }
    }
    if (validation.ok) {
      const init = ensureWorkspaceInitialized(validation.value);
      saveWorkspacePath(validation.value);
      console.log(chalk.green(`  ✓ Cartella di lavoro salvata: ${validation.value}`));
      const currentSummary = formatWorkspaceInitSummary(init);
      if (currentSummary || initSummary) {
        console.log(chalk.green(`  ✓ Workspace inizializzato: ${currentSummary ?? initSummary}`));
      }
      console.log("");
      return validation.value;
    }
    console.log(chalk.yellow(`  ${validation.error}`));
  }
}

function loadExistingConfig(): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
  } catch {
    return {};
  }
}

export function saveApiKey(key: string): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  const cfg = loadExistingConfig();
  if (!cfg.providers || typeof cfg.providers !== "object") {
    (cfg as any).providers = {};
  }
  (cfg as any).providers.anthropic = { api_key: key };
  writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2) + "\n", "utf-8");
}

function buildProfile(input: Partial<UserProfile>): UserProfile {
  const profile: UserProfile = {
    nome: input.nome?.trim() ?? "",
    cognome: input.cognome?.trim() ?? "",
    dataNascita: input.dataNascita?.trim() ?? "",
    headline: input.headline?.trim() ?? "",
    targetRoles: Array.isArray(input.targetRoles) ? input.targetRoles.map((s) => s.trim()).filter(Boolean) : [],
    seniorityTarget: input.seniorityTarget?.trim() ?? "",
    competenze: Array.isArray(input.competenze) ? input.competenze.map((s) => s.trim()).filter(Boolean) : [],
    zona: input.zona?.trim() ?? "",
    locationPreferences: Array.isArray(input.locationPreferences)
      ? input.locationPreferences.map((s) => s.trim()).filter(Boolean)
      : input.zona?.trim()
        ? [input.zona.trim()]
        : [],
    tipoLavoro: input.tipoLavoro?.trim() ?? "",
    languages: Array.isArray(input.languages) ? input.languages.map((s) => s.trim()).filter(Boolean) : [],
    strengths: Array.isArray(input.strengths) ? input.strengths.map((s) => s.trim()).filter(Boolean) : [],
    email: input.email?.trim() ?? "",
    linkedin: input.linkedin?.trim() ?? "",
    portfolio: input.portfolio?.trim() ?? "",
    salaryTarget: input.salaryTarget?.trim() ?? "",
    availability: input.availability?.trim() ?? "",
    workAuthorization: input.workAuthorization?.trim() ?? "",
    completato: false,
  };
  profile.completato = isProfileComplete(profile);
  return profile;
}

async function collectManualProfile(
  rl: readline.Interface,
  initial?: Partial<UserProfile>,
): Promise<UserProfile> {
  printStep(4, 4, "Profilo manuale");
  console.log(chalk.dim("  Compila i campi principali del profilo."));
  console.log("");

  const nome = await askValidatedField(rl, "nome", "Nome", initial?.nome ?? "") as string;
  const cognome = await askValidatedField(rl, "cognome", "Cognome", initial?.cognome ?? "") as string;
  const dataNascita = await askValidatedField(rl, "dataNascita", "Data di nascita", initial?.dataNascita ?? "") as string;
  const competenze = await askValidatedField(
    rl,
    "competenze",
    "Competenze (separate da virgola)",
    Array.isArray(initial?.competenze) ? initial.competenze.join(", ") : "",
  );
  const zona = await askValidatedField(rl, "zona", "Zona", initial?.zona ?? "") as string;
  const tipoLavoro = await askValidatedField(rl, "tipoLavoro", "Tipo lavoro", initial?.tipoLavoro ?? "") as string;

  return buildProfile({
    nome,
    cognome,
    dataNascita,
    competenze: competenze as string[],
    zona,
    tipoLavoro,
  });
}

function extractJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  return text.slice(start, end + 1);
}

async function generateAssistantProfile(
  apiKey: string,
  notes: string,
): Promise<AssistantProfileDraft> {
  const systemPrompt = [
    "Sei l'assistente di onboarding del Job Hunter Team.",
    "Dato un testo libero dell'utente, estrai un profilo candidato.",
    "Rispondi solo con JSON valido, senza markdown.",
    "Schema:",
    '{"nome":"","cognome":"","dataNascita":"","competenze":[],"zona":"","tipoLavoro":"","followUpQuestion":"","missing":[]}',
    "Usa stringhe vuote se un campo non e noto.",
    "followUpQuestion deve contenere una sola domanda breve solo se manca un dato importante.",
  ].join("\n");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: SETUP_MODEL,
      max_tokens: 500,
      system: systemPrompt,
      messages: [{ role: "user", content: notes }],
    }),
    signal: AbortSignal.timeout(20_000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`API ${res.status}: ${body.slice(0, 200)}`);
  }

  const payload = await res.json() as { content?: Array<{ type?: string; text?: string }> };
  const rawText = (payload.content ?? [])
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text ?? "")
    .join("\n")
    .trim();

  const jsonText = extractJsonObject(rawText);
  if (!jsonText) {
    throw new Error("risposta AI non parseabile");
  }

  const parsed = JSON.parse(jsonText) as AssistantProfileDraft;
  return {
    nome: typeof parsed.nome === "string" ? parsed.nome : "",
    cognome: typeof parsed.cognome === "string" ? parsed.cognome : "",
    dataNascita: typeof parsed.dataNascita === "string" ? parsed.dataNascita : "",
    competenze: Array.isArray(parsed.competenze) ? parsed.competenze.filter((v): v is string => typeof v === "string") : [],
    zona: typeof parsed.zona === "string" ? parsed.zona : "",
    tipoLavoro: typeof parsed.tipoLavoro === "string" ? parsed.tipoLavoro : "",
    followUpQuestion: typeof parsed.followUpQuestion === "string" ? parsed.followUpQuestion : "",
    missing: Array.isArray(parsed.missing) ? parsed.missing.filter((v): v is string => typeof v === "string") : [],
  };
}

async function collectAssistantProfile(
  rl: readline.Interface,
  apiKey: string,
): Promise<UserProfile> {
  printStep(4, 4, "Profilo assistito da AI");
  console.log(chalk.dim("  Descrivi il tuo profilo in linguaggio naturale."));
  console.log(chalk.dim("  Esempio: Anna Verdi, nata il 14/02/1994, ha esperienza in assistenza clienti e organizzazione, disponibile a Roma e provincia, cerca un lavoro full-time."));
  console.log("");

  let notes = await ask(rl, chalk.green("  > Raccontami chi sei: "));
  if (!notes) {
    console.log(chalk.yellow("  Nessuna descrizione inserita. Passo alla compilazione manuale."));
    return collectManualProfile(rl);
  }

  console.log(chalk.dim("  L'assistente sta preparando una proposta profilo..."));
  let draft = await generateAssistantProfile(apiKey, notes);

  if (draft.followUpQuestion) {
    console.log("");
    console.log(chalk.white(`  Domanda assistente: ${draft.followUpQuestion}`));
    const answer = await ask(rl, chalk.green("  > Risposta: "));
    if (answer) {
      notes += `\n\nInformazione aggiuntiva: ${answer}`;
      console.log(chalk.dim("  Aggiorno la proposta..."));
      draft = await generateAssistantProfile(apiKey, notes);
    }
  }

  const proposed = buildProfile({
    nome: draft.nome,
    cognome: draft.cognome,
    dataNascita: draft.dataNascita,
    competenze: draft.competenze,
    zona: draft.zona,
    tipoLavoro: draft.tipoLavoro,
  });

  console.log("");
  console.log(chalk.white("  Proposta profilo:"));
  for (const line of formatProfile(proposed)) {
    console.log(chalk.white(line));
  }
  console.log("");
  console.log(chalk.white("    1") + chalk.dim(") Conferma e salva"));
  console.log(chalk.white("    2") + chalk.dim(") Rifinisci manualmente"));
  console.log("");

  const choice = await askChoice(rl, chalk.green("  > Scelta (1/2): "), ["1", "2"]);
  if (choice === "1") return proposed;

  console.log("");
  return collectManualProfile(rl, proposed);
}

async function promptApiKey(
  rl: readline.Interface,
  step: number,
  total: number,
  required: boolean,
): Promise<string | null> {
  printStep(step, total, required ? "API key Anthropic (necessaria per assistente AI)" : "API key Anthropic (opzionale)");
  console.log(chalk.dim("  Puoi trovarla su https://console.anthropic.com/settings/keys"));
  if (required) {
    console.log(chalk.white("    1") + chalk.dim(") Inserisci la chiave"));
    console.log(chalk.white("    2") + chalk.dim(") Torna alla configurazione manuale"));
  } else {
    console.log(chalk.white("    1") + chalk.dim(") Inserisci la chiave"));
    console.log(chalk.white("    2") + chalk.dim(") Salta per ora"));
  }
  console.log("");

  const choice = await askChoice(rl, chalk.green("  > Scelta (1/2): "), ["1", "2"]);
  if (choice === "2") return null;

  const key = await ask(rl, chalk.green("  > API Key: "));
  if (!key || key.length < 10) {
    console.log(chalk.yellow("  Chiave vuota o troppo corta."));
    return required ? promptApiKey(rl, step, total, required) : null;
  }

  console.log(chalk.dim("  Verifica in corso..."));
  const valid = await testApiKey(key);
  if (valid) {
    saveApiKey(key);
    console.log(chalk.green("  ✓ Chiave valida e salvata."));
    return key;
  }

  console.log(chalk.yellow("  Chiave non verificata."));
  if (required) {
    console.log(chalk.yellow("  Senza chiave valida l'assistente AI non puo essere usato."));
    return promptApiKey(rl, step, total, required);
  }

  const save = await askChoice(rl, chalk.green("  > Salvare comunque? (s/n): "), ["s", "n"], "n");
  if (save === "s") {
    saveApiKey(key);
    return key;
  }
  return null;
}

export async function runSetupWizard(): Promise<string | null> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  printBanner();
  printWelcomeOverview();

  printStep(1, 4, "Avvio configurazione");
  console.log(chalk.white("    1") + chalk.dim(") Inizia configurazione"));
  console.log(chalk.white("    2") + chalk.dim(") Esci per ora"));
  console.log("");

  const startChoice = await askChoice(rl, chalk.green("  > Scelta (1/2): "), ["1", "2"]);
  if (startChoice === "2") {
    rl.close();
    return null;
  }

  console.log("");
  printStep(2, 4, "Come vuoi inserire i tuoi dati?");
  console.log(chalk.white("    1") + chalk.dim(") Manualmente"));
  console.log(chalk.white("    2") + chalk.dim(") Con l'assistente AI"));
  console.log("");

  const modeChoice = await askChoice(rl, chalk.green("  > Scelta (1/2): "), ["1", "2"]);
  const mode: SetupMode = modeChoice === "2" ? "assistant" : "manual";

  console.log("");
  let apiKey: string | null = null;
  if (mode === "assistant") {
    apiKey = await promptApiKey(rl, 3, 4, true);
    if (!apiKey) {
      console.log("");
      console.log(chalk.yellow("  Passo alla configurazione manuale."));
    }
  } else {
    apiKey = await promptApiKey(rl, 3, 4, false);
  }

  console.log("");
  const profile = mode === "assistant" && apiKey
    ? await collectAssistantProfile(rl, apiKey)
    : await collectManualProfile(rl);

  saveProfile(profile);

  console.log(chalk.green("  ✓ Profilo salvato!"));
  if (profile.completato) {
    console.log(chalk.green("  ✓ Setup completato — gli agenti possono iniziare a cercare."));
  } else {
    console.log(chalk.yellow("  ⚠ Profilo incompleto — usa /profile nella TUI per completarlo."));
  }
  console.log("");
  rl.close();
  await sleep(1500);
  return apiKey;
}

export async function ensureWorkspaceConfigured(): Promise<string> {
  const savedWorkspace = loadWorkspacePath();
  const validation = savedWorkspace ? validateWorkspacePath(savedWorkspace) : null;
  if (validation?.ok) {
    ensureWorkspaceInitialized(validation.value);
    return validation.value;
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const workspace = await promptWorkspacePath(
    rl,
    savedWorkspace || homedir(),
    savedWorkspace ? "La cartella di lavoro salvata non e piu disponibile." : undefined,
  );
  rl.close();
  await sleep(800);
  return workspace;
}

async function testApiKey(key: string): Promise<boolean> {
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1,
        messages: [{ role: "user", content: "test" }],
      }),
      signal: AbortSignal.timeout(10000),
    });
    return res.ok || res.status === 400;
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
