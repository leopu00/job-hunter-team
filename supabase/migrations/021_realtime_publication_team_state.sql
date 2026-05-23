-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ Migration 021 — Realtime publication per browser live view               ║
-- ╠══════════════════════════════════════════════════════════════════════════╣
-- ║                                                                          ║
-- ║ Abilita Supabase Realtime su 4 tabelle. Il browser ascolta gli           ║
-- ║ INSERT/UPDATE via WebSocket (~200ms latenza) → UI live senza polling.    ║
-- ║                                                                          ║
-- ║ Il container resta polling-based (auth jht_sync_ non è user JWT, non     ║
-- ║ può autenticare WS Realtime user-channel). Asimmetria voluta:            ║
-- ║   - browser → vede live cosa fa il team                                  ║
-- ║   - container → polling 5s per cambi desired (UX accettabile)            ║
-- ║                                                                          ║
-- ║ RLS già attiva (auth.uid() = user_id da migration 019). Realtime         ║
-- ║ rispetta RLS: ogni client riceve solo le proprie righe.                  ║
-- ║                                                                          ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

ALTER PUBLICATION supabase_realtime ADD TABLE team_state;
ALTER PUBLICATION supabase_realtime ADD TABLE user_to_agent_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE position_feedback;
ALTER PUBLICATION supabase_realtime ADD TABLE pending_user_messages;
