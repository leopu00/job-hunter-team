/**
 * Setup wizard — onboarding completo al primo avvio.
 * Layout verticale con SelectList per navigazione pulita.
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

// ─────────────────────────────────────────────────────────────────────────────
// TEMA
// ─────────────────────────────────────────────────────────────────────────────

const setupSelectTheme: SelectListTheme = {
  selectedPrefix: (text) => theme.accent(text),
  selectedText: (text) => theme.bold(theme.accent(text)),
  description: (text) => theme.dim(text),
  scrollInfo: (text) => theme.dim(text),
  noMatch: (text) => theme.warning(text),
};

// ─────────────────────────────────────────────────────────────────────────────
// TIPI
// ─────────────────────────────────────────────────────────────────────────────

type SetupStep = "welcome" | "workspace" | "provider" | "apiKey";

type SetupState = {
  step: SetupStep;
  workspace: string;
  provider: WorkspaceProvider | "";
  apiKey: string;
  message: string | null;
};

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

// ─────────────────────────────────────────────────────────────────────────────
// PROVIDER OPTIONS
// ─────────────────────────────────────────────────────────────────────────────

const PROVIDER_OPTIONS: SelectItem[] = [
  { value: "anthropic", label: "Anthropic", description: "Claude via Messages API" },
  { value: "openai", label: "OpenAI", description: "Codex OAuth + API key" },
  { value: "kimi", label: "Moonshot AI", description: "Kimi K2.5" },
];

// ─────────────────────────────────────────────────────────────────────────────
// UI COMPONENTS
// ─────────────────────────────────────────────────────────────────────────────

function renderBanner(): string {
  return [
    "",
    theme.accent("     ██╗██╗  ██╗████████╗"),
    theme.accent("     ██║██║  ██║╚══██╔══╝"),
    theme.accent("     ██║███████║   ██║   "),
    theme.accent("██   ██║██╔══██║   ██║   "),
    theme.accent("╚█████╔╝██║  ██║   ██║   "),
    theme.accent(" ╚════╝ ╚═╝  ╚═╝   ╚═╝   "),
    "",
    theme.header("  Job Hunter Team — Configurazione"),
    "",
  ].join("\n");
}

function renderFooter(): string {
  return theme.dim("  ↑/↓ navigate • Enter confirm • Ctrl+C cancel");
}

// ─────────────────────────────────────────────────────────────────────────────
// SETUP WIZARD — LAYOUT VERTICALE
// ─────────────────────────────────────────────────────────────────────────────

export async function runSetupWizard(): Promise<string> {
  const state: SetupState = {
    step: "welcome",
    workspace: loadWorkspacePath(),
    provider: (loadWorkspaceProvider(loadWorkspacePath()) as WorkspaceProvider) || "",
    apiKey: loadWorkspaceApiKey(loadWorkspacePath()) || "",
    message: null,
  };

  // Se già configurato, salta il wizard
  if (state.workspace && state.provider && state.apiKey) {
    return state.apiKey;
  }

  // Determina step iniziale
  if (!state.workspace) state.step = "workspace";
  else if (!state.provider) state.step = "provider";
  else if (!state.apiKey) state.step = "apiKey";

  const tui = new TUI(new ProcessTerminal());
  tui.setClearOnShrink(true);

  const root = new Container();
  const contentArea = new Container();
  root.addChild(new Text(renderBanner(), 0, 0));
  root.addChild(contentArea);
  root.addChild(new Text("", 0, 0)); // spacer
  root.addChild(new Text(renderFooter(), 0, 0));
  tui.addChild(root);

  let inputBuffer = "";
  let completedApiKey = "";

  // SelectList per provider
  const providerSelect = new SelectList(PROVIDER_OPTIONS, 5, setupSelectTheme, {
    minPrimaryColumnWidth: 14,
    maxPrimaryColumnWidth: 20,
  });

  // Sincronizza selezione provider con stato
  const syncProviderSelection = () => {
    const idx = PROVIDER_OPTIONS.findIndex((o) => o.value === state.provider);
    providerSelect.setSelectedIndex(idx >= 0 ? idx : 0);
  };
  syncProviderSelection();

  // Render step corrente
  const render = () => {
    contentArea.clear();

    switch (state.step) {
      case "welcome":
        renderWelcome(contentArea, state);
        break;
      case "workspace":
        renderWorkspace(contentArea, state, inputBuffer);
        break;
      case "provider":
        renderProvider(contentArea, state, providerSelect);
        break;
      case "apiKey":
        renderApiKey(contentArea, state, inputBuffer);
        break;
    }

    tui.requestRender(true);
  };

  // Handlers step
  const handleWelcome = (): boolean => {
    state.step = "workspace";
    return true;
  };

  const handleWorkspace = async (): Promise<boolean> => {
    let path = inputBuffer.trim();

    // Se vuoto, apri picker
    if (!path) {
      path = openWorkspaceFolderPicker(state.workspace || homedir()) ?? "";
    }

    if (!path) {
      state.message = "Seleziona una cartella di lavoro";
      return false;
    }

    const normalized = resolve(path);
    let validation = validateWorkspacePath(normalized);

    // Se non esiste, prova a crearla
    if (!validation.ok && /cartella non trovata/i.test(validation.error)) {
      try {
        ensureWorkspaceInitialized(normalized);
        validation = validateWorkspacePath(normalized);
      } catch (err) {
        state.message = err instanceof Error ? err.message : "Errore creazione cartella";
        return false;
      }
    }

    if (!validation.ok) {
      state.message = validation.error;
      return false;
    }

    ensureWorkspaceInitialized(validation.value);
    saveWorkspacePath(validation.value);
    state.workspace = validation.value;
    state.provider = (loadWorkspaceProvider(validation.value) as WorkspaceProvider) || "";
    state.apiKey = loadWorkspaceApiKey(validation.value) || "";
    syncProviderSelection();
    inputBuffer = "";
    state.message = null;

    // Procedi al prossimo step
    state.step = state.provider ? "apiKey" : "provider";
    return true;
  };

  const handleProvider = (): boolean => {
    const selected = providerSelect.getSelectedItem();
    if (!selected) {
      state.message = "Seleziona un provider";
      return false;
    }

    const provider = validateWorkspaceProvider(selected.value);
    if (!provider) {
      state.message = "Provider non valido";
      return false;
    }

    saveWorkspaceProvider(provider, state.workspace);
    state.provider = provider;
    state.apiKey = loadWorkspaceApiKey(state.workspace) || "";
    state.message = null;
    state.step = "apiKey";
    return true;
  };

  const handleApiKey = async (): Promise<boolean> => {
    const key = inputBuffer.trim() || state.apiKey;

    if (!key) {
      state.message = "Inserisci la chiave API";
      return false;
    }

    if (state.provider === "anthropic" && !key.startsWith("sk-ant-")) {
      state.message = "La chiave Anthropic deve iniziare con sk-ant-";
      return false;
    }

    state.message = "Verifica in corso...";
    render();

    const valid = state.provider ? await testApiKey(state.provider, key) : false;
    if (!valid) {
      state.message = "Chiave non valida — riprova";
      return false;
    }

    if (!state.provider) return false;
    saveWorkspaceApiKey(key, state.workspace, state.provider);
    state.apiKey = key;
    completedApiKey = key;
    state.message = null;
    return true;
  };

  // Input handler
  await new Promise<void>((resolve) => {
    const finish = () => {
      try { tui.stop(); } catch {}
      resolve();
    };

    tui.addInputListener((data) => {
      // Ctrl+C / Ctrl+D — blocca uscita fino a completamento
      if (matchesKey(data, Key.ctrl("c")) || matchesKey(data, Key.ctrl("d"))) {
        if (state.step !== "apiKey" || !state.apiKey) {
          state.message = "Completa la configurazione prima di uscire";
          render();
          return { consume: true };
        }
        finish();
        return { consume: true };
      }

      // Enter — conferma step
      if (matchesKey(data, Key.enter) || matchesKey(data, Key.return)) {
        void (async () => {
          let ok = false;

          switch (state.step) {
            case "welcome":
              ok = handleWelcome();
              break;
            case "workspace":
              ok = await handleWorkspace();
              break;
            case "provider":
              ok = handleProvider();
              break;
            case "apiKey":
              ok = await handleApiKey();
              if (ok) {
                finish();
                return;
              }
              break;
          }

          render();
        })();
        return { consume: true };
      }

      // Gestione input per step specifici
      const currentStep = state.step;

      if (currentStep === "provider") {
        // Per provider, lascia che SelectList gestisca la navigazione
        // I tasti up/down sono gestiti dal componente stesso
        if (matchesKey(data, Key.up) || matchesKey(data, Key.down)) {
          // Passa l'input al SelectList per la navigazione
          state.message = null;
          render();
          return { consume: true };
        }
        // Altri tasti (come Enter) sono gestiti sopra
      }

      // Backspace per input testuale (solo per workspace e apiKey)
      if ((matchesKey(data, Key.backspace) || matchesKey(data, Key.delete)) && inputBuffer.length > 0 && currentStep !== "provider") {
        inputBuffer = inputBuffer.slice(0, -1);
        state.message = null;
        render();
        return { consume: true };
      }

      // Input testuale (solo per workspace e apiKey)
      const str = typeof data === "string" ? data : "";
      if (str && str.length === 1 && str.charCodeAt(0) >= 32 && currentStep !== "provider") {
        inputBuffer += str;
        state.message = null;
        render();
        return { consume: true };
      }

      return undefined;
    });

    tui.start();
    render();
  });

  return completedApiKey || state.apiKey;
}

// ─────────────────────────────────────────────────────────────────────────────
// RENDER STEP
// ─────────────────────────────────────────────────────────────────────────────

function renderWelcome(panel: Container, state: SetupState) {
  const add = (text: string) => panel.addChild(new Text(text, 0, 0));

  add(`  ${theme.text("Benvenuto in Job Hunter Team!")}`);
  add("");
  add(`  ${theme.dim("Configuriamo il tuo ambiente di lavoro.")}`);
  add("");
  add(`  ${theme.accent("▶ Premi Enter per iniziare")}`);

  if (state.message) {
    add("");
    add(`  ${theme.warning(state.message)}`);
  }
}

function renderWorkspace(panel: Container, state: SetupState, inputBuffer: string) {
  const add = (text: string) => panel.addChild(new Text(text, 0, 0));

  add(`  ${theme.header("📁 Cartella di lavoro")}`);
  add("");
  add(`  ${theme.text("Seleziona o digita il percorso della cartella di lavoro.")}`);
  add(`  ${theme.dim("Premi Enter vuoto per aprire il file picker.")}`);
  add("");

  const display = inputBuffer || state.workspace || "";
  const cursor = "█";
  const line = display + cursor;

  add(`  ${theme.border("┌" + "─".repeat(50) + "┐")}`);
  add(`  ${theme.border("│")} ${theme.text(line.padEnd(50, " "))} ${theme.border("│")}`);
  add(`  ${theme.border("└" + "─".repeat(50) + "┘")}`);

  if (state.message) {
    add("");
    add(`  ${theme.warning(state.message)}`);
  }
}

function renderProvider(panel: Container, state: SetupState, selectList: SelectList) {
  const add = (text: string) => panel.addChild(new Text(text, 0, 0));

  add(`  ${theme.header("🤖 Provider AI")}`);
  add("");
  add(`  ${theme.text("Seleziona il provider per questa cartella:")}`);
  add("");

  // Aggiungi il SelectList come componente
  panel.addChild(selectList);

  if (state.message) {
    add("");
    add(`  ${theme.warning(state.message)}`);
  }
}

function renderApiKey(panel: Container, state: SetupState, inputBuffer: string) {
  const add = (text: string) => panel.addChild(new Text(text, 0, 0));

  add(`  ${theme.header("🔑 API Key")}`);
  add("");
  add(`  ${theme.text(`Provider: ${theme.accent(state.provider)}`)}`);
  add(`  ${theme.dim("Inserisci la chiave API per questo provider.")}`);
  add("");

  const display = inputBuffer || state.apiKey || "";
  const masked = display ? "*".repeat(Math.min(display.length, 30)) : "";
  const cursor = "█";
  const line = masked + cursor;

  add(`  ${theme.border("┌" + "─".repeat(50) + "┐")}`);
  add(`  ${theme.border("│")} ${theme.text(line.padEnd(50, " "))} ${theme.border("│")}`);
  add(`  ${theme.border("└" + "─".repeat(50) + "┘")}`);

  if (state.provider === "anthropic") {
    add(`  ${theme.dim("Formato atteso: sk-ant-...")}`);
  }

  if (state.message) {
    add("");
    add(`  ${theme.warning(state.message)}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPER FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

function openWorkspaceFolderPicker(initialPath: string): string | null {
  // macOS: AppleScript
  if (process.platform === "darwin") {
    const resolvedPath = resolve(initialPath);
    const scriptLines = [
      'tell application "Finder" to activate',
      ...(existsSync(resolvedPath)
        ? [
            `set startFolder to POSIX file ${JSON.stringify(resolvedPath)}`,
            'set selectedFolder to choose folder with prompt "Seleziona la cartella di lavoro" default location startFolder',
          ]
        : ['set selectedFolder to choose folder with prompt "Seleziona la cartella di lavoro"']),
      'POSIX path of selectedFolder',
    ];

    const result = spawnSync("osascript", scriptLines.flatMap((line) => ["-e", line]), {
      encoding: "utf-8",
      timeout: 120_000,
    });

    return result.status === 0 ? result.stdout.trim() || null : null;
  }

  // Windows / WSL
  if (process.platform === "win32" || isWSL()) {
    const escapedPath = initialPath.replace(/'/g, "''");
    const script = [
      "Add-Type -AssemblyName System.Windows.Forms",
      "$dialog = New-Object System.Windows.Forms.OpenFileDialog",
      "$dialog.Title = 'Seleziona la cartella di lavoro'",
      "$dialog.Filter = 'Cartelle|*.folder'",
      "$dialog.CheckFileExists = $false",
      "$dialog.CheckPathExists = $true",
      "$dialog.ValidateNames = $false",
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
    ], { encoding: "utf-8", timeout: 120_000 });

    return result.status === 0 ? result.stdout.trim() || null : null;
  }

  // Linux: nessun picker disponibile
  return null;
}

function isWSL(): boolean {
  return !!(process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP || process.env.WSLENV);
}

async function testApiKey(provider: WorkspaceProvider | "", key: string): Promise<boolean> {
  if (!provider) return false;
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

// ─────────────────────────────────────────────────────────────────────────────
// EXPORT
// ─────────────────────────────────────────────────────────────────────────────

export async function ensureWorkspaceConfigured(): Promise<string> {
  const savedWorkspace = loadWorkspacePath();
  const validation = savedWorkspace ? validateWorkspacePath(savedWorkspace) : null;

  if (!validation?.ok || !loadWorkspaceProvider(validation.value) || !loadWorkspaceApiKey(validation.value)) {
    const apiKey = await runSetupWizard();
    return apiKey;
  }

  return loadWorkspaceApiKey(validation.value) || "";
}

export function saveApiKey(key: string): void {
  saveWorkspaceApiKey(key, loadWorkspacePath());
}
