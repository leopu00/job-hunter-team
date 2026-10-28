// js-yaml 5 espone solo named export: il default non esiste piu'.
import * as yaml from "js-yaml";
import fs from "fs";
import type { CandidateProfile } from "./types";
import { JHT_PROFILE_YAML } from "./jht-paths";
import { isTeamUnlocked } from "./profile-completion";

/**
 * `CORE_SCHEMA` esclude tutti i tag YAML estesi (es. `!!js/function`,
 * `!!js/regexp`) lasciando solo str/int/float/bool/null/seq/map. Senza
 * questa restrizione un attaccante che riesce a scrivere su
 * `~/.jht/profile/candidate_profile.yml` potrebbe materializzare
 * oggetti arbitrari al parse-time.
 */
const SAFE_YAML = { schema: yaml.CORE_SCHEMA } as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function loadProfileYaml(): Record<string, unknown> | null {
  if (!fs.existsSync(JHT_PROFILE_YAML)) return null;
  const raw = yaml.load(fs.readFileSync(JHT_PROFILE_YAML, "utf8"), SAFE_YAML);
  return isPlainObject(raw) ? raw : null;
}

export function readProfile(_workspacePath?: string): CandidateProfile | null {
  try {
    const raw = loadProfileYaml();
    return raw ? mapYamlToProfile(raw) : null;
  } catch {
    return null;
  }
}

/**
 * Legge il profilo dal path fisso ~/.jht/profile/candidate_profile.yml.
 * Restituisce null se mancante, vuoto, o con placeholder del template.
 */
