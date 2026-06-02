-- 027: positions.geocode_requested + geocode_requested_at (Geocoding-on-demand)
-- Additive only — no data loss. Defaults: FALSE / NULL.
--
-- Background: oggi l'Analista esegue la skill `office-geocoding` per OGNI
-- posizione `checked` con loc_city non-NULL, con sforzo aggressivo (3+ tentativi
-- Nominatim / web search / Photon). La maggior parte di quel costo è speso su
-- posizioni che l'utente non userà mai (non passano lo Scorer, o l'utente non
-- le applica). Replica del problema risolto da Writer-on-demand (mig 024).
--
-- Soluzione: l'utente seleziona dal dashboard web (button "Geocodifica") o
-- via Telegram (`/geo <id>`) le posizioni per cui vuole coordinate ufficio
-- precise. L'Analista monitora `geocode_requested = TRUE` e processa solo
-- quelle. Default = FALSE: niente geocoding precision di default.
--
-- Vedi BACKLOG [Cloud Sync — Geocoding opt-in/out] (2026-05-31) e SQLite
-- mirror in `shared/skills/_db.py::_migrate_positions_geocode_requested`
-- (schema V8).

ALTER TABLE positions
  ADD COLUMN IF NOT EXISTS geocode_requested    BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS geocode_requested_at TIMESTAMPTZ;

-- Index partial: l'utente seleziona poche posizioni, il pull cloud→SQLite
-- (handlePullDesiredState) polla questa view -> partial index su WHERE = TRUE
-- mantiene la lookup O(log n_selected) invece di O(n_total).
CREATE INDEX IF NOT EXISTS positions_geocode_requested_idx
  ON positions (user_id, geocode_requested_at)
  WHERE geocode_requested = TRUE;
