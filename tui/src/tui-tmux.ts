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
