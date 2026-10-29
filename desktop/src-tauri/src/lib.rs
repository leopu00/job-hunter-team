mod account_scope;
mod app_exit;
mod auth_login;
mod auth_store;
mod broker_view;
mod browsers;
mod closer_desktop;
pub mod cli_adapter;
mod desktop_platform;
mod direct_chat;
mod agent_control;
mod existing_team_agents;
mod existing_team_cloud_token;
mod app_update;
mod public_pages;
mod team_document;
mod existing_team_judgement;
mod team_settings;
mod export_file;
mod existing_team_register;
// The tests rely on 0600 files, hard links and symlinks; Windows is not covered.
#[cfg(all(test, unix))]
mod existing_team_register_tests;
mod existing_team_runtime;
mod live_screen;
mod local_swipe;
mod mail;
mod onboarding;
#[cfg(test)]
mod onboarding_attestation_tests;
mod podman;
#[cfg(windows)]
mod private_acl;
mod private_copy;
mod profile_import;
mod profile_migration;
mod release_channel;
mod resources;
mod release_channel_rules;
mod runtime_host;
mod runtime_log;
mod saved_vps;
mod team_control;
mod team_backup;
mod team_export;
mod team_owner;
mod chat_attachment;
mod profile_progress;
mod team_start;
mod work_stats;
mod text_file_export;
mod voice_input;
mod vps_link;
mod window_fit;
mod windows_runtime;

