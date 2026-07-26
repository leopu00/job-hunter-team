import Link from "next/link";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/workspace";
import { isCloudDeploy } from "@/lib/deploy-mode";
import { readWorkspaceProfile } from "@/lib/profile-reader";
import { isLocalRequest } from "@/lib/auth";
import { activeDemoPersona } from "@/lib/demo/mode";
import { getDemoCandidate } from "@/lib/demo/profile";
import type { CandidateProfile } from "@/lib/types";
import { locales, defaultLocale, type Locale } from "@/i18n/config";
import { getProfileT } from "@/lib/profile-i18n";
import ProfileStats from "@/components/ProfileStats";
import ProfileEditButton from "@/components/ProfileEditButton";
import RevealableContactRow from "@/app/components/RevealableContactRow";
import ProfileBlockRenderer from "@/app/components/ProfileBlockRenderer";
import { decryptContacts } from "@/lib/pii-crypto";

const SKILL_CATEGORY_COLORS = [
  "var(--color-blue)",
  "var(--color-green)",
  "var(--color-purple)",
  "var(--color-yellow)",
  "var(--color-orange)",
  "#58a6ff",
  "#f78166",
  "#d2a8ff",
];

/**
 * Chiave di ordinamento cronologico per l'esperienza: estrae l'anno di fine dal
 * campo `period` grezzo ("Sep 2021 - Feb 2023"). "present/in corso" → in cima.
 */
function experienceSortKey(period?: string): number {
  if (!period) return 0;
  if (
    /present|in corso|current|ongoing|attuale|adesso|oggi|presente|now/i.test(
      period,
    )
  )
    return 999999;
  const years = (period.match(/\b(?:19|20)\d{2}\b/g) ?? []).map(Number);
  return years.length ? Math.max(...years) : 0;
}

