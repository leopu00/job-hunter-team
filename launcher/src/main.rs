#![windows_subsystem = "windows"]

mod bootstrap;
mod config;
mod log;
mod prereqs;
mod repo;
mod server;
mod tray;
mod ui;
mod wizard;

fn main() {
    // 1. Check if we have a saved config
    let existing = config::load_config();

    // 2. Show setup wizard
    let setup = match wizard::run(existing) {
        Some(cfg) => cfg,
        None => return, // User closed the wizard
    };

    // 3. Save config for next time
    let _ = config::save_config(&setup);

    // 4. Show splash and run bootstrap
    let _splash = ui::create_splash();
    std::thread::sleep(std::time::Duration::from_millis(200));

    let port = match bootstrap::run(&setup) {
        Ok(port) => port,
        Err(e) => {
            ui::close_splash();
            std::thread::sleep(std::time::Duration::from_millis(100));
            ui::show_error("JHT Desktop", &e);
            return;
        }
    };

    // 5. Close splash
    ui::close_splash();

    // 6. System tray
    // For now, just keep running with a simple message loop
    ui::show_info(
        "JHT Desktop",
        &format!("JHT is running!\n\nDashboard: http://localhost:{}\n\nClose this dialog to stop.", port),
    );
}
