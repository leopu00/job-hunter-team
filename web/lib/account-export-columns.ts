// Che cosa esce nell'export dei dati, colonna per colonna.
//
// È una ALLOWLIST, non una denylist, ed è la differenza che conta: si
// elenca ciò che esce. Con l'approccio opposto — `select("*")` meno
// qualche campo — una colonna aggiunta domani finirebbe nell'export senza
// che nessuno lo decida. È esattamente così che `token_hash` è arrivato a
// un passo dall'essere scaricabile dall'utente.
//
// ── Cosa è escluso, e perché ──────────────────────────────────────────
// Materiale segreto o di sicurezza, che non è «un dato dell'utente» ma
// una credenziale:
//
//   cloud_sync_tokens            token_hash, token_prefix
//   cloud_sync_pairing_sessions  approved_token, approved_token_id
//   team_state                   restart_token, last_restart_token
//
// `approved_token` merita una riga a parte: contiene il token IN CHIARO
// fra l'approvazione e il primo ritiro, dopo il quale viene azzerato
// (`device-poll` fa il wipe). È effimero per progetto, ma finché c'è è un
// segreto: fuori dall'export senza discussioni.
//
// Materiale crittografico di `encrypted_user_blobs` — `ciphertext`,
// `kdf_salt`, `cipher_iv`, `cipher_auth_tag` — escluso anch'esso: senza la
// chiave, che noi non abbiamo, sarebbe inutile a chi lo scarica, e resta
// materiale che non ha ragione di girare in un file. Restano i metadati,
// così l'utente sa che quel blob esiste.
//
// ── Cosa NON è escluso, benché il nome inganni ────────────────────────
// `candidate_blocks.key` è la chiave logica di un blocco del profilo
// (sta accanto a `kind`, `title`, `content`), non un segreto: esce.
// `sentinel_ticks.sample_key` è telemetria di campionamento e non serve a
// chi rilegge i propri dati: quella tabella esce con i soli campi utili.

/** Colonne esportate, per tabella. Una tabella assente da qui non viene
 *  esportata affatto: è voluto, e il test lo verifica contro l'elenco
 *  delle tabelle dell'utente. */
