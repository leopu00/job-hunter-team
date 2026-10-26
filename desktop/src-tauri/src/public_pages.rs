//! The app's few public web pages, opened in the person's own browser: the privacy notice, the
//! terms and the download page. The renderer names one of three words; the addresses are
//! constants here, so the call carries no address and nothing the network said can become one
//! (the «new version» banner opens the releases page, never a link taken from a response).

use serde_json::{json, Value};

const SITE: &str = "https://jobhunterteam.ai";
const PRIVACY_URL: &str = "https://jobhunterteam.ai/privacy";
const TERMS_URL: &str = "https://jobhunterteam.ai/terms";
const DOWNLOAD_URL: &str = "https://github.com/leopu00/job-hunter-team/releases/latest";

fn address(page: &str) -> Option<&'static str> {
    match page {
        "privacy" => Some(PRIVACY_URL),
        "terms" => Some(TERMS_URL),
        "download" => Some(DOWNLOAD_URL),
        _ => None,
    }
}

fn open_with(window_is_main: bool, page: &str, open: impl FnOnce(&str) -> std::io::Result<()>) -> Value {
    if !window_is_main {
        return json!({ "ok": false, "error": "public_page_window_refused" });
    }
    let Some(url) = address(page) else {
        return json!({ "ok": false, "error": "public_page_unknown" });
    };
    match open(url) {
        Ok(()) => json!({ "ok": true }),
        Err(_) => json!({ "ok": false, "error": "browser_failed" }),
    }
}

#[tauri::command]
pub(crate) fn open_public_page(window: tauri::Window, page: String) -> Value {
    open_with(window.label() == "main", &page, |url| open::that_detached(url))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    #[test]
    fn three_words_open_three_https_addresses_of_ours_and_nothing_else_opens() {
        let seen = RefCell::new(Vec::new());
        for page in ["privacy", "terms", "download"] {
            let reply = open_with(true, page, |url| {
                seen.borrow_mut().push(url.to_owned());
                Ok(())
            });
            assert_eq!(reply, json!({ "ok": true }), "{page}");
        }
        assert_eq!(
            *seen.borrow(),
            [PRIVACY_URL, TERMS_URL, DOWNLOAD_URL],
            "the addresses are the constants"
        );
        for url in seen.borrow().iter() {
            assert!(url.starts_with("https://"), "{url}");
            assert!(url.starts_with(SITE) || url.starts_with("https://github.com/leopu00/job-hunter-team/"), "{url}");
        }
        for hostile in ["", "Privacy", "privacy ", "https://evil.example", "file:///etc/passwd", "../privacy", "privacy\nterms"] {
            let opened = RefCell::new(false);
            let reply = open_with(true, hostile, |_| {
                *opened.borrow_mut() = true;
                Ok(())
            });
            assert_eq!(reply["error"], "public_page_unknown", "{hostile:?}");
            assert!(!*opened.borrow(), "{hostile:?} opened something");
        }
    }

    #[test]
    fn only_the_main_window_may_ask_and_a_failing_browser_is_said() {
        let opened = RefCell::new(false);
        let refused = open_with(false, "privacy", |_| {
            *opened.borrow_mut() = true;
            Ok(())
        });
        assert_eq!(refused["error"], "public_page_window_refused");
        assert!(!*opened.borrow());
        let failed = open_with(true, "terms", |_| Err(std::io::Error::other("no browser")));
        assert_eq!(failed["error"], "browser_failed");
    }
}
