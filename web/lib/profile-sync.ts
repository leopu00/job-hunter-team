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
import { targetRoleChoiceError } from "../../shared/config/profile-schema";

type Dict = Record<string, unknown>;
const BLOCK_KINDS = [
  "key_value",
  "tag_list",
  "timeline",
  "narrative",
  "key_points",
  "distribution",
] as const;
type BlockKind = (typeof BLOCK_KINDS)[number];

// ── helpers ──────────────────────────────────────────────────────────
const isObj = (v: unknown): v is Dict =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v.trim() : null;
const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v)
    ? v
    : typeof v === "string" && /^-?\d+$/.test(v.trim())
      ? Number(v)
      : null;
const cap = (s: string, n = 8000) => (s.length > n ? s.slice(0, n) : s);

// ── canonical shape ──────────────────────────────────────────────────
export interface CanonicalProfile {
  profileRow: Dict; // candidate_profiles upsert (core + JSONB legacy)
  skills: Array<{
    user_id: string;
    name: string;
    category: string;
    ord: number;
  }>;
  languages: Array<{
    user_id: string;
    language: string;
    level: string;
    ord: number;
  }>;
  experiences: Array<Dict>;
  education: Array<Dict>;
  workAuth: Array<{
    user_id: string;
    region: string;
    status: string;
    ord: number;
  }>;
  locationPrefs: Array<{ user_id: string; value: string; ord: number }>;
  contacts: Dict | null;
  blocks: Array<Dict>;
}

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

// ── block generation ─────────────────────────────────────────────────
/** Normalizza un valore arbitrario nel kind più adatto. null = niente blocco. */
function valueToBlock(
  value: unknown,
): { kind: BlockKind; content: unknown } | null {
  // stringa lunga → narrative
  if (typeof value === "string") {
    const s = value.trim();
    return s ? { kind: "narrative", content: cap(s) } : null;
  }
  if (Array.isArray(value)) {
    const items = value.filter((x) => x != null);
    if (!items.length) return null;
    // array di oggetti {heading,text} → key_points
    if (
      items.every(
        (x) => isObj(x) && (str((x as Dict).heading) || str((x as Dict).title)),
      )
    ) {
      return {
        kind: "key_points",
        content: items.map((x) => {
          const o = x as Dict;
          return {
            heading: str(o.heading) ?? str(o.title) ?? "—",
            text: cap(str(o.text) ?? str(o.summary) ?? str(o.detail) ?? ""),
          };
        }),
      };
    }
    // array di stringhe: brevi → tag_list, lunghe → narrative bullettato
    const strings = items
      .filter((x): x is string => typeof x === "string")
      .map((s) => s.trim())
      .filter(Boolean);
    if (strings.length === items.length && strings.length) {
      const avg = strings.reduce((a, s) => a + s.length, 0) / strings.length;
      return avg <= 40
        ? { kind: "tag_list", content: strings }
        : {
            kind: "narrative",
            content: cap(strings.map((s) => `• ${s}`).join("\n")),
          };
    }
    return null;
  }
  // dict {k: scalar|array} → key_value (array appiattito)
  if (isObj(value)) {
    const content = Object.entries(value)
      .map(([k, v]) => {
        const label = k.replace(/_/g, " ");
        if (typeof v === "string" && v.trim())
          return { label, value: cap(v.trim()) };
        if (Array.isArray(v)) {
          const flat = v.filter((x) => typeof x === "string").join(", ");
          return flat ? { label, value: cap(flat) } : null;
        }
        if (typeof v === "number" || typeof v === "boolean")
          return { label, value: String(v) };
        return null;
      })
      .filter(Boolean);
    return content.length ? { kind: "key_value", content } : null;
  }
  return null;
}

