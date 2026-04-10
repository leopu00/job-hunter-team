use std::sync::{Arc, Mutex};

use shared_child::SharedChild;
use tray_item::TrayItem;

use crate::config;
use crate::log::log;
use crate::repo;
use crate::server;

pub fn run(child: Arc<SharedChild>, port: u16) {
    let child = Arc::new(Mutex::new(Some(child)));

    let mut tray =
        TrayItem::new("JHT Desktop", tray_item::IconSource::Resource("app-icon")).unwrap();

    tray.add_label(&format!("JHT Desktop - localhost:{}", port))
        .unwrap();

    tray.inner_mut().add_separator().unwrap();

    // Open Browser
    let p = port;
    tray.add_menu_item("Open Browser", move || {
        let _ = open::that(format!("http://localhost:{}", p));
    })
    .unwrap();

    // Restart Server
    let child_ref = Arc::clone(&child);
    let p = port;
    tray.add_menu_item("Restart Server", move || {
        log("Restarting server...");
        if let Ok(mut guard) = child_ref.lock() {
            if let Some(c) = guard.take() {
                server::stop(&c);
            }
            match server::start(p) {
                Ok(new_child) => {
                    *guard = Some(new_child);
                    log("Server restarted.");
                }
                Err(e) => log(&format!("Restart failed: {}", e)),
            }
        }
    })
    .unwrap();

    // Update (git pull + restart)
    let child_ref = Arc::clone(&child);
    let p = port;
    tray.add_menu_item("Update && Restart", move || {
        log("Updating...");
        if let Ok(mut guard) = child_ref.lock() {
            if let Some(c) = guard.take() {
                server::stop(&c);
            }

            match repo::update_repo(&config::repo_dir()) {
                Ok(_) => log("Repository updated."),
                Err(e) => {
                    log(&format!("Update failed: {}", e));
                    return;
                }
            }

            if let Err(e) = server::ensure_deps() {
                log(&format!("npm install failed: {}", e));
                return;
            }

            match server::start(p) {
                Ok(new_child) => {
                    *guard = Some(new_child);
                    log("Server restarted after update.");
                }
                Err(e) => log(&format!("Restart failed: {}", e)),
            }
        }
    })
    .unwrap();

    tray.inner_mut().add_separator().unwrap();

    // Quit
    let child_ref = Arc::clone(&child);
    tray.add_menu_item("Quit", move || {
        log("Quitting...");
        if let Ok(mut guard) = child_ref.lock() {
            if let Some(c) = guard.take() {
                server::stop(&c);
            }
        }
        crate::log::flush_to_file(&config::log_file());
        std::process::exit(0);
    })
    .unwrap();

    // Block the main thread — tray runs on Windows message loop
    loop {
        std::thread::sleep(std::time::Duration::from_secs(1));
    }
}
