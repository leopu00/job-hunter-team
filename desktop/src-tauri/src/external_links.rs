//! An external link of a page shown in the app (the source of a position, the company's website, Glassdoor,
//! a map), opened in the person's own browser. The webview drops a new-window request in silence, so the page
//! hands the address here (lib/external-links.ts) and this side decides.
//!
//! The addresses come from data the agents wrote, so nothing is trusted: the address is parsed, and what is
//! opened is the parser's own rebuilt text, never the raw string. Refused, with a word the page turns into its
//! own sentence: anything but `http`/`https`, an address with a user name or password, a host that is this
//! computer or a private network (`localhost`, a name without a dot, `.local`/`.internal`, a private, loopback,
//! link-local or reserved IP in any notation the parser reads). `open_public_page` (public_pages.rs) is not
//! touched: it still opens only its three constants.
//!
//! A name that a public DNS points at a private IP (`127.0.0.1.nip.io`) cannot be told from here without
//! resolving it, and resolving it would race the browser's own lookup: it is not covered.

use std::net::{Ipv4Addr, Ipv6Addr};

use serde_json::{json, Value};
use url::{Host, Url};

const MAX_LEN: usize = 2048;

/// Domain suffixes (and the bare names) that belong to this machine or to a private network.
const LOCAL_SUFFIXES: [&str; 9] =
    ["localhost", "local", "localdomain", "internal", "intranet", "lan", "home", "corp", "home.arpa"];

fn public_v4(a: Ipv4Addr) -> bool {
    let [o0, o1, o2, _] = a.octets();
    !(o0 == 0
        || o0 == 10
        || o0 == 127
        || (o0 == 100 && (64..=127).contains(&o1))
        || (o0 == 169 && o1 == 254)
        || (o0 == 172 && (16..=31).contains(&o1))
        || (o0 == 192 && o1 == 0 && o2 == 0)
        || (o0 == 192 && o1 == 0 && o2 == 2)
        || (o0 == 192 && o1 == 88 && o2 == 99)
        || (o0 == 192 && o1 == 168)
        || (o0 == 198 && (o1 == 18 || o1 == 19))
        || (o0 == 198 && o1 == 51 && o2 == 100)
        || (o0 == 203 && o1 == 0 && o2 == 113)
        || o0 >= 224)
}

fn public_v6(a: Ipv6Addr) -> bool {
    // ::ffff:a.b.c.d and the old ::a.b.c.d are an IPv4 address in disguise.
    if let Some(v4) = a.to_ipv4() {
        return public_v4(v4);
    }
    let s = a.segments();
    // 64:ff9b::/96 (NAT64) carries an IPv4 address in its last 32 bits.
    if s[0] == 0x64 && s[1] == 0xff9b && s[2..6].iter().all(|part| *part == 0) {
        let [a0, a1] = s[6].to_be_bytes();
        let [a2, a3] = s[7].to_be_bytes();
        return public_v4(Ipv4Addr::new(a0, a1, a2, a3));
    }
    !(a.is_unspecified()
        || a.is_loopback()
        || a.is_multicast()
        || (s[0] & 0xfe00) == 0xfc00 // unique local fc00::/7
        || (s[0] & 0xffc0) == 0xfe80 // link-local fe80::/10
        || (s[0] & 0xffc0) == 0xfec0 // site-local fec0::/10
        || (s[0] == 0x2001 && s[1] == 0x0db8)) // documentation
}

fn public_domain(domain: &str) -> bool {
    let name = domain.trim_end_matches('.');
    if name.is_empty() || !name.contains('.') {
        return false;
    }
    !LOCAL_SUFFIXES.iter().any(|suffix| name == *suffix || name.ends_with(&format!(".{suffix}")))
}

