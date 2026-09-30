//! Login Google (Supabase Auth, PKCE) nel browser di sistema, con ritorno su
//! loopback.
//!
//! Google rifiuta il login dentro una webview incorporata, quindi la pagina di
//! autorizzazione si apre nel browser dell'utente. Il ritorno arriva su
//! `http://127.0.0.1:<CALLBACK_PORT>/auth/callback`, un listener di un colpo
//! solo aperto qui prima del browser e chiuso subito dopo. Loopback e non deep
//! link: un deep link su macOS esiste solo per l'app installata, e il login
//! deve funzionare anche da `tauri dev`.
//!
//! Il codice che torna da solo non vale nulla: si scambia per una sessione
//! solo insieme al code verifier, che non esce mai dall'app. Un altro processo
//! che bussa alla porta con un codice suo fa fallire lo scambio, non entra.

use crate::browsers::{self, Browser};
use serde::Serialize;
use std::{
    io::{ErrorKind, Read, Write},
    net::{Ipv4Addr, SocketAddrV4, TcpListener, TcpStream},
    sync::atomic::{AtomicBool, Ordering},
    thread,
    time::{Duration, Instant},
};
use tauri::Url;

/// Porta fissa: Supabase accetta solo i redirect elencati nel progetto.
pub(crate) const CALLBACK_PORT: u16 = 54917;
const CALLBACK_PATH: &str = "/auth/callback";
const LOGIN_TIMEOUT: Duration = Duration::from_secs(5 * 60);
const POLL_INTERVAL: Duration = Duration::from_millis(100);
const READ_TIMEOUT: Duration = Duration::from_secs(5);
const MAX_REQUEST_BYTES: usize = 16 * 1024;
const MAX_ERROR_DESCRIPTION: usize = 300;

static LOGIN_IN_PROGRESS: AtomicBool = AtomicBool::new(false);
static LOGIN_CANCELLED: AtomicBool = AtomicBool::new(false);

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AuthLoginError {
    code: &'static str,
    /// Il motivo che dà Supabase/Google (`error_description`), se c'è.
    detail: Option<String>,
}

fn failure(code: &'static str) -> AuthLoginError {
    AuthLoginError { code, detail: None }
}

#[derive(Debug, PartialEq, Eq)]
enum Callback {
    Code(String),
    Denied(Option<String>),
}

pub(crate) fn callback_url() -> String {
    format!("http://127.0.0.1:{CALLBACK_PORT}{CALLBACK_PATH}")
}

/// L'URL a cui Supabase deve rimandare: il frontend lo passa a
/// `signInWithOAuth` come `redirectTo`.
#[tauri::command]
pub(crate) fn auth_callback_url() -> String {
    callback_url()
}

/// Dove si apre la pagina di autorizzazione.
#[derive(Debug, PartialEq, Eq)]
enum Opener {
    /// Il browser predefinito del sistema.
    Default,
    /// Nessuno: l'utente copia il link e lo incolla nel browser che vuole.
    Manual,
    /// Uno dei browser rilevati da `browsers::installed`.
    Installed(Browser),
}

fn resolve_opener(choice: Option<&str>, installed: Vec<Browser>) -> Result<Opener, AuthLoginError> {
    match choice {
        None | Some("default") => Ok(Opener::Default),
        Some("manual") => Ok(Opener::Manual),
        Some(id) => installed
            .into_iter()
            .find(|browser| browser.id == id)
            .map(Opener::Installed)
            .ok_or_else(|| failure("browser_not_found")),
    }
}

