/**
 * Tmux integration — gestione sessioni agenti JHT.
 * Lettura stato, cattura output, invio messaggi, start/stop sessioni.
 * Supporta Windows (via wsl.exe) e Linux/macOS nativo.
 */
import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  JHT_HOME,
  JHT_CONFIG_PATH,
  JHT_DB_PATH,
  JHT_USER_DIR,
  getAgentDir,
} from "./tui-paths.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

export type TmuxSession = {
  name: string;
  agentId: string;
  attached: boolean;
};

// ── WSL distro detection ──────────────────────────────────────────────────

let cachedWslDistro: string | undefined;

function detectWslDistro(): string {
  if (cachedWslDistro !== undefined) return cachedWslDistro;

  for (const distro of ["Ubuntu-22.04", "Ubuntu-24.04", "Ubuntu-20.04", "Ubuntu"]) {
    const r = spawnSync("wsl.exe", ["-d", distro, "-e", "which", "tmux"], {
      encoding: "utf-8",
      timeout: 3000,
    });
    if (r.status === 0 && String(r.stdout ?? "").trim()) {
      cachedWslDistro = distro;
      return distro;
    }
  }

  cachedWslDistro = "";
  return "";
}

// ── Tmux helper (Windows/WSL compat) ──────────────────────────────────────

function buildWslArgs(extraArgs: string[]): string[] {
  const distro = detectWslDistro();
  return distro ? ["-d", distro, ...extraArgs] : extraArgs;
}

function spawnTmux(args: string[], timeout = 5000): { status: number | null; stdout: string; stderr: string } {
  const opts = { encoding: "utf-8" as const, timeout };
  const r = process.platform === "win32"
    ? spawnSync("wsl.exe", buildWslArgs(["-e", "tmux", ...args]), opts)
    : spawnSync("tmux", args, opts);
  return {
    status: r.status,
    stdout: String(r.stdout ?? ""),
    stderr: String(r.stderr ?? ""),
  };
}

// ── Agent configs ─────────────────────────────────────────────────────────

type AgentConfig = {
  sessionPrefix: string;
  effort: string;
  type: "single" | "multi";
};

const AGENT_CONFIGS: Record<string, AgentConfig> = {
  capitano:       { sessionPrefix: "CAPITANO",       effort: "high",   type: "single" },
  scout:      { sessionPrefix: "SCOUT",      effort: "high",   type: "multi" },
  analista:   { sessionPrefix: "ANALISTA",   effort: "high",   type: "multi" },
  scorer:     { sessionPrefix: "SCORER",     effort: "medium", type: "multi" },
  scrittore:  { sessionPrefix: "SCRITTORE",  effort: "high",   type: "multi" },
  critico:    { sessionPrefix: "CRITICO",    effort: "high",   type: "single" },
  sentinella: { sessionPrefix: "SENTINELLA", effort: "low",    type: "single" },
  assistente: { sessionPrefix: "ASSISTENTE", effort: "medium", type: "single" },
};

/** Mappa agentId -> nome sessione tmux standard */
const SESSION_NAME_MAP: Record<string, string> = {
  // Agenti moderni (derivati da AGENT_CONFIGS)
  ...Object.fromEntries(
    Object.entries(AGENT_CONFIGS).map(([role, config]) => [
      role,
      config.type === "single" ? config.sessionPrefix : `${config.sessionPrefix}-1`,
    ]),
  ),
  // Legacy
  gatekeeper: "JHT-GATEKEEPER",
  fullstack: "JHT-FULLSTACK",
  fullstack_2: "JHT-FULLSTACK-2",
  fullstack_3: "JHT-FULLSTACK-3",
  coord: "JHT-COORD",
  sentinel: "JHT-SENTINEL",
};

/** Reverse map: nome sessione -> agentId */
const REVERSE_SESSION_MAP = new Map<string, string>(
  Object.entries(SESSION_NAME_MAP).map(([id, name]) => [name, id]),
);

/** Prefissi sessione noti */
const KNOWN_PREFIXES = [
  "JHT-", "lab-",
  ...new Set(Object.values(AGENT_CONFIGS).map((c) => c.sessionPrefix)),
];

