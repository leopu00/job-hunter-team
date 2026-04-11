#![cfg_attr(windows, windows_subsystem = "windows")]

mod bootstrap;
mod config;
mod log;
mod server;
mod ui;
mod wizard;

fn main() {
    let existing = config::load_config();
    wizard::run(existing);
}
