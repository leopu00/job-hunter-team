/**
 * Profili sintetici per le riprese.
 *
 * Il contenuto nasce dagli stessi quattro seed usati dalla demo pubblica, ma
 * viene trasformato in righe normali (UUID, legacy_id, score, candidature e
 * dossier azienda). Il browser quindi percorre il ramo dati reale e non riceve
 * mai il cookie che attiva DemoBanner.
 *
 * Questo modulo resta puro: disco, credenziali e Supabase vivono nello script
 * operativo web/scripts/recording-profile.ts. In questo modo il contratto del
 * dataset e' testabile senza account né segreti.
 */
import type { Locale } from "@/i18n/config";
import {
  DEMO_PERSONA_KEYS,
  getDemoPositionsData,
  type DemoPersonaKey,
} from "@/lib/demo/data";
import { getDemoCandidate } from "@/lib/demo/profile";
import { demoCompanyFor } from "@/lib/demo/seeds/companies";

export const RECORDING_PROFILE_ALIASES = [...DEMO_PERSONA_KEYS] as const;
export type RecordingProfileAlias = (typeof RECORDING_PROFILE_ALIASES)[number];

// Data fissa: un reset fatto domani ricostruisce lo stesso identico scenario.
// I seed esprimono gli eventi come "N ore fa" rispetto a questa ancora.
export const RECORDING_ANCHOR = "2026-08-04T12:00:00.000Z";

type Row = Record<string, unknown>;

export type RecordingProfileDataset = {
  alias: RecordingProfileAlias;
  anchor: string;
  candidateProfile: Row;
  companies: Row[];
  positions: Row[];
  scores: Row[];
  applications: Row[];
  highlights: Row[];
  chatTurns: Row[];
};

const RECORDING_CHAT: ReadonlyArray<{
  agent: "assistente" | "mentor" | "capitano";
  user: string;
  agentReply: string;
}> = [
  {
    agent: "assistente",
    user: "Help me organize the next steps for this week.",
    agentReply:
      "I grouped the strongest matches by priority and kept the plan balanced: research first, then tailoring and follow-up.",
  },
  {
    agent: "mentor",
    user: "What pattern should I watch for before I apply?",
    agentReply:
      "Compare the role scope, room to learn, and the evidence you can bring. A good match should make all three clear.",
  },
  {
    agent: "capitano",
    user: "What should the team focus on today?",
    agentReply:
      "We will validate the best opportunities, tailor the strongest application, and keep a few solid alternatives moving.",
  },
];

