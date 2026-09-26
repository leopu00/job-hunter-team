mod auth_login;
mod auth_store;
mod live_screen;
mod podman;
mod team;

use team::TeamRuntimeState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(TeamRuntimeState::default())
        .invoke_handler(tauri::generate_handler![
            auth_login::auth_callback_url,
            auth_login::auth_cancel_login,
            auth_login::auth_google_login,
            auth_store::auth_store_get,
            auth_store::auth_store_remove,
            auth_store::auth_store_set,
            live_screen::live_screen_session,
            live_screen::open_live_screen,
            podman::check_podman,
            team::start_api_team
        ])
        .run(tauri::generate_context!())
        .expect("error while running JHT Desktop");
}
