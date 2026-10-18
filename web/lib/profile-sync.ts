/**
 * profile-sync — mappa il candidate_profile.yml (legacy) al modello canonico a
 * 3 livelli e lo sincronizza su Supabase (Fase 2 del redesign profilo).
 *
 *   L1 core      → candidate_profiles (scalari) + tabelle normalizzate
 *   L2/L3 blocchi→ candidate_blocks (kind: narrative/tag_list/key_value/…)
 *   PII          → candidate_contacts
 *
 * Le colonne JSONB legacy di candidate_profiles (skills/languages/positioning…)
 * vengono ancora popolate per retro-compat con la pagina /profile attuale
 * durante il cutover (Fase 4). `positioning` qui è RICCO (include
 * certifications/projects/strengths/career_goals/aspirations) → chiude anche il
 * bug "sezioni vuote" senza aspettare il refactor UI.
 *
 * Strategia di sync: uno snapshot canonico passa a una RPC PostgreSQL che
 * serializza per tenant, deduplica per hash e sostituisce core + figli nella
 * stessa transazione. Un errore non può quindi lasciare un profilo monco.
 *
 * Vedi docs/internal/candidate-profile-cloud-sync-redesign-2026-06-05.md
 */

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { encryptContacts } from "./pii-crypto";
import {
  isObj,
  mapYamlToCanonical,
  type CanonicalProfile,
  type Dict,
} from "./profile-yaml-map";

// Il mapper vive in profile-yaml-map.ts (puro, senza moduli di Node): i
// chiamanti di questo file lo trovano dove sono sempre andati a cercarlo.
export { mapYamlToCanonical, type CanonicalProfile };

/**
 * Tabelle normalizzate del profilo, accoppiate al campo del modello
 * canonico che le riempie.
 *
 * Le conoscono entrambe le direzioni della sincronizzazione — il push
 * qui sotto e il pull in `api/cloud-sync/pull-profile` — e le
 * elencavano tutte e due per esteso. Aggiungerne una da un lato solo
 * significa un profilo che si carica intero e si riscarica incompleto,
 * senza errori. Aggiungendola qui, entrambe le direzioni la vedono.
 */
export const CANDIDATE_LIST_TABLES = [
  ["skills", "candidate_skills"],
  ["languages", "candidate_languages"],
  ["experiences", "candidate_experiences"],
  ["education", "candidate_education"],
  ["workAuth", "candidate_work_authorization"],
  ["locationPrefs", "candidate_location_preferences"],
  ["blocks", "candidate_blocks"],
] as const satisfies ReadonlyArray<readonly [keyof CanonicalProfile, string]>;

/** Campo del modello canonico che corrisponde a una tabella normalizzata. */
export type CandidateListField = (typeof CANDIDATE_LIST_TABLES)[number][0];

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object")
    return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.keys(value as Dict)
    .filter((key) => (value as Dict)[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson((value as Dict)[key])}`)
    .join(",")}}`;
}

/** Hash del contenuto canonico in chiaro, mai del ciphertext PII randomico. */
export function canonicalProfileContentHash(c: CanonicalProfile): string {
  return createHash("sha256").update(stableJson(c)).digest("hex");
}

// ── sync to Supabase ─────────────────────────────────────────────────
/** Applica lo snapshot intero con dedup e rollback dentro PostgreSQL. */
export async function syncProfileToSupabase(
  admin: SupabaseClient,
  userId: string,
  c: CanonicalProfile,
  force = false,
): Promise<{
  ok: boolean;
  changed: boolean;
  error: string | null;
  warnings: string[];
}> {
  const contentHash = canonicalProfileContentHash(c);
  const encryptedContacts = encryptContacts(
    c.contacts as Record<string, string | null | undefined> | null,
  );
  try {
    const { data, error } = await admin.rpc("sync_candidate_profile_atomic", {
      p_user_id: userId,
      p_content_hash: contentHash,
      p_force: force,
      p_snapshot: {
        profile: c.profileRow,
        skills: c.skills,
        languages: c.languages,
        experiences: c.experiences,
        education: c.education,
        work_auth: c.workAuth,
        location_preferences: c.locationPrefs,
        contacts: encryptedContacts
          ? { user_id: userId, ...encryptedContacts }
          : null,
        blocks: c.blocks,
      },
    });
    if (error)
      return {
        ok: false,
        changed: false,
        error: "profile_sync_failed",
        warnings: [],
      };
    if (
      !data ||
      typeof data !== "object" ||
      typeof (data as { changed?: unknown }).changed !== "boolean"
    ) {
      return {
        ok: false,
        changed: false,
        error: "profile_sync_result_invalid",
        warnings: [],
      };
    }
    return {
      ok: true,
      changed: (data as { changed: boolean }).changed,
      error: null,
      warnings: [],
    };
  } catch {
    return {
      ok: false,
      changed: false,
      error: "profile_sync_failed",
      warnings: [],
    };
  }
}

