/**
 * Candidate profile — schema Zod canonico (single source of truth tipizzata).
 *
 * Modello a 3 livelli (vedi docs/internal/candidate-profile-cloud-sync-redesign-2026-06-05.md):
 *   L1 CORE   — campi frozen, normalizzati, query-able (identità, skills, esperienza…)
 *   L2/L3     — `blocks[]`: blocchi tipizzati per `kind`. L2 = slot standard
 *               (about/goals/preferences/strengths…), L3 = blocchi custom per-persona.
 *
 * Il `kind` è il "contratto" di rendering (l'analogo di positions.role_family per il
 * donut /map): l'assistente è libero su titolo/contenuto, deve solo dichiarare uno dei
 * 6 kind che il web sa disegnare. `narrative` è il fallback universale.
 *
 * NB: questo schema è la definizione TIPIZZATA consumata dal web (TS). Il gate runtime
 * operativo (agenti nel container + `jht profile validate`) è `shared/skills/validate_profile.py`,
 * che deve restare allineato a queste regole (cross-check in CI — follow-up Fase 0).
 */

import { z } from "zod";

const MAX_TEXT = 8000;

export const TARGET_ROLE_CATEGORY_IDS = [
  "software",
  "data",
  "product",
  "design",
  "business",
  "security",
  "other",
] as const;
export type TargetRoleCategoryId = (typeof TARGET_ROLE_CATEGORY_IDS)[number];
export const TARGET_ROLE_SPECIALTIES: Readonly<
  Record<TargetRoleCategoryId, readonly string[]>
> = {
  software: [
    "backend",
    "frontend",
    "fullstack",
    "platform",
    "embedded",
    "open",
  ],
  data: ["data_science", "ml", "genai", "data_engineering", "research", "open"],
  product: ["product", "project", "technical_pm", "delivery", "founder"],
  design: ["specialist", "generalist", "leadership", "individual", "explore"],
  business: ["specialist", "generalist", "leadership", "individual", "explore"],
  security: ["specialist", "generalist", "leadership", "individual", "explore"],
  other: ["specialist", "generalist", "leadership", "individual", "explore"],
};

export function targetRoleChoiceError(
  category: string | null | undefined,
  specialty: string | null | undefined,
): string | null {
  if (!category)
    return specialty
      ? "target_specialty requires target_role_category_id"
      : null;
  if (!(TARGET_ROLE_CATEGORY_IDS as readonly string[]).includes(category))
    return "invalid target_role_category_id";
  if (
    specialty &&
    !TARGET_ROLE_SPECIALTIES[category as TargetRoleCategoryId].includes(
      specialty,
    )
  )
    return "target_specialty is not valid for target_role_category_id";
  return null;
}

// ── Block kinds (il vocabolario concordato di renderer) ──────────────
export const BLOCK_KINDS = [
  "key_value", // coppie label → valore (info base, contatti, "consulting fit")
  "tag_list", // chip (competenze, lingue, interessi, città, ruoli target)
  "timeline", // voci datate in ordine cronologico (esperienza, formazione)
  "narrative", // testo markdown, 1ª persona (about, obiettivi, aspirazioni)
  "key_points", // titolo + testo (preferenze, punti di forza — "sezionato bene")
  "distribution", // donut/grafico (città, categorie) — riuso pattern /map
] as const;
export const BlockKindSchema = z.enum(BLOCK_KINDS);
export type BlockKind = (typeof BLOCK_KINDS)[number];

// ── Content per kind (enforcement reale via discriminated union) ─────
const KeyValueItem = z.object({
  label: z.string().min(1),
  value: z.string().max(MAX_TEXT),
});
const TimelineItem = z.object({
  title: z.string().min(1),
  subtitle: z.string().optional(), // azienda / istituzione
  period: z.string().optional(), // raw "Sep 2021 - Feb 2023"
  start: z.string().optional(), // normalizzato per ordinamento (YYYY-MM / YYYY)
  end: z.string().optional(), // "present" ammesso
  detail: z.string().max(MAX_TEXT).optional(),
});
const KeyPointItem = z.object({
  heading: z.string().min(1),
  text: z.string().max(MAX_TEXT),
});
const DistributionItem = z.object({
  label: z.string().min(1),
  value: z.number().nonnegative(),
});

const blockBase = {
  key: z.string().min(1),
  title: z.string().min(1),
  ord: z.number().int().optional(),
  source: z.enum(["assistant", "web", "import"]).optional(),
};