function isKnownSession(name: string): boolean {
  return KNOWN_PREFIXES.some((prefix) => name.startsWith(prefix));
}

/** Deriva l'agentId dal nome sessione tmux */
function deriveAgentId(sessionName: string): string {
  // Reverse lookup esatto (piu' affidabile)
  const exact = REVERSE_SESSION_MAP.get(sessionName);
  if (exact) return exact;

  // Fallback euristico
  return sessionName
    .replace(/^JHT-/i, "")
    .replace(/^lab-/, "")
    .toLowerCase()
    .replace(/-\d+$/, "")
    .replace(/-/g, "_");
}

// ── Session listing ───────────────────────────────────────────────────────

/** Elenca le sessioni tmux agenti attive */
export function listJhtSessions(): TmuxSession[] {
  const r = spawnTmux(["list-sessions", "-F", "#{session_name}|#{session_attached}"], 2000);
  if (r.status !== 0 || !r.stdout) return [];
  return r.stdout
    .trim()
    .split("\n")
    .filter((line) => {
      const name = line.split("|")[0] ?? "";
      return isKnownSession(name);
    })
    .map((line) => {
      const parts = line.split("|");
      const name = parts[0] ?? "";
      const attached = parts[1] === "1";
      const agentId = deriveAgentId(name);
      return { name, agentId, attached };
    });
}

/** Sessioni interne da nascondere all'utente finale */
const INTERNAL_PREFIXES = ["lab-", "JHT-E2E", "JHT-SENTINEL-USAGE"];

/** Elenca solo le sessioni agenti visibili all'utente (filtra sessioni interne dev) */
export function listUserSessions(): TmuxSession[] {
  return listJhtSessions().filter(
    (s) => !INTERNAL_PREFIXES.some((p) => s.name.startsWith(p)),
  );
}

// ── Session interaction ───────────────────────────────────────────────────

/** Cattura le ultime N righe del pane di una sessione tmux */
export function capturePane(sessionName: string, lines = 10): string[] {
  const r = spawnTmux(["capture-pane", "-t", sessionName, "-p", "-S", `-${lines}`], 2000);
  if (r.status !== 0 || !r.stdout) return [];
  return r.stdout.split("\n").filter((l) => l.trim().length > 0);
}

/** Invia un messaggio a una sessione tmux (2 comandi: testo + Enter) */
export function sendToSession(sessionName: string, message: string): boolean {
  const r1 = spawnTmux(["send-keys", "-t", sessionName, message], 2000);
  if (r1.status !== 0) return false;
  const r2 = spawnTmux(["send-keys", "-t", sessionName, "Enter"], 2000);
  return r2.status === 0;
}

/** Verifica se una sessione tmux esiste */
export function sessionExists(sessionName: string): boolean {
  const r = spawnTmux(["has-session", "-t", sessionName], 2000);
  return r.status === 0;
}

/** Trova il nome sessione tmux per un agente */
export function resolveSessionName(agentId: string): string | null {
  const sessions = listJhtSessions();
  const normalized = agentId.toLowerCase().replace(/-/g, "_");
  const match = sessions.find((s) => s.agentId === normalized);
  return match?.name ?? null;
}

// ── Start/Stop ────────────────────────────────────────────────────────────