export default async function ProfilePage() {
  // Locale corrente dalla fonte unica: il cookie NEXT_LOCALE.
  const cookieStore = await cookies();
  const cookieLocale = cookieStore.get("NEXT_LOCALE")?.value;
  const locale: Locale =
    cookieLocale && (locales as string[]).includes(cookieLocale)
      ? (cookieLocale as Locale)
      : defaultLocale;
  const t = getProfileT(locale);
  const dateLocale = locale === "it" ? "it-IT" : locale;

  let profile: CandidateProfile | null = null;
  let blocks: {
    key: string;
    kind: string;
    title: string;
    content: unknown;
    ord?: number;
  }[] = [];
  let cloudContacts: Record<string, string | null> | null = null;

  // In locale (desktop container su localhost) il profilo vive nel
  // workspace YAML, Supabase non viene interpellato — coerente con il
  // bypass auth in (protected)/layout.tsx e proxy.ts. Sul deploy CLOUD
  // invece la fonte è SEMPRE Supabase, anche se la richiesta arriva da
  // localhost (dev server in modalità cloud): decidere per origine
  // richiesta mandava il dev :3002 sul workspace vuoto → "nessun
  // profilo" con dati presenti sul cloud (21/07).
  // Demo mode: profilo candidato fittizio della persona attiva, così anche
  // /profile è dimostrabile prima del pairing (feedback utente 23/07).
  const demoPersona = await activeDemoPersona();
  if (demoPersona) {
    const d = getDemoCandidate(demoPersona);
    profile = d.profile;
    cloudContacts = d.contacts;
  } else if (
    isSupabaseConfigured &&
    (isCloudDeploy() || !(await isLocalRequest()))
  ) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return (
        <div className="p-12 text-center text-[var(--color-muted)]">
          {t("session_expired")}{" "}
          <Link href="/" className="text-[var(--color-green)]">
            {t("sign_in_again")}
          </Link>
        </div>
      );
    }
    const { data } = (await supabase
      .from("candidate_profiles")
      .select("*")
      .eq("user_id", user.id)
      .single()) as { data: CandidateProfile | null };
    profile = data;
    const { data: blocksData } = await supabase
      .from("candidate_blocks")
      .select("key,kind,title,content,ord")
      .eq("user_id", user.id)
      .order("ord", { ascending: true });
    blocks = blocksData ?? [];
    // Contatti (PII): vivono in candidate_contacts (cifrata), non in positioning.
    const { data: contactsRow } = await supabase
      .from("candidate_contacts")
      .select("email,phone,linkedin,github,website,address")
      .eq("user_id", user.id)
      .maybeSingle();
    cloudContacts = decryptContacts(contactsRow) as Record<
      string,
      string | null
    > | null;
  } else {
    profile = readWorkspaceProfile();
  }

  // Blocchi L2/L3 → "Approfondimenti" in fondo. Escludiamo SOLO le key che hanno
  // già una sezione fissa strutturata che le mostra bene (esperienza, formazione,
  // competenze, lingue, contatti, note libere). I blocchi narrativi/semi-liberi
  // (about, goals, strengths, preferences, positioning_*, interessi…) non hanno
  // una resa fissa equivalente — vanno mostrati qui, altrimenti restano invisibili.
  const COVERED_BLOCK =
    /^(experience|education|skills|languages|contacts|free_notes)/;
  const extraBlocks = blocks.filter((b) => b.key && !COVERED_BLOCK.test(b.key));

  const pos = profile?.positioning ?? {};
  const contacts = (cloudContacts ?? pos.contacts ?? {}) as Record<
    string,
    string
  >;
  const experience = (pos.experience ?? []) as {
    role?: string;
    company?: string;
    period?: string;
    summary?: string; // campo canonico ExperienceSchema (NON "description")
  }[];
  // Ordine cronologico: più recente in cima (period grezzo parsato).
  const sortedExperience = [...experience].sort(
    (a, b) => experienceSortKey(b.period) - experienceSortKey(a.period),
  );
  const education = (pos.education ?? []) as {
    degree?: string; // campo canonico EducationSchema (NON "title")
    institution?: string;
    year?: string | number;
  }[];
  const certifications = (pos.certifications ?? []) as string[];
  const projects = (pos.projects ?? []) as {
    name?: string;
    description?: string;
    url?: string;
  }[];
  const strengths = (pos.strengths ?? []) as string[];
  const careerGoals = (pos.career_goals ?? {}) as {
    direction?: string;
    specializations?: string[];
    target_job?: string;
    desired_courses?: string[];
  };
  const aspirations = (pos.aspirations ?? {}) as {
    short_term?: string;
    long_term?: string;
    ambitious?: string;
  };
  const freeNotes = (pos.free_notes ?? "") as string;

  const allSkills: string[] = profile?.skills
    ? Object.values(profile.skills).flat()
    : [];

  const hasContacts =
    contacts.phone || contacts.linkedin || contacts.github || contacts.website;
  const hasExperience = experience.length > 0;
  const hasEducation = education.length > 0 || certifications.length > 0;
  const hasProjects = projects.length > 0;
  const hasCareerGoals =
    careerGoals.direction ||
    (careerGoals.specializations?.length ?? 0) > 0 ||
    careerGoals.target_job ||
    (careerGoals.desired_courses?.length ?? 0) > 0;
  const hasAspirations =
    aspirations.short_term || aspirations.long_term || aspirations.ambitious;

  return (
    <>
      <div style={{ animation: "fade-in 0.35s ease both" }}>
        {/* Header */}
        <div className="mb-8 pb-6 border-b border-[var(--color-border)]">
          <nav
            aria-label={t("aria_breadcrumb")}
            className="flex items-center gap-2 mb-1"
          >
            <Link
              href="/dashboard"
              className="text-[10px] text-[var(--color-dim)] hover:text-[var(--color-muted)] no-underline transition-colors"
            >
              {t("bc_dashboard")}
            </Link>
            <span className="text-[var(--color-border)]" aria-hidden="true">
              /
            </span>
            <span
              className="text-[10px] text-[var(--color-muted)]"
              aria-current="page"
            >
              {t("bc_profile")}
            </span>
          </nav>
          <div className="flex items-start justify-between gap-4 mt-3 flex-wrap">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-[var(--color-white)]">
                {t("page_title")}
              </h1>
              {profile?.updated_at && (
                <p className="text-[var(--color-muted)] text-[11px] mt-1">
                  {t("updated_on")}{" "}
                  {new Date(profile.updated_at).toLocaleDateString(dateLocale)}
                </p>
              )}
            </div>
            <div className="flex items-center gap-2">
              {/* [JHT-DASHBOARD-SPLIT] Profilo: vista sul cloud, modifica solo
                  desktop (l'edit passa dall'assistente). Export dati resta. */}
              {!isCloudDeploy() && (
                <ProfileEditButton
                  label={t("edit")}
                  message={t("chat_edit_msg")}
                />
              )}
              {profile && (
                <a
                  href="/api/profile/export"
                  download
                  className="flex items-center gap-2 px-3 py-2 rounded-lg border text-[11px] font-semibold no-underline transition-colors hover:bg-[var(--color-row)]"
                  style={{
                    borderColor: "var(--color-border)",
                    color: "var(--color-muted)",
                  }}
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    aria-hidden="true"
                  >
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                  {t("export_json")}
                </a>
              )}
            </div>
          </div>
        </div>

        <ProfileStats profile={profile} />

        {!profile && (
          <div className="flex flex-col items-center justify-center py-12 mb-8 text-center rounded-lg border border-dashed border-[var(--color-border)] bg-[var(--color-card)]">
            <div className="text-3xl mb-3" style={{ opacity: 0.3 }}>
              👤
            </div>
            <p className="text-[13px] text-[var(--color-muted)] font-semibold">
              {t("no_profile_title")}
            </p>
            <p className="text-[11px] text-[var(--color-dim)] mt-1 max-w-md">
              {t("no_profile_desc")}
            </p>
          </div>
        )}

        {profile && (
          <div className="columns-1 md:columns-2 gap-6 mb-8">
            {/* Basic Info */}
            <ProfileSection id="info-base" title={t("sec_info_base")}>
              <ProfileField label={t("f_name")} value={profile.name} />
              <ProfileField
                label={t("f_target_role")}
                value={profile.target_role}
              />
              <ProfileField label={t("f_location")} value={profile.location} />
              <ProfileField
                label={t("f_experience")}
                value={
                  profile.experience_years != null
                    ? `${profile.experience_years} ${t("years")}`
                    : null
                }
              />
              <ProfileField
                label={t("f_degree")}
                value={profile.has_degree ? t("f_yes") : t("f_no")}
              />
              <ProfileField label={t("f_email")} value={profile.email} />
            </ProfileSection>

            {/* Contacts */}
            {(profile.email || hasContacts) && (
              <ProfileSection id="contatti" title={t("sec_contacts")}>
                <div className="flex flex-col gap-2.5">
                  {profile.email && (
                    <ContactRow
                      icon={
                        <>
                          <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                          <polyline points="22,6 12,13 2,6" />
                        </>
                      }
                      label={t("f_email")}
                      value={profile.email}
                      href={`mailto:${profile.email}`}
                    />
                  )}
                  {contacts.phone && (
                    <RevealableContactRow
                      icon={
                        <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />
                      }
                      label={t("c_phone")}
                      value={contacts.phone}
                      hrefPrefix="tel:"
                    />
                  )}
                  {contacts.linkedin && (
                    <ContactRow
                      icon={
                        <>
                          <path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z" />
                          <rect x="2" y="9" width="4" height="12" />
                          <circle cx="4" cy="4" r="2" />
                        </>
                      }
                      label="LinkedIn"
                      value={contacts.linkedin}
                      href={
                        contacts.linkedin.startsWith("http")
                          ? contacts.linkedin
                          : `https://linkedin.com/in/${contacts.linkedin}`
                      }
                    />
                  )}
                  {contacts.github && (
                    <ContactRow
                      icon={
                        <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22" />
                      }
                      label="GitHub"
                      value={contacts.github}
                      href={
                        contacts.github.startsWith("http")
                          ? contacts.github
                          : `https://github.com/${contacts.github}`
                      }
                    />
                  )}
                  {contacts.website && (
                    <ContactRow
                      icon={
                        <>
                          <circle cx="12" cy="12" r="10" />
                          <line x1="2" y1="12" x2="22" y2="12" />
                          <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                        </>
                      }
                      label={t("c_website")}
                      value={contacts.website}
                      href={
                        contacts.website.startsWith("http")
                          ? contacts.website
                          : `https://${contacts.website}`
                      }
                    />
                  )}
                </div>
              </ProfileSection>
            )}

            {/* Languages */}
            <ProfileSection id="lingue" title={t("sec_languages")}>
              {profile.languages && profile.languages.length > 0 ? (
                <div className="flex flex-col gap-2">
                  {profile.languages.map((l, i) => (
                    <div
                      key={`${l.language}-${i}`}
                      className="flex items-center justify-between"
                    >
                      <span className="text-[var(--color-bright)] text-[12px]">
                        {l.language}
                      </span>
                      <span className="text-[10px] text-[var(--color-muted)] bg-[var(--color-panel)] border border-[var(--color-border)] px-2 py-0.5 rounded">
                        {l.level}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <span className="text-[var(--color-dim)] text-[11px]">
                  {t("empty_languages")}
                </span>
              )}
            </ProfileSection>

            {/* Skills */}
            <ProfileSection
              id="skills"
              title={`${t("sec_skills")}${allSkills.length > 0 ? ` (${allSkills.length})` : ""}`}
            >
              {allSkills.length > 0 ? (
                <div className="flex flex-col gap-3">
                  {Object.entries(profile.skills!).map(
                    ([category, items], catIdx) => {
                      const color =
                        SKILL_CATEGORY_COLORS[
                          catIdx % SKILL_CATEGORY_COLORS.length
                        ];
                      return (
                        <div key={category}>
                          <div className="flex items-center gap-2 mb-1.5">
                            <span
                              className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                              style={{ background: color }}
                            />
                            <span className="text-[9px] font-bold tracking-[0.15em] uppercase text-[var(--color-dim)]">
                              {category.replace(/_/g, " ")}
                            </span>
                            <span className="text-[9px] text-[var(--color-dim)]">
                              ({(items as string[]).length})
                            </span>
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {(items as string[]).map((s) => (
                              <span
                                key={s}
                                className="px-2 py-0.5 text-[10px] font-semibold tracking-wider rounded"
                                style={{
                                  background: `${color}18`,
                                  color,
                                  border: `1px solid ${color}30`,
                                }}
                              >
                                {s}
                              </span>
                            ))}
                          </div>
                        </div>
                      );
                    },
                  )}
                </div>
              ) : (
                <span className="text-[var(--color-dim)] text-[11px]">
                  {t("empty_skills")}
                </span>
              )}
            </ProfileSection>

            {/* Esperienza lavorativa */}
            <ProfileSection
              id="esperienza-lavorativa"
              title={`${t("sec_experience")}${hasExperience ? ` (${experience.length})` : ""}`}
            >
              {hasExperience ? (
                <div className="flex flex-col">
                  {sortedExperience.map((e, i) => (
                    <div key={i} className="flex gap-3">
                      {/* Timeline */}
                      <div
                        className="flex flex-col items-center flex-shrink-0"
                        style={{ width: "16px" }}
                      >
                        <div
                          className="w-2.5 h-2.5 rounded-full flex-shrink-0 mt-1"
                          style={{
                            background:
                              i === 0
                                ? "var(--color-green)"
                                : "var(--color-border)",
                            boxShadow:
                              i === 0 ? "0 0 8px rgba(0,232,122,0.4)" : "none",
                          }}
                        />
                        {i < sortedExperience.length - 1 && (
                          <div
                            className="w-px flex-1 min-h-[16px]"
                            style={{ background: "var(--color-border)" }}
                          />
                        )}
                      </div>
                      {/* Content */}
                      <div className="pb-4 flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2 mb-0.5">
                          <span className="text-[12px] font-semibold text-[var(--color-bright)]">
                            {e.role || "—"}
                          </span>
                          {e.period && (
                            <span className="text-[10px] text-[var(--color-dim)] flex-shrink-0 font-mono">
                              {e.period}
                            </span>
                          )}
                        </div>
                        {e.company && (
                          <span className="text-[11px] text-[var(--color-muted)]">
                            {e.company}
                          </span>
                        )}
                        {e.summary && (
                          <p className="text-[10px] text-[var(--color-dim)] mt-1 leading-relaxed">
                            {e.summary}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <span className="text-[var(--color-dim)] text-[11px]">
                  {t("empty_experience")}
                </span>
              )}
            </ProfileSection>

            {/* Formazione */}
            <ProfileSection
              id="formazione"
              title={`${t("sec_education")}${hasEducation ? ` (${education.length + certifications.length})` : ""}`}
            >
              {hasEducation ? (
                <div className="flex flex-col">
                  {education.map((e, i) => (
                    <div key={i} className="flex gap-3">
                      <div
                        className="flex flex-col items-center flex-shrink-0"
                        style={{ width: "16px" }}
                      >
                        <div
                          className="w-2.5 h-2.5 rounded-full flex-shrink-0 mt-1"
                          style={{
                            background:
                              i === 0
                                ? "var(--color-blue)"
                                : "var(--color-border)",
                          }}
                        />
                        {(i < education.length - 1 ||
                          certifications.length > 0) && (
                          <div
                            className="w-px flex-1 min-h-[16px]"
                            style={{ background: "var(--color-border)" }}
                          />
                        )}
                      </div>
                      <div className="pb-3 flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <span className="text-[12px] text-[var(--color-bright)]">
                              {e.degree || "—"}
                            </span>
                            {e.institution && (
                              <div className="text-[10px] text-[var(--color-muted)]">
                                {e.institution}
                              </div>
                            )}
                          </div>
                          {e.year && (
                            <span className="text-[10px] text-[var(--color-dim)] font-mono flex-shrink-0">
                              {e.year}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                  {certifications.length > 0 && (
                    <div className="mt-1">
                      <div className="text-[9px] font-bold tracking-[0.15em] uppercase text-[var(--color-dim)] mb-2">
                        {t("cert_label")}
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {certifications.map((c, i) => (
                          <span
                            key={i}
                            className="px-2 py-0.5 text-[10px] font-semibold rounded bg-[var(--color-yellow)]/10 text-[var(--color-yellow)] border border-[var(--color-yellow)]/20"
                          >
                            {c}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <span className="text-[var(--color-dim)] text-[11px]">
                  {t("empty_education")}
                </span>
              )}
            </ProfileSection>

            {/* Progetti personali */}
            {hasProjects && (
              <ProfileSection
                title={`${t("sec_projects")} (${projects.length})`}
              >
                <div className="flex flex-col gap-2">
                  {projects.map((p, i) => (
                    <div
                      key={i}
                      className="px-3 py-2.5 rounded bg-[var(--color-panel)] border border-[var(--color-border)] transition-colors hover:border-[var(--color-border-glow)]"
                    >
                      <div className="flex items-start justify-between gap-2 mb-0.5">
                        <div className="flex items-center gap-2 min-w-0">
                          <svg
                            aria-hidden="true"
                            width="12"
                            height="12"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.5"
                            className="flex-shrink-0"
                            style={{ color: "var(--color-purple)" }}
                          >
                            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                          </svg>
                          <span
                            className="text-[12px] font-semibold text-[var(--color-bright)] truncate"
                            title={p.name || undefined}
                          >
                            {p.name || "—"}
                          </span>
                        </div>
                        {p.url && (
                          <a
                            href={p.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1 text-[9px] font-semibold text-[var(--color-blue)] hover:underline no-underline flex-shrink-0"
                          >
                            <svg
                              aria-hidden="true"
                              width="10"
                              height="10"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                            >
                              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                              <polyline points="15 3 21 3 21 9" />
                              <line x1="10" y1="14" x2="21" y2="3" />
                            </svg>
                            {t("link")}
                          </a>
                        )}
                      </div>
                      {p.description && (
                        <p className="text-[10px] text-[var(--color-dim)] leading-relaxed mt-1 ml-5">
                          {p.description}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </ProfileSection>
            )}

            {/* Target Roles */}
            {profile.job_titles && profile.job_titles.length > 0 && (
              <ProfileSection
                id="ruoli-target"
                title={`${t("sec_target_roles")} (${profile.job_titles.length})`}
              >
                <div className="flex flex-col gap-2">
                  {profile.job_titles.map((r, i) => (
                    <div
                      key={r}
                      className="flex items-center gap-3 px-3 py-2 rounded bg-[var(--color-panel)] border border-[var(--color-border)]"
                    >
                      <span
                        className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold flex-shrink-0"
                        style={{
                          background:
                            i === 0
                              ? "var(--color-green)"
                              : "var(--color-border)",
                          color: i === 0 ? "#000" : "var(--color-dim)",
                        }}
                      >
                        {i + 1}
                      </span>
                      <span className="text-[12px] text-[var(--color-bright)] font-semibold">
                        {r}
                      </span>
                      {i === 0 && (
                        <span className="text-[8px] font-bold tracking-[0.15em] uppercase text-[var(--color-green)] ml-auto">
                          TOP
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </ProfileSection>
            )}

            {/* Preferenze lavoro */}
            {profile.location_preferences &&
              profile.location_preferences.length > 0 && (
                <ProfileSection
                  id="location-preferite"
                  title={t("sec_job_prefs")}
                >
                  <div className="flex flex-wrap gap-2 mb-3">
                    {profile.location_preferences.map((lp, i) => (
                      <div
                        key={i}
                        className="flex items-center gap-2 px-3 py-2 rounded bg-[var(--color-panel)] border border-[var(--color-border)]"
                      >
                        <svg
                          aria-hidden="true"
                          width="12"
                          height="12"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          style={{ color: "var(--color-green)" }}
                        >
                          <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                          <circle cx="12" cy="10" r="3" />
                        </svg>
                        <div>
                          <span className="text-[10px] font-semibold text-[var(--color-green)]">
                            {(lp.type ?? "").replace(/_/g, " ")}
                          </span>
                          <span className="text-[10px] text-[var(--color-muted)] ml-1">
                            {lp.region && lp.region}
                            {lp.cities && lp.cities.join(", ")}
                            {lp.max_days != null &&
                              ` (max ${lp.max_days} ${t("days_per_week")})`}
                            {lp.note && lp.note}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                  {profile.salary_target &&
                    (profile.salary_target.italy_min != null ||
                      profile.salary_target.remote_eu_min != null) && (
                      <div
                        id="salary-target"
                        className="mt-3 pt-3 border-t border-[var(--color-border)] scroll-mt-20"
                      >
                        <div className="text-[9px] font-bold tracking-[0.15em] uppercase text-[var(--color-dim)] mb-3">
                          {t("salary_target")}
                        </div>
                        <div className="flex flex-col gap-3">
                          {profile.salary_target.italy_min != null && (
                            <SalaryRange
                              label={t("salary_italy")}
                              ariaLabel={t("aria_salary_range")}
                              min={profile.salary_target.italy_min}
                              max={
                                profile.salary_target.italy_max ??
                                profile.salary_target.italy_min
                              }
                              color="var(--color-green)"
                              dateLocale={dateLocale}
                            />
                          )}
                          {profile.salary_target.remote_eu_min != null && (
                            <SalaryRange
                              label={t("salary_remote_eu")}
                              ariaLabel={t("aria_salary_range")}
                              min={profile.salary_target.remote_eu_min}
                              max={
                                profile.salary_target.remote_eu_max ??
                                profile.salary_target.remote_eu_min
                              }
                              color="var(--color-blue)"
                              dateLocale={dateLocale}
                            />
                          )}
                        </div>
                      </div>
                    )}
                </ProfileSection>
              )}

            {/* Obiettivi di carriera */}
            {hasCareerGoals && (
              <ProfileSection
                id="obiettivi-carriera"
                title={t("sec_career_goals")}
              >
                <div className="flex flex-col gap-2">
                  <ProfileField
                    label={t("cg_direction")}
                    value={careerGoals.direction || null}
                  />
                  <ProfileField
                    label={t("cg_target_job")}
                    value={careerGoals.target_job || null}
                  />
                  {(careerGoals.specializations?.length ?? 0) > 0 && (
                    <div className="py-1.5 border-b border-[var(--color-border)]">
                      <div className="text-[10px] font-semibold tracking-[0.1em] uppercase text-[var(--color-dim)] mb-1.5">
                        {t("cg_specializations")}
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {careerGoals.specializations!.map((s, i) => (
                          <span
                            key={i}
                            className="px-2 py-0.5 text-[10px] rounded bg-[var(--color-purple)]/10 text-[var(--color-purple)] border border-[var(--color-purple)]/20 font-semibold"
                          >
                            {s}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  {(careerGoals.desired_courses?.length ?? 0) > 0 && (
                    <div className="py-1.5">
                      <div className="text-[10px] font-semibold tracking-[0.1em] uppercase text-[var(--color-dim)] mb-1.5">
                        {t("cg_desired_courses")}
                      </div>
                      <div className="flex flex-col gap-1">
                        {careerGoals.desired_courses!.map((c, i) => (
                          <span
                            key={i}
                            className="text-[11px] text-[var(--color-muted)]"
                          >
                            · {c}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </ProfileSection>
            )}

            {/* Desideri e aspirazioni */}
            {hasAspirations && (
              <ProfileSection title={t("sec_aspirations")}>
                <div className="flex flex-col gap-2">
                  {aspirations.short_term && (
                    <div className="flex gap-3 px-3 py-2.5 rounded bg-[var(--color-panel)] border border-[var(--color-border)]">
                      <svg
                        aria-hidden="true"
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        className="flex-shrink-0 mt-0.5"
                        style={{ color: "var(--color-yellow)" }}
                      >
                        <circle cx="12" cy="12" r="10" />
                        <polyline points="12 6 12 12 16 14" />
                      </svg>
                      <div>
                        <div className="text-[9px] font-bold tracking-[0.15em] uppercase text-[var(--color-yellow)] mb-0.5">
                          {t("asp_short")}
                        </div>
                        <p className="text-[11px] text-[var(--color-bright)] leading-relaxed">
                          {aspirations.short_term}
                        </p>
                      </div>
                    </div>
                  )}
                  {aspirations.long_term && (
                    <div className="flex gap-3 px-3 py-2.5 rounded bg-[var(--color-panel)] border border-[var(--color-border)]">
                      <svg
                        aria-hidden="true"
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        className="flex-shrink-0 mt-0.5"
                        style={{ color: "var(--color-blue)" }}
                      >
                        <circle cx="12" cy="12" r="10" />
                        <line x1="2" y1="12" x2="22" y2="12" />
                        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                      </svg>
                      <div>
                        <div className="text-[9px] font-bold tracking-[0.15em] uppercase text-[var(--color-blue)] mb-0.5">
                          {t("asp_long")}
                        </div>
                        <p className="text-[11px] text-[var(--color-bright)] leading-relaxed">
                          {aspirations.long_term}
                        </p>
                      </div>
                    </div>
                  )}
                  {aspirations.ambitious && (
                    <div className="flex gap-3 px-3 py-2.5 rounded bg-[var(--color-panel)] border border-[var(--color-green)]/20">
                      <svg
                        aria-hidden="true"
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        className="flex-shrink-0 mt-0.5"
                        style={{ color: "var(--color-green)" }}
                      >
                        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                      </svg>
                      <div>
                        <div className="text-[9px] font-bold tracking-[0.15em] uppercase text-[var(--color-green)] mb-0.5">
                          {t("asp_ambitious")}
                        </div>
                        <p className="text-[11px] text-[var(--color-bright)] leading-relaxed italic">
                          {aspirations.ambitious}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </ProfileSection>
            )}

            {/* Strengths — nascosto quando vuoto; i chip "campi mancanti"
                aprono la chat dell'Assistente, non un form. */}
            {strengths.length > 0 && (
              <ProfileSection
                id="punti-di-forza"
                title={`${t("sec_strengths")} (${strengths.length})`}
              >
                <div className="flex flex-wrap gap-2">
                  {strengths.map((s, i) => (
                    <span
                      key={i}
                      className="flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-semibold rounded-lg bg-[var(--color-green)]/8 text-[var(--color-green)] border border-[var(--color-green)]/20"
                    >
                      <svg
                        aria-hidden="true"
                        width="10"
                        height="10"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                      >
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                      {s}
                    </span>
                  ))}
                </div>
              </ProfileSection>
            )}

            {/* Note libere */}
            {freeNotes && (
              <ProfileSection title={t("sec_free_notes")}>
                <p className="text-[12px] text-[var(--color-bright)] leading-relaxed whitespace-pre-wrap">
                  {freeNotes}
                </p>
              </ProfileSection>
            )}

            {/* Approfondimenti — blocchi L2/L3 non coperti dalle sezioni fisse.
                Data-driven: ogni kind ha il suo renderer, un blocco custom nuovo
                appare senza toccare codice. */}
            {extraBlocks.map((b) => (
              <ProfileSection key={b.key} id={b.key} title={b.title}>
                <ProfileBlockRenderer kind={b.kind} content={b.content} />
              </ProfileSection>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function ProfileSection({
  id,
  title,
  children,
}: {
  id?: string;
  title: string;
  children: React.ReactNode;
}) {
  // scroll-mt-20: deep-link da chip "campi mancanti" arrivano qui senza
  // finire sotto la navbar sticky.
  return (
    <div
      id={id}
      className="bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg p-5 hover:border-[var(--color-border-glow)] transition-colors scroll-mt-20 break-inside-avoid mb-6"
    >
      <div className="section-label mb-4">{title}</div>
      {children}
    </div>
  );
}

function SalaryRange({
  label,
  ariaLabel,
  min,
  max,
  color,
  dateLocale,
}: {
  label: string;
  ariaLabel: string;
  min: number;
  max: number;
  color: string;
  dateLocale: string;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] font-semibold text-[var(--color-muted)]">
          {label}
        </span>
        <span className="text-[11px] font-bold tabular-nums" style={{ color }}>
          €{min.toLocaleString(dateLocale)} – €{max.toLocaleString(dateLocale)}
        </span>
      </div>
      <div
        role="progressbar"
        aria-valuenow={Math.round(Math.min(100, (max / 120000) * 100))}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={ariaLabel}
        className="h-1.5 rounded-full overflow-hidden"
        style={{ background: "var(--color-panel)" }}
      >
        <div
          className="h-full rounded-full"
          style={{
            width: `${Math.min(100, (max / 120000) * 100)}%`,
            background: color,
            opacity: 0.6,
          }}
        />
      </div>
    </div>
  );
}

function ContactRow({
  icon,
  label,
  value,
  href,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  href: string;
}) {
  return (
    <a
      href={href}
      target={
        href.startsWith("mailto:") || href.startsWith("tel:")
          ? undefined
          : "_blank"
      }
      rel="noopener noreferrer"
      className="flex items-center gap-3 px-3 py-2 rounded bg-[var(--color-panel)] border border-[var(--color-border)] no-underline transition-colors hover:border-[var(--color-border-glow)]"
    >
      <svg
        aria-hidden="true"
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        className="flex-shrink-0"
        style={{ color: "var(--color-muted)" }}
      >
        {icon}
      </svg>
      <div className="flex-1 min-w-0">
        <span className="text-[9px] font-bold tracking-[0.15em] uppercase text-[var(--color-dim)] block">
          {label}
        </span>
        <span className="text-[11px] text-[var(--color-bright)] truncate block">
          {value}
        </span>
      </div>
      <svg
        aria-hidden="true"
        width="10"
        height="10"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        className="flex-shrink-0"
        style={{ color: "var(--color-dim)" }}
      >
        <polyline points="9 18 15 12 9 6" />
      </svg>
    </a>
  );
}

function ProfileField({
  label,
  value,
}: {
  label: string;
  value?: string | null;
}) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5 border-b border-[var(--color-border)] last:border-0 transition-colors hover:bg-[rgba(255,255,255,0.015)]">
      <span className="text-[10px] font-semibold tracking-[0.1em] uppercase text-[var(--color-dim)] flex-shrink-0 pt-0.5">
        {label}
      </span>
      <span className="text-[12px] text-[var(--color-bright)] text-right">
        {value ?? <span className="text-[var(--color-dim)]">—</span>}
      </span>
    </div>
  );
}
