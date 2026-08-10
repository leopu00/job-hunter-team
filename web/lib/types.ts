// ── Position ──────────────────────────────────────────────────────
export type PositionStatus =
  | "new"
  | "checked"
  | "excluded"
  | "scored"
  | "writing"
  | "review"
  | "ready"
  | "applied"
  | "response";

export interface Position {
  id: string;
  legacy_id: number | null;
  title: string;
  company: string;
  company_id: string | null;
  location: string | null;
  remote_type: "full_remote" | "hybrid" | "onsite" | null;
  salary_declared_min: number | null;
  salary_declared_max: number | null;
  salary_declared_currency: string | null;
  salary_estimated_min: number | null;
  salary_estimated_max: number | null;
  salary_estimated_currency: string | null;
  salary_estimated_source: string | null;
  url: string | null;
  source: string | null;
  jd_text: string | null;
  jd_summary: string | null;
  requirements: string | null;
  found_by: string | null;
  found_at: string;
  deadline: string | null;
  status: PositionStatus;
  notes: string | null;
  last_checked: string | null;
  // V9 (2026-06-13) — Scadenze machine-readable (Analista expansion).
  // deadline resta il testo grezzo del JD; expires_at è la data parsata
  // (deadline_extract.py). is_open = posizione ancora aperta (false se link
  // morto o expires_at passata, settato dall'Analista al richeck giornaliero
  // RULE-12). last_open_check = ultimo richeck apertura (distinto da
  // last_checked = ultima analisi). La soglia "in scadenza" si calcola nel
  // web da expires_at (es. ≤7gg), nessun campo extra.
  expires_at?: string | null;
  is_open?: boolean;
  last_open_check?: string | null;
  // Faceting fields (popolati dall'analista). Colonne DB reali, opzionali
  // perché caricate solo dalle query che le selezionano esplicitamente
  // (es. /positions per i filtri intelligenti donut/location).
  role_family?: string | null;
  loc_country?: string | null;
  loc_city?: string | null;
  // ISO-3166 alpha-2 (location-enrichment): alimenta la bandierina della
  // card Località; null sulle righe pre-enrichment (fallback sul nome).
  loc_country_code?: string | null;
  // V6 (2026-05-29) — Writer-on-demand: utente seleziona da dashboard
  // o /cv Telegram. Il Capitano spawna Scrittori solo quando = true.
  write_requested?: boolean;
  write_requested_at?: string | null;
  // V8 (2026-05-31) — Geocoding-on-demand: utente seleziona da dashboard
  // per coordinate ufficio precise. L'Analista esegue office-geocoding
  // solo quando = true. office_geocoded indica lo stato di completamento.
  geocode_requested?: boolean;
  geocode_requested_at?: string | null;
  office_geocoded?: boolean;
  // Mig 041 (2026-06-17) — esclusione MANUALE utente. user_excluded_reason
  // valorizzato = esclusa dall'utente (per distinguere dall'esclusione-agente
  // che vive nelle notes EXCLUDED:[TAG]). prev_status per l'annullamento.
  user_excluded_reason?: string | null;
  user_excluded_note?: string | null;
  user_excluded_at?: string | null;
  user_excluded_prev_status?: string | null;
  // Mig 042 (2026-06-18) — recheck/liveness ON-DEMAND (non più autonomo):
  // l'utente lo richiede dalla pagina posizione, l'Analista serve la coda.
  recheck_requested?: boolean;
  recheck_requested_at?: string | null;
  // V9 (2026-06-13) — coordinate ufficio esposte al web (esistono in DB dalla
  // migration 017, prima non nel type). office_lat/lon alimentano JobsGlobe a
  // livello ufficio invece che città; office_address per la vignetta del pin.
  office_lat?: number | null;
  office_lon?: number | null;
  office_address?: string | null;
  office_verified?: boolean;
}

// ── Score ──────────────────────────────────────────────────────────
export interface Score {
  id: string;
  position_id: string;
  total_score: number;
  stack_match: number | null;
  remote_fit: number | null;
  salary_fit: number | null;
  experience_fit: number | null;
  strategic_fit: number | null;
  breakdown: string | null;
  notes: string | null;
  scored_by: string | null;
  scored_at: string;
}

