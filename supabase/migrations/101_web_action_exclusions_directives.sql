-- 101: exclusions and standing orders from the website, through the single door (phase 4).
--
-- Needs 098 (the door) and 099 (the door by families: web_door.vocab, request_action with p_body,
-- web_door.ext_<family>). Applied after them, in the same series: 098, 099, 100, 101.
--
-- What changes for a browser session (anon, authenticated):
--   - excluding a position, withdrawing the exclusion, deciding a proposal of exclusion of the profile,
--     and creating, editing or archiving a standing order of the team are actions of the door:
--     one line in web_action_log each, the limits and the session of the door;
--   - the columns of the user's decision on a position (user_excluded_reason, _note, _at, _prev_status)
--     are written only by the door (or by the box with the service role). status stays writable by the
--     user's own sync (web/app/api/local/sync), as before: the decision is the four columns, not status;
--   - profile_exclusions is read only;
--   - mutate_team_directive_with_event (079) is no longer executable by a browser role: one door only;
--   - team_directives.origin says who wrote the current text: 'web' when the door did, 'desktop'
--     otherwise (the box, the team's chat, the rows written before this migration).
--
-- An application that already left is not excluded (already_submitted, the rule of the gate and of
-- web_door.ext_position), instead of failing on the trigger of 081.
--
-- Free text: the standing order (up to 2000 characters) and the note of an exclusion (up to 200) come
-- as p_body of the first call, are kept in web_action_log.body (099), and the effect reads them from
-- there: what is confirmed is the text that was shown. A free text never becomes an application: no
-- action here touches apply_requested, and the agents read a standing order only inside the fence of
-- shared/skills/team_directives.py (fence_user_turn).
--
-- Vocabulary of the reasons: shared/feedback-reasons.json («reasons» for a position, «proposable» for
-- the profile, the same set as the CHECK of profile_exclusions). A test compares the two lists.

-- ---------------------------------------------------------------------------------------------
-- 0. The series: 099 must be there
-- ---------------------------------------------------------------------------------------------

DO $$
BEGIN
    IF to_regclass('web_door.vocab') IS NULL
       OR to_regprocedure('public.request_action(text,jsonb,uuid,text,text)') IS NULL THEN
        RAISE EXCEPTION '101: needs 099 (web_door.vocab and request_action with p_body)';
    END IF;
END $$;

-- ---------------------------------------------------------------------------------------------
-- 1. The mark «written by the website»
-- ---------------------------------------------------------------------------------------------

ALTER TABLE public.team_directives
    ADD COLUMN IF NOT EXISTS origin TEXT NOT NULL DEFAULT 'desktop';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conrelid = 'public.team_directives'::regclass
           AND conname = 'team_directives_origin_check'
    ) THEN
        ALTER TABLE public.team_directives
            ADD CONSTRAINT team_directives_origin_check CHECK (origin IN ('desktop', 'web'));
    END IF;
END $$;

COMMENT ON COLUMN public.team_directives.origin IS
    'web when the single door wrote or archived the directive last (web_door.ext_directive), desktop otherwise. For the record and the notice of the website; the agents do not read it.';

-- ---------------------------------------------------------------------------------------------
-- 2. The decision on a position: door only
-- ---------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.positions_guard_user_exclusion()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    IF current_user IN ('anon', 'authenticated') THEN
        IF TG_OP = 'INSERT' THEN
            IF NEW.user_excluded_reason IS NOT NULL
               OR NEW.user_excluded_note IS NOT NULL
               OR NEW.user_excluded_at IS NOT NULL
               OR NEW.user_excluded_prev_status IS NOT NULL THEN
                RAISE EXCEPTION 'user_exclusion_is_door_only' USING ERRCODE = '42501';
            END IF;
        ELSIF NEW.user_excluded_reason IS DISTINCT FROM OLD.user_excluded_reason
           OR NEW.user_excluded_note IS DISTINCT FROM OLD.user_excluded_note
           OR NEW.user_excluded_at IS DISTINCT FROM OLD.user_excluded_at
           OR NEW.user_excluded_prev_status IS DISTINCT FROM OLD.user_excluded_prev_status THEN
            RAISE EXCEPTION 'user_exclusion_is_door_only' USING ERRCODE = '42501';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.positions_guard_user_exclusion() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_positions_guard_user_exclusion ON public.positions;
