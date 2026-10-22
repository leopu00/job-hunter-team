-- 100 — web capace, phase 6: the settings the site may change on the box, through the door.
--
-- One action on the door by families (099): settings.update, level L2, recent session, at most 20
-- an hour, no two-step confirmation (it starts and stops nothing).
--
-- Closed keys, the same lists as shared/config/schema.ts and cli/src/lib/team-settings.js:
--   working_hours  {timezone, windows: at most 7 of {days, start, end}}, one block per day, at least
--                  4 hours, start <> end; or null (the team works 24/7)
--   role_models    {<role>: {model: sol|terra|luna, effort: low|medium|high}}
-- Nothing else: no free text, no key, no provider.
--
-- The effect is a desire, never the box's config: team_state.desired_settings (the given keys over
-- the previous desire) with desired_settings_at, stamped now() by a trigger and never kept from a
-- client. The box applies it to its own config (team-settings.js, under the rules of P6) and says
-- so in settings_applied_at, through its token route (service_role): no grant to a browser role.
-- The log row is `done` at once: the desire is written, and «applied» is the box's to say.
--
-- params_max_bytes 1536: both keys at their longest valid shape (seven one-day windows, a long
-- timezone, ten roles with model and effort) measure 981 bytes as jsonb text, over the default 256.

-- ---------------------------------------------------------------------------------------------
-- 1. The desire in team_state
-- ---------------------------------------------------------------------------------------------

ALTER TABLE public.team_state
    ADD COLUMN IF NOT EXISTS desired_settings     JSONB,
    ADD COLUMN IF NOT EXISTS desired_settings_at  TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS settings_applied_at  TIMESTAMPTZ;

COMMENT ON COLUMN public.team_state.desired_settings IS
    'Settings asked from the site (settings.update, 100): working_hours, role_models. Applied by the box.';
COMMENT ON COLUMN public.team_state.desired_settings_at IS
    'now() of the last change of desired_settings, by trigger; a value sent by a client is never kept.';
COMMENT ON COLUMN public.team_state.settings_applied_at IS
    'desired_settings_at of the version the box applied to its config; written by the box only.';

CREATE OR REPLACE FUNCTION public.team_state_stamp_desired_settings()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        NEW.desired_settings_at := CASE WHEN NEW.desired_settings IS NULL THEN NULL ELSE now() END;
    ELSIF NEW.desired_settings IS DISTINCT FROM OLD.desired_settings THEN
        NEW.desired_settings_at := now();
    ELSE
        NEW.desired_settings_at := OLD.desired_settings_at;
    END IF;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.team_state_stamp_desired_settings() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_team_state_stamp_desired_settings ON public.team_state;
CREATE TRIGGER trg_team_state_stamp_desired_settings
    BEFORE INSERT OR UPDATE ON public.team_state
    FOR EACH ROW EXECUTE FUNCTION public.team_state_stamp_desired_settings();

-- ---------------------------------------------------------------------------------------------
-- 2. The closed lists
-- ---------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION web_door.settings_valid_working_hours(p JSONB)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
    w     JSONB;
    d     TEXT;
    seen  TEXT[] := '{}';
    s_min INTEGER;
    e_min INTEGER;
