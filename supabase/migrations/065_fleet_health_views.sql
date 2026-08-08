-- Fleet health: is the product working in the field, and for whom.
--
-- Everything known about the installed base used to come from hand-written
-- SQL against production, and the column reached for by reflex lies:
-- `cloud_sync_tokens.last_used_at` is written by the box's own sync loop, so
-- an account whose team runs unattended looks maximally *active* while
-- nobody has opened a browser in weeks. Measured 2026-08-03 across the whole
-- instance: of three externally-active accounts, two showed sync timestamps
-- minutes old against a last human session 6 and 24 days earlier, one of
-- them with hundreds of positions collected and zero ever opened. That —
-- teams burning quota into a mailbox nobody reads — is the actual health
-- signal, and no dashboard would have shown it.
--
-- So the distinction is hard-coded in the column names rather than left to
-- whoever writes the query: `machine_*` is the box breathing, `human_*` is a
-- person doing something deliberate. They must never be summed.
--
-- AGGREGATES ONLY. Counts, distributions and timestamps per account, never
-- message bodies, position content or profile fields. No email, no name, no
-- address, no IP, no hostname: the question is whether the product works,
-- and none of the questions we actually have need to read what somebody
-- wrote. Adding such a column here would break the same promise that
-- [CLIENT-VERSION-INVISIBLE] draws its scope rule from.
--
-- ACCESS. These views deliberately cross accounts — that is what makes them
-- a fleet view — so they are readable by `service_role` alone and by nothing
-- a browser can reach: REVOKE from PUBLIC/anon/authenticated, no GRANT to
-- either. They run as the view owner on purpose (the default, not
-- `security_invoker`): `auth.sessions` belongs to the auth schema, which
-- service_role has no direct grant on, and the human-activity half of this
-- view is worth little without the one timestamp that says a person logged
-- in. Supabase's advisor flags owner-rights views as a matter of course;
-- here it is the intended design, not an oversight.

CREATE OR REPLACE VIEW public.fleet_account_health AS
SELECT
  u.id AS user_id,
  u.created_at AS account_created_at,

  -- ── Machine liveness — the box, not the person ────────────────────────
  sync.machine_sync_last_used_at,
  ts.last_heartbeat_at   AS machine_heartbeat_at,
  ts.is_running          AS machine_is_running,
  (ts.active_device_id IS NOT NULL) AS machine_has_active_device,

  -- ── Install base (declared by the box itself, migration 064) ──────────
  sync.client_version,
  sync.client_platform,
  sync.client_seen_at,
  sync.active_tokens,

  -- ── Human activity — somebody actually did something ──────────────────
  sess.human_last_session_at,
  views.human_last_position_view_at,
  COALESCE(views.human_positions_opened, 0)  AS human_positions_opened,
  COALESCE(fb.human_feedback_given, 0)       AS human_feedback_given,
  fb.human_last_feedback_at,
  chat.human_last_chat_turn_at,

  -- ── Volume produced for that person ───────────────────────────────────
  COALESCE(pos.positions_total, 0) AS positions_total,
  GREATEST(
    COALESCE(pos.positions_total, 0) - COALESCE(views.human_positions_opened, 0),
    0
  ) AS positions_never_opened,
  COALESCE(app.applications_total, 0)   AS applications_total,
  COALESCE(app.applications_applied, 0) AS applications_applied,

  -- ── Pending rendezvous — a repeat of the silent chat drop shows up
  --    here as a number instead of an archaeology session ───────────────
  COALESCE(chat.undelivered_user_turns, 0) AS undelivered_user_turns,
  chat.oldest_undelivered_user_turn_at,
  (
    ts.chat_requested_at IS NOT NULL
    AND (ts.chat_delivered_at IS NULL OR ts.chat_requested_at > ts.chat_delivered_at)
  ) AS chat_lane_pending,

  -- ── Onboarding milestones ─────────────────────────────────────────────
  onb.vps_setup_completed_at,
  onb.first_team_run_at