export const EXPORT_COLUMNS: Record<string, readonly string[]> = {
  applications: [
    "id",
    "position_id",
    "status",
    "critic_score",
    "critic_verdict",
    "written_at",
    "applied_at",
    "response",
    "response_at",
    "created_at",
    "interview_round",
    "critic_notes",
    "applied_via",
    "written_by",
    "reviewed_by",
    "critic_reviewed_at",
    "applied",
    "critic_round",
    "deleted_at",
  ],
  position_highlights: [
    "id",
    "position_id",
    "type",
    "text",
    "created_at",
    "deleted_at",
  ],
  scores: [
    "id",
    "position_id",
    "total_score",
    "experience_fit",
    "skill_match",
    "location_fit",
    "salary_fit",
    "created_at",
    "stack_match",
    "remote_fit",
    "strategic_fit",
    "breakdown",
    "notes",
    "scored_by",
    "scored_at",
    "pros",
    "cons",
    "deleted_at",
  ],
  positions: [
    "id",
    "title",
    "company",
    "url",
    "location",
    "remote_type",
    "status",
    "score",
    "found_at",
    "source",
    "jd_text",
    "requirements",
    "notes",
    "last_checked",
    "salary_declared_min",
    "salary_declared_max",
    "salary_estimated_min",
    "salary_estimated_max",
    "salary_estimated_source",
    "created_at",
    "company_id",
    "salary_declared_currency",
    "salary_estimated_currency",
    "found_by",
    "deadline",
    "office_address",
    "is_remote",
    "role_family",
    "loc_city",
    "loc_region",
    "loc_country",
    "work_mode",
    "work_country",
    "location_notes",
    "deleted_at",
    "is_open",
    "salary_precise",
    "user_excluded_reason",
    "user_excluded_note",
    "user_excluded_at",
    "jd_summary",
    "updated_at",
  ],
  companies: [
    "id",
    "name",
    "website",
    "hq",
    "size",
    "stage",
    "notes",
    "created_at",
    "sector",
    "glassdoor_rating",
    "red_flags",
    "culture_notes",
    "analyzed_by",
    "analyzed_at",
    "verdict",
    "deleted_at",
  ],
  candidate_profiles: [
    "id",
    "name",
    "email",
    "location",
    "birth_year",
    "nationality",
    "work_authorization",
    "target_role",
    "experience_months",
    "experience_years",
    "has_degree",
    "languages",
    "skills",
    "seniority_target",
    "job_titles",
    "location_preferences",
    "salary_target",
    "positioning",
    "created_at",
    "updated_at",
    "timezone",
    "industry",
  ],
  candidate_contacts: [
    "email",
    "phone",
    "linkedin",
    "github",
    "website",
    "address",
    "created_at",
    "updated_at",
  ],
  candidate_education: [
    "id",
    "kind",
    "institution",
    "degree",
    "year",
    "period",
    "location",
    "details",
    "ord",
    "created_at",
    "updated_at",
  ],
  candidate_experiences: [
    "id",
    "company",
    "role",
    "period",
    "start_date",
    "end_date",
    "location",
    "summary",
    "ord",
    "created_at",
    "updated_at",
  ],
  candidate_files: [
    "id",
    "name",
    "category",
    "sha256",
    "size",
    "mime",
    "updated_at",
  ],
  candidate_languages: [
    "id",
    "language",
    "level",
    "ord",
    "created_at",
    "updated_at",
  ],
  candidate_location_preferences: [
    "id",
    "value",
    "ord",
    "created_at",
    "updated_at",
  ],
  candidate_work_authorization: [
    "id",
    "region",
    "status",
    "ord",
    "created_at",
    "updated_at",
  ],
  candidate_skills: [
    "id",
    "name",
    "category",
    "ord",
    "created_at",
    "updated_at",
  ],
  candidate_blocks: [
    "id",
    "key",
    "kind",
    "title",
    "content",
    "ord",
    "source",
    "created_at",
    "updated_at",
  ],
  // Envelope crittografico COMPLETO, non i soli metadati.
  //
  // La prima versione escludeva ciphertext, salt, iv e auth tag «per
  // prudenza». Era la prudenza sbagliata: quel blob è dato dell'utente,
  // cifrato con una chiave che noi non abbiamo, e senza l'envelope intero
  // non è decifrabile nemmeno da lui — l'export gli consegnava la propria
  // roba inutilizzabile. Portabilità significa poterlo riaprire.
  // La chiave non c'è e non ci sarà: quella non è nostra da esportare.
  encrypted_user_blobs: [
    "id",
    "blob_type",
    "kdf_version",
    "kdf_salt",
    "kdf_iterations",
    "cipher_iv",
    "cipher_auth_tag",
    "ciphertext",
    "metadata",
    "created_at",
    "updated_at",
  ],
  // `storage_path` is generated from user_id/request id by the database. It is
  // safe to export as request metadata, but is never Storage authority.
  file_bridge_requests: [
    "id",
    "file_name",
    "status",
    "storage_path",
    "expires_at",
    "created_at",
    "updated_at",
  ],
  notification_prefs: ["prefs", "created_at", "updated_at"],
  pending_user_messages: [
    "id",
    "agent",
    "body",
    "kind",
    "related_position_id",
    "delivered_via",
    "delivered_at",
    "acknowledged_at",
    "user_reply",
    "user_reply_at",
    "created_at",
    "author",
    "chat_ts",
  ],
  position_feedback: [
    "id",
    "position_legacy_id",
    "action",
    "reason",
    "created_at",
    "comment",
    "score",
    "direction",
  ],
  position_tickets: [
    "id",
    "position_legacy_id",
    "request_text",
    "kind",
    "status",
    "assigned_agent",
    "response_text",
    "created_at",
    "resolved_at",
  ],
  position_transitions: [
    "id",
    "position_legacy_id",
    "from_state",
    "to_state",
    "ts",
    "by_agent",
    "notes",
    "created_at",
  ],
  position_views: ["position_id", "viewed_at"],
  // Senza `restart_token` e `last_restart_token`.
  team_state: [
    "should_run",
    "agents_enabled",
    "is_running",
    "last_heartbeat_at",
    "last_user_activity_at",
    "last_action",
    "last_action_at",
    "created_at",
    "updated_at",
  ],
  // Senza `old_value` e `new_value`: quella tabella registra il cambio di
  // un campo qualsiasi, e fra i campi c'è `restart_token` — quindi lo
  // storico contiene token veri, solo passati. Restano il nome del campo e
  // quando è cambiato, che è l'informazione utile a chi rilegge.
  team_state_history: ["id", "field", "changed_at", "changed_by"],
  team_commands: [
    "id",
    "action",
    "payload",
    "requested_at",
    "processed_at",
    "status",
  ],
  team_directives: [
    "id",
    "body",
    "kind",
    "status",
    "sort_order",
    "created_by",
    "created_at",
    "updated_at",
    "archived_at",
  ],
  user_onboarding_state: [
    "vps_setup_completed_at",
    "profile_configured_at",
    "first_team_run_at",
    "created_at",
    "updated_at",
    "tour_done_at",
  ],
  user_to_agent_messages: [
    "id",
    "agent",
    "message",
    "payload",
    "sent_at",
    "delivered_at",
    "replied_at",
    "status",
  ],
  // Telemetria: solo ciò che è leggibile da chi rilegge i propri dati.
  sentinel_ticks: [
    "id",
    "ts",
    "provider",
    "usage",
    "status",
    "weekly_usage",
    "created_at",
  ],
  // Senza `approved_token` e `approved_token_id`.
  // Senza `device_code`: è il segreto con cui un dispositivo reclama la
  // sessione, quindi bearer-like anche se il nome dice «code».
  cloud_sync_pairing_sessions: [
    "status",
    "approved_at",
    "consumed_at",
    "created_at",
    "expires_at",
  ],
  // Senza `token_hash` e `token_prefix`.
  cloud_sync_tokens: [
    "id",
    "name",
    "last_used_at",
    "revoked_at",
    "created_at",
    "expires_at",
  ],
};

/** I nomi che non devono comparire in un export, a nessun titolo. Il test
 *  li cerca nel payload serializzato: se uno passa, l'allowlist ha un buco. */
export const FORBIDDEN_EXPORT_FIELDS = [
  "token_hash",
  "token_prefix",
  "approved_token",
  "approved_token_id",
  "restart_token",
  "last_restart_token",
  // Bearer-like: con questo un dispositivo reclama la sessione di pairing.
  "device_code",
  // Lo storico dei cambi di stato può contenere il valore di
  // `restart_token`: fuori i valori, resta il nome del campo.
  "old_value",
  "new_value",
] as const;

// NOTA: il materiale crittografico di `encrypted_user_blobs` NON è in
// questo elenco, ed è voluto. È dato dell'utente cifrato con una chiave
// che non possediamo: senza l'envelope completo l'export non sarebbe
// portabile. Escluderlo sarebbe prudenza apparente e danno reale.