BEGIN
    IF jsonb_typeof(p) = 'null' THEN
        RETURN TRUE;
    END IF;
    IF jsonb_typeof(p) IS DISTINCT FROM 'object'
       OR EXISTS (SELECT 1 FROM jsonb_object_keys(p) AS k WHERE k NOT IN ('timezone', 'windows'))
       OR jsonb_typeof(p -> 'timezone') IS DISTINCT FROM 'string'
       OR (p ->> 'timezone') !~ '^[A-Za-z0-9_+/-]{1,64}$'
       OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names AS z WHERE z.name = p ->> 'timezone')
       OR jsonb_typeof(p -> 'windows') IS DISTINCT FROM 'array'
       OR jsonb_array_length(p -> 'windows') > 7 THEN
        RETURN FALSE;
    END IF;
    FOR w IN SELECT * FROM jsonb_array_elements(p -> 'windows') LOOP
        IF jsonb_typeof(w) IS DISTINCT FROM 'object'
           OR EXISTS (SELECT 1 FROM jsonb_object_keys(w) AS k WHERE k NOT IN ('days', 'start', 'end'))
           OR jsonb_typeof(w -> 'days') IS DISTINCT FROM 'array'
           OR jsonb_array_length(w -> 'days') = 0
           OR jsonb_typeof(w -> 'start') IS DISTINCT FROM 'string'
           OR jsonb_typeof(w -> 'end') IS DISTINCT FROM 'string'
           OR (w ->> 'start') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
           OR (w ->> 'end') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
           OR (w ->> 'start') = (w ->> 'end') THEN
            RETURN FALSE;
        END IF;
        IF EXISTS (SELECT 1 FROM jsonb_array_elements(w -> 'days') AS e WHERE jsonb_typeof(e) <> 'string') THEN
            RETURN FALSE;
        END IF;
        FOR d IN SELECT * FROM jsonb_array_elements_text(w -> 'days') LOOP
            IF d NOT IN ('mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun') OR d = ANY (seen) THEN
                RETURN FALSE;
            END IF;
            seen := seen || d;
        END LOOP;
        s_min := split_part(w ->> 'start', ':', 1)::INTEGER * 60 + split_part(w ->> 'start', ':', 2)::INTEGER;
        e_min := split_part(w ->> 'end', ':', 1)::INTEGER * 60 + split_part(w ->> 'end', ':', 2)::INTEGER;
        IF (CASE WHEN e_min > s_min THEN e_min - s_min ELSE 1440 - s_min + e_min END) < 240 THEN
            RETURN FALSE;
        END IF;
    END LOOP;
    RETURN TRUE;
END;
$$;
REVOKE ALL ON FUNCTION web_door.settings_valid_working_hours(JSONB) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION web_door.settings_valid_role_models(p JSONB)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
    -- a JSON null or a number is refused, as on the box: ->> gives NULL or '1', never a class
    SELECT jsonb_typeof(p) IS NOT DISTINCT FROM 'object'
       AND NOT EXISTS (
           SELECT 1 FROM jsonb_each(p) AS r(role, entry)
            WHERE r.role NOT IN ('capitano', 'scout', 'analista', 'scorer', 'scrittore',
                                 'critico', 'sentinella', 'assistente', 'mentor', 'closer')
               OR jsonb_typeof(r.entry) <> 'object'
               OR EXISTS (SELECT 1 FROM jsonb_object_keys(r.entry) AS k WHERE k NOT IN ('model', 'effort'))
               OR (r.entry ? 'model'
                   AND NOT COALESCE(jsonb_typeof(r.entry -> 'model') = 'string'
                                    AND (r.entry ->> 'model') IN ('sol', 'terra', 'luna'), FALSE))
               OR (r.entry ? 'effort'
                   AND NOT COALESCE(jsonb_typeof(r.entry -> 'effort') = 'string'
                                    AND (r.entry ->> 'effort') IN ('low', 'medium', 'high'), FALSE))
       );
