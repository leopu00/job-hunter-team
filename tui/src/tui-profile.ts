/**
 * Profilo utente + config runtime — load/save da ~/.jht/jht.config.json.
 * Usato dal wizard onboarding, dalla TUI e dalla cartella di lavoro.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";

const CONFIG_DIR = join(homedir(), ".jht");
const CONFIG_PATH = join(CONFIG_DIR, "jht.config.json");

export type UserProfile = {
  nome: string;
  cognome: string;
  dataNascita: string;
  headline: string;
  targetRoles: string[];
  seniorityTarget: string;
  competenze: string[];
  zona: string;
  locationPreferences: string[];
  tipoLavoro: string;
  languages: string[];
  strengths: string[];
  email: string;
  linkedin: string;
  portfolio: string;
  salaryTarget: string;
  availability: string;
  workAuthorization: string;
  completato: boolean;
};

export type ProfileFieldValidationResult =
  | { ok: true; value: string | string[] }
  | { ok: false; error: string };

export type WorkspaceValidationResult =
  | { ok: true; value: string }
  | { ok: false; error: string };

export type WorkspaceInitResult = {
  createdWorkspaceDir: boolean;
  createdProfileDir: boolean;
  createdUploadsDir: boolean;
  createdDb: boolean;
};

const EMPTY_PROFILE: UserProfile = {
  nome: "",
  cognome: "",
  dataNascita: "",
  headline: "",
  targetRoles: [],
  seniorityTarget: "",
  competenze: [],
  zona: "",
  locationPreferences: [],
  tipoLavoro: "",
  languages: [],
  strengths: [],
  email: "",
  linkedin: "",
  portfolio: "",
  salaryTarget: "",
  availability: "",
  workAuthorization: "",
  completato: false,
};

const WORKSPACE_DB_SCHEMA = `
CREATE TABLE IF NOT EXISTS companies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  website TEXT,
  hq_country TEXT,
  sector TEXT,
  size TEXT,
  glassdoor_rating REAL,
  red_flags TEXT,
  culture_notes TEXT,
  analyzed_by TEXT,
  analyzed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  verdict TEXT
);

CREATE TABLE IF NOT EXISTS positions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  company TEXT NOT NULL,
  company_id INTEGER,
  location TEXT,
  remote_type TEXT,
  salary_declared_min INTEGER,
  salary_declared_max INTEGER,
  salary_declared_currency TEXT DEFAULT 'EUR',
  salary_estimated_min INTEGER,
  salary_estimated_max INTEGER,
  salary_estimated_currency TEXT DEFAULT 'EUR',
  salary_estimated_source TEXT,
  url TEXT,
  source TEXT,
  jd_text TEXT,
  requirements TEXT,
  found_by TEXT,
  found_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  deadline TEXT,
  status TEXT DEFAULT 'new',
  notes TEXT,
  last_checked TIMESTAMP,
  FOREIGN KEY (company_id) REFERENCES companies(id)
);

CREATE INDEX IF NOT EXISTS idx_positions_status ON positions(status);
CREATE INDEX IF NOT EXISTS idx_positions_company ON positions(company);
CREATE INDEX IF NOT EXISTS idx_positions_url ON positions(url);

CREATE TABLE IF NOT EXISTS position_highlights (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  position_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  text TEXT NOT NULL,
  FOREIGN KEY (position_id) REFERENCES positions(id)
);

CREATE TABLE IF NOT EXISTS scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  position_id INTEGER NOT NULL UNIQUE,
  total_score INTEGER NOT NULL,
  stack_match INTEGER,
  remote_fit INTEGER,
  salary_fit INTEGER,
  experience_fit INTEGER,
  strategic_fit INTEGER,
  breakdown TEXT,
  notes TEXT,
  scored_by TEXT,
  scored_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (position_id) REFERENCES positions(id)
);

CREATE INDEX IF NOT EXISTS idx_scores_total ON scores(total_score);

CREATE TABLE IF NOT EXISTS applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  position_id INTEGER NOT NULL UNIQUE,
  cv_path TEXT,
  cl_path TEXT,
  cv_pdf_path TEXT,
  cl_pdf_path TEXT,
  critic_verdict TEXT,
  critic_score REAL,
  critic_notes TEXT,
  status TEXT DEFAULT 'draft',
  written_at TIMESTAMP,
  applied_at TIMESTAMP,
  applied_via TEXT,
  response TEXT,
  response_at TIMESTAMP,
  written_by TEXT,
  reviewed_by TEXT,
  critic_reviewed_at TIMESTAMP,
  applied BOOLEAN DEFAULT 0,
  interview_round INTEGER DEFAULT NULL,
  cv_drive_id TEXT,
  cl_drive_id TEXT,
  FOREIGN KEY (position_id) REFERENCES positions(id)
);

CREATE INDEX IF NOT EXISTS idx_applications_status ON applications(status);

PRAGMA user_version = 2;
`;

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

function normalizeWorkspaceInput(value: string): string {
  return value.trim().replace(/^"(.*)"$/, "$1");
}

export function validateWorkspacePath(value: string): WorkspaceValidationResult {
  const normalized = normalizeWorkspaceInput(value);
  if (!normalized) {
    return { ok: false, error: "inserisci una cartella di lavoro" };
  }

  const resolved = resolve(normalized);
  if (!existsSync(resolved)) {
    return { ok: false, error: "cartella non trovata" };
  }

  try {
    if (!statSync(resolved).isDirectory()) {
      return { ok: false, error: "il percorso indicato non e una cartella" };
    }
  } catch {
    return { ok: false, error: "cartella non accessibile" };
  }

  return { ok: true, value: resolved };
}

export function loadWorkspacePath(): string {
  const cfg = loadConfig();
  const nested = cfg.workspace as Record<string, unknown> | undefined;
  const raw = typeof cfg.workspacePath === "string"
    ? cfg.workspacePath
    : typeof nested?.path === "string"
      ? nested.path
      : "";
  return raw.trim();
}

export function hasValidWorkspacePath(): boolean {
  const workspace = loadWorkspacePath();
  return validateWorkspacePath(workspace).ok;
}

export function saveWorkspacePath(workspacePath: string): void {
  const validation = validateWorkspacePath(workspacePath);
  if (!validation.ok) {
    throw new Error(validation.error);
  }

  const cfg = loadConfig();
  const workspace = cfg.workspace && typeof cfg.workspace === "object"
    ? cfg.workspace as Record<string, unknown>
    : {};
  workspace.path = validation.value;
  cfg.workspace = workspace;
  cfg.workspacePath = validation.value;
  saveConfig(cfg);
}

function initWorkspaceDb(dbPath: string): void {
  const script = [
    "const { DatabaseSync } = require('node:sqlite');",
    `const db = new DatabaseSync(${JSON.stringify(dbPath)});`,
    "db.exec('PRAGMA journal_mode = WAL;');",
    "db.exec('PRAGMA foreign_keys = ON;');",
    `db.exec(${JSON.stringify(WORKSPACE_DB_SCHEMA)});`,
    "db.close();",
  ].join("");

  const result = spawnSync(process.execPath, ["-e", script], {
    encoding: "utf-8",
    timeout: 15_000,
  });

  if (result.status !== 0) {
    const details = result.stderr?.trim() || result.stdout?.trim() || "errore inizializzazione database";
    throw new Error(details);
  }
}

export function ensureWorkspaceInitialized(workspacePath: string): WorkspaceInitResult {
  const resolved = resolve(workspacePath);
  const profileDir = join(resolved, "profile");
  const uploadsDir = join(profileDir, "uploads");
  const dbPath = join(resolved, "jobs.db");

  const createdWorkspaceDir = !existsSync(resolved);
  mkdirSync(resolved, { recursive: true });

  const createdProfileDir = !existsSync(profileDir);
  mkdirSync(profileDir, { recursive: true });

  const createdUploadsDir = !existsSync(uploadsDir);
  mkdirSync(uploadsDir, { recursive: true });

  const createdDb = !existsSync(dbPath);
  if (createdDb) {
    initWorkspaceDb(dbPath);
  }

  return { createdWorkspaceDir, createdProfileDir, createdUploadsDir, createdDb };
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
  const profile: UserProfile = {
    nome,
    cognome,
    dataNascita: typeof p.dataNascita === "string"
      ? p.dataNascita
      : typeof p.birthDate === "string"
        ? p.birthDate
        : "",
    headline: typeof p.headline === "string" ? p.headline : "",
    targetRoles: Array.isArray(p.targetRoles)
      ? p.targetRoles.filter((v): v is string => typeof v === "string").map((v) => v.trim()).filter(Boolean)
      : typeof p.targetRole === "string" && p.targetRole.trim()
        ? [p.targetRole.trim()]
        : [],
    seniorityTarget: typeof p.seniorityTarget === "string" ? p.seniorityTarget : "",
    competenze: Array.isArray(p.competenze) ? (p.competenze as string[]) : [],
    zona: typeof p.zona === "string" ? p.zona : "",
    locationPreferences: Array.isArray(p.locationPreferences)
      ? p.locationPreferences.filter((v): v is string => typeof v === "string").map((v) => v.trim()).filter(Boolean)
      : typeof p.zona === "string" && p.zona.trim()
        ? [p.zona.trim()]
        : [],
    tipoLavoro: typeof p.tipoLavoro === "string" ? p.tipoLavoro : "",
    languages: Array.isArray(p.languages)
      ? p.languages
        .map((item) => {
          if (typeof item === "string") return item.trim();
          if (item && typeof item === "object") {
            const lingua = typeof (item as Record<string, unknown>).lingua === "string"
              ? String((item as Record<string, unknown>).lingua).trim()
              : "";
            const livello = typeof (item as Record<string, unknown>).livello === "string"
              ? String((item as Record<string, unknown>).livello).trim()
              : "";
            return [lingua, livello].filter(Boolean).join(" ");
          }
          return "";
        })
        .filter(Boolean)
      : [],
    strengths: Array.isArray(p.strengths)
      ? p.strengths.filter((v): v is string => typeof v === "string").map((v) => v.trim()).filter(Boolean)
      : [],
    email: typeof p.email === "string" ? p.email.trim() : "",
    linkedin: typeof p.linkedin === "string" ? p.linkedin.trim() : "",
    portfolio: typeof p.portfolio === "string" ? p.portfolio.trim() : "",
    salaryTarget: typeof p.salaryTarget === "string" ? p.salaryTarget.trim() : "",
    availability: typeof p.availability === "string" ? p.availability.trim() : "",
    workAuthorization: typeof p.workAuthorization === "string" ? p.workAuthorization.trim() : "",
    completato: false,
  };
  if (!profile.zona && profile.locationPreferences.length > 0) {
    profile.zona = profile.locationPreferences.join(", ");
  }
  profile.completato = isProfileComplete(profile);
  return profile;
}

export function saveProfile(profile: UserProfile): void {
  const cfg = loadConfig();
  cfg.profile = {
    ...profile,
    zona: profile.zona || profile.locationPreferences.join(", "),
    // Mantiene compatibilita con letture legacy che usano un nome completo singolo.
    nomeCompleto: [profile.nome, profile.cognome].filter(Boolean).join(" ").trim(),
  };
  saveConfig(cfg);
}

export function isProfileComplete(profile: UserProfile): boolean {
  return !!(
    profile.nome &&
    profile.cognome &&
    profile.targetRoles.length > 0 &&
    profile.seniorityTarget &&
    profile.competenze.length > 0 &&
    profile.locationPreferences.length > 0 &&
    profile.tipoLavoro
  );
}

export function getMissingProfileFields(profile: UserProfile): string[] {
  const missing: string[] = [];
  if (!profile.nome) missing.push("nome");
  if (!profile.cognome) missing.push("cognome");
  if (profile.targetRoles.length === 0) missing.push("ruoli target");
  if (!profile.seniorityTarget) missing.push("seniority");
  if (profile.competenze.length === 0) missing.push("competenze");
  if (profile.locationPreferences.length === 0) missing.push("preferenze luogo");
  if (!profile.tipoLavoro) missing.push("tipo lavoro");
  return missing;
}

export function getProfileCompletion(profile: UserProfile): { filled: number; total: number; percent: number } {
  const checks = [
    Boolean(profile.nome),
    Boolean(profile.cognome),
    profile.targetRoles.length > 0,
    Boolean(profile.seniorityTarget),
    profile.competenze.length > 0,
    profile.locationPreferences.length > 0,
    Boolean(profile.tipoLavoro),
  ];
  const filled = checks.filter(Boolean).length;
  const total = checks.length;
  return { filled, total, percent: Math.round((filled / total) * 100) };
}

export function formatProfile(profile: UserProfile): string[] {
  const lines: string[] = [];
  lines.push(`  Nome: ${profile.nome || "(non impostato)"}`);
  lines.push(`  Cognome: ${profile.cognome || "(non impostato)"}`);
  if (profile.headline) lines.push(`  Headline: ${profile.headline}`);
  lines.push(`  Ruoli target: ${profile.targetRoles.length > 0 ? profile.targetRoles.join(", ") : "(non impostati)"}`);
  lines.push(`  Seniority: ${profile.seniorityTarget || "(non impostata)"}`);
  lines.push(`  Competenze: ${profile.competenze.length > 0 ? profile.competenze.join(", ") : "(nessuna)"}`);
  lines.push(`  Preferenze luogo: ${profile.locationPreferences.length > 0 ? profile.locationPreferences.join(", ") : "(non impostate)"}`);
  lines.push(`  Tipo lavoro: ${profile.tipoLavoro || "(non impostato)"}`);
  if (profile.languages.length > 0) lines.push(`  Lingue: ${profile.languages.join(", ")}`);
  if (profile.strengths.length > 0) lines.push(`  Punti di forza: ${profile.strengths.join(", ")}`);
  if (profile.email) lines.push(`  Email: ${profile.email}`);
  if (profile.linkedin) lines.push(`  LinkedIn: ${profile.linkedin}`);
  if (profile.portfolio) lines.push(`  Portfolio: ${profile.portfolio}`);
  if (profile.salaryTarget) lines.push(`  Retribuzione target: ${profile.salaryTarget}`);
  if (profile.availability) lines.push(`  Disponibilita: ${profile.availability}`);
  if (profile.workAuthorization) lines.push(`  Work authorization: ${profile.workAuthorization}`);
  if (profile.dataNascita) lines.push(`  Data di nascita: ${profile.dataNascita}`);
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

function validateTargetRoles(value: string): ProfileFieldValidationResult {
  const roles = value
    .split(",")
    .map((item) => normalizeSpaces(item))
    .filter(Boolean);
  if (roles.length === 0) {
    return { ok: false, error: "inserisci almeno un ruolo target" };
  }
  if (roles.some((role) => role.length < 2 || role.length > 60)) {
    return { ok: false, error: "uno dei ruoli target non e valido" };
  }
  return { ok: true, value: Array.from(new Set(roles)) };
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

function validateLocationPreferences(value: string): ProfileFieldValidationResult {
  const preferences = value
    .split(",")
    .map((item) => normalizeSpaces(item))
    .filter(Boolean);
  if (preferences.length === 0) {
    return { ok: false, error: "inserisci almeno una preferenza di luogo" };
  }
  if (preferences.some((item) => item.length < 2 || item.length > 60)) {
    return { ok: false, error: "una preferenza di luogo non e valida" };
  }
  return { ok: true, value: Array.from(new Set(preferences)) };
}

const SENIORITY_MAP: Record<string, string> = {
  junior: "Junior",
  jr: "Junior",
  mid: "Mid",
  middle: "Mid",
  senior: "Senior",
  sr: "Senior",
  lead: "Lead",
  manager: "Manager",
  head: "Head",
};

function validateSeniorityTarget(value: string): ProfileFieldValidationResult {
  const normalized = normalizeSpaces(value).toLowerCase();
  const canonical = SENIORITY_MAP[normalized];
  if (!canonical) {
    return { ok: false, error: "usa Junior, Mid, Senior, Lead, Manager o Head" };
  }
  return { ok: true, value: canonical };
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

function validateLanguages(value: string): ProfileFieldValidationResult {
  const normalized = value
    .split(",")
    .map((item) => normalizeSpaces(item))
    .filter(Boolean);
  if (normalized.length === 0) return { ok: true, value: [] };
  if (normalized.some((item) => item.length < 2 || item.length > 40)) {
    return { ok: false, error: "una lingua o livello non e valido" };
  }
  return { ok: true, value: Array.from(new Set(normalized)) };
}

function validateStrengths(value: string): ProfileFieldValidationResult {
  const normalized = value
    .split(",")
    .map((item) => normalizeSpaces(item))
    .filter(Boolean);
  if (normalized.length === 0) return { ok: true, value: [] };
  if (normalized.some((item) => item.length < 2 || item.length > 60)) {
    return { ok: false, error: "uno dei punti di forza non e valido" };
  }
  return { ok: true, value: Array.from(new Set(normalized)) };
}

function validateHeadline(value: string): ProfileFieldValidationResult {
  const normalized = normalizeSpaces(value);
  if (!normalized) return { ok: true, value: "" };
  if (normalized.length < 5) return { ok: false, error: "headline troppo corta" };
  if (normalized.length > 90) return { ok: false, error: "headline troppo lunga" };
  return { ok: true, value: normalized };
}

function validateEmail(value: string): ProfileFieldValidationResult {
  const normalized = normalizeSpaces(value);
  if (!normalized) return { ok: true, value: "" };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    return { ok: false, error: "email non valida" };
  }
  return { ok: true, value: normalized };
}

function validateUrlField(value: string, label: string): ProfileFieldValidationResult {
  const normalized = normalizeSpaces(value);
  if (!normalized) return { ok: true, value: "" };
  if (!/^https?:\/\/\S+$/i.test(normalized)) {
    return { ok: false, error: `${label} non valido: usa un URL completo` };
  }
  return { ok: true, value: normalized };
}

function validateFreeText(value: string, label: string, maxLength: number): ProfileFieldValidationResult {
  const normalized = normalizeSpaces(value);
  if (!normalized) return { ok: true, value: "" };
  if (normalized.length > maxLength) return { ok: false, error: `${label} troppo lungo` };
  return { ok: true, value: normalized };
}

export function validateProfileField(
  field: keyof Pick<UserProfile,
    | "nome"
    | "cognome"
    | "dataNascita"
    | "headline"
    | "targetRoles"
    | "seniorityTarget"
    | "competenze"
    | "locationPreferences"
    | "tipoLavoro"
    | "languages"
    | "strengths"
    | "email"
    | "linkedin"
    | "portfolio"
    | "salaryTarget"
    | "availability"
    | "workAuthorization"
    | "zona"
  >,
  value: string,
): ProfileFieldValidationResult {
  switch (field) {
    case "nome":
      return validatePersonName(value, "nome");
    case "cognome":
      return validatePersonName(value, "cognome");
    case "dataNascita":
      return validateBirthDate(value);
    case "headline":
      return validateHeadline(value);
    case "targetRoles":
      return validateTargetRoles(value);
    case "seniorityTarget":
      return validateSeniorityTarget(value);
    case "competenze":
      return validateSkills(value);
    case "zona":
      return validateZona(value);
    case "locationPreferences":
      return validateLocationPreferences(value);
    case "tipoLavoro":
      return validateTipoLavoro(value);
    case "languages":
      return validateLanguages(value);
    case "strengths":
      return validateStrengths(value);
    case "email":
      return validateEmail(value);
    case "linkedin":
      return validateUrlField(value, "LinkedIn");
    case "portfolio":
      return validateUrlField(value, "portfolio");
    case "salaryTarget":
      return validateFreeText(value, "range retributivo", 40);
    case "availability":
      return validateFreeText(value, "disponibilita", 50);
    case "workAuthorization":
      return validateFreeText(value, "work authorization", 80);
  }
}