FROM auth.users u

-- Un account può avere più device: la versione che conta è quella dell'ultimo
-- che si è fatto vivo, e `last_used_at` più recente è la liveness della
-- macchina nel suo complesso.
LEFT JOIN LATERAL (
  SELECT
    max(t.last_used_at) AS machine_sync_last_used_at,
    count(*)            AS active_tokens,
    (array_agg(t.client_version  ORDER BY t.client_seen_at DESC NULLS LAST))[1] AS client_version,
    (array_agg(t.client_platform ORDER BY t.client_seen_at DESC NULLS LAST))[1] AS client_platform,
    max(t.client_seen_at) AS client_seen_at
  FROM public.cloud_sync_tokens t
  WHERE t.user_id = u.id AND t.revoked_at IS NULL
) sync ON true

LEFT JOIN public.team_state ts ON ts.user_id = u.id
LEFT JOIN public.user_onboarding_state onb ON onb.user_id = u.id

-- L'unico segnale di "una persona era davanti a uno schermo". Le sessioni
-- scadute spariscono, quindi NULL significa "non di recente", non "mai".
LEFT JOIN LATERAL (
  SELECT max(s.updated_at) AS human_last_session_at
  FROM auth.sessions s
  WHERE s.user_id = u.id
) sess ON true

LEFT JOIN LATERAL (
  SELECT
    count(*)          AS human_positions_opened,
    max(v.viewed_at)  AS human_last_position_view_at
  FROM public.position_views v
  WHERE v.user_id = u.id
) views ON true

LEFT JOIN LATERAL (
  SELECT
    count(*)           AS human_feedback_given,
    max(f.created_at)  AS human_last_feedback_at
  FROM public.position_feedback f
  WHERE f.user_id = u.id
) fb ON true

LEFT JOIN LATERAL (
  SELECT count(*) AS positions_total
  FROM public.positions p
  WHERE p.user_id = u.id
) pos ON true

LEFT JOIN LATERAL (
  SELECT
    count(*) AS applications_total,
    count(*) FILTER (WHERE a.applied_at IS NOT NULL) AS applications_applied
  FROM public.applications a
  WHERE a.user_id = u.id
) app ON true

-- Turni scritti dall'utente: quelli che il box non ha ritirato sono la
-- misura del guasto che il 2026-08-03 era rimasto invisibile per giorni.
LEFT JOIN LATERAL (
  SELECT
    max(m.created_at) AS human_last_chat_turn_at,
    count(*) FILTER (WHERE m.delivered_at IS NULL) AS undelivered_user_turns,
    min(m.created_at) FILTER (WHERE m.delivered_at IS NULL)
      AS oldest_undelivered_user_turn_at
  FROM public.pending_user_messages m
  WHERE m.user_id = u.id AND m.author = 'user'
) chat ON true;

-- Distribuzione dell'install base: "chi è colpito da questo bug" diventa
-- una risposta invece di una stima. Solo conteggi.
CREATE OR REPLACE VIEW public.fleet_version_distribution AS
SELECT
  client_version,
  client_platform,
  count(*)                    AS accounts,
  min(client_seen_at)         AS first_seen_at,
  max(client_seen_at)         AS last_seen_at
FROM public.fleet_account_health
WHERE active_tokens > 0
GROUP BY client_version, client_platform;

REVOKE ALL ON public.fleet_account_health FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.fleet_version_distribution FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.fleet_account_health TO service_role;
GRANT SELECT ON public.fleet_version_distribution TO service_role;

COMMENT ON VIEW public.fleet_account_health IS
  'Internal fleet view, service_role only. machine_* = the box breathing (sync, heartbeat); human_* = a person acting (session, opened positions, feedback, chat). Never sum the two. Aggregates and timestamps only — no content, no identity beyond user_id.';
COMMENT ON VIEW public.fleet_version_distribution IS
  'Install-base distribution by declared build and OS family. Counts only.';