function hash32(value: string, seed: number): number {
  let h = (2166136261 ^ seed) >>> 0;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

/** UUID stabile e valido, sufficiente per chiavi sintetiche (non sicurezza). */
export function recordingUuid(namespace: string, value: string): string {
  const words = [0, 1, 2, 3].map((n) =>
    hash32(`${namespace}:${value}`, 0x9e3779b9 * (n + 1)),
  );
  const hex = words.map((n) => n.toString(16).padStart(8, "0")).join("");
  // Versione 5 + variant RFC 4122, così Postgres lo accetta come UUID.
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-` +
    `${((parseInt(hex.slice(16, 18), 16) & 0x3f) | 0x80)
      .toString(16)
      .padStart(2, "0")}${hex.slice(18, 20)}-${hex.slice(20, 32)}`;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

/**
 * Chiama l'espansore demo con Date.now fissato. L'espansore e' sincrono e il
 * processo dello script e' monouso; il finally evita comunque di contaminare
 * chi importa questa funzione nei test.
 */
function anchoredPositions(alias: DemoPersonaKey, locale: Locale, anchor: string) {
  const realNow = Date.now;
  Date.now = () => Date.parse(anchor);
  try {
    return clone(getDemoPositionsData(alias, locale));
  } finally {
    Date.now = realNow;
  }
}

function applicationStatus(status: string): string {
  if (status === "applied") return "applied";
  if (status === "response") return "response";
  return "ready";
}

export function buildRecordingProfileDataset(
  alias: RecordingProfileAlias,
  options: { locale?: Locale; anchor?: string } = {},
): RecordingProfileDataset {
  if (!RECORDING_PROFILE_ALIASES.includes(alias)) {
    throw new Error(`alias riprese sconosciuto: ${alias}`);
  }
  const locale = options.locale ?? "en";
  const anchor = options.anchor ?? RECORDING_ANCHOR;
  if (!Number.isFinite(Date.parse(anchor))) {
    throw new Error(`ancora temporale non valida: ${anchor}`);
  }

  const source = anchoredPositions(alias, locale, anchor);
  const companyMap = new Map<string, Row>();
  const positions: Row[] = [];
  const scores: Row[] = [];
  const applications: Row[] = [];
  const highlights: Row[] = [];

  for (const p of source) {
    const positionId = recordingUuid(alias, `position:${p.legacy_id}`);
    const companyId = recordingUuid(alias, `company:${p.company}`);
    if (!companyMap.has(p.company)) {
      const dossier = demoCompanyFor({
        persona: alias,
        name: p.company,
        location: p.location,
        score: p.score,
        analyzedBy: "analista-1",
        analyzedAt: p.last_checked,
      });
      companyMap.set(p.company, {
        ...dossier,
        id: companyId,
        // Nessun link riservato/documentale compare nella UI di ripresa.
        website: null,
      });
    }

    positions.push({
      id: positionId,
      legacy_id: p.legacy_id,
      title: p.title,
      company: p.company,
      company_id: companyId,
      location: p.location,
      remote_type: p.remote_type,
      salary_declared_min: p.salary_declared_min,
      salary_declared_max: p.salary_declared_max,
      salary_declared_currency: p.salary_declared_currency,
      salary_estimated_min: p.salary_estimated_min,
      salary_estimated_max: p.salary_estimated_max,
      salary_estimated_currency: p.salary_estimated_currency,
      salary_estimated_source: p.salary_estimated_source,
      // I seed demo usano un URL esplicitamente documentale. Nelle riprese
      // lo omettiamo: non si finge un sito terzo e non appare alcun segnale.
      url: null,
      source: p.source,
      jd_text: p.jd_text,
      jd_summary: p.jd_summary,
      requirements: p.requirements,
      found_by: p.found_by,
      found_at: p.found_at,
      deadline: p.deadline,
      status: p.status,
      score: p.score,
      notes: p.notes,
      last_checked: p.last_checked,
      last_actor: p.last_action_actor,
      role_family: p.role_family,
      loc_country: p.loc_country,
      loc_city: p.loc_city,
      loc_country_code: p.loc_country_code,
      write_requested: p.write_requested,
      office_lat: p.office_lat,
      office_lon: p.office_lon,
      office_address: p.office_address,
      office_geocoded: p.office_lat != null && p.office_lon != null,
      office_verified: p.office_lat != null && p.office_lon != null,
      is_remote: p.remote_type === "full_remote",
      is_open: p.is_open,
      deleted_at: null,
    });

    if (p.demo_score_row) {
      scores.push({
        ...p.demo_score_row,
        id: recordingUuid(alias, `score:${p.legacy_id}`),
        position_id: positionId,
        deleted_at: null,
      });
    }
    for (let i = 0; i < p.demo_highlights.length; i++) {
      const h = p.demo_highlights[i];
      highlights.push({
        id: recordingUuid(alias, `highlight:${p.legacy_id}:${i}`),
        position_id: positionId,
        type: h.type,
        text: h.text,
        deleted_at: null,
      });
    }
    if (p.critic_score != null) {
      const applied = p.status === "applied" || p.status === "response";
      applications.push({
        id: recordingUuid(alias, `application:${p.legacy_id}`),
        position_id: positionId,
        cv_path: null,
        cl_path: null,
        cv_pdf_path: null,
        cl_pdf_path: null,
        cv_drive_id: null,
        cl_drive_id: null,
        critic_verdict: p.critic_verdict,
        critic_score: p.critic_score,
        critic_notes: p.demo_critic_notes,
        status: applicationStatus(p.status),
        written_at: p.last_action_at,
        applied_at: applied ? p.last_action_at : null,
        applied_via: applied ? "Company website" : null,
        response: null,
        response_at: p.status === "response" ? p.last_action_at : null,
        written_by: "scrittore-1",
        reviewed_by: "critico",
        critic_reviewed_at: p.last_action_at,
        applied,
        interview_round: null,
        deleted_at: null,
      });
    }
  }

  const candidate = clone(getDemoCandidate(alias).profile) as unknown as Row;
  const anchorMs = Date.parse(anchor);
  const candidateProfile: Row = {
    ...candidate,
    id: recordingUuid(alias, "candidate-profile"),
    user_id: null,
    // L'account di autenticazione resta un artefatto locale; la pagina
    // profilo non deve esporlo né simulare un contatto.
    email: null,
    created_at: new Date(anchorMs - 21 * 86400_000).toISOString(),
    updated_at: new Date(anchorMs - 2 * 86400_000).toISOString(),
  };

  // Tre thread brevi e trasversali, nello stesso modello condiviso da gioco
  // e web. Gli id positivi sono quelli che il mirror SQLite porta sul cloud;
  // chat_ts e testi fissi rendono anche il contenuto delle scene ripetibile.
  const chatTurns: Row[] = RECORDING_CHAT.flatMap((thread, threadIndex) => {
    const position = positions[threadIndex];
    return [thread.user, thread.agentReply].map((body, turnIndex) => {
      const legacyId = threadIndex * 2 + turnIndex + 1;
      const createdAt = new Date(
        anchorMs - (RECORDING_CHAT.length * 2 - legacyId + 1) * 3600_000,
      ).toISOString();
      return {
        id: recordingUuid(alias, `chat:${legacyId}`),
        legacy_id: legacyId,
        agent: thread.agent,
        body,
        kind: "notification",
        author: turnIndex === 0 ? "user" : "agent",
        chat_ts: Date.parse(createdAt) / 1000,
        related_position_id: turnIndex === 1 ? position.id : null,
        delivered_via: "web",
        delivered_at: createdAt,
        acknowledged_at: createdAt,
        created_at: createdAt,
      };
    });
  });

  return {
    alias,
    anchor,
    candidateProfile,
    companies: [...companyMap.values()],
    positions,
    scores,
    applications,
    highlights,
    chatTurns,
  };
}