$$;
REVOKE ALL ON FUNCTION web_door.settings_valid_role_models(JSONB) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- 3. The family: what settings.update accepts and does
-- ---------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION web_door.ext_settings(
    p_stage TEXT, p_action TEXT, p_uid UUID, p_params JSONB, p_body TEXT, p_log_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_parts TEXT[] := '{}';
BEGIN
    IF p_action IS DISTINCT FROM 'settings.update' THEN
        RAISE EXCEPTION 'web_door.ext_settings: not an action of this family: %', p_action;
    END IF;
    IF p_stage NOT IN ('prepare', 'effect') THEN
        RAISE EXCEPTION 'web_door.ext_settings: bad stage %', p_stage;
    END IF;

    -- The same checks at both stages: the effect gets the SAVED parameters, and checks them again.
    IF p_body IS NOT NULL
       OR jsonb_typeof(p_params) IS DISTINCT FROM 'object'
       OR NOT EXISTS (SELECT 1 FROM jsonb_object_keys(p_params))
       OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_params) AS k WHERE k NOT IN ('working_hours', 'role_models'))
       OR (p_params ? 'working_hours' AND NOT web_door.settings_valid_working_hours(p_params -> 'working_hours'))
       OR (p_params ? 'role_models' AND NOT web_door.settings_valid_role_models(p_params -> 'role_models')) THEN
        RETURN jsonb_build_object('error', 'invalid_params');
    END IF;

    IF p_stage = 'prepare' THEN
        IF p_params ? 'working_hours' THEN
            v_parts := v_parts || CASE
                WHEN jsonb_typeof(p_params -> 'working_hours') = 'null' THEN 'working hours: always'
                ELSE 'working hours: ' || jsonb_array_length(p_params -> 'working_hours' -> 'windows')::TEXT
                     || ' blocks, ' || (p_params -> 'working_hours' ->> 'timezone')
            END;
        END IF;
        IF p_params ? 'role_models' THEN
            v_parts := v_parts || ('models: '
                || (SELECT count(*) FROM jsonb_object_keys(p_params -> 'role_models'))::TEXT || ' roles');
        END IF;
        RETURN jsonb_build_object(
            'params', p_params,
            'body', NULL,
            'summary', left(array_to_string(v_parts, '; '), 200),
            'confirm', FALSE);
    END IF;

    INSERT INTO public.team_state (user_id, desired_settings)
    VALUES (p_uid, p_params)
    ON CONFLICT (user_id) DO UPDATE
       SET desired_settings = COALESCE(public.team_state.desired_settings, '{}'::JSONB) || EXCLUDED.desired_settings;
    -- done: the desire is written; «applied» is team_state.settings_applied_at, from the box.
    RETURN jsonb_build_object('status', 'done');
END;
$$;
REVOKE ALL ON FUNCTION web_door.ext_settings(TEXT, TEXT, UUID, JSONB, TEXT, UUID) FROM PUBLIC, anon, authenticated;

INSERT INTO web_door.vocab
    (action, family, level, recent, cap_group, cap_n, cap_window, takes_body, params_max_bytes)
VALUES ('settings.update', 'settings', 'L2', TRUE, 'settings', 20, INTERVAL '1 hour', FALSE, 1536)
ON CONFLICT (action) DO UPDATE
   SET family = EXCLUDED.family, level = EXCLUDED.level, recent = EXCLUDED.recent,
       cap_group = EXCLUDED.cap_group, cap_n = EXCLUDED.cap_n, cap_window = EXCLUDED.cap_window,
       takes_body = EXCLUDED.takes_body, params_max_bytes = EXCLUDED.params_max_bytes;

-- ---------------------------------------------------------------------------------------------
-- 4. Fail the migration if the boundary is not there
-- ---------------------------------------------------------------------------------------------

DO $$
DECLARE
    c TEXT;
BEGIN
    IF has_function_privilege('authenticated', 'web_door.ext_settings(text,text,uuid,jsonb,text,uuid)', 'EXECUTE')
       OR has_function_privilege('anon', 'web_door.ext_settings(text,text,uuid,jsonb,text,uuid)', 'EXECUTE') THEN
        RAISE EXCEPTION '100: a browser role can execute the settings family';
    END IF;
    FOREACH c IN ARRAY ARRAY['desired_settings', 'desired_settings_at', 'settings_applied_at'] LOOP
        IF has_column_privilege('authenticated', 'public.team_state', c, 'UPDATE')
           OR has_column_privilege('authenticated', 'public.team_state', c, 'INSERT')
           OR has_column_privilege('anon', 'public.team_state', c, 'UPDATE') THEN
            RAISE EXCEPTION '100: a browser role can write team_state.%', c;
        END IF;
    END LOOP;
    IF NOT EXISTS (SELECT 1 FROM web_door.vocab
                    WHERE action = 'settings.update' AND family = 'settings' AND level = 'L2'
                      AND recent AND NOT takes_body AND params_max_bytes = 1536) THEN
        RAISE EXCEPTION '100: settings.update is not in the vocabulary as written';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger
                    WHERE tgrelid = 'public.team_state'::regclass
                      AND tgname = 'trg_team_state_stamp_desired_settings' AND NOT tgisinternal) THEN
        RAISE EXCEPTION '100: the stamp of desired_settings is not there';
    END IF;
END $$;
