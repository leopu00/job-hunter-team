/**
 * profile-completion — tassonomia di completezza del profilo a 3 livelli.
 * Single source of truth per: gate del team, % di completamento, UI di guida.
 *
 *   🔴 required     minimo per CERCARE + VALUTARE → sblocca il team
 *   🟡 recommended  non bloccante, ma migliora molto ricerca + CV su misura
 *   🟢 optional     personalizzazione massima (più ce n'è, meglio è)
 *
 * Decisione 2026-06-06: esperienza/titolo/work-auth sono RACCOMANDATI (il team
 * parte senza; servono per CV mirati / posizioni lavorabili), non bloccanti.
 * Vedi docs/internal/candidate-profile-cloud-sync-redesign-2026-06-05.md.
 */

import type { CandidateProfile } from "./types";

export type FieldLevel = "required" | "recommended" | "optional";

export interface ProfileRequirement {
  key: string; // id stabile
  level: FieldLevel;
  labelKey: string; // chiave i18n per la UI
  anchor: string; // ancora della sezione in /profile (pagina di view)
  editAnchor: string; // ancora della FormSection in /profile/edit (deep-link dai chip "campi mancanti")
  check: (p: CandidateProfile) => boolean;
}

// helper di lettura difensiva (positioning è un blob durante il cutover)
const pos = (p: CandidateProfile) =>
  (p.positioning ?? {}) as Record<string, unknown>;
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const skillCount = (p: CandidateProfile) =>
  p.skills ? Object.values(p.skills).flat().filter(Boolean).length : 0;
const hasEmail = (p: CandidateProfile) =>
  Boolean(
    p.email || (pos(p).contacts as Record<string, unknown> | undefined)?.email,
  );
const hasWorkAuth = (p: CandidateProfile) => {
  const prefs = pos(p).preferences as Record<string, unknown> | undefined;
  const wa = (pos(p).work_authorization ??
    prefs?.work_authorization) as unknown;
  if (Array.isArray(wa)) return wa.length > 0;
  if (wa && typeof wa === "object") return Object.keys(wa).length > 0;
  return arr(pos(p).citizenship as unknown).length > 0;
};