pub(crate) fn application_context() -> tauri::Context<tauri::Wry> {
    tauri::generate_context!()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        // a new position's system notification (lib/notify): only what capabilities/new-position-notification.json allows
        .plugin(tauri_plugin_notification::init())
        .manage(account_scope::AccountScopeState::default())
        .manage(broker_view::BrokerViewState::default())
        .manage(direct_chat::DirectChatState::default())
        .manage(onboarding::OnboardingNativeState::default())
        .manage(profile_import::ProfileImportState::default())
        .manage(voice_input::VoiceInputState::default())
        .manage(auth_store::system_key_cache())
        .setup(|app| {
            // inside the work area of its monitor, at any scale
            window_fit::fit_main_window(app.handle());
            voice_input::attach(app.handle())?;
            // the folder of the private copies a document is opened from (and the sweep of what an earlier run left)
            if let Ok(dir) = tauri::Manager::path(app).app_local_data_dir() {
                std::thread::spawn(move || private_copy::init(dir));
            }
            // what a crash left of the pipe-free ssh calls (Windows only), off the start's path
            std::thread::spawn(runtime_host::remove_stale_pipe_free_files);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            account_scope::onboarding_local_data_adopt,
            account_scope::onboarding_local_data_set_aside,
            account_scope::onboarding_local_owner_probe,
            account_scope::onboarding_local_owner_confirm,
            account_scope::onboarding_local_owner_return,
            account_scope::onboarding_local_owner_take_over,
            account_scope::onboarding_previous_local_data,
            account_scope::runtime_account_scope_reset,
            account_scope::runtime_account_scope_set,
            account_scope::runtime_account_scope_set_local,
            account_scope::runtime_local_profile_create,
            account_scope::runtime_local_profile_migrate_to_authenticated,
            account_scope::runtime_local_profile_migration_probe,
            account_scope::runtime_playground_local_orphan_recover,
            account_scope::runtime_playground_local_reset,
            team_owner::runtime_local_team_owner_identity,
            team_owner::runtime_local_team_owner,
            profile_progress::profile_progress_read,
            team_start::team_start_read,
            auth_login::auth_callback_url,
            auth_login::auth_cancel_login,
            auth_login::auth_google_login,
            auth_store::auth_store_clear,
            auth_store::auth_store_get,
            auth_store::auth_store_prepare,
            auth_store::auth_store_remove,
            auth_store::auth_store_set,
            broker_view::broker_login_status,
            broker_view::broker_login_view_close,
            broker_view::broker_login_view_open,
            broker_view::broker_login_view_session,
            browsers::auth_browsers,
            closer_desktop::closer_desktop_register_host,
            closer_desktop::closer_desktop_request,
            existing_team_runtime::existing_team_positions_read,
            existing_team_judgement::existing_team_position_write,
            existing_team_judgement::existing_team_position_write_target,
            existing_team_cloud_token::existing_team_cloud_token,
            existing_team_cloud_token::existing_team_cloud_token_open_site,
            app_update::latest_app_version,
            public_pages::open_public_page,
            team_document::team_document_save,
            team_document::team_document_text,
            team_document::team_document_pages,
            team_document::team_document_page,
            team_document::team_document_open,
            existing_team_runtime::existing_team_link_identity,
            existing_team_agents::existing_team_agents_read,
            agent_control::agent_control,
            team_settings::team_settings,
            export_file::export_csv_save,
            direct_chat::direct_chat_answer,
            direct_chat::direct_chat_attach,
            direct_chat::direct_chat_attach_state,
            direct_chat::direct_chat_close,
            direct_chat::direct_chat_connect,
            direct_chat::direct_chat_enter,
            direct_chat::direct_chat_read,
            direct_chat::direct_chat_reconnect,
            direct_chat::direct_chat_send,
            direct_chat::direct_chat_team_language,
            direct_chat::direct_chat_team_language_set,
            direct_chat::direct_chat_status,
            direct_chat::direct_chat_subscribe,
            desktop_platform::desktop_platform,
            live_screen::live_screen_session,
            live_screen::open_live_screen,
            mail::mail_save_password,
            mail::mail_status,
            onboarding::onboarding_assistant_open,
            existing_team_register::onboarding_existing_team_discover,
            existing_team_register::onboarding_existing_team_register,
            existing_team_runtime::own_vps_claim,
            onboarding::existing_team_assistant_start,
            onboarding::onboarding_existing_team_connect,
            onboarding::existing_team_reconfirm_summary,
            onboarding::existing_team_link_status,
            onboarding::existing_team_unlink,
            onboarding::existing_team_write_access_off,
            onboarding::onboarding_existing_team_readonly_connect,
            onboarding::onboarding_existing_team_reopen,
            onboarding::onboarding_podman_machine_recreate,
            onboarding::onboarding_clean_images,
            onboarding::onboarding_plans,
            onboarding::onboarding_plan_declare,
            onboarding::onboarding_local_uninstall_available,
            onboarding::onboarding_local_uninstall,
            runtime_log::onboarding_runtime_log,
            runtime_log::page_load_metric,
            runtime_log::onboarding_runtime_log_open,
            saved_vps::saved_vps_list,
            saved_vps::saved_vps_add,
            saved_vps::saved_vps_rename,
            saved_vps::saved_vps_remove,
            runtime_log::onboarding_support_context,
            runtime_log::onboarding_support_report_save,
            runtime_log::onboarding_support_reports_open,
            onboarding::onboarding_prepare,
            onboarding::onboarding_provider_login,
            onboarding::onboarding_provider_login_close,
            onboarding::onboarding_provider_login_input,
            onboarding::onboarding_resume_snapshot,
            onboarding::onboarding_resume_team_start,
            onboarding::onboarding_resume_runtime_wake,
            runtime_host::onboarding_ssh_host_key_confirm,
            runtime_host::onboarding_ssh_host_key_probe,
            onboarding::onboarding_snapshot,
            onboarding::onboarding_team_start,
            podman::check_podman,
            profile_import::profile_import_vps_to_local,
            text_file_export::save_text_file,
            team_export::export_team_data,
            team_export::export_account_save,
            team_backup::backup_create,
            team_backup::backup_cancel,
            team_backup::backup_inspect,
            app_exit::app_exit_ack,
            app_exit::app_exit_cancel,
            app_exit::app_exit_state,
            app_exit::app_exit_order,
            app_exit::app_exit_poll,
            app_exit::app_exit_finish,
            work_stats::work_stats_read,
            work_stats::work_stats_clear,
            local_swipe::local_swipe_deck_read,
            local_swipe::local_team_position_judge,
            voice_input::voice_input_cancel,
            voice_input::voice_input_start,
            voice_input::voice_input_status,
            voice_input::voice_input_stop
        ])
        // the close button leaves nothing running unasked: the page is asked first (app_exit.rs)
        .on_window_event(|window, event| {
            if window.label() == "main" {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    if !app_exit::request_goes_through(std::time::Instant::now()) {
                        api.prevent_close();
                        app_exit::ask_the_page(tauri::Manager::app_handle(window));
                    }
                }
            }
        })
        .build(application_context())
        .expect("error while building JHT Desktop")
        .run(|app, event| match event {
            // ⌘Q and the app menu's Quit come here, not through the window
            tauri::RunEvent::ExitRequested { api, .. } => {
                if !app_exit::request_goes_through(std::time::Instant::now()) {
                    api.prevent_exit();
                    app_exit::ask_the_page(app);
                }
            }
            // the app is really leaving: the private copies of documents go with it
            tauri::RunEvent::Exit => private_copy::sweep_private_copies(),
            _ => {}
        });
}
