/**
 * Setup wizard — onboarding completo al primo avvio.
 * Step: API key → profilo utente (nome, competenze, zona, tipo lavoro).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import * as readline from "node:readline";
import chalk from "chalk";
import { loadProfile, saveProfile, isProfileComplete, type UserProfile } from "./tui-profile.js";

const CONFIG_DIR = join(homedir(), ".jht");
const CONFIG_PATH = join(CONFIG_DIR, "jht.config.json");

function printBanner() {
  console.clear();
  console.log("");
  console.log(chalk.green("  ┌─────────────────────────────────────────┐"));
  console.log(chalk.green("  │") + chalk.bold.white("   Job Hunter Team — Setup Iniziale    ") + chalk.green("│"));
  console.log(chalk.green("  └─────────────────────────────────────────┘"));
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

export async function runSetupWizard(): Promise<string | null> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const TOTAL = 5;

  printBanner();
  console.log(chalk.yellow("  Benvenuto! Configuriamo il tuo Job Hunter Team."));
  console.log(chalk.dim("  I dati vengono salvati in ~/.jht/jht.config.json"));
  console.log("");

  // ── Step 1: API Key ──
  printStep(1, TOTAL, "API Key Anthropic (per la chat AI)");
  console.log(chalk.dim("  Puoi trovarla su https://console.anthropic.com/settings/keys"));
  console.log(chalk.white("    1") + chalk.dim(") Inserisci la chiave"));
  console.log(chalk.white("    2") + chalk.dim(") Salta (potrai configurarla dopo con /setup)"));
  console.log("");

  let apiKey: string | null = null;
  const choice = await ask(rl, chalk.green("  > Scelta (1/2): "));
  if (choice === "1") {
    const key = await ask(rl, chalk.green("  > API Key: "));
    if (key && key.length >= 10) {
      console.log(chalk.dim("  Verifica in corso..."));
      const valid = await testApiKey(key);
      if (valid) {
        saveApiKey(key);
        console.log(chalk.green("  ✓ Chiave valida e salvata."));
        apiKey = key;
      } else {
        const save = await ask(rl, chalk.yellow("  Chiave non verificata. Salvare comunque? (s/n): "));
        if (save.toLowerCase() === "s") { saveApiKey(key); apiKey = key; }
      }
    }
  }
  console.log("");

  // ── Step 2: Nome ──
  printStep(2, TOTAL, "Come ti chiami?");
  const nome = await ask(rl, chalk.green("  > Nome: "));
  console.log("");

  // ── Step 3: Competenze ──
  printStep(3, TOTAL, "Quali sono le tue competenze principali?");
  console.log(chalk.dim("  Separale con virgola. Es: Python, React, Project Management"));
  const compRaw = await ask(rl, chalk.green("  > Competenze: "));
  const competenze = compRaw.split(",").map((s) => s.trim()).filter(Boolean);
  console.log("");

  // ── Step 4: Zona ──
  printStep(4, TOTAL, "In che zona cerchi lavoro?");
  console.log(chalk.dim("  Es: Milano, Roma, Remoto, Italia"));
  const zona = await ask(rl, chalk.green("  > Zona: "));
  console.log("");

  // ── Step 5: Tipo lavoro ──
  printStep(5, TOTAL, "Che tipo di lavoro cerchi?");
  console.log(chalk.dim("  Es: Full-time, Part-time, Freelance, Stage"));
  const tipoLavoro = await ask(rl, chalk.green("  > Tipo: "));
  console.log("");

  // ── Salva profilo ──
  const profile: UserProfile = {
    nome,
    eta: "",
    competenze,
    zona,
    tipoLavoro,
    completato: isProfileComplete({ nome, eta: "", competenze, zona, tipoLavoro, completato: false }),
  };
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