// ── PositionHighlight ──────────────────────────────────────────────
export interface PositionHighlight {
  id: string;
  position_id: string;
  type: "pro" | "con";
  text: string;
}

// ── Company ────────────────────────────────────────────────────────
// Ticket utente→team su una posizione (mig 043). L'utente scrive una richiesta
// testuale; il Capitano l'assegna; l'agente risolve con response_text.
export interface PositionTicket {
  id: string;
  position_id: string;
  request_text: string;
  kind: string;
  status: "open" | "assigned" | "resolved";
  assigned_agent: string | null;
  response_text: string | null;
  created_at: string | null;
  resolved_at: string | null;
}

export interface Company {
  id: string;
  name: string;
  website: string | null;
  hq: string | null;
  sector: string | null;
  size: string | null;
  glassdoor_rating: number | null;
  red_flags: string | null;
  culture_notes: string | null;
  analyzed_by: string | null;
  analyzed_at: string | null;
  verdict: "GO" | "CAUTIOUS" | "NO_GO" | null;
  // Logo aziendale (mig 056): data-URI base64 ≤~35KB estratto dall'Analista
  // (skill logo-extraction). Null = non ancora estratto / non trovato.
  logo: string | null;
}

// ── Application ────────────────────────────────────────────────────
export type ApplicationStatus =
  "draft" | "review" | "approved" | "applied" | "response" | "ready";

export interface Application {
  id: string;
  position_id: string;
  cv_path: string | null;
  cl_path: string | null;
  cv_pdf_path: string | null;
  cl_pdf_path: string | null;
  cv_drive_id: string | null;
  cl_drive_id: string | null;
  critic_verdict: "PASS" | "NEEDS_WORK" | "REJECT" | null;
  critic_score: number | null;
  critic_notes: string | null;
  status: ApplicationStatus;
  written_at: string | null;
  applied_at: string | null;
  applied_via: string | null;
  response: string | null;
  response_at: string | null;
  written_by: string | null;
  reviewed_by: string | null;
  applied: boolean;
  interview_round: number | null;
}

// ── CandidateProfile ───────────────────────────────────────────────
export interface Language {
  language: string;
  level: string;
}

export interface LocationPreference {
  type: string;
  region?: string;
  cities?: string[];
  max_days?: number;
  note?: string;
}

export interface CandidateProfile {
  id: string;
  user_id: string;
  name: string | null;
  email: string | null;
  target_role: string | null;
  location: string | null;
  experience_years: number | null;
  experience_months: number | null;
  has_degree: boolean;
  skills: Record<string, string[]> | null;
  languages: Language[] | null;
  location_preferences: LocationPreference[] | null;
  job_titles: string[] | null;
  salary_target: {
    currency: string;
    italy_min: number;
    italy_max: number;
    remote_eu_min: number;
    remote_eu_max: number;
  } | null;
  positioning: Record<string, any> | null;
  created_at: string;
  updated_at: string;
}

// ── Dashboard Stats ────────────────────────────────────────────────
export interface DashboardStats {
  total: number;
  checked: number;
  scored: number;
  writing: number;
  ready: number;
  applied: number;
  excluded: number;
  response: number;
  review: number;
  new: number;
  // Pipeline write-requested-aware (2026-06-07):
  // scored_open = status 'scored' NON ancora selezionate (write_requested != true)
  // to_write    = selezionate dall'utente (write_requested) ma CV non ancora
  //               pronto (status in scored/writing/review)
  scored_open: number;
  to_write: number;
}

