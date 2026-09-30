mod auth_login;
mod auth_store;
mod browsers;
mod direct_chat;
mod live_screen;
mod podman;
mod runtime_host;
mod spend;
mod team;

use team::TeamRuntimeState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(TeamRuntimeState::default())
        .manage(direct_chat::DirectChatState::default())
        .manage(auth_store::system_key_cache())
        .invoke_handler(tauri::generate_handler![
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
            live_screen::live_screen_session,
            live_screen::open_live_screen,
            podman::check_podman,
            spend::api_team_spend,
            team::start_api_team
        ])
        .run(tauri::generate_context!())
        .expect("error while running JHT Desktop");
}
