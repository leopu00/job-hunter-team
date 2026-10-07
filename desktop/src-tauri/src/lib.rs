mod account_scope;
mod auth_login;
mod auth_store;
mod browsers;
mod desktop_platform;
mod direct_chat;
mod live_screen;
mod onboarding;
#[cfg(test)]
mod onboarding_attestation_tests;
mod podman;
#[cfg(windows)]
mod private_acl;
mod profile_import;
mod profile_migration;
mod runtime_host;
mod voice_input;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(account_scope::AccountScopeState::default())
        .manage(direct_chat::DirectChatState::default())
        .manage(onboarding::OnboardingNativeState::default())
        .manage(profile_import::ProfileImportState::default())
        .manage(voice_input::VoiceInputState::default())
        .manage(auth_store::system_key_cache())
        .setup(|app| {
            voice_input::attach(app.handle())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            account_scope::runtime_account_scope_reset,
            account_scope::runtime_account_scope_set,
            account_scope::runtime_account_scope_set_local,
            account_scope::runtime_local_profile_create,
            account_scope::runtime_local_profile_migrate_to_authenticated,
            account_scope::runtime_local_profile_migration_probe,
            account_scope::runtime_playground_local_orphan_recover,
            account_scope::runtime_playground_local_reset,
            auth_login::auth_callback_url,
            auth_login::auth_cancel_login,
            auth_login::auth_google_login,
            auth_store::auth_store_get,
            auth_store::auth_store_prepare,
            auth_store::auth_store_remove,
            auth_store::auth_store_set,
            browsers::auth_browsers,
            direct_chat::direct_chat_close,
            direct_chat::direct_chat_connect,
            direct_chat::direct_chat_read,
            direct_chat::direct_chat_reconnect,
            direct_chat::direct_chat_send,
            direct_chat::direct_chat_status,
            direct_chat::direct_chat_subscribe,
            desktop_platform::desktop_platform,
            live_screen::live_screen_session,
            live_screen::open_live_screen,
            onboarding::onboarding_assistant_open,
            onboarding::onboarding_existing_team_connect,
            onboarding::onboarding_podman_machine_recreate,
            onboarding::onboarding_prepare,
            onboarding::onboarding_provider_login,
            onboarding::onboarding_provider_login_close,
            onboarding::onboarding_provider_login_input,
            onboarding::onboarding_resume_snapshot,
            onboarding::onboarding_resume_team_start,
            runtime_host::onboarding_ssh_host_key_confirm,
            runtime_host::onboarding_ssh_host_key_probe,
            onboarding::onboarding_snapshot,
            onboarding::onboarding_team_start,
            podman::check_podman,
            profile_import::profile_import_vps_to_local,
            voice_input::voice_input_cancel,
            voice_input::voice_input_start,
            voice_input::voice_input_status,
            voice_input::voice_input_stop
        ])
        .run(tauri::generate_context!())
        .expect("error while running JHT Desktop");
}