export const PROFILE_REQUIREMENTS: ProfileRequirement[] = [
  // 🔴 required — sblocca il team
  {
    key: "name",
    level: "required",
    labelKey: "f_name",
    anchor: "info-base",
    editAnchor: "info-base",
    check: (p) => !!p.name,
  },
  {
    key: "email",
    level: "required",
    labelKey: "f_email",
    anchor: "contatti",
    editAnchor: "contatti",
    check: hasEmail,
  },
  {
    key: "target_role",
    level: "required",
    labelKey: "f_target_role",
    anchor: "info-base",
    editAnchor: "info-base",
    check: (p) => !!p.target_role,
  },
  {
    key: "location",
    level: "required",
    labelKey: "f_location",
    anchor: "info-base",
    editAnchor: "info-base",
    check: (p) => !!p.location,
  },
  {
    key: "experience_years",
    level: "required",
    labelKey: "mf_exp_years",
    anchor: "info-base",
    editAnchor: "info-base",
    check: (p) => p.experience_years != null,
  },
  {
    key: "seniority_target",
    level: "required",
    labelKey: "mf_seniority",
    anchor: "info-base",
    editAnchor: "info-base",
    check: (p) => !!pos(p).seniority_target,
  },
  {
    key: "skills",
    level: "required",
    labelKey: "sec_skills",
    anchor: "skills",
    editAnchor: "skills",
    check: (p) => skillCount(p) >= 2,
  },
  {
    key: "languages",
    level: "required",
    labelKey: "sec_languages",
    anchor: "lingue",
    editAnchor: "lingue",
    check: (p) => arr(p.languages).length >= 1,
  },

  // 🟡 recommended — non bloccante, grande miglioramento
  {
    key: "job_titles",
    level: "recommended",
    labelKey: "mf_desired_roles",
    anchor: "ruoli-target",
    editAnchor: "ruoli-target",
    check: (p) => arr(p.job_titles).length >= 1,
  },
  {
    key: "experience",
    level: "recommended",
    labelKey: "f_experience",
    anchor: "esperienza-lavorativa",
    editAnchor: "esperienza-lavorativa",
    check: (p) => arr(pos(p).experience).length >= 1,
  },
  {
    key: "education",
    level: "recommended",
    labelKey: "mf_education",
    anchor: "formazione",
    editAnchor: "formazione",
    check: (p) => arr(pos(p).education).length >= 1,
  },
  {
    key: "industry",
    level: "recommended",
    labelKey: "f_industry",
    anchor: "info-base",
    editAnchor: "info-base",
    check: (p) => !!pos(p).industry,
  },
  {
    key: "work_authorization",
    level: "recommended",
    labelKey: "mf_work_auth",
    anchor: "info-base",
    editAnchor: "info-base",
    check: hasWorkAuth,
  },
  {
    key: "location_preferences",
    level: "recommended",
    labelKey: "mf_location_prefs",
    anchor: "preferenze-lavoro",
    editAnchor: "location-preferite",
    check: (p) => arr(p.location_preferences).length >= 1,
  },
  {
    key: "strengths",
    level: "recommended",
    labelKey: "sec_strengths",
    anchor: "punti-di-forza",
    editAnchor: "punti-di-forza",
    check: (p) => arr(pos(p).strengths).length >= 1,
  },

  // 🟢 optional — su misura massima
  {
    key: "certifications",
    level: "optional",
    labelKey: "sec_certifications",
    anchor: "formazione",
    editAnchor: "formazione",
    check: (p) => arr(pos(p).certifications).length >= 1,
  },
  {
    key: "projects",
    level: "optional",
    labelKey: "sec_projects",
    anchor: "progetti",
    editAnchor: "progetti",
    check: (p) => arr(pos(p).projects).length >= 1,
  },
  {
    key: "career_goals",
    level: "optional",
    labelKey: "sec_career_goals",
    anchor: "obiettivi-carriera",
    editAnchor: "obiettivi-carriera",
    check: (p) =>
      !!(
        pos(p).career_goals &&
        Object.values(pos(p).career_goals as Record<string, unknown>).some(
          Boolean,
        )
      ),
  },
  {
    key: "salary_target",
    level: "optional",
    labelKey: "salary_target",
    anchor: "preferenze-lavoro",
    editAnchor: "salary-target",
    check: (p) => p.salary_target != null,
  },
  {
    key: "contacts_extra",
    level: "optional",
    labelKey: "sec_contacts",
    anchor: "contatti",
    editAnchor: "contatti",
    check: (p) => {
      const c = (pos(p).contacts ?? {}) as Record<string, unknown>;
      return Boolean(c.phone || c.linkedin || c.github || c.website);
    },
  },
];

export interface LevelProgress {
  level: FieldLevel;
  total: number;
  filled: number;
  missing: ProfileRequirement[];
}

/** Progresso per ciascun livello (required/recommended/optional). */
export function completionByLevel(
  p: CandidateProfile | null,
): Record<FieldLevel, LevelProgress> {
  const make = (level: FieldLevel): LevelProgress => {
    const reqs = PROFILE_REQUIREMENTS.filter((r) => r.level === level);
    const filled = p ? reqs.filter((r) => safeCheck(r, p)) : [];
    return {
      level,
      total: reqs.length,
      filled: filled.length,
      missing: reqs.filter((r) => !p || !safeCheck(r, p)),
    };
  };
  return {
    required: make("required"),
    recommended: make("recommended"),
    optional: make("optional"),
  };
}

/** Il team è sbloccato quando TUTTI i required sono soddisfatti. */
export function isTeamUnlocked(p: CandidateProfile | null): boolean {
  if (!p) return false;
  return PROFILE_REQUIREMENTS.filter((r) => r.level === "required").every((r) =>
    safeCheck(r, p),
  );
}

/** % complessiva pesata: required pesa 3, recommended 2, optional 1. */
export function weightedCompletion(p: CandidateProfile | null): number {
  if (!p) return 0;
  const W: Record<FieldLevel, number> = {
    required: 3,
    recommended: 2,
    optional: 1,
  };
  let got = 0;
  let max = 0;
  for (const r of PROFILE_REQUIREMENTS) {
    max += W[r.level];
    if (safeCheck(r, p)) got += W[r.level];
  }
  return max === 0 ? 0 : Math.round((got / max) * 100);
}

function safeCheck(r: ProfileRequirement, p: CandidateProfile): boolean {
  try {
    return r.check(p);
  } catch {
    return false;
  }
}
