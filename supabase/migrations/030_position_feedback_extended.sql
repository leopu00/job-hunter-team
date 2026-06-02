-- 028: position_feedback extended (comment, score, direction)
-- Additive only — no data loss. Tutti i nuovi campi sono NULLABLE.
--
-- Background: lo schema base (mig 019) ha 4 action enum (like/dislike/hide/star)
-- + reason TEXT opzionale. Sufficiente per il moltiplicatore Scorer (mig 027
-- agent skill feedback-query). Manca però:
--
--   - `comment`     TEXT: feedback verboso libero (più del breve `reason`)
--   - `score`       INTEGER 1..5: granularità numerica oltre il binary like/
--                   dislike (utile per dashboards aggregate + Scorer fine-grained)
--   - `direction`   TEXT: 'more_like_this' | 'less_like_this' — segnale per
--                   lo SCOUT che il pattern (company / role_family / location)
--                   va deprioritizzato o boostato in future ricerche.
--                   Distinto da `action`: like/dislike sono PER-posizione,
--                   direction è per-PATTERN.
--
-- Tutti opzionali per garantire compat con le righe esistenti e con i client
-- che non sono stati ancora aggiornati. Lo Scorer/Scout leggono i nuovi campi
-- via skill `feedback-query` (shared/skills/feedback_query.py) — vedi BACKLOG
-- [Cloud Sync — Feedback loop esteso] (2026-05-31).

ALTER TABLE position_feedback
  ADD COLUMN IF NOT EXISTS comment   TEXT,
  ADD COLUMN IF NOT EXISTS score     INTEGER,
  ADD COLUMN IF NOT EXISTS direction TEXT;

-- CHECK constraints additive. `IF NOT EXISTS` non è supportato su CHECK
-- standalone; uso DO block idempotente che droppa+ricrea solo se mancante.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'position_feedback_score_range'
  ) THEN
    ALTER TABLE position_feedback
      ADD CONSTRAINT position_feedback_score_range
      CHECK (score IS NULL OR (score >= 1 AND score <= 5));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'position_feedback_direction_enum'
  ) THEN
    ALTER TABLE position_feedback
      ADD CONSTRAINT position_feedback_direction_enum
      CHECK (direction IS NULL OR direction IN ('more_like_this', 'less_like_this'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'position_feedback_comment_length'
  ) THEN
    ALTER TABLE position_feedback
      ADD CONSTRAINT position_feedback_comment_length
      CHECK (comment IS NULL OR LENGTH(comment) <= 2000);
  END IF;
END$$;

-- Indice partial sul direction (cardinality bassa, lookup Scout per pattern).
-- WHERE direction IS NOT NULL → solo le righe rilevanti per il segnale Scout
-- (la maggior parte degli action like/dislike non avrà direction).
CREATE INDEX IF NOT EXISTS idx_position_feedback_direction
  ON position_feedback(user_id, direction, created_at DESC)
  WHERE direction IS NOT NULL;
