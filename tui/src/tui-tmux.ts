/**
 * Tmux integration — gestione sessioni agenti JHT.
 * Lettura stato, cattura output, invio messaggi, start/stop sessioni.
 */
import { spawnSync } from "node:child_process";

export type TmuxSession = {
  name: string;
  agentId: string;
  attached: boolean;
};

/** Elenca le sessioni tmux JHT-* e lab-* attive */
export function listJhtSessions(): TmuxSession[] {
  const r = spawnSync("tmux", ["list-sessions", "-F", "#{session_name}|#{session_attached}"], {
    encoding: "utf-8",
    timeout: 2000,
  });
  if (r.status !== 0 || !r.stdout) return [];
  return r.stdout
    .trim()
    .split("\n")
    .filter((line) => line.startsWith("JHT-") || line.startsWith("lab-"))
    .map((line) => {
      const parts = line.split("|");
      const name = parts[0] ?? "";
      const attached = parts[1] === "1";
      const agentId = name
        .replace(/^JHT-/i, "")
        .replace(/^lab-/, "")
        .toLowerCase()
        .replace(/-/g, "_");
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

/** Cattura le ultime N righe del pane di una sessione tmux */
export function capturePane(sessionName: string, lines = 10): string[] {
  const r = spawnSync("tmux", ["capture-pane", "-t", sessionName, "-p", "-S", `-${lines}`], {
    encoding: "utf-8",
    timeout: 2000,
  });
  if (r.status !== 0 || !r.stdout) return [];
  return r.stdout.split("\n").filter((l) => l.trim().length > 0);
}

/** Invia un messaggio a una sessione tmux (2 comandi: testo + Enter) */
export function sendToSession(sessionName: string, message: string): boolean {
  const r1 = spawnSync("tmux", ["send-keys", "-t", sessionName, message], { timeout: 2000 });
  if (r1.status !== 0) return false;
  const r2 = spawnSync("tmux", ["send-keys", "-t", sessionName, "Enter"], { timeout: 2000 });
  return r2.status === 0;
}

/** Verifica se una sessione tmux esiste */
export function sessionExists(sessionName: string): boolean {
  const r = spawnSync("tmux", ["has-session", "-t", sessionName], { timeout: 2000 });
  return r.status === 0;
}

/** Trova il nome sessione tmux per un agente */
export function resolveSessionName(agentId: string): string | null {
  const sessions = listJhtSessions();
  const normalized = agentId.toLowerCase().replace(/-/g, "_");
  const match = sessions.find((s) => s.agentId === normalized);
  return match?.name ?? null;
}

/** Mappa agentId → nome sessione tmux standard */
const SESSION_NAME_MAP: Record<string, string> = {
  gatekeeper: "JHT-GATEKEEPER",
  fullstack: "JHT-FULLSTACK",
  fullstack_2: "JHT-FULLSTACK-2",
  fullstack_3: "JHT-FULLSTACK-3",
  coord: "JHT-COORD",
  sentinel: "JHT-SENTINEL",
  scout: "SCOUT-1",
  analista: "ANALISTA-1",
  scorer: "SCORER-1",
  scrittore: "SCRITTORE-1",
  critico: "CRITICO",
  sentinella: "SENTINELLA",
  assistente: "ASSISTENTE",
  alfa: "ALFA",
};

/** Avvia una nuova sessione tmux per un agente */
export function startSession(agentId: string, workDir?: string): { ok: boolean; name: string; error?: string } {
  const normalized = agentId.toLowerCase().replace(/-/g, "_");
  const name = SESSION_NAME_MAP[normalized] ?? `JHT-${agentId.toUpperCase()}`;

  if (sessionExists(name)) {
    return { ok: false, name, error: "sessione gia' attiva" };
  }

  const args = ["new-session", "-d", "-s", name];
  if (workDir) args.push("-c", workDir);

  const r = spawnSync("tmux", args, { encoding: "utf-8", timeout: 3000 });
  if (r.status !== 0) {
    return { ok: false, name, error: r.stderr?.trim() || "errore tmux" };
  }
  return { ok: true, name };
}

/** Ferma (kill) una sessione tmux */
export function stopSession(sessionName: string): { ok: boolean; error?: string } {
  if (!sessionExists(sessionName)) {
    return { ok: false, error: "sessione non trovata" };
  }
  const r = spawnSync("tmux", ["kill-session", "-t", sessionName], {
    encoding: "utf-8",
    timeout: 3000,
  });
  if (r.status !== 0) {
    return { ok: false, error: r.stderr?.trim() || "errore tmux" };
  }
  return { ok: true };
}