/// Apre `authorize_url` nel browser scelto (`browser`: `default`, `manual` o
/// l'`id` di un browser rilevato) e aspetta il ritorno. Restituisce il codice
/// da scambiare con `exchangeCodeForSession`.
#[tauri::command]
pub(crate) async fn auth_google_login(
    authorize_url: String,
    browser: Option<String>,
) -> Result<String, AuthLoginError> {
    validate_authorize_url(&authorize_url)?;
    let opener = resolve_opener(browser.as_deref(), browsers::installed())?;
    if LOGIN_IN_PROGRESS.swap(true, Ordering::SeqCst) {
        return Err(failure("login_in_progress"));
    }
    LOGIN_CANCELLED.store(false, Ordering::SeqCst);
    let outcome = tauri::async_runtime::spawn_blocking(move || {
        let listener = TcpListener::bind(SocketAddrV4::new(Ipv4Addr::LOCALHOST, CALLBACK_PORT))
            .map_err(|_| failure("port_busy"))?;
        listener
            .set_nonblocking(true)
            .map_err(|_| failure("listener_failed"))?;
        match &opener {
            Opener::Default => open::that_detached(&authorize_url),
            Opener::Manual => Ok(()),
            Opener::Installed(browser) => browsers::open_in(browser, &authorize_url),
        }
        .map_err(|_| failure("browser_failed"))?;
        wait_for_callback(&listener, Instant::now() + LOGIN_TIMEOUT, &LOGIN_CANCELLED)
    })
    .await
    .unwrap_or_else(|_| Err(failure("listener_failed")));
    LOGIN_IN_PROGRESS.store(false, Ordering::SeqCst);
    match outcome? {
        Callback::Code(code) => Ok(code),
        Callback::Denied(detail) => Err(AuthLoginError {
            code: "denied",
            detail,
        }),
    }
}

/// Interrompe l'attesa del ritorno (l'utente ha chiuso il browser o ci ripensa).
#[tauri::command]
pub(crate) fn auth_cancel_login() {
    if LOGIN_IN_PROGRESS.load(Ordering::SeqCst) {
        LOGIN_CANCELLED.store(true, Ordering::SeqCst);
    }
}

/// Solo la pagina di autorizzazione di Supabase, con il ritorno su questa porta:
/// il comando non apre indirizzi qualsiasi nel browser.
fn validate_authorize_url(raw: &str) -> Result<(), AuthLoginError> {
    let url = Url::parse(raw).map_err(|_| failure("invalid_authorize_url"))?;
    let https = url.scheme() == "https" && url.host_str().is_some();
    let path = url.path() == "/auth/v1/authorize";
    let redirect = url
        .query_pairs()
        .any(|(key, value)| key == "redirect_to" && value == callback_url());
    let pkce = url
        .query_pairs()
        .any(|(key, value)| key == "code_challenge_method" && value.eq_ignore_ascii_case("s256"));
    if https && path && redirect && pkce && url.username().is_empty() && url.password().is_none() {
        Ok(())
    } else {
        Err(failure("invalid_authorize_url"))
    }
}

fn wait_for_callback(
    listener: &TcpListener,
    deadline: Instant,
    cancelled: &AtomicBool,
) -> Result<Callback, AuthLoginError> {
    loop {
        if cancelled.load(Ordering::SeqCst) {
            return Err(failure("cancelled"));
        }
        if Instant::now() >= deadline {
            return Err(failure("timed_out"));
        }
        match listener.accept() {
            Ok((stream, _)) => {
                if let Some(callback) = serve(stream) {
                    return Ok(callback);
                }
            }
            Err(error) if error.kind() == ErrorKind::WouldBlock => thread::sleep(POLL_INTERVAL),
            Err(_) => thread::sleep(POLL_INTERVAL),
        }
    }
}

