/**
 * Setup wizard — onboarding completo al primo avvio.
 * Step: cartella di lavoro → scelta configurazione → profilo manuale o assistito AI.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import * as readline from "node:readline";
import {
  Container,
  Key,
  matchesKey,
  ProcessTerminal,
  SelectList,
  Text,
  TUI,
  type SelectItem,
  type SelectListTheme,
} from "@mariozechner/pi-tui";
import chalk from "chalk";
import {
  ensureWorkspaceInitialized,
  loadWorkspaceProvider,
  saveProfile,
  isProfileComplete,
  formatProfile,
  validateWorkspaceProvider,
  validateProfileField,
  loadWorkspacePath,
  saveWorkspaceApiKey,
  saveWorkspaceProvider,
  saveWorkspacePath,
  loadWorkspaceApiKey,
  validateWorkspacePath,
  type WorkspaceProvider,
  type UserProfile,
} from "./tui-profile.js";
import { theme } from "./tui-theme.js";

const CONFIG_DIR = join(homedir(), ".jht");
const CONFIG_PATH = join(CONFIG_DIR, "jht.config.json");
const SETUP_MODEL = "claude-sonnet-4-20250514";
const setupAccent = chalk.hex("#F6C453");
const setupDim = chalk.hex("#7B7F87");

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

type SetupConfigField = "workspace" | "provider" | "authMethod" | "apiKey";

type AuthMethod = "codex-oauth" | "api-key";

type SetupConfigStep = {
  field: SetupConfigField;
  section: string;
  title: string;
  question: string;
  hint: string;
  required: boolean;
};

type SetupConfigWizardState = {
  stepIndex: number;
  steps: SetupConfigStep[];
  draft: {
    workspace: string;
    provider: string;
    authMethod: AuthMethod | "";
    apiKey: string;
  };
  lastMessage?: string | null;
};

const SETUP_CONFIG_STEPS: SetupConfigStep[] = [
  {
    field: "workspace",
    section: "Configurazione",
    title: "📁 Cartella di lavoro",
    question: "Seleziona o incolla la cartella di lavoro.",
    hint: "Premi Enter vuoto per aprire Finder oppure incolla un percorso.",
    required: true,
  },
  {
    field: "provider",
    section: "Configurazione",
    title: "Model/auth provider",
    question: "Scegli il provider AI per questa cartella.",
    hint: "↑/↓ per selezionare, Enter per confermare",
    required: true,
  },
  {
    field: "authMethod",
    section: "Configurazione",
    title: "{provider} auth method",
    question: "Scegli il metodo di autenticazione.",
    hint: "↑/↓ per selezionare, Enter per confermare, ← per tornare indietro",
    required: true,
  },
  {
    field: "apiKey",
    section: "Configurazione",
    title: "🔑 API Key",
    question: "Inserisci la chiave API per il provider scelto.",
    hint: "Anthropic: sk-ant- · OpenAI/Kimi: sk-...",
    required: true,
  },
];

const PROVIDER_OPTIONS: SelectItem[] = [
  {
    value: "openai",
    label: "OpenAI",
    description: "Codex OAuth + API key",
  },
  {
    value: "anthropic",
    label: "Anthropic",
    description: "Claude via Messages API",
  },
  {
    value: "kimi",
    label: "Moonshot AI",
    description: "Kimi K2.5",
  },
];

const setupSelectTheme: SelectListTheme = {
  selectedPrefix: (text) => theme.accent(text),
  selectedText: (text) => theme.selectedRow(theme.bold(theme.accent(text))),
  description: (text) => theme.dim(text),
  scrollInfo: (text) => theme.dim(text),
  noMatch: (text) => theme.dim(text),
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
  console.log(setupAccent(`   ╔${"═".repeat(innerWidth + 2)}╗`));
  for (const line of logoLines) {
    console.log(setupAccent(frameRaw(line)));
  }
  for (const line of titleLines) {
    console.log(setupAccent(frameCentered(line)));
  }
  console.log(setupAccent(`   ╚${"═".repeat(innerWidth + 2)}╝`));
  console.log("");
}

function renderSetupBannerText(): string {
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
    "Configurazione",
  ];
  const innerWidth = Math.max(
    ...logoLines.map((line) => line.length),
    ...titleLines.map((line) => line.length),
  );
  const frameRaw = (line: string) => `   ${theme.accent("║")} ${theme.accent(line.padEnd(innerWidth, " "))} ${theme.accent("║")}`;
  const frameCentered = (line: string) => `   ${theme.accent("║")} ${theme.accent(centerText(line, innerWidth))} ${theme.accent("║")}`;

  return [
    "",
    `   ${theme.accent(`╔${"═".repeat(innerWidth + 2)}╗`)}`,
    ...logoLines.map(frameRaw),
    ...titleLines.map(frameCentered),
    `   ${theme.accent(`╚${"═".repeat(innerWidth + 2)}╝`)}`,
    "",
  ].join("\n");
}

function setupHasValue(value: string): boolean {
  return value.trim().length > 0;
}

function renderSetupCheckpoints(wizard: SetupConfigWizardState): string {
  // If authMethod step should be skipped, mark it as completed
  const isAuthMethodSkipped = wizard.draft.provider && 
    getAuthMethodOptions(wizard.draft.provider).length === 1;
  
  return wizard.steps.map((step, index) => {
    // Skip rendering checkpoint for authMethod if provider has only one auth method
    if (step.field === "authMethod" && isAuthMethodSkipped) {
      return theme.dim("·");
    }
    
    let completed = setupHasValue(wizard.draft[step.field]);
    
    // For authMethod, consider it completed if skipped
    if (step.field === "authMethod" && isAuthMethodSkipped) {
      completed = true;
    }
    
    const current = index === wizard.stepIndex;
    if (current && completed) return theme.accent("◉");
    if (current) return theme.accent("◎");
    if (completed) return theme.accent("●");
    return theme.dim("○");
  }).join(theme.dim(" "));
}

function truncateSetupText(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(text.length - max);
}

// Auth method options per provider
type AuthMethodOption = { value: AuthMethod | "back"; label: string; hint?: string };

function getAuthMethodOptions(provider: string): AuthMethodOption[] {
  if (provider === "openai") {
    return [
      { value: "codex-oauth", label: "OpenAI Codex", hint: "ChatGPT OAuth" },
      { value: "api-key", label: "OpenAI API key", hint: "" },
      { value: "back", label: "Back", hint: "" },
    ];
  }
  // Anthropic and Moonshot only support API key
  return [{ value: "api-key", label: "API key", hint: "" }];
}

function renderSetupWizard(
  panel: Container,
  wizard: SetupConfigWizardState,
  currentInput: string,
  providerSelect: SelectList,
  authMethodIndex: number,
): void {
  panel.clear();
  const add = (text: string) => panel.addChild(new Text(text, 0, 0));

  const current = wizard.steps[wizard.stepIndex];
  const progress = `${wizard.stepIndex + 1}/${wizard.steps.length}`;
  const fallback = wizard.draft[current.field];
  const displayValue = currentInput.length > 0 ? currentInput : fallback;
  const maskedValue = current.field === "apiKey" && currentInput.length === 0 && fallback
    ? `${"*".repeat(Math.max(8, Math.min(fallback.length, 24)))}`
    : displayValue;
  const cursor = "█";
  const contentWidth = 58;
  const padded = truncateSetupText(`${maskedValue}${cursor}`, contentWidth).padEnd(contentWidth, " ");

  // Update title with provider name for authMethod step
  const displayTitle = current.field === "authMethod" 
    ? `${wizard.draft.provider} auth method`
    : current.title;

  add(renderSetupBannerText());
  add(theme.header("  ■ CONFIGURA JHT"));
  add(theme.border("  " + "─".repeat(62)));
  add("");
  add(`  ${renderSetupCheckpoints(wizard)}`);
  add("");
  add(`  ${theme.dim(current.section.toUpperCase())}`);
  add(`  ${theme.accent(displayTitle)} ${theme.dim("· " + progress)} ${theme.dim("·")} ${theme.accent("Richiesto")}`);
  add("");
  add(`  ${theme.text(current.question)}`);
  add("");

  if (current.field === "provider") {
    // Render provider selection with radio buttons
    const selectedIndex = providerSelect.getSelectedIndex();
    const options = [
      { label: "OpenAI", hint: "Codex OAuth + API key" },
      { label: "Anthropic", hint: "" },
      { label: "Moonshot AI", hint: "Kimi K2.5" },
    ];
    
    add("");
    for (let i = 0; i < options.length; i++) {
      const opt = options[i];
      const isSelected = i === selectedIndex;
      const radio = isSelected ? theme.accent("◉") : theme.dim("○");
      const label = isSelected ? theme.bold(theme.accent(opt.label)) : theme.text(opt.label);
      const hint = opt.hint ? ` ${theme.dim(`(${opt.hint})`)}` : "";
      add(`  ${radio} ${label}${hint}`);
    }
    add("");
    add(theme.dim(`  ${"─".repeat(contentWidth)}`));
  } else if (current.field === "authMethod") {
    // Render auth method selection
    const options = getAuthMethodOptions(wizard.draft.provider);
    
    add("");
    for (let i = 0; i < options.length; i++) {
      const opt = options[i];
      const isSelected = i === authMethodIndex;
      const radio = isSelected ? theme.accent("◉") : theme.dim("○");
      const label = isSelected ? theme.bold(theme.accent(opt.label)) : theme.text(opt.label);
      const hint = opt.hint ? ` ${theme.dim(`(${opt.hint})`)}` : "";
      add(`  ${radio} ${label}${hint}`);
    }
    add("");
    add(theme.dim(`  ${"─".repeat(contentWidth)}`));
  } else {
    add(`  ${theme.border("┌" + "─".repeat(contentWidth + 2) + "┐")}`);
    add(`  ${theme.border("│")} ${theme.text(padded)} ${theme.border("│")}`);
    add(`  ${theme.border("└" + "─".repeat(contentWidth + 2) + "┘")}`);
  }

  add("");
  add(`  ${theme.dim(current.hint)}`);

  if (wizard.lastMessage) {
    add("");
    add(theme.warning(`  ${wizard.lastMessage}`));
  }
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
  console.log(setupAccent("  Benvenuto nel portale Job Hunter Team."));
  console.log(setupDim("  Qui completi la configurazione iniziale e poi puoi usare:"));
  console.log("");
  console.log(setupAccent("    • Dashboard") + setupDim("  riepilogo profilo, task e stato team"));
  console.log(setupAccent("    • Team") + setupDim("       agenti attivi e sessioni runtime"));
  console.log(setupAccent("    • Tasks") + setupDim("      ricerche e lavorazioni in corso"));
  console.log(setupAccent("    • AI") + setupDim("         assistente per CV, offerte e colloqui"));
  console.log("");
  console.log(setupDim("  I dati vengono salvati in ~/.jht/jht.config.json"));
  console.log("");
}

function printStep(n: number, total: number, text: string) {
  console.log(setupDim(`  [${n}/${total}]`) + " " + setupAccent(text));
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
    console.log(setupAccent(`  Inserisci una scelta valida: ${allowed.join("/")}`));
  }
}

async function askWithDefault(
  rl: readline.Interface,
  label: string,
  fallback: string,
): Promise<string> {
  const suffix = fallback ? ` [${fallback}]` : "";
  const answer = await ask(rl, setupAccent(`  > ${label}${suffix}: `));
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
    console.log(setupAccent(`  ${validation.error}`));
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
  console.log(setupAccent("  📁 Premi Enter per selezionare la tua cartella di lavoro."));
  if (reason) {
    console.log("");
    console.log(setupDim(`  ${reason}`));
  }
  console.log("");

  while (true) {
    const answer = await ask(rl, setupAccent("  > "));
    const candidate = answer || openWorkspaceFolderPicker(fallback);
    if (!candidate) {
      console.log(setupDim("  Nessuna cartella selezionata."));
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
        console.log(setupAccent(`  ${message}`));
        continue;
      }
    }
    if (validation.ok) {
      const init = ensureWorkspaceInitialized(validation.value);
      saveWorkspacePath(validation.value);
      console.log(setupAccent(`  ✓ Cartella di lavoro salvata: ${validation.value}`));
      const currentSummary = formatWorkspaceInitSummary(init);
      if (currentSummary || initSummary) {
        console.log(setupAccent(`  ✓ Workspace inizializzato: ${currentSummary ?? initSummary}`));
      }
      console.log("");
      return validation.value;
    }
    console.log(setupAccent(`  ${validation.error}`));
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
  saveWorkspaceApiKey(key, loadWorkspacePath());
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
  const valid = await testApiKey("anthropic", key);
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

export async function runSetupWizard(): Promise<string> {
  const wizard: SetupConfigWizardState = {
    stepIndex: 0,
    steps: SETUP_CONFIG_STEPS,
    draft: {
      workspace: loadWorkspacePath(),
      provider: "",
      authMethod: "",
      apiKey: "",
    },
    lastMessage: null,
  };

  if (wizard.draft.workspace) {
    const validation = validateWorkspacePath(wizard.draft.workspace);
    if (validation.ok) {
      wizard.draft.workspace = validation.value;
      wizard.draft.provider = loadWorkspaceProvider(validation.value) ?? "";
      wizard.draft.apiKey = loadWorkspaceApiKey(validation.value) ?? "";
      wizard.stepIndex = wizard.draft.apiKey ? 2 : wizard.draft.provider ? 1 : 0;
    } else {
      wizard.draft.workspace = "";
    }
  }

  const tui = new TUI(new ProcessTerminal());
  tui.setClearOnShrink(true);
  const panel = new Container();
  tui.addChild(panel);
  const providerSelect = new SelectList(PROVIDER_OPTIONS, 5, setupSelectTheme, {
    minPrimaryColumnWidth: 14,
    maxPrimaryColumnWidth: 18,
  });

  let inputBuffer = "";
  let completedApiKey = wizard.draft.apiKey;
  let authMethodIndex = 0;

  const syncProviderSelection = () => {
    const index = PROVIDER_OPTIONS.findIndex((option) => option.value === wizard.draft.provider);
    providerSelect.setSelectedIndex(index >= 0 ? index : 0);
  };

  const moveProviderSelection = (delta: number) => {
    const selectedValue = providerSelect.getSelectedItem()?.value ?? wizard.draft.provider;
    const currentIndex = PROVIDER_OPTIONS.findIndex((option) => option.value === selectedValue);
    const safeIndex = currentIndex >= 0 ? currentIndex : 0;
    const nextIndex = (safeIndex + delta + PROVIDER_OPTIONS.length) % PROVIDER_OPTIONS.length;
    providerSelect.setSelectedIndex(nextIndex);
  };

  const moveAuthMethodSelection = (delta: number) => {
    const options = getAuthMethodOptions(wizard.draft.provider);
    authMethodIndex = (authMethodIndex + delta + options.length) % options.length;
  };

  const persistDraftValue = () => {
    const current = wizard.steps[wizard.stepIndex];
    if (current.field === "provider") {
      const selected = providerSelect.getSelectedItem();
      if (selected) {
        wizard.draft.provider = selected.value;
      }
      return;
    }
    if (current.field === "authMethod") {
      const options = getAuthMethodOptions(wizard.draft.provider);
      const selected = options[authMethodIndex];
      if (selected && selected.value !== "back") {
        wizard.draft.authMethod = selected.value as AuthMethod;
      }
      return;
    }

    const raw = inputBuffer.trim();
    if (raw) {
      wizard.draft[current.field] = raw;
    }
  };

  const refresh = () => {
    renderSetupWizard(panel, wizard, inputBuffer, providerSelect, authMethodIndex);
    tui.requestRender(true);
  };

  // Skip authMethod step if provider has only one auth method
  const shouldSkipAuthMethod = (): boolean => {
    const options = getAuthMethodOptions(wizard.draft.provider);
    return options.length === 1;
  };

  const moveStep = (delta: number) => {
    persistDraftValue();
    wizard.stepIndex = Math.max(0, Math.min(wizard.steps.length - 1, wizard.stepIndex + delta));
    if (wizard.steps[wizard.stepIndex]?.field === "provider") {
      syncProviderSelection();
    }
    wizard.lastMessage = null;
    inputBuffer = "";
    refresh();
  };

  const validateAndPersistStep = async (): Promise<boolean> => {
    const current = wizard.steps[wizard.stepIndex];
    let nextValue = inputBuffer.trim();

    if (current.field === "workspace") {
      if (!nextValue) {
        nextValue = openWorkspaceFolderPicker(wizard.draft.workspace || homedir()) ?? "";
      }
      if (!nextValue) {
        wizard.lastMessage = "Seleziona una cartella di lavoro.";
        return false;
      }

      const normalizedCandidate = resolve(nextValue);
      let validation = validateWorkspacePath(normalizedCandidate);
      if (!validation.ok && /cartella non trovata/i.test(validation.error)) {
        try {
          ensureWorkspaceInitialized(normalizedCandidate);
          validation = validateWorkspacePath(normalizedCandidate);
        } catch (error) {
          wizard.lastMessage = error instanceof Error ? error.message : "impossibile inizializzare la cartella";
          return false;
        }
      }
      if (!validation.ok) {
        wizard.lastMessage = validation.error;
        return false;
      }

      ensureWorkspaceInitialized(validation.value);
      saveWorkspacePath(validation.value);
      wizard.draft.workspace = validation.value;
      wizard.draft.provider = loadWorkspaceProvider(validation.value) ?? wizard.draft.provider;
      wizard.draft.apiKey = loadWorkspaceApiKey(validation.value) ?? "";
      syncProviderSelection();
      inputBuffer = "";
      wizard.lastMessage = "Cartella configurata.";
      return true;
    }

    if (current.field === "provider") {
      const selected = providerSelect.getSelectedItem();
      nextValue = selected?.value ?? wizard.draft.provider;
      const provider = validateWorkspaceProvider(nextValue);
      if (!provider) {
        wizard.lastMessage = "Usa anthropic, openai oppure kimi.";
        return false;
      }
      saveWorkspaceProvider(provider, wizard.draft.workspace);
      wizard.draft.provider = provider;
      wizard.draft.authMethod = "";
      wizard.draft.apiKey = loadWorkspaceApiKey(wizard.draft.workspace) ?? "";
      inputBuffer = "";
      authMethodIndex = 0;
      wizard.lastMessage = "Provider configurato.";
      return true;
    }

    if (current.field === "authMethod") {
      const options = getAuthMethodOptions(wizard.draft.provider);
      const selected = options[authMethodIndex];
      
      if (!selected) {
        wizard.lastMessage = "Seleziona un metodo di autenticazione.";
        return false;
      }
      
      if (selected.value === "back") {
        // Go back to provider selection
        wizard.stepIndex = 1; // provider step
        authMethodIndex = 0;
        wizard.lastMessage = null;
        refresh();
        return false; // Don't advance, we manually changed step
      }
      
      wizard.draft.authMethod = selected.value as AuthMethod;
      wizard.lastMessage = "Metodo di autenticazione configurato.";
      
      // For OAuth, we'd handle differently - for now just proceed
      if (selected.value === "codex-oauth") {
        wizard.lastMessage = "Codex OAuth selezionato (simulazione).";
      }
      
      return true;
    }

    nextValue = nextValue || wizard.draft.apiKey;
    if (!nextValue) {
      wizard.lastMessage = "Inserisci la chiave API per il provider scelto.";
      return false;
    }
    const provider = validateWorkspaceProvider(wizard.draft.provider);
    if (!provider) {
      wizard.lastMessage = "Configura prima il provider.";
      return false;
    }
    if (provider === "anthropic" && !nextValue.startsWith("sk-ant-")) {
      wizard.lastMessage = "Per Anthropic la chiave deve iniziare con sk-ant-.";
      return false;
    }

    wizard.lastMessage = "Verifica chiave in corso...";
    refresh();
    const valid = await testApiKey(provider, nextValue);
    if (!valid) {
      wizard.lastMessage = "Chiave non valida o non verificabile.";
      return false;
    }

    saveWorkspaceApiKey(nextValue, wizard.draft.workspace, provider);
    wizard.draft.apiKey = nextValue;
    completedApiKey = nextValue;
    inputBuffer = "";
    wizard.lastMessage = "Chiave salvata per questa cartella.";
    return true;
  };

  await new Promise<void>((resolvePromise) => {
    const finish = () => {
      try { tui.stop(); } catch {}
      resolvePromise();
    };

    tui.addInputListener((data) => {
      if (matchesKey(data, Key.enter) || matchesKey(data, Key.return)) {
        void (async () => {
          const currentField = wizard.steps[wizard.stepIndex].field;
          
          // Skip authMethod step if provider has only one auth method
          if (currentField === "provider" && shouldSkipAuthMethod()) {
            const ok = await validateAndPersistStep();
            if (!ok) {
              refresh();
              return;
            }
            // Skip authMethod and go directly to apiKey
            wizard.stepIndex = 3; // apiKey step
            wizard.lastMessage = null;
            refresh();
            return;
          }
          
          const ok = await validateAndPersistStep();
          if (!ok) {
            refresh();
            return;
          }
          if (wizard.stepIndex < wizard.steps.length - 1) {
            wizard.stepIndex += 1;
            wizard.lastMessage = null;
            refresh();
            return;
          }
          if (!wizard.draft.workspace || !wizard.draft.provider || !wizard.draft.apiKey) {
            wizard.lastMessage = "Completa cartella, provider e chiave prima di uscire dal wizard.";
            refresh();
            return;
          }
          finish();
        })();
        return { consume: true };
      }
      const current = wizard.steps[wizard.stepIndex];
      if (current.field === "provider") {
        if (matchesKey(data, Key.left)) {
          moveStep(-1);
          return { consume: true };
        }
        if (matchesKey(data, Key.right)) {
          moveStep(1);
          return { consume: true };
        }
        if (matchesKey(data, Key.up) || matchesKey(data, Key.down)) {
          moveProviderSelection(matchesKey(data, Key.up) ? -1 : 1);
          wizard.lastMessage = null;
          refresh();
          return { consume: true };
        }
      } else if (current.field === "authMethod") {
        if (matchesKey(data, Key.up) || matchesKey(data, Key.down)) {
          moveAuthMethodSelection(matchesKey(data, Key.up) ? -1 : 1);
          wizard.lastMessage = null;
          refresh();
          return { consume: true };
        }
        if (matchesKey(data, Key.left)) {
          // Go back to provider
          wizard.stepIndex = 1;
          authMethodIndex = 0;
          wizard.lastMessage = null;
          refresh();
          return { consume: true };
        }
      } else {
        if (matchesKey(data, Key.up) || matchesKey(data, Key.left)) {
          moveStep(-1);
          return { consume: true };
        }
        if (matchesKey(data, Key.down) || matchesKey(data, Key.right)) {
          moveStep(1);
          return { consume: true };
        }
      }
      if (matchesKey(data, Key.backspace) || matchesKey(data, Key.delete)) {
        if (current.field !== "provider" && inputBuffer.length > 0) {
          inputBuffer = inputBuffer.slice(0, -1);
          refresh();
        }
        return { consume: true };
      }
      if (matchesKey(data, Key.ctrl("c")) || matchesKey(data, Key.ctrl("d"))) {
        wizard.lastMessage = "Completa cartella, provider e chiave prima di uscire dal wizard.";
        refresh();
        return { consume: true };
      }

      const str = typeof data === "string" ? data : "";
      if (current.field !== "provider" && str && str.length === 1 && str.charCodeAt(0) >= 32) {
        inputBuffer += str;
        wizard.lastMessage = null;
        refresh();
        return { consume: true };
      }
      return undefined;
    });

    syncProviderSelection();
    tui.start();
    refresh();
  });

  return completedApiKey;
}

export async function ensureWorkspaceConfigured(): Promise<string> {
  const savedWorkspace = loadWorkspacePath();
  const validation = savedWorkspace ? validateWorkspacePath(savedWorkspace) : null;
  if (!validation?.ok || !loadWorkspaceProvider(validation.value) || !loadWorkspaceApiKey(validation.value)) {
    await runSetupWizard();
  }
  return loadWorkspacePath();
}

async function testApiKey(provider: WorkspaceProvider, key: string): Promise<boolean> {
  try {
    const res = provider === "anthropic"
      ? await fetch("https://api.anthropic.com/v1/messages", {
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
        })
      : await fetch(
          `${provider === "kimi" ? "https://api.moonshot.ai/v1" : "https://api.openai.com/v1"}/chat/completions`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${key}`,
            },
            body: JSON.stringify({
              model: provider === "kimi" ? "kimi-k2-0711-preview" : "gpt-4o-mini",
              max_tokens: 1,
              messages: [{ role: "user", content: "test" }],
            }),
            signal: AbortSignal.timeout(10000),
          },
        );
    return res.ok || res.status === 400;
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