/** Avvia una nuova sessione tmux per un agente con Claude CLI */
export function startSession(agentId: string, _workDir?: string, apiKey?: string): { ok: boolean; name: string; error?: string } {
  const normalized = agentId.toLowerCase().replace(/-/g, "_");
  const config = AGENT_CONFIGS[normalized];
  const name = SESSION_NAME_MAP[normalized] ?? `JHT-${agentId.toUpperCase()}`;

  if (sessionExists(name)) {
    return { ok: false, name, error: "sessione gia' attiva" };
  }

  if (!config) {
    return { ok: false, name, error: `agente '${agentId}' non riconosciuto` };
  }

  // Directory agente nella zona nascosta ~/.jht/agents/<id>/
  const agentDir = getAgentDir(normalized, config.type === "multi" ? "1" : undefined);
  mkdirSync(agentDir, { recursive: true });
  // Copia CLAUDE.md template se non esiste
  const templatePath = join(REPO_ROOT, "agents", normalized, `${normalized}.md`);
  const claudeMdPath = join(agentDir, "CLAUDE.md");
  if (existsSync(templatePath) && !existsSync(claudeMdPath)) {
    try { copyFileSync(templatePath, claudeMdPath); } catch { /* ignora */ }
  }

  const claudeCmd = `claude --dangerously-skip-permissions --effort ${config.effort}`;

  // Env var che gli agenti devono poter leggere
  const jhtEnv: Record<string, string> = {
    JHT_HOME,
    JHT_USER_DIR,
    JHT_DB: JHT_DB_PATH,
    JHT_CONFIG: JHT_CONFIG_PATH,
    JHT_AGENT_DIR: agentDir,
  };
  if (apiKey) jhtEnv.ANTHROPIC_API_KEY = apiKey;

  if (process.platform === "win32") {
    // Windows/WSL: crea sessione tmux con cmd.exe (evita Execution Policy di PowerShell)
    const r = spawnTmux(["new-session", "-d", "-s", name, "cmd.exe"]);
    if (r.status !== 0) {
      return { ok: false, name, error: r.stderr.trim() || "errore tmux" };
    }

    // Setup in background: setta env vars, naviga nella cartella e avvia Claude
    const safePath = agentDir.replace(/\\/g, "\\\\");
    const setEnvCmds = Object.entries(jhtEnv).map(([k, v]) =>
      `tmux send-keys -t '${name}' 'set ${k}=${v}' Enter && sleep 0.2`,
    );
    // Se c'e' API key, Claude chiede conferma: Up (seleziona "Yes") + Enter
    const acceptApiKeyCmd = apiKey
      ? `sleep 5 && tmux send-keys -t '${name}' Up Enter && sleep 5`
      : "sleep 8";
    const setupCmds = [
      "sleep 2",
      ...setEnvCmds,
      `tmux send-keys -t '${name}' 'cd ${safePath}' Enter`,
      "sleep 1",
      `tmux send-keys -t '${name}' '${claudeCmd}' Enter`,
      acceptApiKeyCmd,
      `tmux send-keys -t '${name}' Enter`,
    ].join(" && ");

    spawn("wsl.exe", buildWslArgs(["-e", "bash", "-c", setupCmds]), {
      detached: true,
      stdio: "ignore",
    }).unref();
  } else {
    // Linux/macOS: crea sessione direttamente con cwd = agentDir
    const r = spawnTmux(["new-session", "-d", "-s", name, "-c", agentDir]);
    if (r.status !== 0) {
      return { ok: false, name, error: r.stderr.trim() || "errore tmux" };
    }

    // Export env vars (escape single quotes nei valori)
    for (const [k, v] of Object.entries(jhtEnv)) {
      const escaped = String(v).replace(/'/g, "'\\''");
      spawnTmux(["send-keys", "-t", name, `export ${k}='${escaped}'`, "C-m"]);
    }
    // Avvia Claude e auto-accept trust/API key dialog
    spawnTmux(["send-keys", "-t", name, claudeCmd, "C-m"]);
    const acceptDelay = apiKey ? `sleep 5 && tmux send-keys -t '${name}' Up Enter && sleep 5` : "sleep 4";
    spawn("bash", ["-c", `${acceptDelay} && tmux send-keys -t '${name}' Enter && sleep 3 && tmux send-keys -t '${name}' Enter`], {
      detached: true,
      stdio: "ignore",
    }).unref();
  }

  return { ok: true, name };
}

/** Ferma tutte le sessioni agente attive */
export function stopAllSessions(): number {
  const sessions = listUserSessions();
  let stopped = 0;
  for (const s of sessions) {
    const r = stopSession(s.name);
    if (r.ok) stopped++;
  }
  return stopped;
}

/** Ferma (kill) una sessione tmux */
export function stopSession(sessionName: string): { ok: boolean; error?: string } {
  if (!sessionExists(sessionName)) {
    return { ok: false, error: "sessione non trovata" };
  }
  const r = spawnTmux(["kill-session", "-t", sessionName], 3000);
  if (r.status !== 0) {
    return { ok: false, error: r.stderr.trim() || "errore tmux" };
  }
  return { ok: true };
}
