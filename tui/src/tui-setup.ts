/**
 * Setup wizard — onboarding completo al primo avvio.
 * Step: benvenuto → scelta configurazione → profilo manuale o assistito AI.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import * as readline from "node:readline";
import chalk from "chalk";
import { saveProfile, isProfileComplete, formatProfile, type UserProfile } from "./tui-profile.js";

const CONFIG_DIR = join(homedir(), ".jht");
const CONFIG_PATH = join(CONFIG_DIR, "jht.config.json");
const SETUP_MODEL = "claude-sonnet-4-20250514";

type SetupMode = "manual" | "assistant";

type AssistantProfileDraft = {
  nome?: string;
  eta?: string;
  competenze?: string[];
  zona?: string;
  tipoLavoro?: string;
  followUpQuestion?: string;
  missing?: string[];
};

function printBanner() {
  console.clear();
  console.log("");
  console.log(chalk.green("  ┌─────────────────────────────────────────┐"));
  console.log(chalk.green("  │") + chalk.bold.white("   Job Hunter Team — Setup Iniziale    ") + chalk.green("│"));
  console.log(chalk.green("  └─────────────────────────────────────────┘"));
  console.log("");
}

function printWelcomeOverview() {
  console.log(chalk.white("  Benvenuto nel portale Job Hunter Team."));
  console.log(chalk.dim("  Qui configuri il tuo spazio di lavoro e poi puoi usare:"));
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
    eta: input.eta?.trim() ?? "",
    competenze: Array.isArray(input.competenze) ? input.competenze.map((s) => s.trim()).filter(Boolean) : [],
    zona: input.zona?.trim() ?? "",
    tipoLavoro: input.tipoLavoro?.trim() ?? "",
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

  const nome = await askWithDefault(rl, "Nome", initial?.nome ?? "");
  const eta = await askWithDefault(rl, "Eta", initial?.eta ?? "");
  const competenzeRaw = await askWithDefault(
    rl,
    "Competenze (separate da virgola)",
    Array.isArray(initial?.competenze) ? initial!.competenze!.join(", ") : "",
  );
  const zona = await askWithDefault(rl, "Zona", initial?.zona ?? "");
  const tipoLavoro = await askWithDefault(rl, "Tipo lavoro", initial?.tipoLavoro ?? "");

  return buildProfile({
    nome,
    eta,
    competenze: competenzeRaw.split(",").map((s) => s.trim()).filter(Boolean),
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
    '{"nome":"","eta":"","competenze":[],"zona":"","tipoLavoro":"","followUpQuestion":"","missing":[]}',
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
    eta: typeof parsed.eta === "string" ? parsed.eta : "",
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
  console.log(chalk.dim("  Esempio: sviluppatore React a Milano, 5 anni di esperienza, cerco full-time remoto."));
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
    eta: draft.eta,
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