CREATE TRIGGER trg_positions_guard_user_exclusion
BEFORE INSERT OR UPDATE OF user_excluded_reason, user_excluded_note, user_excluded_at, user_excluded_prev_status
ON public.positions
FOR EACH ROW
EXECUTE FUNCTION public.positions_guard_user_exclusion();

-- ---------------------------------------------------------------------------------------------
-- 3. The other ways in, closed
-- ---------------------------------------------------------------------------------------------

-- The decisions on the proposals of the profile: read by the user, written by the door or the box.
REVOKE ALL ON TABLE public.profile_exclusions FROM anon, authenticated;
GRANT SELECT ON TABLE public.profile_exclusions TO authenticated;

-- The standing orders: the RPC of 079 stays for nobody but its owner; the door writes them now.
REVOKE ALL ON FUNCTION public.mutate_team_directive_with_event(BIGINT, TEXT, TEXT, TEXT, TEXT)
    FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- 4. The vocabulary
-- ---------------------------------------------------------------------------------------------
--
-- A standing order is L2 with the confirmation in two steps, but without the recent login (decision of
-- 22/10): the desktop app writes them too, with a session that stays open for days, and the door cannot
-- tell it from a browser. What holds instead: the text reaches the agents only inside the fence, no
-- free text ever starts an application, every change is a line of the log, and the box tells the user
-- out of band when it imports a new or changed order from the website.

INSERT INTO web_door.vocab
    (action, family, level, recent, cap_group, cap_n, cap_window, takes_body, params_max_bytes)
VALUES
    ('exclusion.decide',      'exclusion', 'L1', FALSE, 'exclusion',         300, INTERVAL '1 hour', TRUE,  256),
    ('exclusion.withdraw',    'exclusion', 'L1', FALSE, 'exclusion',         300, INTERVAL '1 hour', FALSE, 256),
    ('exclusion.profile_set', 'exclusion', 'L1', FALSE, 'exclusion.profile', 60,  INTERVAL '1 hour', FALSE, 256),
    ('directive.create',      'directive', 'L2', FALSE, 'directive',         30,  INTERVAL '1 hour', TRUE,  256),
    ('directive.update',      'directive', 'L2', FALSE, 'directive',         30,  INTERVAL '1 hour', TRUE,  256),
    ('directive.archive',     'directive', 'L1', FALSE, 'directive.archive', 60,  INTERVAL '1 hour', FALSE, 256)
ON CONFLICT (action) DO UPDATE
    SET family = EXCLUDED.family, level = EXCLUDED.level, recent = EXCLUDED.recent,
        cap_group = EXCLUDED.cap_group, cap_n = EXCLUDED.cap_n, cap_window = EXCLUDED.cap_window,
        takes_body = EXCLUDED.takes_body, params_max_bytes = EXCLUDED.params_max_bytes;

