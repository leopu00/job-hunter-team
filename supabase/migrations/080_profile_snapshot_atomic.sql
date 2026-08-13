-- Migration 080 / O-85: profile sync is one idempotent snapshot, not seven replace-all gaps.
--
-- Existing rows intentionally keep sync_hash NULL. Their first post-upgrade
-- push establishes the baseline; subsequent identical pushes perform no DML.
ALTER TABLE public.candidate_profiles
  ADD COLUMN IF NOT EXISTS sync_hash TEXT;

CREATE OR REPLACE FUNCTION public.sync_candidate_profile_atomic(
    p_user_id UUID,
    p_content_hash TEXT,
    p_snapshot JSONB
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
    current_hash TEXT;
    profile JSONB;
    list_key TEXT;
BEGIN
    IF p_user_id IS NULL THEN
        RAISE EXCEPTION 'profile_user_id_required';
    END IF;
    IF p_content_hash IS NULL
       OR p_content_hash !~ '^[0-9a-f]{64}$' THEN
        RAISE EXCEPTION 'profile_hash_invalid';
    END IF;
    IF jsonb_typeof(p_snapshot) IS DISTINCT FROM 'object'
       OR jsonb_typeof(p_snapshot->'profile') IS DISTINCT FROM 'object' THEN
        RAISE EXCEPTION 'profile_snapshot_invalid';
    END IF;
    FOREACH list_key IN ARRAY ARRAY[
        'skills', 'languages', 'experiences', 'education', 'work_auth',
        'location_preferences', 'blocks'
    ] LOOP
        IF jsonb_typeof(p_snapshot->list_key) IS DISTINCT FROM 'array' THEN
            RAISE EXCEPTION 'profile_snapshot_invalid';
        END IF;
    END LOOP;
    IF NOT p_snapshot ? 'contacts'
       OR jsonb_typeof(p_snapshot->'contacts') NOT IN ('object', 'null') THEN
        RAISE EXCEPTION 'profile_snapshot_invalid';
    END IF;

    -- The lock covers the absent-row case too. Two first pushes therefore
    -- cannot both replace the same tenant after observing sync_hash = NULL.
    PERFORM pg_advisory_xact_lock(
        hashtextextended('profile-sync:' || p_user_id::TEXT, 0)
    );
    SELECT candidate_profiles.sync_hash
      INTO current_hash
      FROM public.candidate_profiles
     WHERE candidate_profiles.user_id = p_user_id
     FOR UPDATE;
    IF FOUND AND current_hash = p_content_hash THEN
        RETURN jsonb_build_object('changed', FALSE);
    END IF;

    profile := p_snapshot->'profile';
    INSERT INTO public.candidate_profiles (
        user_id, name, email, location, birth_year, nationality,
        work_authorization, target_role, experience_months,
        experience_years, has_degree, languages, skills, seniority_target,
        job_titles, location_preferences, positioning, timezone, industry,
        schema_version, sync_hash, updated_at
    ) VALUES (
        p_user_id,
        profile->>'name',
        profile->>'email',
        profile->>'location',
        NULLIF(profile->>'birth_year', '')::INTEGER,
        profile->>'nationality',
        COALESCE(profile->'work_authorization', '[]'::JSONB),
        profile->>'target_role',
        COALESCE(NULLIF(profile->>'experience_months', '')::INTEGER, 0),
        COALESCE(NULLIF(profile->>'experience_years', '')::INTEGER, 0),
        COALESCE((profile->>'has_degree')::BOOLEAN, FALSE),
        COALESCE(profile->'languages', '[]'::JSONB),
        COALESCE(profile->'skills', '[]'::JSONB),
        profile->>'seniority_target',
        COALESCE(profile->'job_titles', '[]'::JSONB),
        COALESCE(profile->'location_preferences', '[]'::JSONB),
        COALESCE(profile->'positioning', '{}'::JSONB),
        profile->>'timezone',
        profile->>'industry',
        COALESCE(NULLIF(profile->>'schema_version', '')::SMALLINT, 1),
        p_content_hash,
        now()
    )
    ON CONFLICT (user_id) DO UPDATE SET
        name = EXCLUDED.name,
        email = EXCLUDED.email,
        location = EXCLUDED.location,
        birth_year = EXCLUDED.birth_year,
        nationality = EXCLUDED.nationality,
        work_authorization = EXCLUDED.work_authorization,
        target_role = EXCLUDED.target_role,
        experience_months = EXCLUDED.experience_months,
        experience_years = EXCLUDED.experience_years,
        has_degree = EXCLUDED.has_degree,
        languages = EXCLUDED.languages,
        skills = EXCLUDED.skills,
        seniority_target = EXCLUDED.seniority_target,
        job_titles = EXCLUDED.job_titles,
        location_preferences = EXCLUDED.location_preferences,
        positioning = EXCLUDED.positioning,
        timezone = EXCLUDED.timezone,
        industry = EXCLUDED.industry,
        schema_version = EXCLUDED.schema_version,
        sync_hash = EXCLUDED.sync_hash,
        updated_at = EXCLUDED.updated_at;

    DELETE FROM public.candidate_skills WHERE user_id = p_user_id;
    INSERT INTO public.candidate_skills (user_id, name, category, ord)
    SELECT p_user_id, row.name, row.category, row.ord
      FROM jsonb_to_recordset(p_snapshot->'skills')
           AS row(name TEXT, category TEXT, ord INTEGER);

    DELETE FROM public.candidate_languages WHERE user_id = p_user_id;
    INSERT INTO public.candidate_languages (user_id, language, level, ord)
    SELECT p_user_id, row.language, row.level, row.ord
      FROM jsonb_to_recordset(p_snapshot->'languages')
           AS row(language TEXT, level TEXT, ord INTEGER);

    DELETE FROM public.candidate_experiences WHERE user_id = p_user_id;
    INSERT INTO public.candidate_experiences (
        user_id, company, role, period, start_date, end_date, location,
        summary, ord
    )
    SELECT p_user_id, row.company, row.role, row.period, row.start_date,
           row.end_date, row.location, row.summary, row.ord
      FROM jsonb_to_recordset(p_snapshot->'experiences') AS row(
          company TEXT, role TEXT, period TEXT, start_date TEXT,
          end_date TEXT, location TEXT, summary TEXT, ord INTEGER
      );

    DELETE FROM public.candidate_education WHERE user_id = p_user_id;
    INSERT INTO public.candidate_education (
        user_id, kind, institution, degree, year, period, location, details,
        ord
    )
    SELECT p_user_id, row.kind, row.institution, row.degree, row.year,
           row.period, row.location, row.details, row.ord
      FROM jsonb_to_recordset(p_snapshot->'education') AS row(
          kind TEXT, institution TEXT, degree TEXT, year TEXT, period TEXT,
          location TEXT, details TEXT, ord INTEGER
      );

    DELETE FROM public.candidate_work_authorization
     WHERE user_id = p_user_id;
    INSERT INTO public.candidate_work_authorization (
        user_id, region, status, ord
    )
    SELECT p_user_id, row.region, row.status, row.ord
      FROM jsonb_to_recordset(p_snapshot->'work_auth')
           AS row(region TEXT, status TEXT, ord INTEGER);

    DELETE FROM public.candidate_location_preferences
     WHERE user_id = p_user_id;
    INSERT INTO public.candidate_location_preferences (user_id, value, ord)
    SELECT p_user_id, row.value, row.ord
      FROM jsonb_to_recordset(p_snapshot->'location_preferences')
           AS row(value TEXT, ord INTEGER);

    DELETE FROM public.candidate_blocks WHERE user_id = p_user_id;
    INSERT INTO public.candidate_blocks (
        user_id, key, kind, title, content, ord, source
    )
    SELECT p_user_id, row.key, row.kind, row.title, row.content, row.ord,
           row.source
      FROM jsonb_to_recordset(p_snapshot->'blocks') AS row(
          key TEXT, kind TEXT, title TEXT, content JSONB, ord INTEGER,
          source TEXT
      );

    DELETE FROM public.candidate_contacts WHERE user_id = p_user_id;
    IF jsonb_typeof(p_snapshot->'contacts') = 'object' THEN
        INSERT INTO public.candidate_contacts (
            user_id, email, phone, linkedin, github, website, address,
            updated_at
        ) VALUES (
            p_user_id,
            p_snapshot->'contacts'->>'email',
            p_snapshot->'contacts'->>'phone',
            p_snapshot->'contacts'->>'linkedin',
            p_snapshot->'contacts'->>'github',
            p_snapshot->'contacts'->>'website',
            p_snapshot->'contacts'->>'address',
            now()
        );
    END IF;

    RETURN jsonb_build_object('changed', TRUE);
END;
$$;

REVOKE ALL ON FUNCTION public.sync_candidate_profile_atomic(UUID, TEXT, JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_candidate_profile_atomic(UUID, TEXT, JSONB)
  TO service_role;