function titleFor(key: string): string {
  return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// ── main mapper ──────────────────────────────────────────────────────
export function mapYamlToCanonical(
  raw: Dict,
  userId: string,
  summaries: Record<string, string> = {},
): CanonicalProfile {
  const candidate = isObj(raw.candidate) ? raw.candidate : {};
  const personal = isObj(raw.personal) ? raw.personal : {};
  const targetRoleCategoryId = str(raw.target_role_category_id);
  const targetSpecialty = str(raw.target_specialty);
  const targetRoleError = targetRoleChoiceError(
    targetRoleCategoryId,
    targetSpecialty,
  );
  if (targetRoleError) throw new Error(targetRoleError);

  // skills (dict {primary,secondary} o lista piatta)
  const rawSkills = candidate.skills ?? raw.skills;
  const skillsByCat: Record<string, string[]> = isObj(rawSkills)
    ? Object.fromEntries(
        Object.entries(rawSkills).map(([k, v]) => [
          k,
          arr(v).filter((x): x is string => typeof x === "string"),
        ]),
      )
    : Array.isArray(rawSkills)
      ? { primary: rawSkills.filter((x): x is string => typeof x === "string") }
      : {};
  const skills = Object.entries(skillsByCat).flatMap(([category, names]) =>
    names.map((name, i) => ({
      user_id: userId,
      name,
      category: category === "secondary" ? "secondary" : "primary",
      ord: i,
    })),
  );

  // languages ('language' o 'name', it: 'lingua'/'livello')
  const languages = arr(candidate.languages ?? raw.languages)
    .map((l, i) => {
      const o = isObj(l) ? l : {};
      const language = str(o.language) ?? str(o.name) ?? str(o.lingua);
      const level = str(o.level) ?? str(o.livello) ?? "";
      return language ? { user_id: userId, language, level, ord: i } : null;
    })
    .filter(Boolean) as CanonicalProfile["languages"];

  // experience
  const experiences = arr(candidate.experience ?? raw.experience).map(
    (e, i) => {
      const o = isObj(e) ? e : {};
      return {
        user_id: userId,
        company: str(o.company) ?? "—",
        role: str(o.role) ?? str(o.title) ?? "—",
        period: str(o.years) ?? str(o.period) ?? null,
        start_date: str(o.start) ?? null,
        end_date: str(o.end) ?? null,
        location: str(o.location) ?? null,
        summary: o.summary != null ? cap(String(o.summary)) : null,
        ord: i,
      };
    },
  );

  // education + certifications (kind discrimina)
  const education = [
    ...arr(candidate.education ?? raw.education).map((e, i) => {
      const o = isObj(e) ? e : {};
      return {
        user_id: userId,
        kind: "education" as const,
        institution: str(o.institution) ?? str(o.title) ?? "—",
        degree: str(o.degree) ?? null,
        year: str(o.year) ?? null,
        period: str(o.period) ?? null,
        location: str(o.location) ?? null,
        details: o.details != null ? cap(String(o.details)) : null,
        ord: i,
      };
    }),
    ...arr(candidate.certifications ?? raw.certifications).map((c, i) => {
      const o = isObj(c) ? c : {};
      return {
        user_id: userId,
        kind: "certification" as const,
        institution: str(o.issuer) ?? str(o.name) ?? "—",
        degree: str(o.name) ?? null,
        year: str(o.year) ?? null,
        period: null,
        location: null,
        details: null,
        ord: 100 + i,
      };
    }),
  ];

  // work authorization: lista [{region,status}] o dict {eu,ch,…}
  const rawWa =
    candidate.work_authorization ??
    raw.work_authorization ??
    (isObj(raw.preferences)
      ? (raw.preferences as Dict).work_authorization
      : undefined);
  let workAuth: CanonicalProfile["workAuth"] = [];
  if (Array.isArray(rawWa)) {
    workAuth = rawWa
      .map((w, i) => {
        const o = isObj(w) ? w : {};
        const region = str(o.region) ?? str(o.country);
        const status = str(o.status) ?? str(o.value) ?? "";
        return region ? { user_id: userId, region, status, ord: i } : null;
      })
      .filter(Boolean) as CanonicalProfile["workAuth"];
  } else if (isObj(rawWa)) {
    workAuth = Object.entries(rawWa)
      .map(([region, v], i) => ({
        user_id: userId,
        region,
        status: cap(String(v ?? "")),
        ord: i,
      }))
      .filter((w) => w.status);
  }

  // location preferences: preferences.geography | location_preferences (string|{type})
  const rawLoc = (
    isObj(raw.preferences) ? arr((raw.preferences as Dict).geography) : []
  ).concat(arr(raw.location_preferences));
  const seenLoc = new Set<string>();
  const locationPrefs = rawLoc
    .map((l) =>
      typeof l === "string"
        ? l
        : isObj(l)
          ? (str(l.type) ?? str(l.city))
          : null,
    )
    .filter(
      (v): v is string => !!v && !seenLoc.has(v) && (seenLoc.add(v), true),
    )
    .map((value, ord) => ({ user_id: userId, value, ord }));

  // contacts
  const rawContacts = isObj(candidate.contacts) ? candidate.contacts : personal;
  const contacts = {
    email:
      str((rawContacts as Dict).email) ?? str(personal.email) ?? str(raw.email),
    phone: str((rawContacts as Dict).phone),
    linkedin: str((rawContacts as Dict).linkedin),
    github: str((rawContacts as Dict).github),
    website: str((rawContacts as Dict).website),
    address: str((rawContacts as Dict).address),
  };
  const hasContact = Object.values(contacts).some(Boolean);

  // ── blocks (L2/L3): summary .md narrativi + campi narrativi del raw ──
  const blocks: Array<Dict> = [];
  const seenKeys = new Set<string>();
  const addBlock = (
    key: string,
    value: unknown,
    title?: string,
    source = "import",
  ) => {
    if (seenKeys.has(key)) return;
    const b = valueToBlock(value);
    if (!b) return;
    seenKeys.add(key);
    blocks.push({
      user_id: userId,
      key,
      kind: b.kind,
      title: title ?? titleFor(key),
      content: b.content,
      ord: blocks.length,
      source,
    });
  };
  // 1) summary .md dell'Assistente (about/goals/preferences/strengths) → narrative.
  //    Priorità sui blocchi derivati dal raw (stessa key → vince il summary).
  const SUMMARY_TITLES: Record<string, string> = {
    about: "Chi sono",
    goals: "Obiettivi",
    preferences: "Preferenze di lavoro",
    strengths: "Punti di forza",
  };
  for (const [k, v] of Object.entries(summaries)) {
    addBlock(k, v, SUMMARY_TITLES[k] ?? titleFor(k), "assistant");
  }
  // 2) campi narrativi del raw (saltati se già coperti da un summary)
  addBlock("goals", raw.goals ?? candidate.career_goals, "Obiettivi");
  addBlock(
    "aspirations",
    candidate.aspirations ?? raw.aspirations,
    "Aspirazioni",
  );
  addBlock(
    "strengths",
    candidate.strengths ?? raw.strengths ?? raw.domain_expertise,
    "Punti di forza",
  );
  if (isObj(raw.positioning)) {
    for (const [k, v] of Object.entries(raw.positioning))
      addBlock(`positioning_${k}`, v, titleFor(k));
  }
  if (isObj(raw.preferences)) {
    for (const k of ["role_focus", "avoid", "language_requirements"])
      addBlock(`pref_${k}`, (raw.preferences as Dict)[k], titleFor(k));
  }
  addBlock("interests", raw.interests, "Interessi");
  addBlock("sector_details", raw.sector_details, "Dettagli settore");
  addBlock("free_notes", candidate.free_notes ?? raw.notes, "Note");

  // ── candidate_profiles row (core + JSONB legacy ricco) ─────────────
  const profileRow: Dict = {
    user_id: userId,
    name:
      str(candidate.name) ?? str(personal.name) ?? str(raw.name) ?? "Candidato",
    email: contacts.email,
    location: str(raw.location) ?? str(personal.location),
    target_role:
      str(candidate.target_role) ??
      str(raw.target_role) ??
      str(arr(raw.target_roles)[0] as string),
    experience_years: num(raw.experience_years) ?? 0,
    experience_months: num(raw.experience_months),
    has_degree: typeof raw.has_degree === "boolean" ? raw.has_degree : false,
    seniority_target: str(raw.seniority_target),
    nationality:
      str(raw.nationality) ?? str(arr(candidate.citizenship)[0] as string),
    birth_year: num(raw.birth_year),
    timezone: str(raw.timezone),
    industry: str(raw.industry),
    schema_version: 1,
    // JSONB legacy (retro-compat pagina /profile attuale + fix sezioni vuote)
    skills: isObj(rawSkills) ? rawSkills : skillsByCat,
    languages: languages.map((l) => ({ language: l.language, level: l.level })),
    location_preferences: locationPrefs.map((l) => ({ type: l.value })),
    job_titles: arr(raw.target_roles_priority ?? raw.target_roles).filter(
      (x): x is string => typeof x === "string",
    ),
    work_authorization: Array.isArray(rawWa) ? rawWa : [],
    positioning: {
      ...(targetRoleCategoryId
        ? { target_role_category_id: targetRoleCategoryId }
        : {}),
      ...(targetSpecialty ? { target_specialty: targetSpecialty } : {}),
      seniority_target: str(raw.seniority_target),
      industry: str(raw.industry),
      experience: candidate.experience ?? raw.experience,
      education: candidate.education ?? raw.education,
      certifications: candidate.certifications ?? raw.certifications,
      projects: candidate.projects ?? raw.projects,
      strengths: candidate.strengths ?? raw.strengths,
      career_goals: candidate.career_goals ?? raw.goals,
      aspirations: candidate.aspirations,
      // PII: i contatti NON vanno in chiaro in positioning → vivono solo in
      // candidate_contacts (cifrata). La pagina cloud li legge da lì.
    },
  };

  return {
    profileRow,
    skills,
    languages,
    experiences,
    education,
    workAuth,
    locationPrefs,
    contacts: hasContact ? contacts : null,
    blocks,
  };
}

// ── sync to Supabase ─────────────────────────────────────────────────
/** Applica lo snapshot intero con dedup e rollback dentro PostgreSQL. */
export async function syncProfileToSupabase(
  admin: SupabaseClient,
  userId: string,
  c: CanonicalProfile,
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
