/**
 * Profilo utente — load/save da ~/.jht/jht.config.json.
 * Usato dal wizard onboarding e dal comando /profile.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const CONFIG_DIR = join(homedir(), ".jht");
const CONFIG_PATH = join(CONFIG_DIR, "jht.config.json");

export type UserProfile = {
  nome: string;
  eta: string;
  competenze: string[];
  zona: string;
  tipoLavoro: string;
  completato: boolean;
};

const EMPTY_PROFILE: UserProfile = {
  nome: "",
  eta: "",
  competenze: [],
  zona: "",
  tipoLavoro: "",
  completato: false,
};

function loadConfig(): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
  } catch {
    return {};
  }
}

function saveConfig(cfg: Record<string, unknown>): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2) + "\n", "utf-8");
}

export function loadProfile(): UserProfile {
  const cfg = loadConfig();
  const p = cfg.profile as Record<string, unknown> | undefined;
  if (!p || typeof p !== "object") return { ...EMPTY_PROFILE };
  return {
    nome: typeof p.nome === "string" ? p.nome : "",
    eta: typeof p.eta === "string" ? p.eta : "",
    competenze: Array.isArray(p.competenze) ? (p.competenze as string[]) : [],
    zona: typeof p.zona === "string" ? p.zona : "",
    tipoLavoro: typeof p.tipoLavoro === "string" ? p.tipoLavoro : "",
    completato: p.completato === true,
  };
}

export function saveProfile(profile: UserProfile): void {
  const cfg = loadConfig();
  cfg.profile = profile;
  saveConfig(cfg);
}

export function isProfileComplete(profile: UserProfile): boolean {
  return !!(profile.nome && profile.competenze.length > 0 && profile.zona);
}

export function formatProfile(profile: UserProfile): string[] {
  const lines: string[] = [];
  lines.push(`  Nome: ${profile.nome || "(non impostato)"}`);
  if (profile.eta) lines.push(`  Eta': ${profile.eta}`);
  lines.push(`  Competenze: ${profile.competenze.length > 0 ? profile.competenze.join(", ") : "(nessuna)"}`);
  lines.push(`  Zona: ${profile.zona || "(non impostata)"}`);
  lines.push(`  Tipo lavoro: ${profile.tipoLavoro || "(non impostato)"}`);
  return lines;
}
