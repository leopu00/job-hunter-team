//! «A newer version exists»: the app reads the latest PUBLIC release of the project once at startup and, if its
//! version is above the one running, the window shows a banner with a link to the download page (opened through
//! `public_pages`: a constant address, never one taken from the answer). Nothing is downloaded or installed.
//!
//! What leaves the computer: one anonymous HTTPS GET to the project's public release list (no account, no cookie,
//! no token, the app's version in the `User-Agent` as every GitHub client does). What comes back is read for ONE
//! thing: the tag, in the form `v1.2.3`. Anything else (no network, a status that is not 200, an answer over
//! 256 KiB, a tag of another shape, a draft or a pre-release, a version that is not above) is silence: no banner,
//! no error, nothing written down.

use serde_json::{json, Value};
use std::time::Duration;

const LATEST_URL: &str = "https://api.github.com/repos/leopu00/job-hunter-team/releases/latest";
const MAX_ANSWER: u64 = 256 * 1024;
const TIMEOUT: Duration = Duration::from_secs(10);

/// `1.2.3` or `v1.2.3`, three numbers of at most five digits and nothing else (no `-rc`, no build metadata).
fn parse_version(text: &str) -> Option<[u32; 3]> {
    let text = text.strip_prefix('v').unwrap_or(text);
    let mut parts = text.split('.');
    let mut version = [0u32; 3];
    for slot in &mut version {
        let part = parts.next()?;
        if part.is_empty() || part.len() > 5 || !part.bytes().all(|b| b.is_ascii_digit()) {
            return None;
        }
        *slot = part.parse().ok()?;
    }
    parts.next().is_none().then_some(version)
}

/// The version of the answer, as `x.y.z`, only if it is a published release above `current`.
fn newer_version(current: &str, body: &[u8]) -> Option<String> {
    let current = parse_version(current)?;
    let release: Value = serde_json::from_slice(body).ok()?;
    if release.get("draft").and_then(Value::as_bool) != Some(false) || release.get("prerelease").and_then(Value::as_bool) != Some(false) {
        return None;
    }
    let latest = parse_version(release.get("tag_name")?.as_str()?)?;
    (latest > current).then(|| format!("{}.{}.{}", latest[0], latest[1], latest[2]))
}

async fn fetch_latest() -> Option<Vec<u8>> {
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(TIMEOUT)
        .timeout(TIMEOUT)
        .user_agent(concat!("jht-desktop/", env!("CARGO_PKG_VERSION")))
        .build()
        .ok()?;
    let mut response = client.get(LATEST_URL).header("Accept", "application/vnd.github+json").send().await.ok()?;
    if response.status().as_u16() != 200 || response.content_length().is_some_and(|length| length > MAX_ANSWER) {
        return None;
    }
    // in pieces, with the cap on what has arrived: an answer without a length is not read to its end first
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await.ok()? {
        if (body.len() + chunk.len()) as u64 > MAX_ANSWER {
            return None;
        }
        body.extend_from_slice(&chunk);
    }
    Some(body)
}

/// `{ "newer": "1.2.3" }` when a newer public release exists, `{ "newer": null }` in every other case.
#[tauri::command]
pub(crate) async fn latest_app_version(window: tauri::Window) -> Value {
    if window.label() != "main" {
        return json!({ "newer": null });
    }
    let newer = fetch_latest().await.and_then(|body| newer_version(env!("CARGO_PKG_VERSION"), &body));
    json!({ "newer": newer })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn release(tag: &str, draft: bool, prerelease: bool) -> Vec<u8> {
        json!({ "tag_name": tag, "draft": draft, "prerelease": prerelease, "html_url": "https://evil.example/download", "body": "notes" }).to_string().into_bytes()
    }

    #[test]
    fn a_banner_only_for_a_published_release_that_is_above() {
        assert_eq!(newer_version("0.4.0", &release("v0.4.1", false, false)), Some("0.4.1".into()));
        assert_eq!(newer_version("0.4.0", &release("v0.10.0", false, false)), Some("0.10.0".into()), "numbers, not text");
        assert_eq!(newer_version("0.4.9", &release("1.0.0", false, false)), Some("1.0.0".into()));
        for same_or_below in ["v0.4.0", "v0.3.9", "v0.0.1", "0.4.0"] {
            assert_eq!(newer_version("0.4.0", &release(same_or_below, false, false)), None, "{same_or_below}");
        }
        assert_eq!(newer_version("0.4.0", &release("v0.5.0", true, false)), None, "a draft");
        assert_eq!(newer_version("0.4.0", &release("v0.5.0", false, true)), None, "a pre-release");
    }

    #[test]
    fn anything_that_is_not_a_plain_tag_or_a_plain_answer_is_silence() {
        for tag in ["", "v", "latest", "v1", "v1.2", "v1.2.3.4", "v1.2.3-rc1", "v1.2.3+build", "v1.2.x", "v-1.2.3", "v1.2.3\n", " v1.2.3", "V1.2.3", "v99999999.0.0", "v1..3"] {
            assert_eq!(newer_version("0.4.0", &release(tag, false, false)), None, "{tag:?}");
        }
        for body in [&b""[..], b"not json", b"[]", b"{}", b"{\"tag_name\": 7}", b"{\"tag_name\": \"v9.0.0\"}", b"{\"tag_name\": \"v9.0.0\", \"draft\": false}"] {
            assert_eq!(newer_version("0.4.0", body), None, "{:?}", String::from_utf8_lossy(body));
        }
        assert_eq!(newer_version("garbage", &release("v9.0.0", false, false)), None, "an unreadable own version");
    }

    #[test]
    fn the_answer_decides_one_number_and_never_an_address() {
        let source = include_str!("app_update.rs");
        let code = &source[..source.find("#[cfg(test)]").unwrap()];
        for taken_from_the_answer in ["html_url", "browser_download_url", "assets", "open::", "Command::new"] {
            assert!(!code.contains(taken_from_the_answer), "{taken_from_the_answer}");
        }
        assert_eq!(code.matches("https://").count(), 1, "one address, the one that is asked");
        assert!(LATEST_URL.starts_with("https://api.github.com/repos/leopu00/job-hunter-team/"));
        assert!(!code.contains("response.bytes()"), "the answer is read in pieces under the cap, never whole first");
        for logging in ["println!", "eprintln!", "tracing::", "log::"] {
            assert!(!code.contains(logging), "{logging}");
        }
    }
}
