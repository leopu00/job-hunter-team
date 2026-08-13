WITH
expected_079_columns(table_name, column_name, type_name, is_not_null) AS (
  VALUES
    ('pending_user_messages', 'source_id', 'text', false),
    ('pending_user_messages', 'source_action', 'text', false),
    ('pending_user_messages', 'source_payload', 'text', false),
    ('pending_user_messages', 'source_directive_id', 'bigint', false),
    ('team_directives', 'source_id', 'text', false)
),
expected_ledger_columns(column_name, type_name, is_not_null) AS (
  VALUES
    ('user_id', 'uuid', true),
    ('request_id', 'text', true),
    ('action', 'text', true),
    ('target_id', 'bigint', true),
    ('payload', 'text', false),
    ('kind', 'text', false),
    ('result', 'jsonb', false)
),
expected_state_columns(column_name, type_name, is_not_null, has_default) AS (
  VALUES
    ('user_id', 'uuid', true, false),
    ('content_hash', 'text', true, false),
    ('updated_at', 'timestamp with time zone', true, true)
),
expected_tenant_fks(
  constraint_name, child_table, child_columns, parent_table, parent_columns,
  delete_action, delete_set_columns
) AS (
  VALUES
    (
      'positions_company_tenant_fkey', 'positions',
      ARRAY['user_id', 'company_id']::text[], 'companies',
      ARRAY['user_id', 'id']::text[], 'a', NULL::text[]
    ),
    (
      'scores_position_tenant_fkey', 'scores',
      ARRAY['user_id', 'position_id']::text[], 'positions',
      ARRAY['user_id', 'id']::text[], 'c', NULL::text[]
    ),
    (
      'applications_position_tenant_fkey', 'applications',
      ARRAY['user_id', 'position_id']::text[], 'positions',
      ARRAY['user_id', 'id']::text[], 'c', NULL::text[]
    ),
    (
      'position_highlights_position_tenant_fkey', 'position_highlights',
      ARRAY['user_id', 'position_id']::text[], 'positions',
      ARRAY['user_id', 'id']::text[], 'c', NULL::text[]
    ),
    (
      'position_views_position_tenant_fkey', 'position_views',
      ARRAY['user_id', 'position_id']::text[], 'positions',
      ARRAY['user_id', 'id']::text[], 'c', NULL::text[]
    ),
    (
      'position_user_notes_position_tenant_fkey', 'position_user_notes',
      ARRAY['user_id', 'position_id']::text[], 'positions',
      ARRAY['user_id', 'id']::text[], 'c', NULL::text[]
    ),
    (
      'pending_user_messages_position_tenant_fkey', 'pending_user_messages',
      ARRAY['user_id', 'related_position_id']::text[], 'positions',
      ARRAY['user_id', 'id']::text[], 'n', ARRAY['related_position_id']::text[]
    )
),
expected_user_settings_columns(
  column_name, type_name, is_not_null, has_default, default_expression
) AS (
  VALUES
    ('user_id', 'uuid', true, false, NULL::text),
    ('theme', 'text', true, false, NULL::text),
    ('updated_at', 'timestamp with time zone', true, true, 'now()')
),
expected_team_directive_policies(
  policy_name, policy_command, using_expression, check_expression
) AS (
  VALUES
    (
      'users insert own team directives', 'a', NULL::text,
      '(( SELECT auth.uid() AS uid) = user_id)'
    ),
    (
      'users select own team directives', 'r',
      '(( SELECT auth.uid() AS uid) = user_id)', NULL::text
    ),
    (
      'users update own team directives', 'w',
      '(( SELECT auth.uid() AS uid) = user_id)',
      '(( SELECT auth.uid() AS uid) = user_id)'
    )
),
expected_pending_message_policies(
  policy_name, policy_command, role_name, using_expression, check_expression
) AS (
  VALUES
    (
      'Users can insert own chat turns', 'a', 'authenticated', NULL::text,
      '((( SELECT auth.uid() AS uid) = user_id) AND (author = ''user''::text) AND (legacy_id < 0))'
    ),
    (
      'Users can update own pending messages', 'w', 'PUBLIC',
      '(( SELECT auth.uid() AS uid) = user_id)',
      '(( SELECT auth.uid() AS uid) = user_id)'
    ),
    (
      'Users can view own pending messages', 'r', 'PUBLIC',
      '(( SELECT auth.uid() AS uid) = user_id)', NULL::text
    )
),
directive_rpc AS (
  SELECT procedure.*
  FROM pg_catalog.pg_proc AS procedure
  JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.oid = procedure.pronamespace
  WHERE namespace.nspname = 'public'
    AND procedure.proname = 'mutate_team_directive_with_event'
    AND procedure.pronargs = 5
    AND procedure.proargtypes[0] = 'bigint'::pg_catalog.regtype
    AND procedure.proargtypes[1] = 'text'::pg_catalog.regtype
    AND procedure.proargtypes[2] = 'text'::pg_catalog.regtype
    AND procedure.proargtypes[3] = 'text'::pg_catalog.regtype
    AND procedure.proargtypes[4] = 'text'::pg_catalog.regtype
),
profile_rpc AS (
  SELECT procedure.*
  FROM pg_catalog.pg_proc AS procedure
  JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.oid = procedure.pronamespace
  WHERE namespace.nspname = 'public'
    AND procedure.proname = 'sync_candidate_profile_atomic'
    AND procedure.pronargs = 4
    AND procedure.proargtypes[0] = 'uuid'::pg_catalog.regtype
    AND procedure.proargtypes[1] = 'text'::pg_catalog.regtype
    AND procedure.proargtypes[2] = 'jsonb'::pg_catalog.regtype
    AND procedure.proargtypes[3] = 'boolean'::pg_catalog.regtype
),
sync_applications_rpc AS (
  SELECT procedure.*
  FROM pg_catalog.pg_proc AS procedure
  JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.oid = procedure.pronamespace
  WHERE namespace.nspname = 'public'
    AND procedure.proname = 'sync_upsert_applications'
),
mark_applied_rpc AS (
  SELECT procedure.*
  FROM pg_catalog.pg_proc AS procedure
  JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.oid = procedure.pronamespace
  WHERE namespace.nspname = 'public'
    AND procedure.proname = 'mark_position_applied'
),
undo_application_rpc AS (
  SELECT procedure.*
  FROM pg_catalog.pg_proc AS procedure
  JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.oid = procedure.pronamespace
  WHERE namespace.nspname = 'public'
    AND procedure.proname = 'undo_manual_position_application'
),
expected_081_functions(
  check_id, function_name, argument_types, argument_names, all_argument_types,
  argument_modes, input_count, return_type, security_definer, search_path_config,
  extra_acl_grantees, body_md5
) AS (
  VALUES
    (
      '081.cleanup.definition', 'cleanup_pairing_sessions', '',
      '{expired_count,deleted_count}', '{23,23}', '{t,t}', 0, 'record', true,
      ARRAY['search_path=public, pg_temp']::text[],
      ARRAY['service_role']::text[],
      '04c821c3cb523f9bee8a34cb913cf5f1'
    ),
    (
      '081.delete_account.definition', 'delete_account_data', '2950',
      '{p_user_id}', 'NULL', 'NULL', 1, 'jsonb', true,
      ARRAY['search_path=""']::text[], ARRAY['service_role']::text[],
      'e15b8fdbb13be61468df65132492fb99'
    ),
    (
      '081.redeem_pairing.definition', 'redeem_cloud_sync_pairing', '25',
      '{p_device_code,status,approved_token,user_id,approved_token_id,token_name}',
      '{25,25,25,2950,2950,25}', '{i,t,t,t,t,t}', 1, 'record', true,
      ARRAY['search_path=public, pg_temp']::text[],
      ARRAY['service_role']::text[],
      '83caf7dda57d33565c9da3ec44a54a4a'
    ),
    (
      '081.reject_stale_applied.definition',
      'reject_stale_applied_position_downgrade', '', 'NULL', 'NULL', 'NULL',
      0, 'trigger', false,
      ARRAY['search_path=public, pg_temp']::text[],
      ARRAY['PUBLIC', 'anon', 'authenticated', 'service_role']::text[],
      'f9f359fcd3903e40a6c0c6f545b2a8b6'
    ),
    (
      '081.sync_confirm.definition', 'sync_confirm_positions_applied',
      '2950 1007', '{p_user_id,p_position_legacy_ids}', 'NULL', 'NULL', 2,
      'integer', false,
      ARRAY['search_path=public, pg_temp']::text[],
      ARRAY['service_role']::text[], 'a3a57546231170b2ba31e28220123161'
    ),
    (
      '081.team_state_stamp.definition', 'team_state_stamp_cloud_push_check', '',
      'NULL', 'NULL', 'NULL', 0, 'trigger', false,
      ARRAY['search_path=pg_catalog, public']::text[],
      ARRAY['service_role']::text[],
      '43529b967d2c16f4ca23e96e653ddf54'
    )
),
checks(check_id, ok) AS (
  VALUES
    (
      '078.positions.write_request_kind.column',
      COALESCE((
        SELECT pg_catalog.count(*) = 1
        FROM pg_catalog.pg_attribute AS attribute
        WHERE attribute.attrelid = pg_catalog.to_regclass('public.positions')
          AND attribute.attname = 'write_request_kind'
          AND NOT attribute.attisdropped
          AND NOT attribute.attnotnull
          AND pg_catalog.format_type(attribute.atttypid, attribute.atttypmod) = 'text'
      ), false)
    ),
    (
      '078.positions.write_request_kind.constraint',
      COALESCE((
        SELECT pg_catalog.count(*) = 1
          AND pg_catalog.bool_and(constraint_row.convalidated)
          AND pg_catalog.bool_and(
            pg_catalog.strpos(
              pg_catalog.pg_get_constraintdef(constraint_row.oid),
              'write_request_kind'
            ) > 0
            AND pg_catalog.strpos(
              pg_catalog.pg_get_constraintdef(constraint_row.oid), '''cv'''
            ) > 0
            AND pg_catalog.strpos(
              pg_catalog.pg_get_constraintdef(constraint_row.oid),
              '''cover_letter'''
            ) > 0
            AND pg_catalog.strpos(
              pg_catalog.pg_get_constraintdef(constraint_row.oid), 'IS NULL'
            ) > 0
            AND (
              SELECT pg_catalog.array_agg(
                literal.value[1] ORDER BY literal.value[1]
              )
              FROM pg_catalog.regexp_matches(
                pg_catalog.pg_get_constraintdef(constraint_row.oid),
                '''([^'']+)''',
                'g'
              ) AS literal(value)
            ) = ARRAY['cover_letter', 'cv']::text[]
          )
        FROM pg_catalog.pg_constraint AS constraint_row
        WHERE constraint_row.conrelid = pg_catalog.to_regclass('public.positions')
          AND constraint_row.conname = 'positions_write_request_kind_check'
          AND constraint_row.contype = 'c'
      ), false)
    ),
    (
      '079.event_columns.shape',
      COALESCE((
        SELECT pg_catalog.count(*) = 5
        FROM expected_079_columns AS expected
        JOIN pg_catalog.pg_attribute AS attribute
          ON attribute.attrelid = pg_catalog.to_regclass(
            'public.' || expected.table_name
          )
          AND attribute.attname = expected.column_name
          AND NOT attribute.attisdropped
          AND attribute.attnotnull = expected.is_not_null
          AND pg_catalog.format_type(attribute.atttypid, attribute.atttypmod) =
            expected.type_name
      ), false)
    ),
    (
      '079.team_directives.source_index',
      COALESCE((
        SELECT pg_catalog.count(*) = 1
          AND pg_catalog.bool_and(index_row.indisunique)
          AND pg_catalog.bool_and(index_row.indisvalid)
          AND pg_catalog.bool_and(index_row.indpred IS NULL)
          AND pg_catalog.bool_and(index_row.indexprs IS NULL)
          AND pg_catalog.bool_and(index_row.indnkeyatts = 2)
          AND pg_catalog.bool_and((
            SELECT pg_catalog.array_agg(
              attribute.attname::text ORDER BY key_row.ordinality
            )
            FROM pg_catalog.unnest(index_row.indkey::smallint[])
              WITH ORDINALITY AS key_row(attnum, ordinality)
            JOIN pg_catalog.pg_attribute AS attribute
              ON attribute.attrelid = index_row.indrelid
              AND attribute.attnum = key_row.attnum
            WHERE key_row.ordinality <= index_row.indnkeyatts
          ) = ARRAY['user_id', 'source_id']::text[])
        FROM pg_catalog.pg_index AS index_row
        JOIN pg_catalog.pg_class AS index_class
          ON index_class.oid = index_row.indexrelid
        WHERE index_class.relname = 'team_directives_source_id_unique'
          AND index_row.indrelid = pg_catalog.to_regclass('public.team_directives')
      ), false)
    ),
    (
      '079.pending_messages.source_index',
      COALESCE((
        SELECT pg_catalog.count(*) = 1
          AND pg_catalog.bool_and(index_row.indisunique)
          AND pg_catalog.bool_and(index_row.indisvalid)
          AND pg_catalog.bool_and(index_row.indpred IS NULL)
          AND pg_catalog.bool_and(index_row.indexprs IS NULL)
          AND pg_catalog.bool_and(index_row.indnkeyatts = 2)
          AND pg_catalog.bool_and((
            SELECT pg_catalog.array_agg(
              attribute.attname::text ORDER BY key_row.ordinality
            )
            FROM pg_catalog.unnest(index_row.indkey::smallint[])
              WITH ORDINALITY AS key_row(attnum, ordinality)
            JOIN pg_catalog.pg_attribute AS attribute
              ON attribute.attrelid = index_row.indrelid
              AND attribute.attnum = key_row.attnum
            WHERE key_row.ordinality <= index_row.indnkeyatts
          ) = ARRAY['user_id', 'source_id']::text[])
        FROM pg_catalog.pg_index AS index_row
        JOIN pg_catalog.pg_class AS index_class
          ON index_class.oid = index_row.indexrelid
        WHERE index_class.relname = 'pending_user_messages_source_id_unique'
          AND index_row.indrelid =
            pg_catalog.to_regclass('public.pending_user_messages')
      ), false)
    ),
    (
      '079.request_ledger.columns',
      COALESCE((
        SELECT pg_catalog.count(*) = 7
        FROM expected_ledger_columns AS expected
        JOIN pg_catalog.pg_attribute AS attribute
          ON attribute.attrelid =
            pg_catalog.to_regclass('public.team_directive_request_ledger')
          AND attribute.attname = expected.column_name
          AND NOT attribute.attisdropped
          AND attribute.attnotnull = expected.is_not_null
          AND pg_catalog.format_type(attribute.atttypid, attribute.atttypmod) =
            expected.type_name
      ), false)
    ),
    (
      '079.request_ledger.primary_key',
      COALESCE((
        SELECT pg_catalog.count(*) = 1
          AND pg_catalog.bool_and((
            SELECT pg_catalog.array_agg(
              attribute.attname::text ORDER BY key_row.ordinality
            )
            FROM pg_catalog.unnest(constraint_row.conkey)
              WITH ORDINALITY AS key_row(attnum, ordinality)
            JOIN pg_catalog.pg_attribute AS attribute
              ON attribute.attrelid = constraint_row.conrelid
              AND attribute.attnum = key_row.attnum
          ) = ARRAY['user_id', 'request_id']::text[])
        FROM pg_catalog.pg_constraint AS constraint_row
        WHERE constraint_row.conrelid =
            pg_catalog.to_regclass('public.team_directive_request_ledger')
          AND constraint_row.contype = 'p'
      ), false)
    ),
    (
      '079.request_ledger.user_fk',
      COALESCE((
        SELECT pg_catalog.count(*) = 1
          AND pg_catalog.bool_and(
            constraint_row.confrelid = pg_catalog.to_regclass('auth.users')
          )
          AND pg_catalog.bool_and(constraint_row.confdeltype = 'c')
          AND pg_catalog.bool_and((
            SELECT pg_catalog.array_agg(
              attribute.attname::text ORDER BY key_row.ordinality
            )
            FROM pg_catalog.unnest(constraint_row.conkey)
              WITH ORDINALITY AS key_row(attnum, ordinality)
            JOIN pg_catalog.pg_attribute AS attribute
              ON attribute.attrelid = constraint_row.conrelid
              AND attribute.attnum = key_row.attnum
          ) = ARRAY['user_id']::text[])
        FROM pg_catalog.pg_constraint AS constraint_row
        WHERE constraint_row.conrelid =
            pg_catalog.to_regclass('public.team_directive_request_ledger')
          AND constraint_row.conname = 'team_directive_request_ledger_user_id_fkey'
          AND constraint_row.contype = 'f'
      ), false)
    ),
    (
      '079.request_ledger.rls',
      COALESCE((
        SELECT pg_catalog.count(*) = 1
          AND pg_catalog.bool_and(table_row.relrowsecurity)
        FROM pg_catalog.pg_class AS table_row
        WHERE table_row.oid =
          pg_catalog.to_regclass('public.team_directive_request_ledger')
      ), false)
    ),
    (
      '079.request_ledger.acl',
      COALESCE(
        pg_catalog.has_table_privilege(
          'service_role',
          pg_catalog.to_regclass('public.team_directive_request_ledger'),
          'SELECT'
        )
        AND NOT pg_catalog.has_table_privilege(
          'service_role',
          pg_catalog.to_regclass('public.team_directive_request_ledger'),
          'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
        )
        AND NOT pg_catalog.has_table_privilege(
          'anon',
          pg_catalog.to_regclass('public.team_directive_request_ledger'),
          'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
        )
        AND NOT pg_catalog.has_table_privilege(
          'authenticated',
          pg_catalog.to_regclass('public.team_directive_request_ledger'),
          'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
        ),
        false
      )
    ),
    (
      '079.team_directives.mutation_acl',
      COALESCE(
        NOT pg_catalog.has_table_privilege(
          'anon', pg_catalog.to_regclass('public.team_directives'),
          'INSERT,UPDATE,DELETE'
        )
        AND NOT pg_catalog.has_table_privilege(
          'authenticated', pg_catalog.to_regclass('public.team_directives'),
          'INSERT,UPDATE,DELETE'
        ),
        false
      )
    ),
    (
      '079.pending_messages.column_acl',
      COALESCE((
        SELECT pg_catalog.bool_and(
          pg_catalog.has_column_privilege(
            'authenticated', attribute.attrelid, attribute.attname, 'INSERT'
          ) = (attribute.attname = ANY (ARRAY[
            'user_id', 'legacy_id', 'agent', 'body', 'kind', 'author',
            'delivered_via', 'acknowledged_at', 'created_at'
          ]::text[]))
          AND pg_catalog.has_column_privilege(
            'authenticated', attribute.attrelid, attribute.attname, 'UPDATE'
          ) = (attribute.attname = ANY (ARRAY[
            'delivered_at', 'acknowledged_at', 'user_reply', 'user_reply_at'
          ]::text[]))
        )
        FROM pg_catalog.pg_attribute AS attribute
        WHERE attribute.attrelid =
            pg_catalog.to_regclass('public.pending_user_messages')
          AND attribute.attnum > 0
          AND NOT attribute.attisdropped
      ), false)
      AND COALESCE((
        SELECT table_row.relkind = 'r'
          AND table_row.relrowsecurity
          AND NOT table_row.relforcerowsecurity
        FROM pg_catalog.pg_class AS table_row
        WHERE table_row.oid =
          pg_catalog.to_regclass('public.pending_user_messages')
      ), false)
      AND COALESCE((
        SELECT pg_catalog.count(*) = 3
          AND (
            SELECT pg_catalog.count(*) = 3
            FROM pg_catalog.pg_policy AS actual
            WHERE actual.polrelid =
              pg_catalog.to_regclass('public.pending_user_messages')
          )
          AND pg_catalog.bool_and(policy_row.polpermissive)
          AND pg_catalog.bool_and(
            policy_row.polcmd = expected.policy_command::"char"
          )
          AND pg_catalog.bool_and(
            policy_row.polroles = CASE
              WHEN expected.role_name = 'PUBLIC' THEN ARRAY[0::oid]
              ELSE ARRAY[pg_catalog.to_regrole(expected.role_name)::oid]
            END
          )
          AND pg_catalog.bool_and(
            pg_catalog.pg_get_expr(
              policy_row.polqual, policy_row.polrelid
            ) = expected.using_expression
            OR (
              policy_row.polqual IS NULL
              AND expected.using_expression IS NULL
            )
          )
          AND pg_catalog.bool_and(
            pg_catalog.pg_get_expr(
              policy_row.polwithcheck, policy_row.polrelid
            ) = expected.check_expression
            OR (
              policy_row.polwithcheck IS NULL
              AND expected.check_expression IS NULL
            )
          )
        FROM expected_pending_message_policies AS expected
        JOIN pg_catalog.pg_policy AS policy_row
          ON policy_row.polrelid =
            pg_catalog.to_regclass('public.pending_user_messages')
          AND policy_row.polname = expected.policy_name
      ), false)
    ),
    (
      '079.directive_rpc.signature',
      COALESCE((
        SELECT pg_catalog.count(*) = 1
          AND pg_catalog.bool_and(
            procedure.proargnames =
              ARRAY['p_id', 'p_action', 'p_body', 'p_kind', 'p_request_id']::text[]
          )
          AND pg_catalog.bool_and(procedure.prorettype = 'jsonb'::pg_catalog.regtype)
          AND pg_catalog.bool_and(procedure.pronargdefaults = 0)
        FROM directive_rpc AS procedure
      ), false)
    ),
    (
      '079.directive_rpc.definition',
      COALESCE((
        SELECT pg_catalog.count(*) = 1
          AND pg_catalog.bool_and(procedure.prokind = 'f')
          AND pg_catalog.bool_and(procedure.provolatile = 'v')
          AND pg_catalog.bool_and(
            procedure.prolang = (
              SELECT language.oid
              FROM pg_catalog.pg_language AS language
              WHERE language.lanname = 'plpgsql'
            )
          )
          AND pg_catalog.bool_and(
            pg_catalog.md5(procedure.prosrc) =
              'eca3361126044e9777d79b62a0d02968'
          )
        FROM directive_rpc AS procedure
      ), false)
    ),
    (
      '079.directive_rpc.security',
      COALESCE((
        SELECT pg_catalog.count(*) = 1
          AND pg_catalog.bool_and(procedure.prosecdef)
          AND pg_catalog.bool_and(EXISTS (
            SELECT 1
            FROM pg_catalog.unnest(procedure.proconfig) AS config(value)
            WHERE pg_catalog.replace(
              pg_catalog.replace(config.value, ' ', ''), '"', ''
            ) = 'search_path='
          ))
        FROM directive_rpc AS procedure
      ), false)
    ),
    (
      '079.directive_rpc.acl',
      COALESCE((
        SELECT pg_catalog.count(*) = 1
          AND pg_catalog.bool_and(
            pg_catalog.has_function_privilege(
              'authenticated', procedure.oid, 'EXECUTE'
            )
          )
          AND pg_catalog.bool_and(
            NOT pg_catalog.has_function_privilege('anon', procedure.oid, 'EXECUTE')
          )
          AND pg_catalog.bool_and(
            NOT pg_catalog.has_function_privilege(
              'service_role', procedure.oid, 'EXECUTE'
            )
          )
        FROM directive_rpc AS procedure
      ), false)
    ),
    (
      '080.sync_state.columns',
      COALESCE((
        SELECT pg_catalog.count(*) = 3
        FROM expected_state_columns AS expected
        JOIN pg_catalog.pg_attribute AS attribute
          ON attribute.attrelid =
            pg_catalog.to_regclass('public.candidate_profile_sync_state')
          AND attribute.attname = expected.column_name
          AND NOT attribute.attisdropped
          AND attribute.attnotnull = expected.is_not_null
          AND attribute.atthasdef = expected.has_default
          AND pg_catalog.format_type(attribute.atttypid, attribute.atttypmod) =
            expected.type_name
      ), false)
    ),
    (
      '080.sync_state.constraints',
      COALESCE((
        SELECT
          pg_catalog.count(*) FILTER (
            WHERE constraint_row.contype = 'p'
              AND (
                SELECT pg_catalog.array_agg(
                  attribute.attname::text ORDER BY key_row.ordinality
                )
                FROM pg_catalog.unnest(constraint_row.conkey)
                  WITH ORDINALITY AS key_row(attnum, ordinality)
                JOIN pg_catalog.pg_attribute AS attribute
                  ON attribute.attrelid = constraint_row.conrelid
                  AND attribute.attnum = key_row.attnum
              ) = ARRAY['user_id']::text[]
          ) = 1
          AND pg_catalog.count(*) FILTER (
            WHERE constraint_row.contype = 'f'
              AND constraint_row.confrelid = pg_catalog.to_regclass('auth.users')
              AND constraint_row.confdeltype = 'c'
              AND (
                SELECT pg_catalog.array_agg(
                  attribute.attname::text ORDER BY key_row.ordinality
                )
                FROM pg_catalog.unnest(constraint_row.conkey)
                  WITH ORDINALITY AS key_row(attnum, ordinality)
                JOIN pg_catalog.pg_attribute AS attribute
                  ON attribute.attrelid = constraint_row.conrelid
                  AND attribute.attnum = key_row.attnum
              ) = ARRAY['user_id']::text[]
              AND (
                SELECT pg_catalog.array_agg(
                  attribute.attname::text ORDER BY key_row.ordinality
                )
                FROM pg_catalog.unnest(constraint_row.confkey)
                  WITH ORDINALITY AS key_row(attnum, ordinality)
                JOIN pg_catalog.pg_attribute AS attribute
                  ON attribute.attrelid = constraint_row.confrelid
                  AND attribute.attnum = key_row.attnum
              ) = ARRAY['id']::text[]
          ) = 1
          AND pg_catalog.count(*) FILTER (
            WHERE constraint_row.contype = 'c'
              AND constraint_row.convalidated
              AND pg_catalog.strpos(
                pg_catalog.pg_get_constraintdef(constraint_row.oid), 'content_hash'
              ) > 0
              AND pg_catalog.strpos(
                pg_catalog.pg_get_constraintdef(constraint_row.oid), '{64}'
              ) > 0
              AND pg_catalog.strpos(
                pg_catalog.pg_get_constraintdef(constraint_row.oid),
                '^[0-9a-f]'
              ) > 0
              AND pg_catalog.strpos(
                pg_catalog.pg_get_constraintdef(constraint_row.oid), '$'
              ) > 0
          ) = 1
          AND (
            SELECT pg_catalog.count(*) = 1
            FROM pg_catalog.pg_attribute AS attribute
            JOIN pg_catalog.pg_attrdef AS default_row
              ON default_row.adrelid = attribute.attrelid
              AND default_row.adnum = attribute.attnum
            WHERE attribute.attrelid =
                pg_catalog.to_regclass('public.candidate_profile_sync_state')
              AND attribute.attname = 'updated_at'
              AND pg_catalog.strpos(
                pg_catalog.lower(
                  pg_catalog.pg_get_expr(default_row.adbin, default_row.adrelid)
                ),
                'now()'
              ) > 0
          )
        FROM pg_catalog.pg_constraint AS constraint_row
        WHERE constraint_row.conrelid =
          pg_catalog.to_regclass('public.candidate_profile_sync_state')
      ), false)
    ),
    (
      '080.sync_state.rls',
      COALESCE((
        SELECT pg_catalog.count(*) = 1
          AND pg_catalog.bool_and(table_row.relrowsecurity)
        FROM pg_catalog.pg_class AS table_row
        WHERE table_row.oid =
          pg_catalog.to_regclass('public.candidate_profile_sync_state')
      ), false)
    ),
    (
      '080.sync_state.acl',
      COALESCE(
        pg_catalog.has_table_privilege(
          'service_role',
          pg_catalog.to_regclass('public.candidate_profile_sync_state'),
          'SELECT'
        )
        AND pg_catalog.has_table_privilege(
          'service_role',
          pg_catalog.to_regclass('public.candidate_profile_sync_state'),
          'INSERT'
        )
        AND pg_catalog.has_table_privilege(
          'service_role',
          pg_catalog.to_regclass('public.candidate_profile_sync_state'),
          'UPDATE'
        )
        AND pg_catalog.has_table_privilege(
          'service_role',
          pg_catalog.to_regclass('public.candidate_profile_sync_state'),
          'DELETE'
        )
        AND NOT pg_catalog.has_table_privilege(
          'anon', pg_catalog.to_regclass('public.candidate_profile_sync_state'),
          'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
        )
        AND NOT pg_catalog.has_table_privilege(
          'authenticated',
          pg_catalog.to_regclass('public.candidate_profile_sync_state'),
          'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
        ),
        false
      )
    ),
    (
      '080.profile_rpc.signature',
      COALESCE((
        SELECT pg_catalog.count(*) = 1
          AND pg_catalog.bool_and(
            procedure.proargnames = ARRAY[
              'p_user_id', 'p_content_hash', 'p_snapshot', 'p_force'
            ]::text[]
          )
          AND pg_catalog.bool_and(procedure.prorettype = 'jsonb'::pg_catalog.regtype)
          AND pg_catalog.bool_and(procedure.pronargdefaults = 1)
          AND pg_catalog.bool_and(
            pg_catalog.strpos(
              pg_catalog.lower(
                pg_catalog.pg_get_expr(procedure.proargdefaults, 0)
              ),
              'false'
            ) > 0
          )
        FROM profile_rpc AS procedure
      ), false)
    ),
    (
      '080.profile_rpc.definition',
      COALESCE((
        SELECT pg_catalog.count(*) = 1
          AND pg_catalog.bool_and(procedure.prokind = 'f')
          AND pg_catalog.bool_and(procedure.provolatile = 'v')
          AND pg_catalog.bool_and(
            procedure.prolang = (
              SELECT language.oid
              FROM pg_catalog.pg_language AS language
              WHERE language.lanname = 'plpgsql'
            )
          )
          AND pg_catalog.bool_and(
            pg_catalog.md5(procedure.prosrc) =
              '6e2f9c1b903a26a04da57fabea075bf8'
          )
        FROM profile_rpc AS procedure
      ), false)
    ),
    (
      '080.profile_rpc.security',
      COALESCE((
        SELECT pg_catalog.count(*) = 1
          AND pg_catalog.bool_and(NOT procedure.prosecdef)
          AND pg_catalog.bool_and(EXISTS (
            SELECT 1
            FROM pg_catalog.unnest(procedure.proconfig) AS config(value)
            WHERE pg_catalog.replace(
              pg_catalog.replace(config.value, ' ', ''), '"', ''
            ) = 'search_path=public,pg_temp'
          ))
        FROM profile_rpc AS procedure
      ), false)
    ),
    (
      '080.profile_rpc.acl',
      COALESCE((
        SELECT pg_catalog.count(*) = 1
          AND pg_catalog.bool_and(
            pg_catalog.has_function_privilege(
              'service_role', procedure.oid, 'EXECUTE'
            )
          )
          AND pg_catalog.bool_and(
            NOT pg_catalog.has_function_privilege('anon', procedure.oid, 'EXECUTE')
          )
          AND pg_catalog.bool_and(
            NOT pg_catalog.has_function_privilege(
              'authenticated', procedure.oid, 'EXECUTE'
            )
          )
        FROM profile_rpc AS procedure
      ), false)
    )
), reconciliation_checks(check_id, ok) AS (
  VALUES
    (
      '081.reconciliation.present',
      COALESCE((
        SELECT table_row.relkind = 'r'
          AND table_row.relrowsecurity
          AND NOT table_row.relforcerowsecurity
          AND (
            SELECT pg_catalog.count(*) = 3
            FROM pg_catalog.pg_attribute AS attribute
            WHERE attribute.attrelid = table_row.oid
              AND attribute.attnum > 0
              AND NOT attribute.attisdropped
          )
          AND (
            SELECT pg_catalog.count(*) = 3
              AND pg_catalog.bool_and(
                pg_catalog.format_type(
                  attribute.atttypid, attribute.atttypmod
                ) = expected.type_name
                AND attribute.attnotnull = expected.is_not_null
                AND attribute.atthasdef = expected.has_default
                AND (
                  pg_catalog.pg_get_expr(
                    default_row.adbin, default_row.adrelid
                  ) = expected.default_expression
                  OR (
                    default_row.adbin IS NULL
                    AND expected.default_expression IS NULL
                  )
                )
              )
            FROM expected_user_settings_columns AS expected
            JOIN pg_catalog.pg_attribute AS attribute
              ON attribute.attrelid = table_row.oid
              AND attribute.attname = expected.column_name
              AND NOT attribute.attisdropped
            LEFT JOIN pg_catalog.pg_attrdef AS default_row
              ON default_row.adrelid = attribute.attrelid
              AND default_row.adnum = attribute.attnum
          )
          AND (
            SELECT pg_catalog.count(*) = 1
              AND pg_catalog.bool_and(constraint_row.convalidated)
              AND pg_catalog.bool_and((
                SELECT pg_catalog.array_agg(
                  attribute.attname::text ORDER BY key_row.ordinality
                )
                FROM pg_catalog.unnest(constraint_row.conkey)
                  WITH ORDINALITY AS key_row(attnum, ordinality)
                JOIN pg_catalog.pg_attribute AS attribute
                  ON attribute.attrelid = constraint_row.conrelid
                  AND attribute.attnum = key_row.attnum
              ) = ARRAY['user_id']::text[])
            FROM pg_catalog.pg_constraint AS constraint_row
            WHERE constraint_row.conrelid = table_row.oid
              AND constraint_row.contype = 'p'
          )
          AND (
            SELECT pg_catalog.count(*) = 1
              AND pg_catalog.bool_and(constraint_row.convalidated)
              AND pg_catalog.bool_and(
                constraint_row.confrelid = pg_catalog.to_regclass('auth.users')
              )
              AND pg_catalog.bool_and(constraint_row.confdeltype = 'c')
              AND pg_catalog.bool_and((
                SELECT pg_catalog.array_agg(
                  attribute.attname::text ORDER BY key_row.ordinality
                )
                FROM pg_catalog.unnest(constraint_row.conkey)
                  WITH ORDINALITY AS key_row(attnum, ordinality)
                JOIN pg_catalog.pg_attribute AS attribute
                  ON attribute.attrelid = constraint_row.conrelid
                  AND attribute.attnum = key_row.attnum
              ) = ARRAY['user_id']::text[])
              AND pg_catalog.bool_and((
                SELECT pg_catalog.array_agg(
                  attribute.attname::text ORDER BY key_row.ordinality
                )
                FROM pg_catalog.unnest(constraint_row.confkey)
                  WITH ORDINALITY AS key_row(attnum, ordinality)
                JOIN pg_catalog.pg_attribute AS attribute
                  ON attribute.attrelid = constraint_row.confrelid
                  AND attribute.attnum = key_row.attnum
              ) = ARRAY['id']::text[])
            FROM pg_catalog.pg_constraint AS constraint_row
            WHERE constraint_row.conrelid = table_row.oid
              AND constraint_row.contype = 'f'
          )
          AND (
            SELECT pg_catalog.count(*) = 1
              AND pg_catalog.bool_and(constraint_row.convalidated)
              AND pg_catalog.bool_and(
                pg_catalog.pg_get_constraintdef(constraint_row.oid) =
                  'CHECK ((theme = ANY (ARRAY[''dark''::text, ''light''::text, ''system''::text])))'
              )
            FROM pg_catalog.pg_constraint AS constraint_row
            WHERE constraint_row.conrelid = table_row.oid
              AND constraint_row.contype = 'c'
          )
          AND (
            SELECT pg_catalog.count(*) = 1
              AND pg_catalog.bool_and(trigger_row.tgenabled = 'O')
              AND pg_catalog.bool_and(NOT trigger_row.tgisinternal)
              AND pg_catalog.bool_and(trigger_row.tgtype = 19)
              AND pg_catalog.bool_and(trigger_row.tgattr::text = '')
              AND pg_catalog.bool_and(
                trigger_row.tgfoid =
                  pg_catalog.to_regprocedure('public.update_updated_at()')
              )
            FROM pg_catalog.pg_trigger AS trigger_row
            WHERE trigger_row.tgrelid = table_row.oid
              AND trigger_row.tgname = 'user_settings_updated_at'
          )
          AND (
            SELECT pg_catalog.count(*) = 1
            FROM pg_catalog.pg_policy AS policy_row
            WHERE policy_row.polrelid = table_row.oid
          )
          AND (
            SELECT pg_catalog.count(*) = 1
              AND pg_catalog.bool_and(policy_row.polpermissive)
              AND pg_catalog.bool_and(policy_row.polcmd = '*')
              AND pg_catalog.bool_and(policy_row.polroles = ARRAY[0]::oid[])
              AND pg_catalog.bool_and(
                pg_catalog.pg_get_expr(
                  policy_row.polqual, policy_row.polrelid
                ) = '(( SELECT auth.uid() AS uid) = user_id)'
              )
              AND pg_catalog.bool_and(
                pg_catalog.pg_get_expr(
                  policy_row.polwithcheck, policy_row.polrelid
                ) = '(( SELECT auth.uid() AS uid) = user_id)'
              )
            FROM pg_catalog.pg_policy AS policy_row
            WHERE policy_row.polrelid = table_row.oid
              AND policy_row.polname = 'Users manage own settings'
          )
          AND (
            SELECT pg_catalog.count(*) = 28
              AND pg_catalog.count(DISTINCT privilege.privilege_type) = 7
              AND pg_catalog.bool_and(NOT privilege.is_grantable)
              AND pg_catalog.count(*) FILTER (
                WHERE privilege.grantee = table_row.relowner
              ) = 7
              AND pg_catalog.count(*) FILTER (
                WHERE privilege.grantee = pg_catalog.to_regrole('anon')
              ) = 7
              AND pg_catalog.count(*) FILTER (
                WHERE privilege.grantee = pg_catalog.to_regrole('authenticated')
              ) = 7
              AND pg_catalog.count(*) FILTER (
                WHERE privilege.grantee = pg_catalog.to_regrole('service_role')
              ) = 7
              AND pg_catalog.count(*) FILTER (
                WHERE privilege.grantee = 0
              ) = 0
            FROM pg_catalog.aclexplode(
              COALESCE(
                table_row.relacl,
                pg_catalog.acldefault('r', table_row.relowner)
              )
            ) AS privilege
          )
        FROM pg_catalog.pg_class AS table_row
        WHERE table_row.oid = pg_catalog.to_regclass('public.user_settings')
      ), false)
    ),
    ('081.position_role_family.column', COALESCE((SELECT count(*) = 1 FROM pg_catalog.pg_attribute WHERE attrelid = pg_catalog.to_regclass('public.positions') AND attname = 'role_family' AND NOT attisdropped), false)),
    ('081.position_location.columns', COALESCE((SELECT count(*) = 10 FROM pg_catalog.pg_attribute WHERE attrelid = pg_catalog.to_regclass('public.positions') AND attname IN ('loc_city','loc_region','loc_country','loc_country_code','loc_continent','work_mode','work_country','work_country_code','is_multi_location','location_notes') AND NOT attisdropped), false)),
    (
      '081.team_directives.policies',
      COALESCE((
        SELECT pg_catalog.count(*) = 3
          AND (
            SELECT table_row.relkind = 'r'
              AND table_row.relrowsecurity
              AND NOT table_row.relforcerowsecurity
            FROM pg_catalog.pg_class AS table_row
            WHERE table_row.oid =
              pg_catalog.to_regclass('public.team_directives')
          )
          AND (
            SELECT pg_catalog.count(*) = 3
            FROM pg_catalog.pg_policy AS actual
            WHERE actual.polrelid =
              pg_catalog.to_regclass('public.team_directives')
          )
          AND pg_catalog.bool_and(policy_row.polpermissive)
          AND pg_catalog.bool_and(
            policy_row.polroles = ARRAY[0]::oid[]
          )
          AND pg_catalog.bool_and(
            policy_row.polcmd = expected.policy_command::"char"
          )
          AND pg_catalog.bool_and(
            pg_catalog.pg_get_expr(
              policy_row.polqual, policy_row.polrelid
            ) = expected.using_expression
            OR (
              policy_row.polqual IS NULL
              AND expected.using_expression IS NULL
            )
          )
          AND pg_catalog.bool_and(
            pg_catalog.pg_get_expr(
              policy_row.polwithcheck, policy_row.polrelid
            ) = expected.check_expression
            OR (
              policy_row.polwithcheck IS NULL
              AND expected.check_expression IS NULL
            )
          )
        FROM expected_team_directive_policies AS expected
        JOIN pg_catalog.pg_policy AS policy_row
          ON policy_row.polrelid =
            pg_catalog.to_regclass('public.team_directives')
          AND policy_row.polname = expected.policy_name
      ), false)
    ),
    (
      '081.tenant_fk.count',
      COALESCE((
        SELECT pg_catalog.count(*) = 7
          AND pg_catalog.bool_and(constraint_row.contype = 'f')
          AND pg_catalog.bool_and(constraint_row.convalidated)
          AND pg_catalog.bool_and(
            constraint_row.conrelid = pg_catalog.to_regclass(
              'public.' || expected.child_table
            )
          )
          AND pg_catalog.bool_and(
            constraint_row.confrelid = pg_catalog.to_regclass(
              'public.' || expected.parent_table
            )
          )
          AND pg_catalog.bool_and(
            constraint_row.confdeltype = expected.delete_action::"char"
          )
          AND pg_catalog.bool_and((
            SELECT pg_catalog.array_agg(
              attribute.attname::text ORDER BY key_row.ordinality
            )
            FROM pg_catalog.unnest(constraint_row.conkey)
              WITH ORDINALITY AS key_row(attnum, ordinality)
            JOIN pg_catalog.pg_attribute AS attribute
              ON attribute.attrelid = constraint_row.conrelid
              AND attribute.attnum = key_row.attnum
          ) = expected.child_columns)
          AND pg_catalog.bool_and((
            SELECT pg_catalog.array_agg(
              attribute.attname::text ORDER BY key_row.ordinality
            )
            FROM pg_catalog.unnest(constraint_row.confkey)
              WITH ORDINALITY AS key_row(attnum, ordinality)
            JOIN pg_catalog.pg_attribute AS attribute
              ON attribute.attrelid = constraint_row.confrelid
              AND attribute.attnum = key_row.attnum
          ) = expected.parent_columns)
          AND pg_catalog.bool_and(
            CASE
              WHEN expected.delete_set_columns IS NULL THEN
                constraint_row.confdelsetcols IS NULL
              ELSE (
                SELECT pg_catalog.array_agg(
                  attribute.attname::text ORDER BY key_row.ordinality
                )
                FROM pg_catalog.unnest(constraint_row.confdelsetcols)
                  WITH ORDINALITY AS key_row(attnum, ordinality)
                JOIN pg_catalog.pg_attribute AS attribute
                  ON attribute.attrelid = constraint_row.conrelid
                  AND attribute.attnum = key_row.attnum
              ) = expected.delete_set_columns
            END
          )
        FROM expected_tenant_fks AS expected
        JOIN pg_catalog.pg_constraint AS constraint_row
          ON constraint_row.conname = expected.constraint_name
      ), false)
    ),
    ('081.sync_confirm.acl', COALESCE((SELECT pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE') AND NOT pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE') AND NOT pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE') FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='sync_confirm_positions_applied' LIMIT 1), false)),
    ('081.cleanup.acl', COALESCE((SELECT pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE') AND NOT pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE') AND NOT pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE') FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='cleanup_pairing_sessions' LIMIT 1), false)),
    (
      '076.sync_upsert_applications.definition',
      COALESCE((
        SELECT pg_catalog.count(*) = 1
          AND pg_catalog.bool_and(
            procedure.proargnames = ARRAY['p_user_id', 'p_applications']::text[]
          )
          AND pg_catalog.bool_and(procedure.proargtypes::text = '2950 3802')
          AND pg_catalog.bool_and(procedure.proallargtypes IS NULL)
          AND pg_catalog.bool_and(procedure.proargmodes IS NULL)
          AND pg_catalog.bool_and(
            procedure.prorettype = 'jsonb'::pg_catalog.regtype
          )
          AND pg_catalog.bool_and(procedure.pronargdefaults = 0)
          AND pg_catalog.bool_and(procedure.proargdefaults IS NULL)
          AND pg_catalog.bool_and(procedure.prokind = 'f')
          AND pg_catalog.bool_and(
            procedure.prolang = (
              SELECT language.oid FROM pg_catalog.pg_language AS language
              WHERE language.lanname = 'plpgsql'
            )
          )
          AND pg_catalog.bool_and(procedure.provolatile = 'v')
          AND pg_catalog.bool_and(NOT procedure.prosecdef)
          AND pg_catalog.bool_and(
            procedure.proconfig = ARRAY['search_path=public, pg_temp']::text[]
          )
          AND pg_catalog.bool_and(
            pg_catalog.md5(procedure.prosrc) =
              '9809afeec9c0383a3b7548ed578ee1c1'
          )
          AND pg_catalog.bool_and((
            SELECT pg_catalog.count(*) = 2
              AND pg_catalog.count(*) FILTER (
                WHERE privilege.grantee = procedure.proowner
                  AND privilege.privilege_type = 'EXECUTE'
                  AND NOT privilege.is_grantable
              ) = 1
              AND pg_catalog.count(*) FILTER (
                WHERE privilege.grantee = pg_catalog.to_regrole('service_role')
                  AND privilege.privilege_type = 'EXECUTE'
                  AND NOT privilege.is_grantable
              ) = 1
            FROM pg_catalog.aclexplode(
              COALESCE(
                procedure.proacl,
                pg_catalog.acldefault('f', procedure.proowner)
              )
            ) AS privilege
          ))
        FROM sync_applications_rpc AS procedure
      ), false)
    ),
    (
      '077.mark_position_applied.definition',
      COALESCE((
        SELECT pg_catalog.count(*) = 1
          AND pg_catalog.bool_and(
            procedure.proargnames = ARRAY[
              'p_position_legacy_id', 'p_applied_at', 'p_applied_via', 'p_note'
            ]::text[]
          )
          AND pg_catalog.bool_and(procedure.proargtypes::text = '23 1184 25 25')
          AND pg_catalog.bool_and(procedure.proallargtypes IS NULL)
          AND pg_catalog.bool_and(procedure.proargmodes IS NULL)
          AND pg_catalog.bool_and(
            procedure.prorettype = 'jsonb'::pg_catalog.regtype
          )
          AND pg_catalog.bool_and(procedure.pronargdefaults = 1)
          AND pg_catalog.bool_and(
            pg_catalog.pg_get_expr(procedure.proargdefaults, 0) = 'NULL::text'
          )
          AND pg_catalog.bool_and(procedure.prokind = 'f')
          AND pg_catalog.bool_and(
            procedure.prolang = (
              SELECT language.oid FROM pg_catalog.pg_language AS language
              WHERE language.lanname = 'plpgsql'
            )
          )
          AND pg_catalog.bool_and(procedure.provolatile = 'v')
          AND pg_catalog.bool_and(NOT procedure.prosecdef)
          AND pg_catalog.bool_and(
            procedure.proconfig = ARRAY['search_path=public, pg_temp']::text[]
          )
          AND pg_catalog.bool_and(
            pg_catalog.md5(procedure.prosrc) =
              '2e2b5c3dff48508d4a880efb746f3802'
          )
          AND pg_catalog.bool_and((
            SELECT pg_catalog.count(*) = 2
              AND pg_catalog.count(*) FILTER (
                WHERE privilege.grantee = procedure.proowner
                  AND privilege.privilege_type = 'EXECUTE'
                  AND NOT privilege.is_grantable
              ) = 1
              AND pg_catalog.count(*) FILTER (
                WHERE privilege.grantee = pg_catalog.to_regrole('authenticated')
                  AND privilege.privilege_type = 'EXECUTE'
                  AND NOT privilege.is_grantable
              ) = 1
            FROM pg_catalog.aclexplode(
              COALESCE(
                procedure.proacl,
                pg_catalog.acldefault('f', procedure.proowner)
              )
            ) AS privilege
          ))
        FROM mark_applied_rpc AS procedure
      ), false)
    ),
    (
      '077.undo_manual_position_application.definition',
      COALESCE((
        SELECT pg_catalog.count(*) = 1
          AND pg_catalog.bool_and(
            procedure.proargnames = ARRAY[
              'p_position_legacy_id', 'p_restored_status'
            ]::text[]
          )
          AND pg_catalog.bool_and(procedure.proargtypes::text = '23 25')
          AND pg_catalog.bool_and(procedure.proallargtypes IS NULL)
          AND pg_catalog.bool_and(procedure.proargmodes IS NULL)
          AND pg_catalog.bool_and(
            procedure.prorettype = 'jsonb'::pg_catalog.regtype
          )
          AND pg_catalog.bool_and(procedure.pronargdefaults = 1)
          AND pg_catalog.bool_and(
            pg_catalog.pg_get_expr(procedure.proargdefaults, 0) = 'NULL::text'
          )
          AND pg_catalog.bool_and(procedure.prokind = 'f')
          AND pg_catalog.bool_and(
            procedure.prolang = (
              SELECT language.oid FROM pg_catalog.pg_language AS language
              WHERE language.lanname = 'plpgsql'
            )
          )
          AND pg_catalog.bool_and(procedure.provolatile = 'v')
          AND pg_catalog.bool_and(NOT procedure.prosecdef)
          AND pg_catalog.bool_and(
            procedure.proconfig = ARRAY['search_path=public, pg_temp']::text[]
          )
          AND pg_catalog.bool_and(
            pg_catalog.md5(procedure.prosrc) =
              '32fa01ea1d206e2bb9a9f9aeaf4df045'
          )
          AND pg_catalog.bool_and((
            SELECT pg_catalog.count(*) = 2
              AND pg_catalog.count(*) FILTER (
                WHERE privilege.grantee = procedure.proowner
                  AND privilege.privilege_type = 'EXECUTE'
                  AND NOT privilege.is_grantable
              ) = 1
              AND pg_catalog.count(*) FILTER (
                WHERE privilege.grantee = pg_catalog.to_regrole('authenticated')
                  AND privilege.privilege_type = 'EXECUTE'
                  AND NOT privilege.is_grantable
              ) = 1
            FROM pg_catalog.aclexplode(
              COALESCE(
                procedure.proacl,
                pg_catalog.acldefault('f', procedure.proowner)
              )
            ) AS privilege
          ))
        FROM undo_application_rpc AS procedure
      ), false)
    )
), function_body_checks(check_id, ok) AS (
  SELECT expected.check_id,
    COALESCE((
      SELECT pg_catalog.count(*) = 1
        AND pg_catalog.bool_and(
          procedure.proargtypes::text = expected.argument_types
        )
        AND pg_catalog.bool_and(
          COALESCE(procedure.proargnames::text, 'NULL') = expected.argument_names
        )
        AND pg_catalog.bool_and(
          COALESCE(procedure.proallargtypes::text, 'NULL') =
            expected.all_argument_types
        )
        AND pg_catalog.bool_and(
          COALESCE(procedure.proargmodes::text, 'NULL') = expected.argument_modes
        )
        AND pg_catalog.bool_and(procedure.pronargs = expected.input_count)
        AND pg_catalog.bool_and(procedure.pronargdefaults = 0)
        AND pg_catalog.bool_and(procedure.proargdefaults IS NULL)
        AND pg_catalog.bool_and(
          procedure.prorettype = pg_catalog.to_regtype(expected.return_type)
        )
        AND pg_catalog.bool_and(procedure.prokind = 'f')
        AND pg_catalog.bool_and(
          procedure.prolang = (
            SELECT language.oid FROM pg_catalog.pg_language AS language
            WHERE language.lanname = 'plpgsql'
          )
        )
        AND pg_catalog.bool_and(procedure.provolatile = 'v')
        AND pg_catalog.bool_and(
          procedure.prosecdef = expected.security_definer
        )
        AND pg_catalog.bool_and(
          procedure.proconfig = expected.search_path_config
        )
        AND pg_catalog.bool_and(
          pg_catalog.md5(procedure.prosrc) = expected.body_md5
        )
        AND pg_catalog.bool_and((
          SELECT pg_catalog.count(*) =
              1 + pg_catalog.cardinality(expected.extra_acl_grantees)
            AND pg_catalog.count(*) FILTER (
              WHERE privilege.grantee = procedure.proowner
                AND privilege.privilege_type = 'EXECUTE'
                AND NOT privilege.is_grantable
            ) = 1
            AND pg_catalog.count(*) FILTER (
              WHERE privilege.grantee <> procedure.proowner
                AND privilege.privilege_type = 'EXECUTE'
                AND NOT privilege.is_grantable
            ) = pg_catalog.cardinality(expected.extra_acl_grantees)
            AND pg_catalog.bool_and(
              privilege.grantee = procedure.proowner
              OR CASE
                WHEN privilege.grantee = 0 THEN 'PUBLIC'
                ELSE grantee_role.rolname
              END = ANY (expected.extra_acl_grantees)
            )
          FROM pg_catalog.aclexplode(
            COALESCE(
              procedure.proacl,
              pg_catalog.acldefault('f', procedure.proowner)
            )
          ) AS privilege
          LEFT JOIN pg_catalog.pg_roles AS grantee_role
            ON grantee_role.oid = privilege.grantee
        ))
      FROM pg_catalog.pg_proc AS procedure
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = procedure.pronamespace
      WHERE namespace.nspname = 'public'
        AND procedure.proname = expected.function_name
    ), false)
  FROM expected_081_functions AS expected
), trigger_checks(check_id, ok) AS (
  VALUES
    (
      '081.reject_stale_applied.trigger',
      COALESCE((
        SELECT pg_catalog.count(*) = 1
          AND pg_catalog.bool_and(trigger_row.tgenabled = 'O')
          AND pg_catalog.bool_and(NOT trigger_row.tgisinternal)
          AND pg_catalog.bool_and(trigger_row.tgtype = 19)
          AND pg_catalog.bool_and(
            trigger_row.tgattr::text = (
              SELECT attribute.attnum::text
              FROM pg_catalog.pg_attribute AS attribute
              WHERE attribute.attrelid = pg_catalog.to_regclass('public.positions')
                AND attribute.attname = 'status'
                AND NOT attribute.attisdropped
            )
          )
          AND pg_catalog.bool_and(
            trigger_row.tgfoid = pg_catalog.to_regprocedure(
              'public.reject_stale_applied_position_downgrade()'
            )
          )
        FROM pg_catalog.pg_trigger AS trigger_row
        WHERE trigger_row.tgrelid = pg_catalog.to_regclass('public.positions')
          AND trigger_row.tgname = 'positions_reject_stale_applied_downgrade'
      ), false)
    ),
    (
      '081.team_state_stamp.trigger',
      COALESCE((
        SELECT pg_catalog.count(*) = 1
          AND pg_catalog.bool_and(trigger_row.tgenabled = 'O')
          AND pg_catalog.bool_and(NOT trigger_row.tgisinternal)
          AND pg_catalog.bool_and(trigger_row.tgtype = 23)
          AND pg_catalog.bool_and(trigger_row.tgattr::text = '')
          AND pg_catalog.bool_and(
            trigger_row.tgfoid = pg_catalog.to_regprocedure(
              'public.team_state_stamp_cloud_push_check()'
            )
          )
        FROM pg_catalog.pg_trigger AS trigger_row
        WHERE trigger_row.tgrelid = pg_catalog.to_regclass('public.team_state')
          AND trigger_row.tgname = 'trg_team_state_stamp_cloud_push_check'
      ), false)
    )
), release_tail_checks(check_id, ok) AS (
  VALUES
    (
      '082.download_clicks.source_constraint',
      COALESCE((
        SELECT pg_catalog.count(*) = 1
          AND pg_catalog.bool_and(constraint_row.contype = 'c')
          AND pg_catalog.bool_and(constraint_row.convalidated)
          AND pg_catalog.bool_and(
            pg_catalog.md5(
              pg_catalog.pg_get_constraintdef(constraint_row.oid)
            ) = '101bdde26ac74b34498c2e4b8566c5c9'
          )
        FROM pg_catalog.pg_constraint AS constraint_row
        WHERE constraint_row.conrelid =
            pg_catalog.to_regclass('public.download_clicks')
          AND constraint_row.conname = 'download_clicks_utm_source_check'
      ), false)
    ),
    (
      '083.position_ticket.column',
      COALESCE((
        SELECT pg_catalog.count(*) = 1
          AND pg_catalog.bool_and(attribute.attnotnull)
          AND pg_catalog.bool_and(NOT attribute.atthasdef)
          AND pg_catalog.bool_and(
            pg_catalog.format_type(attribute.atttypid, attribute.atttypmod) =
              'uuid'
          )
        FROM pg_catalog.pg_attribute AS attribute
        WHERE attribute.attrelid =
            pg_catalog.to_regclass('public.position_tickets')
          AND attribute.attname = 'position_id'
          AND NOT attribute.attisdropped
      ), false)
    ),
    (
      '083.position_ticket.fk',
      COALESCE((
        SELECT pg_catalog.count(*) = 1
          AND pg_catalog.bool_and(constraint_row.contype = 'f')
          AND pg_catalog.bool_and(constraint_row.convalidated)
          AND pg_catalog.bool_and(
            constraint_row.confrelid = pg_catalog.to_regclass('public.positions')
          )
          AND pg_catalog.bool_and(constraint_row.confupdtype = 'a')
          AND pg_catalog.bool_and(constraint_row.confdeltype = 'c')
          AND pg_catalog.bool_and(constraint_row.confmatchtype = 's')
          AND pg_catalog.bool_and((
            SELECT pg_catalog.array_agg(
              attribute.attname::text ORDER BY key_row.ordinality
            )
            FROM pg_catalog.unnest(constraint_row.conkey)
              WITH ORDINALITY AS key_row(attnum, ordinality)
            JOIN pg_catalog.pg_attribute AS attribute
              ON attribute.attrelid = constraint_row.conrelid
              AND attribute.attnum = key_row.attnum
          ) = ARRAY['user_id', 'position_id', 'position_legacy_id']::text[])
          AND pg_catalog.bool_and((
            SELECT pg_catalog.array_agg(
              attribute.attname::text ORDER BY key_row.ordinality
            )
            FROM pg_catalog.unnest(constraint_row.confkey)
              WITH ORDINALITY AS key_row(attnum, ordinality)
            JOIN pg_catalog.pg_attribute AS attribute
              ON attribute.attrelid = constraint_row.confrelid
              AND attribute.attnum = key_row.attnum
          ) = ARRAY['user_id', 'id', 'legacy_id']::text[])
        FROM pg_catalog.pg_constraint AS constraint_row
        WHERE constraint_row.conrelid =
            pg_catalog.to_regclass('public.position_tickets')
          AND constraint_row.conname = 'position_tickets_position_tenant_fkey'
      ), false)
    ),
    (
      '083.position_ticket.indexes',
      COALESCE((
        SELECT pg_catalog.count(*) = 2
          AND pg_catalog.bool_and(index_row.indisvalid)
          AND pg_catalog.bool_and(index_row.indisready)
          AND pg_catalog.bool_and(index_row.indpred IS NULL)
          AND pg_catalog.bool_and(index_row.indexprs IS NULL)
          AND pg_catalog.bool_and(
            index_row.indisunique =
              (index_class.relname = 'positions_user_id_id_legacy_id_uidx')
          )
          AND pg_catalog.bool_and(
            index_row.indnkeyatts = CASE
              WHEN index_class.relname =
                'positions_user_id_id_legacy_id_uidx' THEN 3
              ELSE 2
            END
          )
          AND pg_catalog.bool_and((
            SELECT pg_catalog.array_agg(
              attribute.attname::text ORDER BY key_row.ordinality
            )
            FROM pg_catalog.unnest(index_row.indkey::smallint[])
              WITH ORDINALITY AS key_row(attnum, ordinality)
            JOIN pg_catalog.pg_attribute AS attribute
              ON attribute.attrelid = index_row.indrelid
              AND attribute.attnum = key_row.attnum
            WHERE key_row.ordinality <= index_row.indnkeyatts
          ) = CASE
            WHEN index_class.relname = 'positions_user_id_id_legacy_id_uidx'
              THEN ARRAY['user_id', 'id', 'legacy_id']::text[]
            ELSE ARRAY['user_id', 'position_id']::text[]
          END)
        FROM pg_catalog.pg_index AS index_row
        JOIN pg_catalog.pg_class AS index_class
          ON index_class.oid = index_row.indexrelid
        WHERE (
          index_class.relname = 'positions_user_id_id_legacy_id_uidx'
          AND index_row.indrelid = pg_catalog.to_regclass('public.positions')
        ) OR (
          index_class.relname = 'idx_position_tickets_user_position'
          AND index_row.indrelid =
            pg_catalog.to_regclass('public.position_tickets')
        )
      ), false)
    )
), ticket_function_definition_checks(check_id, ok) AS (
  SELECT expected.check_id,
    COALESCE((
      SELECT pg_catalog.count(*) = 1
        AND pg_catalog.bool_and(
          procedure.proargtypes::text = expected.argument_types
        )
        AND pg_catalog.bool_and(
          procedure.proargnames::text = expected.argument_names
        )
        AND pg_catalog.bool_and(procedure.proallargtypes IS NULL)
        AND pg_catalog.bool_and(procedure.proargmodes IS NULL)
        AND pg_catalog.bool_and(procedure.pronargs = expected.input_count)
        AND pg_catalog.bool_and(
          procedure.pronargdefaults = expected.default_count
        )
        AND pg_catalog.bool_and(
          pg_catalog.pg_get_expr(procedure.proargdefaults, 0) =
            expected.default_expression
        )
        AND pg_catalog.bool_and(
          procedure.prorettype = 'jsonb'::pg_catalog.regtype
        )
        AND pg_catalog.bool_and(procedure.prokind = 'f')
        AND pg_catalog.bool_and(procedure.provolatile = 'v')
        AND pg_catalog.bool_and(procedure.prosecdef)
        AND pg_catalog.bool_and(
          procedure.prolang = (
            SELECT language.oid
            FROM pg_catalog.pg_language AS language
            WHERE language.lanname = 'plpgsql'
          )
        )
        AND pg_catalog.bool_and(
          procedure.proconfig = ARRAY['search_path=""']::text[]
        )
        AND pg_catalog.bool_and(
          pg_catalog.md5(procedure.prosrc) = expected.body_md5
        )
      FROM pg_catalog.pg_proc AS procedure
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = procedure.pronamespace
      WHERE namespace.nspname = 'public'
        AND procedure.proname = expected.function_name
    ), false)
  FROM (VALUES
    (
      '083.create_ticket.definition', 'create_position_ticket', '23 25 25',
      '{p_position_legacy_id,p_request_text,p_kind}', 3, 1,
      '''custom''::text', '91836c75893f12bea5956f664845f2ac'
    ),
    (
      '083.sync_ticket.definition', 'sync_create_position_ticket',
      '2950 23 25 25 25 25 25 1184 1184 1184',
      '{p_user_id,p_position_legacy_id,p_request_text,p_kind,p_status,p_assigned_agent,p_response_text,p_created_at,p_assigned_at,p_resolved_at}',
      10, 7,
      '''custom''::text, ''open''::text, NULL::text, NULL::text, NULL::timestamp with time zone, NULL::timestamp with time zone, NULL::timestamp with time zone',
      '96b2372b65e4dfc4590cfb01d51e771a'
    )
  ) AS expected(
    check_id, function_name, argument_types, argument_names, input_count,
    default_count, default_expression, body_md5
  )
), ticket_function_acl_checks(check_id, ok) AS (
  SELECT expected.check_id,
    COALESCE((
      SELECT pg_catalog.count(*) = 1
        AND pg_catalog.bool_and((
          SELECT pg_catalog.count(*) = 2
            AND pg_catalog.count(*) FILTER (
              WHERE privilege.grantee = procedure.proowner
                AND privilege.privilege_type = 'EXECUTE'
                AND NOT privilege.is_grantable
            ) = 1
            AND pg_catalog.count(*) FILTER (
              WHERE privilege.grantee =
                pg_catalog.to_regrole(expected.allowed_role)
                AND privilege.privilege_type = 'EXECUTE'
                AND NOT privilege.is_grantable
            ) = 1
          FROM pg_catalog.aclexplode(
            COALESCE(
              procedure.proacl,
              pg_catalog.acldefault('f', procedure.proowner)
            )
          ) AS privilege
        ))
      FROM pg_catalog.pg_proc AS procedure
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = procedure.pronamespace
      WHERE namespace.nspname = 'public'
        AND procedure.proname = expected.function_name
        AND procedure.proargtypes::text = expected.argument_types
    ), false)
  FROM (VALUES
    (
      '083.create_ticket.acl', 'create_position_ticket', '23 25 25',
      'authenticated'
    ),
    (
      '083.sync_ticket.acl', 'sync_create_position_ticket',
      '2950 23 25 25 25 25 25 1184 1184 1184', 'service_role'
    )
  ) AS expected(check_id, function_name, argument_types, allowed_role)
), pairing_attempt_checks(check_id, ok) AS (
  VALUES
    (
      '084.pairing_attempts.table',
      COALESCE((
        SELECT pg_catalog.count(*) = 1
          AND pg_catalog.bool_and(table_class.relkind = 'r')
          AND pg_catalog.bool_and((
            SELECT pg_catalog.array_agg(
              pg_catalog.format(
                '%s|%s|%s|%s|%s',
                attribute.attname,
                pg_catalog.format_type(attribute.atttypid, attribute.atttypmod),
                attribute.attnotnull,
                attribute.atthasdef,
                COALESCE(
                  pg_catalog.pg_get_expr(default_row.adbin, default_row.adrelid),
                  ''
                )
              ) ORDER BY attribute.attnum
            )
            FROM pg_catalog.pg_attribute AS attribute
            LEFT JOIN pg_catalog.pg_attrdef AS default_row
              ON default_row.adrelid = attribute.attrelid
              AND default_row.adnum = attribute.attnum
            WHERE attribute.attrelid = table_class.oid
              AND attribute.attnum > 0
              AND NOT attribute.attisdropped
          ) = ARRAY[
            'user_id|uuid|t|f|',
            'window_started_at|timestamp with time zone|t|t|now()',
            'attempts|integer|t|t|0',
            'locked_until|timestamp with time zone|f|f|',
            'invalidated_at|timestamp with time zone|f|f|',
            'last_device_code|text|f|f|',
            'created_at|timestamp with time zone|t|t|now()',
            'updated_at|timestamp with time zone|t|t|now()'
          ]::text[])
        FROM pg_catalog.pg_class AS table_class
        JOIN pg_catalog.pg_namespace AS namespace
          ON namespace.oid = table_class.relnamespace
        WHERE namespace.nspname = 'public'
          AND table_class.relname = 'cloud_sync_pairing_attempts'
      ), false)
    ),
    (
      '084.pairing_attempts.bucket_constraints',
      COALESCE((
        SELECT pg_catalog.count(*) = 2
          AND pg_catalog.array_agg(
            constraint_row.conname::text || '|' ||
            constraint_row.contype::text || '|' ||
            pg_catalog.md5(
              pg_catalog.pg_get_constraintdef(constraint_row.oid)
            ) ORDER BY constraint_row.conname
          ) = ARRAY[
            'cloud_sync_pairing_attempts_attempts_check|c|57637e3c603a1daa1df1cf72d8847a65',
            'cloud_sync_pairing_attempts_pkey|p|0a0db78b5fb70bf8475b3bd434e6842b'
          ]::text[]
        FROM pg_catalog.pg_constraint AS constraint_row
        WHERE constraint_row.conrelid =
          pg_catalog.to_regclass('public.cloud_sync_pairing_attempts')
          AND constraint_row.contype IN ('c', 'p')
          AND constraint_row.convalidated
      ), false)
    ),
    (
      '084.pairing_attempts.account_cascade',
      COALESCE((
        SELECT pg_catalog.count(*) = 1
          AND pg_catalog.bool_and(constraint_row.contype = 'f')
          AND pg_catalog.bool_and(constraint_row.convalidated)
          AND pg_catalog.bool_and((
            SELECT pg_catalog.count(*) = 3
            FROM pg_catalog.pg_constraint AS all_constraint
            WHERE all_constraint.conrelid = constraint_row.conrelid
          ))
          AND pg_catalog.bool_and(
            constraint_row.confrelid = pg_catalog.to_regclass('auth.users')
          )
          AND pg_catalog.bool_and(constraint_row.confupdtype = 'a')
          AND pg_catalog.bool_and(constraint_row.confdeltype = 'c')
          AND pg_catalog.bool_and(constraint_row.confmatchtype = 's')
          AND pg_catalog.bool_and(
            pg_catalog.pg_get_constraintdef(constraint_row.oid) =
              'FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE'
          )
        FROM pg_catalog.pg_constraint AS constraint_row
        WHERE constraint_row.conrelid =
          pg_catalog.to_regclass('public.cloud_sync_pairing_attempts')
          AND constraint_row.conname =
            'cloud_sync_pairing_attempts_user_id_fkey'
      ), false)
    ),
    (
      '084.pairing_attempts.rls_acl',
      COALESCE((
        SELECT pg_catalog.count(*) = 1
          AND pg_catalog.bool_and(table_class.relrowsecurity)
          AND pg_catalog.bool_and(NOT table_class.relforcerowsecurity)
          AND pg_catalog.bool_and((
            SELECT pg_catalog.count(*) = 0
            FROM pg_catalog.pg_policy AS policy_row
            WHERE policy_row.polrelid = table_class.oid
          ))
          AND pg_catalog.bool_and((
            SELECT pg_catalog.count(*) = 14
              AND pg_catalog.count(*) FILTER (
                WHERE privilege.grantee = table_class.relowner
              ) = 7
              AND pg_catalog.count(*) FILTER (
                WHERE privilege.grantee = pg_catalog.to_regrole('service_role')
              ) = 7
              AND pg_catalog.bool_and(NOT privilege.is_grantable)
              AND pg_catalog.bool_and(
                privilege.privilege_type = ANY(ARRAY[
                  'DELETE', 'INSERT', 'REFERENCES', 'SELECT',
                  'TRIGGER', 'TRUNCATE', 'UPDATE'
                ]::text[])
              )
            FROM pg_catalog.aclexplode(
              COALESCE(
                table_class.relacl,
                pg_catalog.acldefault('r', table_class.relowner)
              )
            ) AS privilege
          ))
        FROM pg_catalog.pg_class AS table_class
        JOIN pg_catalog.pg_namespace AS namespace
          ON namespace.oid = table_class.relnamespace
        WHERE namespace.nspname = 'public'
          AND table_class.relname = 'cloud_sync_pairing_attempts'
      ), false)
    ),
    (
      '084.consume_pairing_attempt.metadata',
      COALESCE((
        SELECT pg_catalog.count(*) = 1
          AND pg_catalog.bool_and(
            procedure.proargtypes::text = '2950 25 23 23'
          )
          AND pg_catalog.bool_and(
            procedure.proargnames::text =
              '{p_user_id,p_device_code,p_window_seconds,p_max_attempts,allowed,attempts,retry_after_seconds}'
          )
          AND pg_catalog.bool_and(
            procedure.proallargtypes::text = '{2950,25,23,23,16,23,23}'
          )
          AND pg_catalog.bool_and(
            procedure.proargmodes::text = '{i,i,i,i,t,t,t}'
          )
          AND pg_catalog.bool_and(procedure.pronargs = 4)
          AND pg_catalog.bool_and(procedure.pronargdefaults = 3)
          AND pg_catalog.bool_and(
            pg_catalog.pg_get_expr(procedure.proargdefaults, 0) =
              'NULL::text, 600, 20'
          )
          AND pg_catalog.bool_and(
            procedure.prorettype = 'record'::pg_catalog.regtype
          )
          AND pg_catalog.bool_and(procedure.prokind = 'f')
          AND pg_catalog.bool_and(procedure.provolatile = 'v')
          AND pg_catalog.bool_and(procedure.prosecdef)
          AND pg_catalog.bool_and(
            procedure.prolang = (
              SELECT language.oid
              FROM pg_catalog.pg_language AS language
              WHERE language.lanname = 'plpgsql'
            )
          )
        FROM pg_catalog.pg_proc AS procedure
        JOIN pg_catalog.pg_namespace AS namespace
          ON namespace.oid = procedure.pronamespace
        WHERE namespace.nspname = 'public'
          AND procedure.proname = 'consume_pairing_attempt'
      ), false)
    ),
    (
      '084.consume_pairing_attempt.body',
      COALESCE((
        SELECT pg_catalog.count(*) = 1
          AND pg_catalog.bool_and(
            pg_catalog.md5(procedure.prosrc) =
              '072c3f45f16b68bac01f01b1dabf54bb'
          )
        FROM pg_catalog.pg_proc AS procedure
        JOIN pg_catalog.pg_namespace AS namespace
          ON namespace.oid = procedure.pronamespace
        WHERE namespace.nspname = 'public'
          AND procedure.proname = 'consume_pairing_attempt'
          AND procedure.proargtypes::text = '2950 25 23 23'
      ), false)
    ),
    (
      '084.consume_pairing_attempt.search_path',
      COALESCE((
        SELECT pg_catalog.count(*) = 1
          AND pg_catalog.bool_and(
            procedure.proconfig = ARRAY['search_path=""']::text[]
          )
        FROM pg_catalog.pg_proc AS procedure
        JOIN pg_catalog.pg_namespace AS namespace
          ON namespace.oid = procedure.pronamespace
        WHERE namespace.nspname = 'public'
          AND procedure.proname = 'consume_pairing_attempt'
          AND procedure.proargtypes::text = '2950 25 23 23'
      ), false)
    ),
    (
      '084.consume_pairing_attempt.execute',
      COALESCE((
        SELECT pg_catalog.count(*) = 1
          AND pg_catalog.bool_and((
            SELECT pg_catalog.count(*) = 2
              AND pg_catalog.count(*) FILTER (
                WHERE privilege.grantee = procedure.proowner
                  AND privilege.privilege_type = 'EXECUTE'
                  AND NOT privilege.is_grantable
              ) = 1
              AND pg_catalog.count(*) FILTER (
                WHERE privilege.grantee = pg_catalog.to_regrole('service_role')
                  AND privilege.privilege_type = 'EXECUTE'
                  AND NOT privilege.is_grantable
              ) = 1
            FROM pg_catalog.aclexplode(
              COALESCE(
                procedure.proacl,
                pg_catalog.acldefault('f', procedure.proowner)
              )
            ) AS privilege
          ))
        FROM pg_catalog.pg_proc AS procedure
        JOIN pg_catalog.pg_namespace AS namespace
          ON namespace.oid = procedure.pronamespace
        WHERE namespace.nspname = 'public'
          AND procedure.proname = 'consume_pairing_attempt'
          AND procedure.proargtypes::text = '2950 25 23 23'
      ), false)
    )
), pairing_attempt_receipt(check_id, ok) AS (
  SELECT '084.migration.receipt',
    pg_catalog.count(*) = 8 AND pg_catalog.bool_and(ok)
  FROM pairing_attempt_checks
)
SELECT checks.check_id, checks.ok
FROM (
  SELECT * FROM checks
  UNION ALL
  SELECT * FROM reconciliation_checks
  UNION ALL
  SELECT * FROM function_body_checks
  UNION ALL
  SELECT * FROM trigger_checks
  UNION ALL
  SELECT * FROM release_tail_checks
  UNION ALL
  SELECT * FROM ticket_function_definition_checks
  UNION ALL
  SELECT * FROM ticket_function_acl_checks
  UNION ALL
  SELECT * FROM pairing_attempt_checks
  UNION ALL
  SELECT * FROM pairing_attempt_receipt
) AS checks
ORDER BY checks.check_id
