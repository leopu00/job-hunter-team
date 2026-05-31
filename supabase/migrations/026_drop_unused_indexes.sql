-- 2026-05-31 — Migration 026: drop unused indexes
--
-- Copre il P2 del perf-backlog 2026-05-20: indici creati in passato e
-- mai usati dal planner. Costano spazio + write overhead + lavoro
-- inutile in autovacuum.
--
-- Selezione conservativa:
--   - droppo indici esplicitamente menzionati come safe nel perf-backlog
--   - droppo indici sostituiti da Realtime subscription (heartbeat,
--     pending messages, agent messages polling) — il polling è morto
--     dopo migration 021
--   - droppo indici legati a sentinel ticks (sentinel decimato, no
--     più scritture cloud)
--   - NON droppo i 9 FK index creati da migration 024 (sono nuovi,
--     ovviamente non hanno traffico ancora — re-evaluate fra 7-14 gg)
--   - NON droppo idx_positions_loc_*: usabili da future feature geo
--   - NON droppo UNIQUE constraint indexes (cloud_sync_pairing_sessions_user_code_key,
--     encrypted_user_blobs_user_id_blob_type_key) — servono per integrità
--
-- Refs: docs/internal/2026-05-20-supabase-perf-backlog.md (P2)

-- pairing sessions cleanup job — index expires_at non usato
DROP INDEX IF EXISTS public.idx_pairing_sessions_expires_at;

-- pending messages — sostituiti da Realtime subscription (mig 021)
DROP INDEX IF EXISTS public.idx_pending_user_messages_user_pending;
DROP INDEX IF EXISTS public.idx_pending_user_messages_user_replies;

-- sentinel ticks — sentinel decimato post-incident 2026-05-19
DROP INDEX IF EXISTS public.idx_sentinel_ticks_user_provider_ts;
DROP INDEX IF EXISTS public.idx_sentinel_ticks_user_source_ts;

-- onboarding state — index su vps_setup field usato 1 volta nel wizard
DROP INDEX IF EXISTS public.idx_user_onboarding_state_vps_setup;

-- team_state heartbeat — sostituito da Realtime
DROP INDEX IF EXISTS public.idx_team_state_last_heartbeat;

-- user-to-agent messages — sostituito da Realtime
DROP INDEX IF EXISTS public.idx_user_to_agent_messages_pending;

-- position_feedback — traffico molto basso, planner usa seq scan
DROP INDEX IF EXISTS public.idx_position_feedback_user_time;