// ── Composite types ────────────────────────────────────────────────
export interface PositionWithScore extends Position {
  score?: number;
  scores?: Score;
  critic_score?: number | null;
  critic_verdict?: string | null;
  // Stipendio coalescato (stima team o, in fallback, dichiarato) — stessa
  // fonte per min/max/currency. Popolato da getPositions/getDashboardPositions.
  salary_min?: number | null;
  salary_max?: number | null;
  salary_currency?: string;
  // Ultima azione tracciata sulla position (es. ACK Capitano, write CV).
  // Aggiunto nei merge dev1/dev2/dev3 del 2026-05-21 per il widget
  // "Recent positions shows last-action timestamp" (commit a89d75d5).
  // Opzionale: presente solo nelle query che fanno join con
  // applications/state-history (vedi getRecentPositions).
  last_action_at?: string;
  // Chi ha eseguito l'ultima azione (ruolo + istanza concreta).
  last_action_by?: string;
  last_action_actor?: string;
  // Quando la candidatura è stata inviata (applications.applied_at). Non è
  // ricavabile da `status: 'applied'`, che dice SE ma non QUANDO — ed è la
  // metà che serve in lista quando le posizioni sono cinquanta (O-25).
  applied_at?: string | null;
  // O-31: esiste un ticket dell'utente ancora senza risposta (open o
  // assigned). Deriva dai ticket, non è uno stato salvato: quando il ticket
  // si chiude la posizione torna a mostrare il proprio stato da sé.
  has_open_ticket?: boolean;
  // true = già aperta dall'utente (position_views, mig 055). undefined in
  // local mode: lì decide il client via localStorage (vedi UnseenDot).
  seen?: boolean;
}

// Coda notifiche agente -> utente (schema V5, decisione 2026-05-13).
// L'agente scrive qui via `jht-notify-user`; il record viene sincronizzato
// su Supabase e mostrato sulla dashboard quando `delivered_via = 'web'`
// (Telegram non configurato/down). L'utente puo' ack-are o rispondere.
export type PendingMessageKind =
  "notification" | "question" | "digest" | "alert";
export type PendingMessageDelivery = "telegram" | "web" | null;

// [JHT-CHAT-UNIFY] Chi ha scritto il turno. 'agent' e' il default storico
// (la tabella nasce come coda di notifiche agente->utente); 'user' e' un
// turno scritto dall'utente — dal web o dal videogioco — che prima non
// aveva modo di esistere come riga a se'.
export type PendingMessageAuthor = "agent" | "user";

export interface PendingMessage {
  // Stringa anche per SQLite, dove l'id e' integer: il widget non se ne accorge.
  id: string;
  agent: string;
  body: string;
  kind: PendingMessageKind;
  author: PendingMessageAuthor;
  related_position_id: string | null;
  delivered_via: PendingMessageDelivery;
  delivered_at: string | null;
  acknowledged_at: string | null;
  user_reply: string | null;
  user_reply_at: string | null;
  agent_seen_reply_at: string | null;
  created_at: string;
}

// ── Albero delle località ──────────────────────────────────────────
// Paese → città → posizioni, come lo costruiscono `getPositionLocations`
// (Supabase) e `getPositionLocationsLocal` (SQLite) e come lo consuma
// MapCharts. I tre tipi erano dichiarati identici in tutti e tre i file:
// le due corsie dati DEVONO produrre la stessa forma, quindi la forma
// sta qui e non in una delle due.

export type LocationPositionLite = {
  id: string;
  title: string | null;
  company: string | null;
  score: number | null;
};

export type LocationCity = {
  city: string | null;
  count: number;
  positions: LocationPositionLite[];
};

export type LocationCountry = {
  country: string;
  count: number;
  cities: LocationCity[];
};

// ── Contratti delle API interne ────────────────────────────────────
// Tipi che descrivono la forma di una risposta e che quindi servono a
// due capi: la route che la produce e il componente che la consuma.
// Dichiararli due volte significa poterli cambiare da un lato solo.

/** Conteggi per tabella — `/api/local/sync/status`. */
export interface SyncCounts {
  positions: number;
  scores: number;
  applications: number;
}

/** Stato di un'integrazione — `/api/integrations`. */
export type IntegrationStatus = "connected" | "configured" | "disconnected";

export type Integration = {
  id: string;
  name: string;
  description: string;
  status: IntegrationStatus;
  detail: string | null;
  last_sync: string | null;
};
