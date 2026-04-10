/**
 * JHT paths — fonte unica di verita per i moduli shared.
 * Specchio di tui/src/tui-paths.ts e web/lib/jht-paths.ts.
 * Se cambi uno, cambia anche gli altri due.
 *
 * Override-abile via env var JHT_HOME e JHT_USER_DIR per test isolation.
 */
import { homedir } from "node:os";
import { join } from "node:path";

// Zona nascosta
export const JHT_HOME = process.env.JHT_HOME || join(homedir(), ".jht");
export const JHT_CONFIG_PATH = join(JHT_HOME, "jht.config.json");
export const JHT_DB_PATH = join(JHT_HOME, "jobs.db");
export const JHT_PROFILE_DIR = join(JHT_HOME, "profile");
export const JHT_PROFILE_YAML = join(JHT_PROFILE_DIR, "candidate_profile.yml");
export const JHT_PROVIDER_CONFIG_PATH = join(JHT_PROFILE_DIR, "jht.config.json");
export const JHT_AGENTS_DIR = join(JHT_HOME, "agents");
export const JHT_LOGS_DIR = join(JHT_HOME, "logs");
export const JHT_CREDENTIALS_DIR = join(JHT_HOME, "credentials");

// Zona visibile
export const JHT_USER_DIR = process.env.JHT_USER_DIR || join(homedir(), "Documents", "Job Hunter Team");
export const JHT_USER_CV_DIR = join(JHT_USER_DIR, "cv");
export const JHT_USER_UPLOADS_DIR = join(JHT_USER_DIR, "allegati");
export const JHT_USER_OUTPUT_DIR = join(JHT_USER_DIR, "output");

export function getAgentDir(agentId: string, instance?: string): string {
  const sub = instance ? `${agentId}-${instance}` : agentId;
  return join(JHT_AGENTS_DIR, sub);
}