// ── reconstruct (pull-profile: tabelle Supabase → YAML canonico) ─────
export interface ProfileTables {
  profile: Dict | null;
  skills: Array<{ name: string; category: string }>;
  languages: Array<{ language: string; level: string }>;
  experiences: Array<Dict>;
  education: Array<Dict>;
  workAuth: Array<{ region: string; status: string }>;
  locationPrefs: Array<{ value: string }>;
  contacts: Dict | null;
  blocks: Array<{
    key: string;
    kind: string;
    title: string;
    content: unknown;
    ord?: number;
  }>;
}

/** Rimuove chiavi null/undefined/'' e array/oggetti vuoti (YAML pulito). */
function clean<T extends Dict>(obj: T): Dict {
  const out: Dict = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v == null || v === "") continue;
    if (Array.isArray(v) && v.length === 0) continue;
    if (isObj(v) && Object.keys(v).length === 0) continue;
    out[k] = v;
  }
  return out;
}

/**
 * Inverso di mapYamlToCanonical: ricostruisce l'oggetto profilo canonico dalle
 * righe delle tabelle Supabase. L'endpoint pull-profile lo serializza in YAML.
 */
export function reconstructCanonicalProfile(d: ProfileTables): Dict {
  const p = d.profile ?? {};
  const positioning = isObj(p.positioning) ? p.positioning : {};
  const skillsByCat: Record<string, string[]> = {};
  for (const s of d.skills) (skillsByCat[s.category] ??= []).push(s.name);

  return clean({
    schema_version: 1,
    name: p.name,
    target_role: p.target_role,
    target_role_category_id: positioning.target_role_category_id,
    target_specialty: positioning.target_specialty,
    location: p.location,
    timezone: p.timezone,
    nationality: p.nationality,
    birth_year: p.birth_year,
    industry: p.industry,
    email: p.email,
    experience_years: p.experience_years,
    experience_months: p.experience_months,
    has_degree: p.has_degree ?? false,
    seniority_target: p.seniority_target,
    skills: clean({
      primary: skillsByCat.primary ?? [],
      secondary: skillsByCat.secondary ?? [],
    }),
    languages: d.languages.map((l) => ({
      language: l.language,
      level: l.level,
    })),
    experience: d.experiences.map((e) =>
      clean({
        company: e.company,
        role: e.role,
        period: e.period,
        start: e.start_date,
        end: e.end_date,
        location: e.location,
        summary: e.summary,
      }),
    ),
    education: d.education
      .filter((e) => e.kind !== "certification")
      .map((e) =>
        clean({
          institution: e.institution,
          degree: e.degree,
          year: e.year,
          period: e.period,
          location: e.location,
          details: e.details,
        }),
      ),
    certifications: d.education
      .filter((e) => e.kind === "certification")
      .map((e) =>
        clean({ name: e.degree, issuer: e.institution, year: e.year }),
      ),
    work_authorization: d.workAuth.map((w) => ({
      region: w.region,
      status: w.status,
    })),
    location_preferences: d.locationPrefs.map((l) => l.value),
    contacts: d.contacts
      ? clean({
          email: d.contacts.email,
          phone: d.contacts.phone,
          linkedin: d.contacts.linkedin,
          github: d.contacts.github,
          website: d.contacts.website,
          address: d.contacts.address,
        })
      : undefined,
    blocks: d.blocks.map((b) =>
      clean({
        key: b.key,
        kind: b.kind,
        title: b.title,
        content: b.content,
        ord: b.ord,
      }),
    ),
  });
}
