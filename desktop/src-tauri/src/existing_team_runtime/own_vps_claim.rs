use super::*;

/// The script the identity probe runs in the VPS's container, through the read channel of the host's
/// wrapper (the chat's): it starts nothing and prints one boolean. The account's id arrives on standard
/// input and nothing of `cloud.json` comes back. An unreadable file is «no».
pub(super) const OWN_VPS_IDENTITY_PY: &str = r#"import json,sys
try:
 expected=json.loads(sys.stdin.readline()).get('user_id')
 cloud=json.load(open('/jht_home/cloud.json'))
 match=isinstance(expected,str) and len(expected)>=16 and cloud.get('user_id')==expected
except Exception:
 match=False
print(json.dumps({'match':match}))"#;

/// What the probe sends: the script in hex, then the expected id. Never an argument.
pub(crate) fn own_vps_identity_input(user_id: &str) -> Option<Vec<u8>> {
    if !crate::onboarding::valid_team_id(user_id) {
        return None;
    }
    let mut input = hex_encode(OWN_VPS_IDENTITY_PY.as_bytes()).into_bytes();
    input.push(b'\n');
    input.extend_from_slice(json!({ "user_id": user_id }).to_string().as_bytes());
    input.push(b'\n');
    Some(input)
}

/// The probe's one answer: exactly `{"match": true}`. Anything else, an error, a different shape: no.
pub(crate) fn own_vps_identity_matches(stdout: &[u8]) -> bool {
    serde_json::from_slice::<Value>(stdout.trim_ascii())
        .ok()
        .and_then(|value| {
            let object = value.as_object()?;
            (object.len() == 1).then(|| object.get("match") == Some(&Value::Bool(true)))
        })
        .unwrap_or(false)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct OwnVpsClaimRequest {
    pub(super) confirmed: bool,
}

/// `account_id` is the one the backend authenticated itself, never one the page sent.
pub(super) fn claim_own_vps_impl(
    app: &tauri::AppHandle,
    scope: &AccountScope,
    account_id: &str,
    request: &OwnVpsClaimRequest,
) -> Result<(), &'static str> {
    if !request.confirmed {
        return Err("own_vps_claim_not_confirmed");
    }
    let input = own_vps_identity_input(account_id).ok_or("own_vps_claim_refused")?;
    let host = direct_chat::load_persisted_host(app, scope).map_err(|_| "own_vps_claim_refused")?;
    if !matches!(host, ExecutionHost::Vps { .. }) {
        return Err("own_vps_claim_refused");
    }
    let validated = crate::runtime_host::validate_host_for_scope(app, &host, scope).map_err(|_| "own_vps_claim_refused")?;
    let pinned = crate::runtime_host::pinned_host_fingerprint(&validated).map_err(|_| "own_vps_claim_refused")?;
    let root = root(app)?;
    // Before any network: an existing team, or no VPS of the app's, is refused here.
    match own_vps_state_at(&root, scope, &host, Some(&pinned)) {
        OwnVpsState::Marked => return Ok(()),
        OwnVpsState::NotOwn => return Err("own_vps_claim_refused"),
        OwnVpsState::Claimable | OwnVpsState::KeyChanged => {}
    }
    let started = std::time::Instant::now();
    let log = crate::runtime_log::RuntimeLog::new(app);
    // The probe goes where the chat's reads go, to the wrapper's python channel, which reads the
    // attested container and never starts it.
    let probe = run_ssh_command(&validated, &crate::agent_control::own_vps_read_command(), Some(&input), Duration::from_secs(30), None);
    let outcome = match &probe {
        Ok(result) if result.success() => {
            let matches = own_vps_identity_matches(&result.stdout);
            claim_own_vps_at(&root, scope, &host, Some(&pinned), matches)
        }
        _ => Err("own_vps_claim_unreachable"),
    };
    // The runtime log keeps that a claim was made and how it ended: no host, no account, no answer.
    if let Some(log) = log {
        log.record("own_vps_claim", outcome.map(|_| 0), &[], &[], started.elapsed());
    }
    outcome
}

/// «This VPS I set up with the app» (JHT-T30). Only the app's own window, only with the person's
/// confirmation, never by itself: nothing calls it but the page's button. The page sends no identifier:
/// the account is the one whose session this backend holds and verified (`authenticated_account_id`),
/// and it must be the account the app is working in; the identity probe asks the VPS about that account.
#[tauri::command]
pub(crate) async fn own_vps_claim(
    window: tauri::Window,
    app: tauri::AppHandle,
    keys: State<'_, crate::auth_store::SystemKeyCache>,
    scopes: State<'_, AccountScopeState>,
    request: OwnVpsClaimRequest,
) -> Result<(), &'static str> {
    if !direct_chat::window_may_write(window.label()) {
        return Err("own_vps_claim_refused");
    }
    let expected = scopes.active().map_err(|_| "own_vps_claim_refused")?;
    let account_id = crate::auth_store::authenticated_account_id(&app, &keys).await?;
    if crate::account_scope::scope_of_authenticated(account_id.as_bytes()) != expected {
        return Err("own_vps_claim_refused");
    }
    let scope_state = scopes.inner().clone();
    let worker_expected = expected.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let _scope = scope_state.lock_expected(&worker_expected).map_err(|_| "own_vps_claim_refused")?;
        claim_own_vps_impl(&app, &worker_expected, &account_id, &request)
    })
    .await
    .unwrap_or(Err("own_vps_claim_unreachable"));
    scopes.lock_expected(&expected).map_err(|_| "own_vps_claim_refused")?;
    result
}
