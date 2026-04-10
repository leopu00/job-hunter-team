use std::cell::RefCell;
use std::path::PathBuf;
use std::rc::Rc;

use crate::config::{AiProvider, SetupConfig};

extern crate native_windows_gui as nwg;

pub fn run(existing: Option<SetupConfig>) -> Option<SetupConfig> {
    nwg::init().expect("Failed to init NWG");

    let mut font = nwg::Font::default();
    nwg::Font::builder()
        .family("Segoe UI")
        .size(16)
        .build(&mut font)
        .ok();
    nwg::Font::set_global_default(Some(font));

    let result: Rc<RefCell<Option<SetupConfig>>> = Rc::new(RefCell::new(None));
    let controls = Rc::new(RefCell::new(Controls::build(existing)));

    let window_handle = controls.borrow().window.handle;

    let c = Rc::clone(&controls);
    let r = Rc::clone(&result);

    let handler = nwg::full_bind_event_handler(&window_handle, move |evt, _data, handle| {
        let ctrl = c.borrow();
        match evt {
            nwg::Event::OnButtonClick => {
                if handle == ctrl.btn_browse.handle {
                    if ctrl.folder_dialog.run(Some(&ctrl.window)) {
                        if let Ok(path) = ctrl.folder_dialog.get_selected_item() {
                            ctrl.txt_dir.set_text(&path.to_string_lossy());
                        }
                    }
                }
                if handle == ctrl.btn_start.handle {
                    let work_dir = PathBuf::from(ctrl.txt_dir.text());
                    let provider = match ctrl.combo_provider.selection() {
                        Some(1) => AiProvider::KimiK2,
                        _ => AiProvider::ClaudeCode,
                    };
                    let api_key = ctrl.txt_key.text();

                    *r.borrow_mut() = Some(SetupConfig {
                        work_dir,
                        provider,
                        api_key,
                    });

                    ctrl.window.close();
                }
            }
            nwg::Event::OnWindowClose => {
                nwg::stop_thread_dispatch();
            }
            _ => {}
        }
    });

    nwg::dispatch_thread_events();
    nwg::unbind_event_handler(&handler);

    let out = result.borrow().clone();
    out
}

struct Controls {
    window: nwg::Window,
    txt_dir: nwg::TextInput,
    btn_browse: nwg::Button,
    combo_provider: nwg::ComboBox<String>,
    txt_key: nwg::TextInput,
    btn_start: nwg::Button,
    folder_dialog: nwg::FileDialog,
}

impl Controls {
    fn build(existing: Option<SetupConfig>) -> Self {
        let mut window = nwg::Window::default();
        nwg::Window::builder()
            .size((460, 400))
            .center(true)
            .title("JHT Desktop \u{2014} Setup")
            .flags(nwg::WindowFlags::WINDOW | nwg::WindowFlags::VISIBLE)
            .build(&mut window)
            .unwrap();

        // Title
        let mut _lbl_title = nwg::Label::default();
        nwg::Label::builder()
            .text("JHT Desktop")
            .size((400, 30))
            .position((30, 15))
            .parent(&window)
            .build(&mut _lbl_title)
            .ok();

        let mut _lbl_sub = nwg::Label::default();
        nwg::Label::builder()
            .text("Configure your setup to get started")
            .size((400, 20))
            .position((30, 48))
            .parent(&window)
            .build(&mut _lbl_sub)
            .ok();

        // Work dir
        let mut _lbl_dir = nwg::Label::default();
        nwg::Label::builder()
            .text("Working directory:")
            .size((400, 20))
            .position((30, 90))
            .parent(&window)
            .build(&mut _lbl_dir)
            .ok();

        let default_dir = existing
            .as_ref()
            .map(|c| c.work_dir.display().to_string())
            .unwrap_or_else(|| {
                let home = std::env::var("USERPROFILE").unwrap_or_default();
                format!("{}\\JHT", home)
            });

        let mut txt_dir = nwg::TextInput::default();
        nwg::TextInput::builder()
            .text(&default_dir)
            .size((320, 26))
            .position((30, 112))
            .parent(&window)
            .build(&mut txt_dir)
            .unwrap();

        let mut btn_browse = nwg::Button::default();
        nwg::Button::builder()
            .text("...")
            .size((56, 26))
            .position((358, 112))
            .parent(&window)
            .build(&mut btn_browse)
            .unwrap();

        // Provider
        let mut _lbl_provider = nwg::Label::default();
        nwg::Label::builder()
            .text("AI Provider:")
            .size((400, 20))
            .position((30, 158))
            .parent(&window)
            .build(&mut _lbl_provider)
            .ok();

        let sel_idx = existing.as_ref().map(|c| match c.provider {
            AiProvider::ClaudeCode => Some(0),
            AiProvider::KimiK2 => Some(1),
        }).unwrap_or(Some(0));

        let mut combo_provider = nwg::ComboBox::default();
        nwg::ComboBox::builder()
            .size((386, 26))
            .position((30, 180))
            .collection(vec!["Claude Code".to_string(), "Kimi K2".to_string()])
            .selected_index(sel_idx)
            .parent(&window)
            .build(&mut combo_provider)
            .unwrap();

        // API Key
        let mut _lbl_key = nwg::Label::default();
        nwg::Label::builder()
            .text("API Key:")
            .size((400, 20))
            .position((30, 226))
            .parent(&window)
            .build(&mut _lbl_key)
            .ok();

        let default_key = existing.as_ref().map(|c| c.api_key.clone()).unwrap_or_default();

        let mut txt_key = nwg::TextInput::default();
        nwg::TextInput::builder()
            .text(&default_key)
            .size((386, 26))
            .position((30, 248))
            .password(Some('*'))
            .parent(&window)
            .build(&mut txt_key)
            .unwrap();

        let mut _lbl_hint = nwg::Label::default();
        nwg::Label::builder()
            .text("Leave empty if you have an active subscription")
            .size((386, 18))
            .position((30, 278))
            .parent(&window)
            .build(&mut _lbl_hint)
            .ok();

        // Start button
        let mut btn_start = nwg::Button::default();
        nwg::Button::builder()
            .text("Start JHT")
            .size((180, 38))
            .position((140, 330))
            .parent(&window)
            .build(&mut btn_start)
            .unwrap();

        // Folder dialog
        let mut folder_dialog = nwg::FileDialog::default();
        nwg::FileDialog::builder()
            .title("Select working directory")
            .action(nwg::FileDialogAction::OpenDirectory)
            .build(&mut folder_dialog)
            .unwrap();

        Controls {
            window,
            txt_dir,
            btn_browse,
            combo_provider,
            txt_key,
            btn_start,
            folder_dialog,
        }
    }
}
