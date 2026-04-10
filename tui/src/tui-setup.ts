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
import { 
  listProviders, 
  getProvider, 
  getAuthMethods,
  saveCredentials, 
  type ProviderId,
  type AuthMethod,
} from "./auth/providers.js";

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

type SetupStep = "welcome" | "workspace" | "provider" | "authMethod" | "credentials";

type SetupState = {
  step: SetupStep;
  workspace: string;
  provider: WorkspaceProvider | "";
  authMethodId: string;
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
// PROVIDER OPTIONS (dal registry auth)
// ─────────────────────────────────────────────────────────────────────────────

const PROVIDER_OPTIONS: SelectItem[] = listProviders().map(p => ({
  value: p.id,
  label: p.label,
  description: p.description,
}));

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
  return theme.dim("  ↑↓ navigate  •  Enter confirm  •  Ctrl+C cancel");
}

// ─────────────────────────────────────────────────────────────────────────────
// SETUP WIZARD — LAYOUT VERTICALE
// ─────────────────────────────────────────────────────────────────────────────

export async function runSetupWizard(): Promise<string> {
  const state: SetupState = {
    step: "welcome",
    workspace: loadWorkspacePath(),
    provider: (loadWorkspaceProvider(loadWorkspacePath()) as WorkspaceProvider) || "",
    authMethodId: "",
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
  else if (!state.apiKey) state.step = "authMethod";

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

  // SelectList per auth method (inizialmente vuoto, popolato dinamicamente)
  let authMethodSelect = new SelectList([], 5, setupSelectTheme, {
    minPrimaryColumnWidth: 14,
    maxPrimaryColumnWidth: 20,
  });

  // Crea SelectList per i metodi auth del provider selezionato
  const createAuthMethodSelect = (): SelectList => {
    const provider = getProvider(state.provider);
    const methods = provider?.auth ?? [];
    const options: SelectItem[] = methods.map(m => ({
      value: m.id,
      label: m.label,
      description: m.hint || "",
    }));
    return new SelectList(options, 5, setupSelectTheme, {
      minPrimaryColumnWidth: 14,
      maxPrimaryColumnWidth: 20,
    });
  };

  // Sincronizza selezione provider con stato
  const syncProviderSelection = () => {
    const idx = PROVIDER_OPTIONS.findIndex((o) => o.value === state.provider);
    providerSelect.setSelectedIndex(idx >= 0 ? idx : 0);
  };
  syncProviderSelection();

  // Se lo step iniziale è authMethod o credentials, inizializza authMethodSelect
  if ((state.step === "authMethod" || state.step === "credentials") && state.provider) {
    authMethodSelect = createAuthMethodSelect();
  }

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
      case "authMethod":
        renderAuthMethod(contentArea, state, authMethodSelect);
        break;
      case "credentials":
        renderCredentials(contentArea, state, inputBuffer);
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
      if (!path) {
        state.message = "Seleziona una cartella";
        return false;
      }
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
    // DEBUG: non caricare provider esistente, forza selezione
    state.provider = "";
    state.apiKey = "";
    syncProviderSelection();
    inputBuffer = "";
    state.message = null;

    // Procedi sempre allo step provider (DEBUG)
    state.step = "provider";
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
    
    // Se il provider ha più metodi di auth, mostra selezione
    const authMethods = getAuthMethods(provider as ProviderId);
    if (authMethods.length > 1) {
      authMethodSelect = createAuthMethodSelect();
      state.step = "authMethod";
    } else {
      // Solo un metodo, procedi direttamente
      state.authMethodId = authMethods[0]?.id || "";
      state.step = "credentials";
    }
    return true;
  };

  const handleAuthMethod = (): boolean => {
    const selected = authMethodSelect.getSelectedItem();
    if (!selected) {
      state.message = "Seleziona un metodo di autenticazione";
      return false;
    }
    state.authMethodId = selected.value;
    state.message = null;
    state.step = "credentials";
    return true;
  };

  const handleCredentials = async (): Promise<boolean> => {
    if (!state.provider || !state.authMethodId) {
      state.message = "Configurazione incompleta";
      return false;
    }

    const provider = getProvider(state.provider);
    const method = provider?.auth.find(m => m.id === state.authMethodId);
    
    if (!method) {
      state.message = "Metodo di autenticazione non trovato";
      return false;
    }

    // Se è OAuth, esegui direttamente (apre browser)
    if (method.kind === "oauth") {
      const result = await executeAuthMethod(method);
      if (!result.success) {
        state.message = result.error;
        return false;
      }
      // Salva credenziali
      await saveCredentials(state.workspace, state.provider as ProviderId, method.id, result.credentials);
      state.apiKey = result.credentials.type === "apiKey" ? result.credentials.key : result.credentials.token;
      completedApiKey = state.apiKey;
      state.message = "Autenticazione completata!";
      return true;
    }

    // Per API key, usa inputBuffer
    const key = inputBuffer.trim();
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

    const valid = await testApiKey(state.provider, key);
    if (!valid) {
      state.message = "Chiave non valida — riprova";
      return false;
    }

    // Salva nel nuovo storage
    await saveCredentials(state.workspace, state.provider as ProviderId, method.id, {
      type: "apiKey",
      key,
    });
    
    state.apiKey = key;
    completedApiKey = key;
    state.message = null;
    return true;
  };

  // Esegue un metodo di autenticazione
  const executeAuthMethod = async (method: AuthMethod): Promise<import("./auth/providers.js").AuthResult> => {
    const { promptAPI, runtimeAPI } = createAuthAPIs();
    
    return method.run({
      workspace: state.workspace,
      provider: state.provider as WorkspaceProvider,
      prompt: promptAPI,
      openUrl: async (url) => {
        // Apri URL nel browser di default
        const { spawn } = await import("node:child_process");
        const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
        spawn(command, [url], { detached: true, stdio: "ignore" });
      },
      runtime: runtimeAPI,
    });
  };

  // Crea API compatibili con il sistema auth
  const createAuthAPIs = () => {
    let pendingInputResolver: ((value: string) => void) | null = null;
    let pendingInputRejecter: ((reason: Error) => void) | null = null;

    const promptAPI = {
      text: async (params: { message: string; placeholder?: string; validate?: (v: string) => string | undefined }): Promise<string> => {
        state.message = params.message;
        if (params.placeholder) {
          state.message += ` (${params.placeholder})`;
        }
        render();
        
        // Attendi input da tastiera
        return new Promise((resolve, reject) => {
          pendingInputResolver = resolve;
          pendingInputRejecter = reject;
        });
      },
      confirm: async (params: { message: string; initialValue?: boolean }): Promise<boolean> => {
        state.message = params.message + " (s/n)";
        render();
        // Semplificato: sempre true per ora
        return true;
      },
      select: async <T extends string>(params: { message: string; options: Array<{ value: T; label: string; hint?: string }> }): Promise<T> => {
        state.message = params.message;
        render();
        // Semplificato: primo opzione
        return params.options[0]?.value as T;
      },
      progress: (msg: string) => {
        state.message = msg;
        render();
        return { 
          update: (m: string) => { state.message = m; render(); }, 
          stop: () => {} 
        };
      },
      note: async (msg: string, title?: string) => {
        state.message = title ? `${title}: ${msg}` : msg;
        render();
      },
    };

    const runtimeAPI = {
      log: (msg: string) => { state.message = msg; render(); },
      error: (msg: string) => { state.message = `Errore: ${msg}`; render(); },
    };

    return { promptAPI, runtimeAPI, pendingInputResolver, pendingInputRejecter };
  };

  // Input handler
  await new Promise<void>((resolve) => {
    const finish = () => {
      try { tui.stop(); } catch {}
      resolve();
    };

    tui.addInputListener((data) => {
      // Ctrl+C / Ctrl+D — esci in qualsiasi momento
      if (matchesKey(data, Key.ctrl("c")) || matchesKey(data, Key.ctrl("d"))) {
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
            case "authMethod":
              ok = handleAuthMethod();
              break;
            case "credentials":
              ok = await handleCredentials();
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

      if (currentStep === "provider" || currentStep === "authMethod") {
        // Per provider e authMethod, lascia che SelectList gestisca la navigazione
        if (matchesKey(data, Key.up) || matchesKey(data, Key.down)) {
          const selectList = currentStep === "provider" ? providerSelect : authMethodSelect;
          selectList.handleInput(data);
          state.message = null;
          render();
          return { consume: true };
        }
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
      if (str && currentStep !== "provider") {
        // Rimuovi sequenze bracketed paste [200~ e [201~ (con o senza ESC)
        let cleaned = str.replace(/\x1b?\[200~/g, "").replace(/\x1b?\[201~/g, "");
        // Gestisce sia input singolo che paste multi-carattere
        // Filtra solo caratteri stampabili (>=32, escluso DEL 127)
        const printable = cleaned.split("").filter(c => c.charCodeAt(0) >= 32 && c.charCodeAt(0) !== 127).join("");
        if (printable) {
          inputBuffer += printable;
          state.message = null;
          render();
          return { consume: true };
        }
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
  add("");
  add(`  ${theme.accent("▶ Premi Enter per iniziare")}`);
  if (state.message) add(`  ${theme.warning(state.message)}`);
}

function renderWorkspace(panel: Container, state: SetupState, inputBuffer: string) {
  const add = (text: string) => panel.addChild(new Text(text, 0, 0));

  const display = inputBuffer || state.workspace || "";
  const cursor = "█";
  const line = display + cursor;

  add(`  ${theme.border("┌" + "─".repeat(50) + "┐")}`);
  add(`  ${theme.border("│")} ${theme.text(line.padEnd(50, " "))} ${theme.border("│")}`);
  add(`  ${theme.border("└" + "─".repeat(50) + "┘")}`);

  if (state.message) add(`  ${theme.warning(state.message)}`);
}

function renderProvider(panel: Container, state: SetupState, selectList: SelectList) {
  const add = (text: string) => panel.addChild(new Text(text, 0, 0));

  add("");
  panel.addChild(selectList);

  if (state.message) {
    add("");
    add(`  ${theme.warning(state.message)}`);
  }
}

function renderAuthMethod(panel: Container, state: SetupState, selectList: SelectList) {
  const add = (text: string) => panel.addChild(new Text(text, 0, 0));

  add("");
  panel.addChild(selectList);

  if (state.message) {
    add("");
    add(`  ${theme.warning(state.message)}`);
  }
}

function renderCredentials(panel: Container, state: SetupState, inputBuffer: string) {
  const add = (text: string) => panel.addChild(new Text(text, 0, 0));

  const provider = getProvider(state.provider);
  const method = provider?.auth.find(m => m.id === state.authMethodId);

  if (method?.kind === "oauth") {
    add("");
    add(`  ${theme.accent("▶ Premi Enter per aprire il browser")}`);
  } else {
    const display = inputBuffer || "";
    const cursor = "█";
    const line = display + cursor;

    add(`  ${theme.border("┌" + "─".repeat(50) + "┐")}`);
    add(`  ${theme.border("│")} ${theme.text(line.padEnd(50, " "))} ${theme.border("│")}`);
    add(`  ${theme.border("└" + "─".repeat(50) + "┘")}`);
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