/// The address to open, rebuilt from the parsed one, or the word that says why it is refused.
pub(crate) fn external_address(raw: &str) -> Result<String, &'static str> {
    // The parser silently drops tabs and line breaks and trims the ends: such text is refused, not "fixed".
    if raw.is_empty() || raw.len() > MAX_LEN || raw.chars().any(|c| c.is_control() || c.is_whitespace() || c == '\\') {
        return Err("external_url_invalid");
    }
    let parsed = Url::parse(raw).map_err(|_| "external_url_invalid")?;
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return Err("external_url_scheme");
    }
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err("external_url_credentials");
    }
    let public = match parsed.host() {
        Some(Host::Domain(domain)) => public_domain(domain),
        Some(Host::Ipv4(ip)) => public_v4(ip),
        Some(Host::Ipv6(ip)) => public_v6(ip),
        None => return Err("external_url_invalid"),
    };
    if !public {
        return Err("external_url_local");
    }
    Ok(parsed.to_string())
}

fn open_with(window_is_main: bool, raw: &str, open: impl FnOnce(&str) -> std::io::Result<()>) -> Value {
    if !window_is_main {
        return json!({ "ok": false, "error": "external_url_window_refused" });
    }
    let url = match external_address(raw) {
        Ok(url) => url,
        Err(error) => return json!({ "ok": false, "error": error }),
    };
    match open(&url) {
        Ok(()) => json!({ "ok": true }),
        Err(_) => json!({ "ok": false, "error": "browser_failed" }),
    }
}