-- ---------------------------------------------------------------------------------------------
-- 5. The family «exclusion»
-- ---------------------------------------------------------------------------------------------
--
-- prepare: the parameters of the first call, as they came; returns them normalised (closed keys), the
-- note, the summary, and no confirmation (L1). effect: the door passes the SAVED parameters and note
-- (its line is queued already), and the target is read again here (it may have changed).
-- A refusal is one of the codes of the door (invalid_params, not_found); a call the door never makes
-- (another family's action, an unknown stage) is a bug and raises.

CREATE OR REPLACE FUNCTION web_door.ext_exclusion(
    p_stage   TEXT,
    p_action  TEXT,
    p_uid     UUID,
    p_params  JSONB,
    p_body    TEXT,
    p_log_id  UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_keys      TEXT[];
    v_legacy    INTEGER;
    v_reason    TEXT;
    v_note      TEXT;
    v_decision  TEXT;
    v_count     INTEGER;
    v_pos_id    INTEGER;
    v_status    TEXT;
    v_prev      TEXT;
    v_excl_at   TIMESTAMPTZ;
    v_applied   BOOLEAN;
BEGIN
    IF p_uid IS NULL OR p_action IS NULL OR p_action NOT IN ('exclusion.decide', 'exclusion.withdraw', 'exclusion.profile_set') THEN
        RAISE EXCEPTION 'web_door.ext_exclusion: not an action of this family: %', p_action;
    END IF;
    IF p_stage IS NULL OR p_stage NOT IN ('prepare', 'effect')
       OR (p_stage = 'effect' AND p_log_id IS NULL) THEN
        RAISE EXCEPTION 'web_door.ext_exclusion: bad stage %', p_stage;
    END IF;

    IF p_params IS NULL OR jsonb_typeof(p_params) <> 'object' THEN
        RETURN jsonb_build_object('error', 'invalid_params');
    END IF;
    SELECT COALESCE(array_agg(k ORDER BY k), '{}') INTO v_keys FROM jsonb_object_keys(p_params) AS k;

    -- The decision on a proposal of the profile: one row of the user per reason.
    IF p_action = 'exclusion.profile_set' THEN
        IF NOT (v_keys <@ ARRAY['positions', 'reason', 'status'] AND v_keys @> ARRAY['reason', 'status'])
           OR jsonb_typeof(p_params -> 'reason') IS DISTINCT FROM 'string'
           OR jsonb_typeof(p_params -> 'status') IS DISTINCT FROM 'string'
           OR p_body IS NOT NULL THEN
            RETURN jsonb_build_object('error', 'invalid_params');
        END IF;
        v_reason := p_params ->> 'reason';
        v_decision := p_params ->> 'status';
        IF v_reason NOT IN ('too_senior', 'too_junior', 'wrong_location', 'salary_low', 'wrong_stack', 'company')
           OR v_decision NOT IN ('accepted', 'dismissed') THEN
            RETURN jsonb_build_object('error', 'invalid_params');
        END IF;
        v_count := 0;
        IF p_params ? 'positions' THEN
            IF jsonb_typeof(p_params -> 'positions') IS DISTINCT FROM 'number'
               OR (p_params ->> 'positions') !~ '^[0-9]{1,6}$'
               OR (p_params ->> 'positions')::INTEGER > 100000 THEN
                RETURN jsonb_build_object('error', 'invalid_params');
            END IF;
            v_count := (p_params ->> 'positions')::INTEGER;
        END IF;

        IF p_stage = 'prepare' THEN
            RETURN jsonb_build_object(
                'params', jsonb_build_object('reason', v_reason, 'status', v_decision, 'positions', v_count),
                'body', NULL,
                'summary', 'profile ' || v_reason || ' ' || v_decision,
                'confirm', FALSE);
        END IF;

        INSERT INTO public.profile_exclusions (user_id, reason, status, positions_at_decision, decided_at)
        VALUES (p_uid, v_reason, v_decision, v_count, now())
        ON CONFLICT (user_id, reason) DO UPDATE
            SET status = EXCLUDED.status,
                positions_at_decision = EXCLUDED.positions_at_decision,
                decided_at = EXCLUDED.decided_at;
        RETURN jsonb_build_object('status', 'done');
    END IF;

    -- A position: the user's decision to exclude it, or to take the exclusion back.
    IF jsonb_typeof(p_params -> 'legacy_id') IS DISTINCT FROM 'number'
       OR (p_params ->> 'legacy_id') !~ '^[1-9][0-9]{0,9}$'
       OR (p_params ->> 'legacy_id')::BIGINT > 2147483647 THEN
        RETURN jsonb_build_object('error', 'invalid_params');
    END IF;
    v_legacy := (p_params ->> 'legacy_id')::INTEGER;

    IF p_action = 'exclusion.decide' THEN
        IF v_keys <> ARRAY['legacy_id', 'reason'] OR jsonb_typeof(p_params -> 'reason') IS DISTINCT FROM 'string' THEN
            RETURN jsonb_build_object('error', 'invalid_params');
        END IF;
        v_reason := p_params ->> 'reason';
        IF v_reason NOT IN ('too_senior', 'too_junior', 'wrong_location', 'salary_low', 'wrong_stack',
                            'company', 'scam_or_gone', 'closed', 'already_applied', 'other') THEN
            RETURN jsonb_build_object('error', 'invalid_params');
        END IF;
        v_note := NULLIF(btrim(COALESCE(p_body, '')), '');
        IF v_note IS NOT NULL AND char_length(v_note) > 200 THEN
            RETURN jsonb_build_object('error', 'invalid_params');
        END IF;
    ELSE
        IF v_keys <> ARRAY['legacy_id'] OR p_body IS NOT NULL THEN
            RETURN jsonb_build_object('error', 'invalid_params');
        END IF;
    END IF;

    -- The position, read at both stages (at the effect again, and locked: it may have changed).
    SELECT p.id, p.status, p.user_excluded_prev_status, p.user_excluded_at
      INTO v_pos_id, v_status, v_prev, v_excl_at
      FROM public.positions AS p
     WHERE p.user_id = p_uid AND p.legacy_id = v_legacy
       FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('error', 'not_found');
    END IF;
    -- An application that already left is not excluded: the same order as the gate
    -- (shared/cloud/apply-request-rule.json, post_submission_states) and as web_door.ext_position.
    -- Refused here with the code of the contract, instead of failing on the trigger of 081.
    IF p_action = 'exclusion.decide' THEN
        SELECT COALESCE(bool_or(a.applied), FALSE) INTO v_applied
          FROM public.applications AS a
         WHERE a.position_id = v_pos_id AND a.user_id = p_uid AND a.deleted_at IS NULL;
        IF v_applied OR v_status IN ('applied', 'response') THEN
            RETURN jsonb_build_object('error', 'already_submitted');
        END IF;
    END IF;

    IF p_stage = 'prepare' THEN
        RETURN jsonb_build_object(
            'params', CASE WHEN p_action = 'exclusion.decide'
                           THEN jsonb_build_object('legacy_id', v_legacy, 'reason', v_reason)
                           ELSE jsonb_build_object('legacy_id', v_legacy) END,
            'body', v_note,
            'summary', CASE WHEN p_action = 'exclusion.decide'
                            THEN 'exclude #' || v_legacy || ' ' || v_reason
                            ELSE 'withdraw exclusion #' || v_legacy END,
            'confirm', FALSE);
    END IF;

    -- effect: the position read above, locked, as it is now.
    IF p_action = 'exclusion.decide' THEN
        -- The status before the user's exclusion is kept only once: a second exclusion keeps the first.
        UPDATE public.positions
           SET status = 'excluded',
               user_excluded_reason = v_reason,
               user_excluded_note = v_note,
               user_excluded_at = now(),
               user_excluded_prev_status = CASE WHEN v_status = 'excluded'
                                                THEN COALESCE(v_prev, 'scored') ELSE v_status END,
               last_actor = 'user'
         WHERE user_id = p_uid AND legacy_id = v_legacy;
    ELSIF v_excl_at IS NOT NULL THEN
        UPDATE public.positions
           SET status = COALESCE(v_prev, 'scored'),
               user_excluded_reason = NULL,
               user_excluded_note = NULL,
               user_excluded_at = NULL,
               user_excluded_prev_status = NULL,
               last_actor = 'user'
         WHERE user_id = p_uid AND legacy_id = v_legacy;
    END IF;
    -- Withdrawing what the user never excluded changes nothing: an exclusion of the team stays.
    RETURN jsonb_build_object('status', 'done');
END;
$$;

REVOKE ALL ON FUNCTION web_door.ext_exclusion(TEXT, TEXT, UUID, JSONB, TEXT, UUID)
    FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- 6. The family «directive»
-- ---------------------------------------------------------------------------------------------
--
-- Creating and editing are L2 with the confirmation of the door: the summary shows the beginning of the
-- text, and the effect writes the text saved at the first call (the door passes it, not the caller). Archiving is L1. The effect does what
-- 079 did, in the same transaction: the row, the wake-up event of the Captain ([TEAM-DIRECTIVE] <verb>,
-- whose text the Captain never executes: it reads the board again, fenced), and the chat request.
-- Archiving marks the directive `web` too: the box tells the user of every change that does not come
-- from the desktop (W7), and an order of the app archived from the website, L1 and without a
-- confirmation, is such a change.

-- One line of plain text for the summary of the log, which the website and the desktop show the user:
-- the same rule as flatten_to_one_line of shared/skills/external_content.py, with its list. Removed with
-- no space (they are not letters, and a space would split a word): the bidi embeddings, overrides and
-- isolates, the zero-width space, word joiner and ZWNBSP, the soft hyphen, the interlinear annotations
-- and the tag characters (an ASCII sentence nobody sees). A space for the control characters and the
-- line and paragraph separators U+2028/U+2029. Kept: ZWNJ, ZWJ, LRM, RLM and ALM, letters of a script
-- and marks of direction that rewrite nothing. Spaces in a row become one. The ranges are written out,
-- not [[:cntrl:]]: under the C collation that class stops at U+007F. A test runs both on every control
-- and format character and on the two separators, and wants the same text.
CREATE OR REPLACE FUNCTION web_door.one_line(p_text TEXT, p_max INTEGER)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
    SELECT left(btrim(regexp_replace(regexp_replace(regexp_replace(COALESCE(p_text, ''),
               '[\u00AD\u200B\u2060\uFEFF\u202A-\u202E\u2066-\u2069\uFFF9-\uFFFB\U000E0000-\U000E007F]', '', 'g'),
               '[\u0001-\u001F\u007F-\u009F\u2028\u2029]', ' ', 'g'),
               ' {2,}', ' ', 'g')), GREATEST(p_max, 0));
$$;

REVOKE ALL ON FUNCTION web_door.one_line(TEXT, INTEGER) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION web_door.ext_directive(
    p_stage   TEXT,
    p_action  TEXT,
    p_uid     UUID,
    p_params  JSONB,
    p_body    TEXT,
    p_log_id  UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_keys       TEXT[];
    v_kind       TEXT;
    v_id         BIGINT;
    v_text       TEXT;
    v_verb       TEXT;
    v_source_id  TEXT;
    v_legacy_id  BIGINT;
    v_changed    INTEGER;
BEGIN
    IF p_uid IS NULL OR p_action IS NULL OR p_action NOT IN ('directive.create', 'directive.update', 'directive.archive') THEN
        RAISE EXCEPTION 'web_door.ext_directive: not an action of this family: %', p_action;
    END IF;
    IF p_stage IS NULL OR p_stage NOT IN ('prepare', 'effect')
       OR (p_stage = 'effect' AND p_log_id IS NULL) THEN
        RAISE EXCEPTION 'web_door.ext_directive: bad stage %', p_stage;
    END IF;

    IF p_params IS NULL OR jsonb_typeof(p_params) <> 'object' THEN
        RETURN jsonb_build_object('error', 'invalid_params');
    END IF;
    SELECT COALESCE(array_agg(k ORDER BY k), '{}') INTO v_keys FROM jsonb_object_keys(p_params) AS k;

    IF p_action = 'directive.create' THEN
        IF v_keys <> ARRAY['kind'] OR jsonb_typeof(p_params -> 'kind') IS DISTINCT FROM 'string' THEN
            RETURN jsonb_build_object('error', 'invalid_params');
        END IF;
        v_kind := p_params ->> 'kind';
        IF v_kind NOT IN ('order', 'strategy', 'formation', 'note') THEN
            RETURN jsonb_build_object('error', 'invalid_params');
        END IF;
    ELSE
        IF v_keys <> ARRAY['id'] OR jsonb_typeof(p_params -> 'id') IS DISTINCT FROM 'number'
           OR (p_params ->> 'id') !~ '^[1-9][0-9]{0,17}$' THEN
            RETURN jsonb_build_object('error', 'invalid_params');
        END IF;
        v_id := (p_params ->> 'id')::BIGINT;
    END IF;

    IF p_action = 'directive.archive' THEN
        IF p_body IS NOT NULL THEN
            RETURN jsonb_build_object('error', 'invalid_params');
        END IF;
    ELSE
        v_text := btrim(COALESCE(p_body, ''));
        IF v_text = '' OR char_length(v_text) > 2000 THEN
            RETURN jsonb_build_object('error', 'invalid_params');
        END IF;
    END IF;

    IF p_action <> 'directive.create' THEN
        PERFORM 1 FROM public.team_directives AS d
         WHERE d.id = v_id AND d.user_id = p_uid AND d.status = 'active'
           FOR UPDATE;
        IF NOT FOUND THEN
            RETURN jsonb_build_object('error', 'not_found');
        END IF;
    END IF;

    IF p_stage = 'prepare' THEN
        RETURN jsonb_build_object(
            'params', CASE WHEN p_action = 'directive.create'
                           THEN jsonb_build_object('kind', v_kind)
                           ELSE jsonb_build_object('id', v_id) END,
            'body', v_text,
            'summary', CASE p_action
                           WHEN 'directive.create'  THEN v_kind || ': ' || web_door.one_line(v_text, 180)
                           WHEN 'directive.update'  THEN '#' || v_id || ': ' || web_door.one_line(v_text, 180)
                           ELSE 'archive #' || v_id END,
            'confirm', p_action <> 'directive.archive');
    END IF;

    -- effect
    v_source_id := 'team-directive:' || p_log_id::TEXT;
    IF p_action = 'directive.create' THEN
        v_verb := 'created';
        INSERT INTO public.team_directives (user_id, body, kind, status, created_by, source_id, origin)
        VALUES (p_uid, v_text, v_kind, 'active', 'user', v_source_id, 'web')
        RETURNING id INTO v_id;
    ELSIF p_action = 'directive.update' THEN
        v_verb := 'edited';
        UPDATE public.team_directives
           SET body = v_text, origin = 'web', updated_at = now()
         WHERE id = v_id AND user_id = p_uid AND status = 'active';
        GET DIAGNOSTICS v_changed = ROW_COUNT;
        IF v_changed <> 1 THEN
            RETURN jsonb_build_object('error', 'not_found');
        END IF;
    ELSE
        v_verb := 'archived';
        UPDATE public.team_directives
           SET status = 'archived', archived_at = now(), origin = 'web', updated_at = now()
         WHERE id = v_id AND user_id = p_uid AND status = 'active';
        GET DIAGNOSTICS v_changed = ROW_COUNT;
        IF v_changed <> 1 THEN
            RETURN jsonb_build_object('error', 'not_found');
        END IF;
    END IF;

    -- The wake-up event of the Captain, as in 079: the negative legacy id is the timestamp encoding of
    -- the cloud chat, and the lock per user keeps two events of the same millisecond apart.
    PERFORM pg_advisory_xact_lock(hashtextextended(p_uid::TEXT, 0));
    SELECT LEAST(
        -floor(date_part('epoch', clock_timestamp()) * 1000)::BIGINT,
        COALESCE(min(m.legacy_id) - 1, -floor(date_part('epoch', clock_timestamp()) * 1000)::BIGINT))
      INTO v_legacy_id
      FROM public.pending_user_messages AS m
     WHERE m.user_id = p_uid AND m.legacy_id < 0;

    INSERT INTO public.pending_user_messages (
        user_id, legacy_id, agent, body, kind, author, source_id, source_action,
        source_payload, source_directive_id, created_at)
    VALUES (
        p_uid, v_legacy_id, 'capitano', '[TEAM-DIRECTIVE] ' || v_verb, 'notification', 'user',
        v_source_id, v_verb, v_text, v_id, now());

    INSERT INTO public.team_state (user_id, chat_requested_at)
    VALUES (p_uid, now())
    ON CONFLICT (user_id) DO UPDATE SET chat_requested_at = EXCLUDED.chat_requested_at;

    RETURN jsonb_build_object('status', 'done');
END;
$$;

REVOKE ALL ON FUNCTION web_door.ext_directive(TEXT, TEXT, UUID, JSONB, TEXT, UUID)
    FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- 7. Fail the migration if the boundary is not there
-- ---------------------------------------------------------------------------------------------

DO $$
DECLARE
    r TEXT;
    p TEXT;
BEGIN
    IF (SELECT count(*) FROM web_door.vocab
         WHERE (action, family) IN (('exclusion.decide', 'exclusion'), ('exclusion.withdraw', 'exclusion'),
                                    ('exclusion.profile_set', 'exclusion'), ('directive.create', 'directive'),
                                    ('directive.update', 'directive'), ('directive.archive', 'directive'))) <> 6 THEN
        RAISE EXCEPTION '101: the vocabulary of phase 4 is incomplete';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger
                    WHERE tgname = 'trg_positions_guard_user_exclusion'
                      AND tgrelid = 'public.positions'::regclass) THEN
        RAISE EXCEPTION '101: the guard of the user''s exclusion is missing';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = 'team_directives' AND column_name = 'origin') THEN
        RAISE EXCEPTION '101: team_directives.origin is missing';
    END IF;
    IF web_door.one_line('a' || U&'\202E' || 'b' || U&'\2028' || 'c', 10) IS DISTINCT FROM 'ab c' THEN
        RAISE EXCEPTION '101: the summary of a standing order would keep a bidi override or a line separator';
    END IF;
    FOREACH r IN ARRAY ARRAY['anon', 'authenticated']
    LOOP
        FOREACH p IN ARRAY ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']
        LOOP
            IF has_table_privilege(r, 'public.profile_exclusions', p)
               OR has_table_privilege(r, 'public.team_directives', p) THEN
                RAISE EXCEPTION '101: % still has % on profile_exclusions or team_directives', r, p;
            END IF;
        END LOOP;
        IF has_function_privilege(r, 'public.mutate_team_directive_with_event(bigint,text,text,text,text)', 'EXECUTE')
           OR has_function_privilege(r, 'web_door.ext_exclusion(text,text,uuid,jsonb,text,uuid)', 'EXECUTE')
           OR has_function_privilege(r, 'web_door.ext_directive(text,text,uuid,jsonb,text,uuid)', 'EXECUTE') THEN
            RAISE EXCEPTION '101: % can still execute a function that writes past the door', r;
        END IF;
    END LOOP;
END $$;
