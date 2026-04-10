/**
 * JHT paths — separazione zona nascosta (agenti/dati sensibili) da zona visibile (utente).
 *
 * ~/.jht/                       → nascosta, toccata solo dalla TUI e dagli agenti
 * ~/Documents/Job Hunter Team/  → visibile, drop CV e output generati dagli agenti
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// Zona nascosta (override-abile via env var per test/e2e)
export const JHT_HOME = process.env.JHT_HOME || join(homedir(), ".jht");
export const JHT_CONFIG_PATH = join(JHT_HOME, "jht.config.json");
export const JHT_DB_PATH = join(JHT_HOME, "jobs.db");
export const JHT_PROFILE_DIR = join(JHT_HOME, "profile");
export const JHT_PROFILE_YAML = join(JHT_PROFILE_DIR, "candidate_profile.yml");
export const JHT_PROVIDER_CONFIG_PATH = join(JHT_PROFILE_DIR, "jht.config.json");
export const JHT_AGENTS_DIR = join(JHT_HOME, "agents");
export const JHT_LOGS_DIR = join(JHT_HOME, "logs");
export const JHT_CREDENTIALS_DIR = join(JHT_HOME, "credentials");

// Zona visibile (override-abile via env var per test/e2e)
export const JHT_USER_DIR = process.env.JHT_USER_DIR || join(homedir(), "Documents", "Job Hunter Team");
export const JHT_USER_CV_DIR = join(JHT_USER_DIR, "cv");
export const JHT_USER_UPLOADS_DIR = join(JHT_USER_DIR, "allegati");
export const JHT_USER_OUTPUT_DIR = join(JHT_USER_DIR, "output");
export const JHT_USER_README = join(JHT_USER_DIR, "README.txt");

export type JhtPathsInitResult = {
  createdHome: boolean;
  createdUserDir: boolean;
  createdReadme: boolean;
};

export function getAgentDir(agentId: string, instance?: string): string {
  const sub = instance ? `${agentId}-${instance}` : agentId;
  return join(JHT_AGENTS_DIR, sub);
}

const USER_README = `Job Hunter Team — Cartella utente
================================

Questa e' la tua cartella di lavoro. Puoi muoverti qui dentro senza paura:
gli agenti sanno dove trovare e scrivere le cose.

  cv/        → metti qui i tuoi CV (PDF, docx, txt). Gli agenti li leggono.
  allegati/  → altri documenti da condividere con gli agenti.
  output/    → gli agenti scrivono qui i CV e le cover letter generati.

NON serve (ne' conviene) aprire la cartella ~/.jht/: contiene il database
jobs.db, le credenziali e le istruzioni degli agenti, toccarli puo'
rompere il sistema.
`;

export function ensureJhtPaths(): JhtPathsInitResult {
  const createdHome = !existsSync(JHT_HOME);
  mkdirSync(JHT_HOME, { recursive: true });
  mkdirSync(JHT_PROFILE_DIR, { recursive: true });
  mkdirSync(JHT_AGENTS_DIR, { recursive: true });
  mkdirSync(JHT_LOGS_DIR, { recursive: true });
  mkdirSync(JHT_CREDENTIALS_DIR, { recursive: true });

  const createdUserDir = !existsSync(JHT_USER_DIR);
  mkdirSync(JHT_USER_DIR, { recursive: true });
  mkdirSync(JHT_USER_CV_DIR, { recursive: true });
  mkdirSync(JHT_USER_UPLOADS_DIR, { recursive: true });
  mkdirSync(JHT_USER_OUTPUT_DIR, { recursive: true });

  const createdReadme = !existsSync(JHT_USER_README);
  if (createdReadme) {
    writeFileSync(JHT_USER_README, USER_README, "utf-8");
  }

  return { createdHome, createdUserDir, createdReadme };
}