export const ProfileBlockSchema = z.discriminatedUnion("kind", [
  z.object({
    ...blockBase,
    kind: z.literal("key_value"),
    content: z.array(KeyValueItem),
  }),
  z.object({
    ...blockBase,
    kind: z.literal("tag_list"),
    content: z.array(z.string().min(1)),
  }),
  z.object({
    ...blockBase,
    kind: z.literal("timeline"),
    content: z.array(TimelineItem),
  }),
  z.object({
    ...blockBase,
    kind: z.literal("narrative"),
    content: z.string().max(MAX_TEXT),
  }),
  z.object({
    ...blockBase,
    kind: z.literal("key_points"),
    content: z.array(KeyPointItem),
  }),
  z.object({
    ...blockBase,
    kind: z.literal("distribution"),
    content: z.array(DistributionItem),
  }),
]);
export type ProfileBlock = z.infer<typeof ProfileBlockSchema>;

// ── L1 core ──────────────────────────────────────────────────────────
export const LanguageSchema = z.object({
  language: z.string().min(1), // chiave canonica: 'language' (NON 'name')
  level: z.string().min(1),
});
export const ExperienceSchema = z.object({
  company: z.string().min(1),
  role: z.string().min(1),
  period: z.string().optional(),
  start: z.string().optional(),
  end: z.string().optional(),
  location: z.string().optional(),
  summary: z.string().max(MAX_TEXT).optional(),
});
export const EducationSchema = z.object({
  institution: z.string().min(1),
  degree: z.string().optional(),
  year: z.string().optional(),
  period: z.string().optional(),
  location: z.string().optional(),
  details: z.string().max(MAX_TEXT).optional(),
});
export const WorkAuthSchema = z.object({
  region: z.string().min(1), // es. "eu", "ch", "uk", "us"
  status: z.string().min(1),
});
// PII — cifrata a riposo + reveal-on-click lato UI (decisione 2026-06-06).
export const ContactsSchema = z
  .object({
    email: z.string(),
    phone: z.string(),
    linkedin: z.string(),
    github: z.string(),
    website: z.string(),
    address: z.string(),
  })
  .partial();

export const CandidateProfileSchema = z
  .object({
    schema_version: z.literal(1).default(1),

    // identità (L1 frozen — mandatori)
    name: z.string().min(1),
    target_role: z.string().min(1),
    location: z.string().min(1),
    experience_years: z.number().int().nonnegative(),
    has_degree: z.boolean(),
    seniority_target: z.string().min(1),

    // identità (L1 — opzionali)
    email: z.string().optional(),
    timezone: z.string().optional(),
    nationality: z.string().optional(),
    birth_year: z.number().int().optional(),
    experience_months: z.number().int().nonnegative().optional(),
    industry: z.string().optional(),
    target_role_category_id: z.enum(TARGET_ROLE_CATEGORY_IDS).optional(),
    target_specialty: z.string().min(1).optional(),

    // liste strutturate (L1)
    skills: z.object({
      primary: z.array(z.string().min(1)).min(1),
      secondary: z.array(z.string().min(1)).default([]),
    }),
    languages: z.array(LanguageSchema).min(1),
    experience: z.array(ExperienceSchema).default([]),
    education: z.array(EducationSchema).default([]),
    work_authorization: z.array(WorkAuthSchema).default([]),
    location_preferences: z.array(z.string().min(1)).default([]),

    // PII
    contacts: ContactsSchema.optional(),

    // L2/L3
    blocks: z.array(ProfileBlockSchema).default([]),

    // provenienza
    sources: z.array(z.string()).default([]),
  })
  .superRefine((profile, ctx) => {
    const error = targetRoleChoiceError(
      profile.target_role_category_id,
      profile.target_specialty,
    );
    if (error) {
      ctx.addIssue({
        code: "custom",
        path: [
          profile.target_role_category_id
            ? "target_specialty"
            : "target_role_category_id",
        ],
        message: error,
      });
    }
  });
export type CandidateProfileCanonical = z.infer<typeof CandidateProfileSchema>;

/**
 * Slot L2 "raccomandati": chiavi/kind/titolo suggeriti che l'assistente riempie quasi
 * sempre. Non sono obbligatori (a parte il core L1), ma il web li mostra come sezioni
 * standard. Tutto ciò che esce da qui è un blocco L3 custom.
 */
export const RECOMMENDED_BLOCKS: ReadonlyArray<{
  key: string;
  kind: BlockKind;
  title: string;
}> = [
  { key: "about", kind: "narrative", title: "Chi sono" },
  { key: "goals", kind: "narrative", title: "Obiettivi" },
  { key: "preferences", kind: "key_points", title: "Preferenze di lavoro" },
  { key: "strengths", kind: "key_points", title: "Punti di forza" },
];

/** Valida e ritorna esito strutturato (per il web / API). */
export function validateCandidateProfile(data: unknown) {
  const r = CandidateProfileSchema.safeParse(data);
  if (r.success)
    return { ok: true as const, value: r.data, errors: [] as string[] };
  return {
    ok: false as const,
    value: null,
    errors: r.error.issues.map(
      (i) => `${i.path.join(".") || "(root)"}: ${i.message}`,
    ),
  };
}
