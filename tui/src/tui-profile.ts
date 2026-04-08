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

export type ProfileFieldValidationResult =
  | { ok: true; value: string | string[] }
  | { ok: false; error: string };

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

function normalizeSpaces(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function validatePersonName(value: string, label: string): ProfileFieldValidationResult {
  const normalized = normalizeSpaces(value);
  if (normalized.length < 2) {
    return { ok: false, error: `${label} troppo corto` };
  }
  if (normalized.length > 50) {
    return { ok: false, error: `${label} troppo lungo` };
  }
  if (!/^[A-Za-zÀ-ÖØ-öø-ÿ' -]+$/.test(normalized)) {
    return { ok: false, error: `${label} contiene caratteri non validi` };
  }
  return { ok: true, value: normalized };
}

function validateBirthDate(value: string): ProfileFieldValidationResult {
  const normalized = normalizeSpaces(value);
  const match = normalized.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) {
    return { ok: false, error: "usa il formato GG/MM/AAAA" };
  }
  const [, dd, mm, yyyy] = match;
  const day = Number(dd);
  const month = Number(mm);
  const year = Number(yyyy);
  const date = new Date(year, month - 1, day);
  if (
    Number.isNaN(date.getTime()) ||
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return { ok: false, error: "data di nascita non valida" };
  }
  const now = new Date();
  if (date > now) {
    return { ok: false, error: "data di nascita nel futuro" };
  }
  if (year < 1900) {
    return { ok: false, error: "anno non valido" };
  }
  return { ok: true, value: `${dd}/${mm}/${yyyy}` };
}

function validateSkills(value: string): ProfileFieldValidationResult {
  const skills = value
    .split(",")
    .map((item) => normalizeSpaces(item))
    .filter(Boolean);
  if (skills.length === 0) {
    return { ok: false, error: "inserisci almeno una competenza" };
  }
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const skill of skills) {
    if (skill.length < 2) return { ok: false, error: "una competenza e troppo corta" };
    if (skill.length > 40) return { ok: false, error: "una competenza e troppo lunga" };
    if (!/^[A-Za-zÀ-ÖØ-öø-ÿ0-9+#./ -]+$/.test(skill)) {
      return { ok: false, error: "una competenza contiene caratteri non validi" };
    }
    const key = skill.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(skill);
  }
  return { ok: true, value: normalized };
}

function validateZona(value: string): ProfileFieldValidationResult {
  const normalized = normalizeSpaces(value);
  if (normalized.length < 2) {
    return { ok: false, error: "zona troppo corta" };
  }
  if (normalized.length > 80) {
    return { ok: false, error: "zona troppo lunga" };
  }
  if (!/^[A-Za-zÀ-ÖØ-öø-ÿ0-9,./()' -]+$/.test(normalized)) {
    return { ok: false, error: "zona contiene caratteri non validi" };
  }
  return { ok: true, value: normalized };
}

const TIPO_LAVORO_MAP: Record<string, string> = {
  "full-time": "Full-time",
  "full time": "Full-time",
  "part-time": "Part-time",
  "part time": "Part-time",
  freelance: "Freelance",
  stage: "Stage",
  internship: "Stage",
  apprendistato: "Apprendistato",
  "tempo determinato": "Contratto a tempo determinato",
  determinato: "Contratto a tempo determinato",
  "contratto a tempo determinato": "Contratto a tempo determinato",
  "tempo indeterminato": "Contratto a tempo indeterminato",
  indeterminato: "Contratto a tempo indeterminato",
  "contratto a tempo indeterminato": "Contratto a tempo indeterminato",
};

function validateTipoLavoro(value: string): ProfileFieldValidationResult {
  const normalized = normalizeSpaces(value).toLowerCase();
  const canonical = TIPO_LAVORO_MAP[normalized];
  if (!canonical) {
    return {
      ok: false,
      error: "tipo non valido: usa Full-time, Part-time, Freelance, Stage, Apprendistato, Tempo determinato o Tempo indeterminato",
    };
  }
  return { ok: true, value: canonical };
}

export function validateProfileField(field: keyof Pick<UserProfile, "nome" | "cognome" | "dataNascita" | "competenze" | "zona" | "tipoLavoro">, value: string): ProfileFieldValidationResult {
  switch (field) {
    case "nome":
      return validatePersonName(value, "nome");
    case "cognome":
      return validatePersonName(value, "cognome");
    case "dataNascita":
      return validateBirthDate(value);
    case "competenze":
      return validateSkills(value);
    case "zona":
      return validateZona(value);
    case "tipoLavoro":
      return validateTipoLavoro(value);
  }
}
