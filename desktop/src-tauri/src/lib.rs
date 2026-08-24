mod podman;
mod team;

use team::TeamRuntimeState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(TeamRuntimeState::default())
        .invoke_handler(tauri::generate_handler![
            podman::check_podman,
            team::start_api_team
        ])
        .run(tauri::generate_context!())
        .expect("error while running JHT Desktop");
}