export function readWorkspaceProfile(
  _workspacePath?: string,
): CandidateProfile | null {
  try {
    const raw = loadProfileYaml();
    if (!raw) return null;
    const profile = mapYamlToProfile(raw);
    if (!profile.name && !profile.target_role) return null;
    if (
      profile.name === "Nome Cognome" ||
      profile.email === "nome.cognome@example.com"
    )
      return null;
    return profile;
  } catch (err) {
    console.error(
      `[profile-reader] failed to parse ${JHT_PROFILE_YAML}:`,
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

/**
 * Gate di completezza ("profilo pronto → team sbloccato"): delega a
 * `isTeamUnlocked` (tassonomia a 3 livelli, single source in profile-completion.ts)
 * → richiede tutti i campi REQUIRED. Esperienza/educazione/work-auth sono
 * RACCOMANDATI, non più bloccanti (decisione 2026-06-06).
 */
export function isProfileComplete(profile: CandidateProfile | null): boolean {
  // Gate del team = tutti i campi REQUIRED soddisfatti (tassonomia a 3 livelli,
  // single source in profile-completion.ts). Decisione 2026-06-06:
  // esperienza/educazione/work-auth NON sono più bloccanti — sono RACCOMANDATI
  // (il team parte; migliorano ricerca mirata e CV su misura).
  return isTeamUnlocked(profile);
}

// Un testo vuoto o di soli spazi non è un valore: come per il validatore
// (validate_profile.py, _is_str), così il campo non conta come compilato e la
// catena `a ?? b` passa al posto successivo.
function filled<T>(value: T): T | null {
  if (typeof value !== "string") return value ?? null;
  return value.trim() === "" ? null : value;
}

export function mapYamlToProfile(raw: any): CandidateProfile {
  const candidate = raw.candidate ?? {};
  const personal = raw.personal ?? {};

  // Skills: cerca in candidate.skills, raw.skills (dict o lista)
  let skills: Record<string, string[]> | null = null;
  const rawSkills = candidate.skills ?? raw.skills;
  if (rawSkills && typeof rawSkills === "object" && !Array.isArray(rawSkills)) {
    skills = rawSkills;
  } else if (Array.isArray(rawSkills)) {
    skills = { primary: rawSkills };
  }

  // Languages: normalizza lingua/livello -> language/level
  const rawLangs = candidate.languages ?? raw.languages ?? [];
  const languages = Array.isArray(rawLangs)
    ? rawLangs.map((l: any) => ({
        language: l.language ?? l.lingua ?? "",
        level: l.level ?? l.livello ?? "",
      }))
    : null;

  // Preferenze di lavoro (nuovo campo standard `preferences`) con retrocompat
  // verso vecchi campi usati dall'agente prima che lo schema venisse fissato:
  // `work_location`, `flexible`, `location_preferences`, `relocation`.
  const rawPrefs = raw.preferences ?? {};
  const rawLoc = raw.location_preferences ?? [];
  const legacyWorkMode = raw.work_location ?? rawPrefs.work_mode ?? null;
  const work_mode: string | null =
    legacyWorkMode ??
    (Array.isArray(rawLoc) && rawLoc.length > 0
      ? typeof rawLoc[0] === "string"
        ? rawLoc[0]
        : (rawLoc[0]?.type ?? null)
      : null);
  const work_mode_flexibility: string | null =
    rawPrefs.work_mode_flexibility ??
    (raw.flexible === true ? "flessibile su altre modalità" : null);
  const relocation: string | boolean | null =
    rawPrefs.relocation ?? raw.relocation ?? null;
  const salary_annual_eur: string | null = rawPrefs.salary_annual_eur ?? null;

  const location_preferences = Array.isArray(rawLoc)
    ? rawLoc.map((l: any) => {
        if (typeof l === "string") return { type: l };
        return l;
      })
    : null;

  // Salary target
  const rawSalary = raw.salary_target ?? {};
  const salary_target =
    rawSalary.min != null
      ? {
          currency: rawSalary.currency ?? "EUR",
          italy_min: rawSalary.min ?? 0,
          italy_max: rawSalary.max ?? 0,
          remote_eu_min: rawSalary.remote_eu_min ?? rawSalary.min ?? 0,
          remote_eu_max: rawSalary.remote_eu_max ?? rawSalary.max ?? 0,
        }
      : null;

  // Contacts: cerca in candidate.contacts, poi nei `contacts` alla radice (schema
  // canonico, shared/config/profile-schema.ts), poi in personal
  const rootContacts =
    raw.contacts && typeof raw.contacts === "object" ? raw.contacts : null;
  // `positioning.contacts`: il posto che la checklist dell'app legge (hasEmail) e che il
  // validatore ammette per l'email
  const positioningContacts =
    raw.positioning?.contacts && typeof raw.positioning.contacts === "object"
      ? raw.positioning.contacts
      : null;
  const contacts = candidate.contacts ??
    rootContacts ?? {
      email: personal.email,
      phone: personal.phone,
      linkedin: personal.linkedin,
      github: personal.github,
      website: personal.website,
    };

  return {
    id: "local",
    user_id: "local",
    name:
      filled(candidate.name) ??
      filled(personal.name) ??
      filled(raw.name) ??
      null,
    email:
      filled(contacts.email) ??
      filled(personal.email) ??
      filled(raw.email) ??
      filled(positioningContacts?.email) ??
      null,
    target_role:
      filled(candidate.target_role) ??
      filled(raw.target_role) ??
      // solo una lista ha un primo ruolo: una stringa non è la lista dei suoi caratteri
      filled(Array.isArray(raw.target_roles) ? raw.target_roles[0] : null) ??
      null,
    location: filled(raw.location) ?? filled(personal.location) ?? null,
    experience_years: raw.experience_years ?? null,
    experience_months: null,
    has_degree: typeof raw.has_degree === "boolean" ? raw.has_degree : null,
    skills,
    languages,
    location_preferences,
    job_titles: raw.target_roles_priority ?? raw.target_roles ?? null,
    salary_target,
    positioning: {
      seniority_target:
        filled(raw.seniority_target) ??
        filled(raw.positioning?.seniority_target),
      strengths: candidate.strengths ?? raw.domain_expertise,
      experience: candidate.experience ?? raw.experience,
      education: candidate.education ?? raw.education,
      certifications: candidate.certifications,
      projects: candidate.projects,
      contacts,
      career_goals: candidate.career_goals,
      aspirations: candidate.aspirations,
      free_notes:
        candidate.free_notes ??
        (typeof raw.notes === "string"
          ? raw.notes
          : raw.notes
            ? Object.entries(raw.notes)
                .map(([k, v]) => `${k}: ${v}`)
                .join("\n")
            : undefined),
      preferences:
        work_mode ||
        work_mode_flexibility ||
        relocation != null ||
        salary_annual_eur
          ? {
              work_mode,
              work_mode_flexibility,
              relocation,
              salary_annual_eur,
            }
          : undefined,
      // Dict aperto per dettagli specifici del settore (cucina, sanità,
      // legale, edile, …). L'assistente popola le chiavi che ha senso per
      // la persona; il frontend le rende come lista key/value generica.
      sector_details:
        raw.sector_details && typeof raw.sector_details === "object"
          ? (raw.sector_details as Record<
              string,
              string | number | boolean | string[] | null
            >)
          : undefined,
    },
    created_at: "",
    updated_at: "",
  };
}
