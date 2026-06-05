-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ Migration 033 — scadenza opzionale dei cloud_sync_tokens (audit #1)      ║
-- ╠══════════════════════════════════════════════════════════════════════════╣
-- ║                                                                          ║
-- ║ I token `jht_sync_` autorizzano le route cloud-sync, che girano con      ║
-- ║ service_role e BYPASSANO la RLS. Prima di questa migration non avevano   ║
-- ║ alcuna scadenza: un token emesso restava valido per sempre, e il logout  ║
-- ║ web non lo invalidava. (Red-team 2026-06-06, finding #1.)                ║
-- ║                                                                          ║
-- ║ Aggiungiamo `expires_at` NULLABLE:                                       ║
-- ║   - NULL            → nessuna scadenza. Riservato ai device headless     ║
-- ║                       (VPS via device-register) che non hanno auto-      ║
-- ║                       refresh del token e andrebbero ri-pairati a mano.  ║
-- ║   - valorizzato     → verifyBearerToken (lib/cloud-sync/auth.ts) rifiuta ║
-- ║                       il token con 401 dopo questa data.                 ║
-- ║                                                                          ║
-- ║ Default policy lato app: token creati da UI → 90 giorni; token VPS →     ║
-- ║ NULL esplicito. I token gia' esistenti restano NULL (non si rompono).    ║
-- ║                                                                          ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

ALTER TABLE cloud_sync_tokens
  ADD COLUMN IF NOT EXISTS expires_at timestamptz;

COMMENT ON COLUMN cloud_sync_tokens.expires_at IS
  'Scadenza del token. NULL = nessuna scadenza (device headless tipo VPS). Valorizzato = verifyBearerToken rifiuta dopo questa data.';