#[tauri::command]
pub(crate) fn open_external_url(window: tauri::Window, url: String) -> Value {
    open_with(window.label() == "main", &url, |address| open::that_detached(address))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    #[test]
    fn public_http_and_https_addresses_open_as_the_parser_rebuilds_them() {
        for (raw, rebuilt) in [
            ("https://www.linkedin.com/jobs/view/123", "https://www.linkedin.com/jobs/view/123"),
            ("http://example.com", "http://example.com/"),
            ("HTTPS://Example.COM/Path?q=1#frag", "https://example.com/Path?q=1#frag"),
            ("https://www.glassdoor.com/Overview/Working-at-Acme-EI_IE1.11,15.htm", "https://www.glassdoor.com/Overview/Working-at-Acme-EI_IE1.11,15.htm"),
            ("https://example.com.", "https://example.com./"),
            ("https://example.com:8443/a", "https://example.com:8443/a"),
            ("https://bücher.example/", "https://xn--bcher-kva.example/"),
            ("https://[2606:4700:4700::1111]/", "https://[2606:4700:4700::1111]/"),
            ("https://example.com/a%20b", "https://example.com/a%20b"),
            ("https://example.com/\u{e8}", "https://example.com/%C3%A8"),
        ] {
            assert_eq!(external_address(raw).as_deref(), Ok(rebuilt), "{raw}");
        }
    }

    #[test]
    fn other_schemes_are_refused_by_name() {
        for raw in [
            "file:///etc/passwd",
            "javascript:alert(1)",
            "data:text/html,<script>1</script>",
            "ftp://example.com/",
            "mailto:a@example.com",
            "tel:+390000000",
            "ssh://example.com",
            "vscode://file/x",
            "tauri://localhost/dashboard.html",
            "ipc://localhost/x",
            "blob:https://example.com/uuid",
            "about:blank",
            "ms-msdt:/id",
            "x-apple.systempreferences:",
        ] {
            assert_eq!(external_address(raw), Err("external_url_scheme"), "{raw}");
        }
    }

    #[test]
    fn credentials_in_the_address_are_refused() {
        for raw in [
            "https://user@example.com/",
            "https://user:secret@example.com/",
            "https://:secret@example.com/",
            "http://example.com@example.org/",
        ] {
            assert_eq!(external_address(raw), Err("external_url_credentials"), "{raw}");
        }
    }

    #[test]
    fn this_computer_and_private_networks_are_refused_in_every_notation() {
        for raw in [
            "http://localhost/",
            "http://LOCALHOST:1420/",
            "http://localhost./",
            "http://app.localhost/",
            "http://intranet/",
            "http://nas/",
            "http://printer.local/",
            "http://db.internal/",
            "http://router.lan/",
            "http://host.home.arpa/",
            "http://127.0.0.1/",
            "http://127.1/",
            "http://2130706433/",
            "http://0x7f.0.0.1/",
            "http://0177.0.0.1/",
            "http://0.0.0.0/",
            "http://10.1.2.3/",
            "http://172.16.0.1/",
            "http://172.31.255.255/",
            "http://192.168.1.1/",
            "http://169.254.169.254/latest/meta-data/",
            "http://224.0.0.1/",
            "http://255.255.255.255/",
            "http://[::1]/",
            "http://[::]/",
            "http://[::ffff:127.0.0.1]/",
            "http://[::ffff:10.0.0.1]/",
            "http://[::127.0.0.1]/",
            "http://[64:ff9b::7f00:1]/",
            "http://[fc00::1]/",
            "http://[fd12:3456::1]/",
            "http://[fe80::1]/",
            "http://[ff02::1]/",
            "http://[2001:db8::1]/",
        ] {
            assert_eq!(external_address(raw), Err("external_url_local"), "{raw}");
        }
        // The neighbours of those ranges are public and open.
        for (first, second) in [(172u8, 15u8), (172, 32), (11, 0), (192, 169), (8, 8)] {
            let raw = format!("http://{first}.{second}.0.1/");
            assert!(external_address(&raw).is_ok(), "{raw}");
        }
        // Just under and just over the shared (carrier-grade NAT) range 100.64/10.
        for second in [63u8, 128] {
            let raw = format!("http://100.{second}.0.1/");
            assert!(external_address(&raw).is_ok(), "{raw}");
        }
        // 198.18/15, the benchmarking range.
        let raw = format!("http://{}.{}.0.1/", 198, 18);
        assert_eq!(external_address(&raw), Err("external_url_local"), "{raw}");
        for second in [64u8, 100, 127] {
            let raw = format!("http://100.{second}.0.1/");
            assert_eq!(external_address(&raw), Err("external_url_local"), "{raw}");
        }
    }

    #[test]
    fn text_that_is_not_one_clean_address_is_refused() {
        let long = format!("https://example.com/{}", "a".repeat(MAX_LEN));
        for raw in [
            "",
            " ",
            " https://example.com/",
            "https://example.com/ ",
            "https://exa mple.com/",
            "https://example.com/\n",
            "https://example.com/\tx",
            "https://example.com/\r\nHost: x",
            "https://example.com/\u{0}",
            "https://example.com/\u{7f}",
            "https://example.com\\@example.org/",
            "example.com",
            "//example.com/",
            "/positions/1",
            "https://",
            "http://exa[mple.com/",
            long.as_str(),
        ] {
            assert_eq!(external_address(raw), Err("external_url_invalid"), "{raw:?}");
        }
    }

    #[test]
    fn the_browser_gets_the_rebuilt_address_only_from_the_main_window_and_a_failure_is_said() {
        let seen = RefCell::new(Vec::new());
        let reply = open_with(true, "HTTPS://Example.COM/x", |url| {
            seen.borrow_mut().push(url.to_owned());
            Ok(())
        });
        assert_eq!(reply, json!({ "ok": true }));
        assert_eq!(*seen.borrow(), ["https://example.com/x"]);

        let opened = RefCell::new(false);
        let other_window = open_with(false, "https://example.com/", |_| {
            *opened.borrow_mut() = true;
            Ok(())
        });
        assert_eq!(other_window["error"], "external_url_window_refused");
        let refused = open_with(true, "file:///etc/passwd", |_| {
            *opened.borrow_mut() = true;
            Ok(())
        });
        assert_eq!(refused, json!({ "ok": false, "error": "external_url_scheme" }));
        assert!(!*opened.borrow(), "a refused address reached the browser");

        let failed = open_with(true, "https://example.com/", |_| Err(std::io::Error::other("no browser")));
        assert_eq!(failed, json!({ "ok": false, "error": "browser_failed" }));
    }
}
