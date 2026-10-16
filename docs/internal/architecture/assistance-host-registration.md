# Assistance connection during FIRSTSETUP

`closer_desktop_register_host({host})` records only an assistance VPS connection
for the native active account. `host` is exactly the existing ExecutionHost VPS
schema: `kind`, `address`, `user`, `port`, `keyPath`. Local and extra fields fail.
The renderer does not select an account, container, binding, command or file.

The native command holds the expected account scope and the bridge in-flight
barrier. Existing `validate_host_for_scope` uses the held scope directly, without
reacquiring the account lock. It checks the address/user/port, actual key file
and account-scoped pinned known-host record before any connection write. Missing
host key returns `host_key_missing`; the existing probe/confirm commands may be
used and registration retried explicitly. This command never opens SSH or
probes a team. It does not invoke provider/provisioning/onboarding completion.

The official connection store remains
`app_local_data/accounts/<active AccountScope.digest>/direct-chat-host.json`.
Registration uses the same atomic writer as direct chat/onboarding under a
shared in-process write mutex. An absent store is written privately; an exact
same host preserves existing bytes. A different host returns
`browser_connection_changed`. Malformed, oversized, symlink or non-file stores
return `host_config_invalid`, without repair or overwrite. Storage errors fail.
The temporary file is exclusive/private before bytes are written, then synced
and renamed. The final bounded, non-following read must match the selected host.
This mutex is not an interprocess filesystem transaction or a sandbox.

Success is exactly `{ok:true,registered:true,assistance_ready:false}`. Failure is
`{ok:false,error:<stable code>}`. Registration does not create a trusted browser
binding, assert remote availability, mark profile/team ready, or admit agents.
The unchanged `closer_desktop_request` still requires the private account+host
binding, validates all runtime pins, and fails closed on missing binding/drift.
FIRSTSETUP remains incomplete; the real assistance panel may report unavailable.

Local profile correlation remains the existing native path:
`runtime_account_scope_set_local(profileId)` loads the exact
`app_local_data/local-profiles/<profileId>.json` record with `scopeDigest`.
Profile IDs and scope digests are independent random-derived identifiers. A
record alone does not attest current in-memory selection. This command creates
no selection receipt, profile, authentication session, or synthetic marker.

Focused Rust tests exercise strict parsing/validation order and actual TEMP
host writes, permissions, idempotence, conflicting registration, invalid stores
and symlink rejection. Validation callbacks are controlled observations; they
are not SSH, platform ACL or real Tauri UI admission evidence. No live account,
key, host, provider, runtime or candidate binding is used by these tests.
