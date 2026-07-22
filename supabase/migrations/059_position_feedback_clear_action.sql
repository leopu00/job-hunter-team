-- 059 — position_feedback: azione 'clear' (2026-07-22)
--
-- Il giudizio dalla UI è togglabile: ricliccare il voto attivo lo RITIRA
-- (regola utente 22/07: dev'essere possibile non avere nessun voto).
-- Il log resta append-only (RLS invariata, niente DELETE): il ritiro è un
-- EVENTO 'clear' e come sempre l'ultimo evento prevale. I lettori web
-- (getLatestFeedbackForLegacyId / getLatestFeedbackByLegacyId) trattano
-- 'clear' come "nessun giudizio"; per gli agenti (skill feedback-query)
-- l'evento è comunque informativo: l'utente ha ritirato il voto.

ALTER TABLE position_feedback
  DROP CONSTRAINT IF EXISTS position_feedback_action_check;

ALTER TABLE position_feedback
  ADD CONSTRAINT position_feedback_action_check
  CHECK (action IN ('like', 'dislike', 'hide', 'star', 'clear'));
