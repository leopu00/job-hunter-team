/**
 * Setup wizard — guida l'utente alla configurazione iniziale della TUI.
 * Si attiva quando ANTHROPIC_API_KEY non è trovata.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import * as readline from "node:readline";
import chalk from "chalk";

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

function prompt(rl: readline.Interface, question: string): Promise<string> {
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

function saveApiKey(key: string): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  const cfg = loadExistingConfig();
  if (!cfg.providers || typeof cfg.providers !== "object") {
    (cfg as any).providers = {};
  }
  (cfg as any).providers.anthropic = { api_key: key };
  writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2) + "\n", "utf-8");
}

export async function runSetupWizard(): Promise<string | null> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  printBanner();

  console.log(chalk.yellow("  Benvenuto! Per usare la TUI serve una API key di Anthropic."));
  console.log(chalk.dim("  La chiave verrà salvata in ~/.jht/jht.config.json"));
  console.log("");

  printStep(1, 2, "Come vuoi configurare l'accesso?");
  console.log("");
  console.log(chalk.white("    1") + chalk.dim(") Inserisci la tua ANTHROPIC_API_KEY"));
  console.log(chalk.white("    2") + chalk.dim(") Salta per ora (la TUI partirà senza chat AI)"));
  console.log("");

  const choice = await prompt(rl, chalk.green("  > Scelta (1/2): "));

  if (choice === "1") {
    console.log("");
    printStep(2, 2, "Inserisci la tua API key Anthropic");
    console.log(chalk.dim("  Puoi trovarla su https://console.anthropic.com/settings/keys"));
    console.log("");

    const key = await prompt(rl, chalk.green("  > API Key: "));

    if (!key || key.length < 10) {
      console.log("");
      console.log(chalk.red("  ✗ Chiave non valida. Setup saltato."));
      console.log(chalk.dim("  Puoi riprovare lanciando di nuovo la TUI."));
      console.log("");
      rl.close();
      await sleep(1500);
      return null;
    }

    // Test rapido della key
    console.log("");
    console.log(chalk.dim("  Verifica chiave in corso..."));

    const valid = await testApiKey(key);
    if (valid) {
      saveApiKey(key);
      console.log(chalk.green("  ✓ Chiave valida e salvata in ~/.jht/jht.config.json"));
      console.log("");
      rl.close();
      await sleep(1000);
      return key;
    } else {
      console.log(chalk.red("  ✗ Chiave non valida o errore di connessione."));
      const retry = await prompt(rl, chalk.yellow("  Vuoi salvarla comunque? (s/n): "));
      if (retry.toLowerCase() === "s") {
        saveApiKey(key);
        console.log(chalk.green("  ✓ Chiave salvata."));
        rl.close();
        await sleep(1000);
        return key;
      }
      rl.close();
      await sleep(1000);
      return null;
    }
  }

  // Scelta 2: salta
  console.log("");
  console.log(chalk.dim("  Setup saltato. La TUI partirà senza connessione AI."));
  console.log(chalk.dim("  Puoi configurare la key in qualsiasi momento con /setup"));
  console.log("");
  rl.close();
  await sleep(1500);
  return null;
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
    return res.ok || res.status === 400; // 400 = key valida ma richiesta malformata
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
