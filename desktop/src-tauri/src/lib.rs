mod live_screen;
mod podman;
mod team;

use team::TeamRuntimeState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(TeamRuntimeState::default())
        .invoke_handler(tauri::generate_handler![
            live_screen::live_screen_session,
            live_screen::open_live_screen,
            podman::check_podman,
            team::start_api_team
        ])
        .run(tauri::generate_context!())
        .expect("error while running JHT Desktop");
}
