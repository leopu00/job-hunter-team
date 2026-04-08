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
  cognome: string;
  dataNascita: string;
  competenze: string[];
  zona: string;
  tipoLavoro: string;
  completato: boolean;
};

const EMPTY_PROFILE: UserProfile = {
  nome: "",
  cognome: "",
  dataNascita: "",
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
  const rawNome = typeof p.nome === "string" ? p.nome.trim() : "";
  const rawCognome = typeof p.cognome === "string" ? p.cognome.trim() : "";
  const legacyParts = rawNome.split(/\s+/).filter(Boolean);
  const nome = rawCognome ? rawNome : (legacyParts[0] ?? rawNome);
  const cognome = rawCognome || (legacyParts.length > 1 ? legacyParts.slice(1).join(" ") : "");
  return {
    nome,
    cognome,
    dataNascita: typeof p.dataNascita === "string"
      ? p.dataNascita
      : typeof p.birthDate === "string"
        ? p.birthDate
        : "",
    competenze: Array.isArray(p.competenze) ? (p.competenze as string[]) : [],
    zona: typeof p.zona === "string" ? p.zona : "",
    tipoLavoro: typeof p.tipoLavoro === "string" ? p.tipoLavoro : "",
    completato: p.completato === true,
  };
}

export function saveProfile(profile: UserProfile): void {
  const cfg = loadConfig();
  cfg.profile = {
    ...profile,
    // Mantiene compatibilita con letture legacy che usano un nome completo singolo.
    nomeCompleto: [profile.nome, profile.cognome].filter(Boolean).join(" ").trim(),
  };
  saveConfig(cfg);
}

export function isProfileComplete(profile: UserProfile): boolean {
  return !!(profile.nome && profile.cognome && profile.dataNascita && profile.competenze.length > 0 && profile.zona && profile.tipoLavoro);
}

export function getMissingProfileFields(profile: UserProfile): string[] {
  const missing: string[] = [];
  if (!profile.nome) missing.push("nome");
  if (!profile.cognome) missing.push("cognome");
  if (!profile.dataNascita) missing.push("data di nascita");
  if (profile.competenze.length === 0) missing.push("competenze");
  if (!profile.zona) missing.push("zona");
  if (!profile.tipoLavoro) missing.push("tipo lavoro");
  return missing;
}

export function formatProfile(profile: UserProfile): string[] {
  const lines: string[] = [];
  lines.push(`  Nome: ${profile.nome || "(non impostato)"}`);
  lines.push(`  Cognome: ${profile.cognome || "(non impostato)"}`);
  lines.push(`  Data di nascita: ${profile.dataNascita || "(non impostata)"}`);
  lines.push(`  Competenze: ${profile.competenze.length > 0 ? profile.competenze.join(", ") : "(nessuna)"}`);
  lines.push(`  Zona: ${profile.zona || "(non impostata)"}`);
  lines.push(`  Tipo lavoro: ${profile.tipoLavoro || "(non impostato)"}`);
  return lines;
}