/// Risponde a una richiesta. `Some` solo per il ritorno vero e proprio: una
/// richiesta di favicon o una connessione vuota non chiudono l'attesa.
fn serve(mut stream: TcpStream) -> Option<Callback> {
    let _ = stream.set_nonblocking(false);
    let _ = stream.set_read_timeout(Some(READ_TIMEOUT));
    let target = read_request_target(&mut stream)?;
    let callback = parse_callback(&target);
    let (status, body) = match &callback {
        Some(Callback::Code(_)) => (
            "200 OK",
            page(
                "Accesso completato",
                "Puoi chiudere questa scheda e tornare a Job Hunter Team.",
            ),
        ),
        Some(Callback::Denied(_)) => (
            "200 OK",
            page(
                "Accesso non riuscito",
                "Torna a Job Hunter Team per riprovare.",
            ),
        ),
        None => ("404 Not Found", String::new()),
    };
    let response = format!(
        "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nCache-Control: no-store\r\nReferrer-Policy: no-referrer\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let _ = stream.write_all(response.as_bytes());
    let _ = stream.flush();
    callback
}

fn read_request_target(stream: &mut TcpStream) -> Option<String> {
    let mut buffer = Vec::with_capacity(1024);
    let mut chunk = [0u8; 1024];
    while !buffer.windows(2).any(|pair| pair == b"\r\n") {
        let read = stream.read(&mut chunk).ok()?;
        if read == 0 || buffer.len() + read > MAX_REQUEST_BYTES {
            return None;
        }
        buffer.extend_from_slice(&chunk[..read]);
    }
    let line_end = buffer.windows(2).position(|pair| pair == b"\r\n")?;
    let line = std::str::from_utf8(&buffer[..line_end]).ok()?;
    let mut parts = line.split(' ');
    match (parts.next(), parts.next()) {
        (Some("GET"), Some(target)) if target.starts_with('/') => Some(target.to_string()),
        _ => None,
    }
}

fn parse_callback(target: &str) -> Option<Callback> {
    let url = Url::parse(&format!("http://127.0.0.1{target}")).ok()?;
    if url.path() != CALLBACK_PATH {
        return None;
    }
    let mut code = None;
    let mut error = None;
    let mut description = None;
    for (key, value) in url.query_pairs() {
        match key.as_ref() {
            "code" => code = Some(value.into_owned()),
            "error" => error = Some(value.into_owned()),
            "error_description" => description = Some(value.into_owned()),
            _ => {}
        }
    }
    if error.is_some() {
        return Some(Callback::Denied(description.map(|text| {
            text.chars()
                .filter(|character| !character.is_control())
                .take(MAX_ERROR_DESCRIPTION)
                .collect()
        })));
    }
    // Il codice PKCE di Supabase è un UUID: niente di più lungo né di più strano.
    let code = code.filter(|code| {
        !code.is_empty()
            && code.len() <= 128
            && code
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
    })?;
    Some(Callback::Code(code))
}

fn page(title: &str, message: &str) -> String {
    format!(
        "<!doctype html><html lang=\"it\"><head><meta charset=\"utf-8\"><title>{title}</title>\
<style>body{{font-family:system-ui,sans-serif;background:#0f1115;color:#e8e6e3;display:grid;place-items:center;height:100vh;margin:0}}\
main{{text-align:center}}h1{{font-size:1.4rem}}</style></head>\
<body><main><h1>{title}</h1><p>{message}</p></main></body></html>"
    )
}

#[cfg(test)]
mod tests {
    use super::{
        callback_url, parse_callback, resolve_opener, serve, validate_authorize_url,
        wait_for_callback, Callback, Opener,
    };
    use crate::browsers::Browser;
    use std::{
        io::{Read, Write},
        net::{TcpListener, TcpStream},
        sync::atomic::AtomicBool,
        thread,
        time::{Duration, Instant},
    };

    fn authorize(redirect: &str) -> String {
        let mut url = tauri::Url::parse("https://example.supabase.co/auth/v1/authorize").unwrap();
        url.query_pairs_mut()
            .append_pair("provider", "google")
            .append_pair("redirect_to", redirect)
            .append_pair("code_challenge", "abc")
            .append_pair("code_challenge_method", "s256");
        url.to_string()
    }

    #[test]
    fn only_the_supabase_authorize_page_with_our_callback_is_opened() {
        assert!(validate_authorize_url(&authorize(&callback_url())).is_ok());
        assert!(validate_authorize_url(&authorize("https://evil.example/cb")).is_err());
        assert!(
            validate_authorize_url(&authorize(&callback_url()).replace("https://", "http://"))
                .is_err()
        );
        assert!(validate_authorize_url(
            &authorize(&callback_url()).replace("/auth/v1/authorize", "/elsewhere")
        )
        .is_err());
        assert!(validate_authorize_url(
            &authorize(&callback_url()).replace("code_challenge_method=s256", "x=y")
        )
        .is_err());
        assert!(validate_authorize_url("file:///etc/passwd").is_err());
    }

    #[test]
    fn the_browser_is_the_default_none_or_one_that_was_detected() {
        let canary = Browser {
            id: "chrome-canary",
            name: "Google Chrome Canary",
            path: "/Applications/Google Chrome Canary.app".into(),
        };
        assert_eq!(resolve_opener(None, vec![]), Ok(Opener::Default));
        assert_eq!(resolve_opener(Some("default"), vec![]), Ok(Opener::Default));
        assert_eq!(resolve_opener(Some("manual"), vec![]), Ok(Opener::Manual));
        assert_eq!(
            resolve_opener(Some("chrome-canary"), vec![canary.clone()]),
            Ok(Opener::Installed(canary))
        );
        assert_eq!(
            resolve_opener(Some("chrome-canary"), vec![])
                .unwrap_err()
                .code,
            "browser_not_found"
        );
        // Un percorso al posto dell'id non diventa un eseguibile da lanciare.
        assert_eq!(
            resolve_opener(Some("/bin/sh"), vec![]).unwrap_err().code,
            "browser_not_found"
        );
    }

    #[test]
    fn the_callback_yields_the_code_or_the_provider_error() {
        assert_eq!(
            parse_callback("/auth/callback?code=0b8f1c2e-1234-4d5e-9abc-def012345678"),
            Some(Callback::Code(
                "0b8f1c2e-1234-4d5e-9abc-def012345678".into()
            ))
        );
        assert_eq!(
            parse_callback("/auth/callback?error=access_denied&error_description=User+denied"),
            Some(Callback::Denied(Some("User denied".into())))
        );
        assert_eq!(parse_callback("/favicon.ico"), None);
        assert_eq!(parse_callback("/auth/callback"), None);
        assert_eq!(parse_callback("/auth/callback?code=%3Cscript%3E"), None);
    }

    fn request(port: u16, target: &str) -> String {
        let mut stream = TcpStream::connect(("127.0.0.1", port)).unwrap();
        write!(stream, "GET {target} HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n").unwrap();
        let mut response = String::new();
        stream.read_to_string(&mut response).unwrap();
        response
    }

    #[test]
    fn a_stray_request_does_not_end_the_wait_and_the_callback_does() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let port = listener.local_addr().unwrap().port();
        let client = thread::spawn(move || {
            let stray = request(port, "/favicon.ico");
            let done = request(port, "/auth/callback?code=abc-123");
            (stray, done)
        });
        let cancelled = AtomicBool::new(false);
        let outcome = wait_for_callback(
            &listener,
            Instant::now() + Duration::from_secs(10),
            &cancelled,
        );
        let (stray, done) = client.join().unwrap();
        assert_eq!(outcome, Ok(Callback::Code("abc-123".into())));
        assert!(stray.starts_with("HTTP/1.1 404"));
        assert!(done.starts_with("HTTP/1.1 200"));
        assert!(done.contains("Accesso completato"));
    }

    #[test]
    fn the_wait_ends_on_cancel_and_on_timeout() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let cancelled = AtomicBool::new(true);
        let outcome = wait_for_callback(
            &listener,
            Instant::now() + Duration::from_secs(10),
            &cancelled,
        );
        assert_eq!(outcome.unwrap_err().code, "cancelled");
        let cancelled = AtomicBool::new(false);
        let outcome = wait_for_callback(&listener, Instant::now(), &cancelled);
        assert_eq!(outcome.unwrap_err().code, "timed_out");
    }

    #[test]
    fn an_empty_connection_is_ignored() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let client = thread::spawn(move || drop(TcpStream::connect(("127.0.0.1", port)).unwrap()));
        let (stream, _) = listener.accept().unwrap();
        client.join().unwrap();
        assert_eq!(serve(stream), None);
    }
}
