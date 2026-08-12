// L'elenco unico delle tabelle che contengono dati dell'utente.
//
// Condiviso fra export e cancellazione di proposito: sono due facce dello
// stesso fatto — «questi sono i tuoi dati». Se vivessero in due elenchi
// separati, prima o poi una tabella nuova finirebbe in uno solo, e
// l'utente potrebbe esportare qualcosa che non riesce a cancellare (o
// peggio: cancellare senza aver potuto esportare).
//
// L'ordine qui NON è quello di cancellazione: quello vive in
// `MANUAL_DELETE_ORDER` ed è vincolato dalle chiavi esterne.

/** Tabelle senza `ON DELETE CASCADE` verso `auth.users`: vanno svuotate a
 *  mano, in quest'ordine, prima di cancellare l'utente. Verificato sul
 *  catalogo di produzione il 7 agosto 2026. */
export const MANUAL_DELETE_ORDER = [
  "applications",
  "position_highlights",
  "scores",
  "positions",
  "companies",
  "candidate_profiles",
] as const;

/** Tabelle che spariscono da sole quando cade `auth.users`. Elencate lo
 *  stesso: l'utente ha diritto di sapere cosa se ne va, e l'export deve
 *  comprenderle.
 *
 *  ⚠️ Questo elenco è scritto a mano e per due volte ha perso una tabella
 *  (`candidate_skills` e `sentinel_ticks`, trovate da HQ-MASTER in
 *  review). Il test `account-tables-census` lo confronta con le
 *  MIGRATION, non con l'altro elenco di questo file: un censimento che
 *  guarda solo sé stesso tace proprio quando entrambe le liste
 *  dimenticano la stessa cosa. */
export const CASCADE_TABLES = [
  "candidate_blocks",
  "candidate_contacts",
  "candidate_education",
  "candidate_experiences",
  "candidate_files",
  "candidate_languages",
  "candidate_location_preferences",
  "candidate_skills",
  "candidate_work_authorization",
  "cloud_sync_pairing_sessions",
  "cloud_sync_tokens",
  "encrypted_user_blobs",
  "file_bridge_requests",
  "notification_prefs",
  "pending_user_messages",
  "position_feedback",
  "position_tickets",
  "position_transitions",
  // O-33/mig 069: la nota privata, una riga per `origin` (la superficie che
  // l'ha scritta). Cascata doppia (auth.users e positions), quindi qui e non
  // in MANUAL_DELETE_ORDER. «Privata dagli agenti» non vuol dire esclusa
  // dall'export: è un testo scritto dall'utente, ed è suo.
  "position_user_notes",
  "position_views",
  "sentinel_ticks",
  "team_commands",
  "team_directives",
  "team_state",
  "team_state_history",
  "user_onboarding_state",
  "user_settings",
  "user_to_agent_messages",
] as const;

/** Tutto ciò che è dell'utente. */
export const USER_DATA_TABLES = [
  ...MANUAL_DELETE_ORDER,
  ...CASCADE_TABLES,
] as const;
