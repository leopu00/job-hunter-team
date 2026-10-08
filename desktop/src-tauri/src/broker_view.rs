//! Interactive view of the broker's screen, for the LinkedIn login.
//!
//! The login happens in a Chromium that runs in the broker container, on the
//! broker's own X display; the agents never see it. The broker publishes an
//! interactive x11vnc behind websockify on 127.0.0.1:6081 of the host, only
//! while a session is open, and `jht linkedin login` hands the host a token
//! valid for ONE WebSocket connection within 120 s. Here the app:
//!
//! - asks for the session (`jht linkedin login`), on this computer through the
//!   attested wrapper, on a VPS through SSH;
//! - on a VPS forwards a random loopback port of this computer to the VPS's
//!   127.0.0.1:6081 with the same SSH the app already uses (pinned host key,
//!   batch mode). No port is ever opened on a public interface, here or there;
//! - opens the detached screen window (`live-screen.html?view=broker-login`,
//!   the same window code as the read-only CLOSER screen) and hands the token
//!   to that window ONCE: a second request gets `token_expired`;
//! - closes everything (`jht linkedin login --stop`, the tunnel, the window)
//!   when the window closes, when the viewer sees the login finished, or at
//!   the latest when the broker's own limits are over.
//!
//! Nothing of the screen is stored: noVNC draws to a canvas and that is all.
//! The token never reaches a log, an error or the diagnostics.

use crate::account_scope::{AccountScope, AccountScopeState};
use crate::onboarding::{run_linkedin_command, LocalCliOperation};
use crate::runtime_host::{ssh_base_args, validate_host, ProcessResult, ValidatedHost};
use serde::{Deserialize, Serialize};
use std::{
    ffi::OsString,
    io::{BufRead, BufReader},
    net::{Ipv4Addr, SocketAddrV4, TcpListener},
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};
use tauri::{Manager, State, WindowEvent};
use zeroize::{Zeroize, Zeroizing};

pub(crate) const WINDOW_LABEL: &str = "broker-login";
const WINDOW_PAGE: &str = "live-screen.html?view=broker-login";
const WINDOW_TITLE: &str = "Accesso a LinkedIn";
const VIEW_PATH: &str = "/websockify";
/// The broker's limits (shared/broker/view.py): the token is good for one
/// connection within 120 s, a session lasts at most 15 minutes from it.
const TOKEN_TTL: Duration = Duration::from_secs(120);
const SESSION_MAX: Duration = Duration::from_secs(15 * 60);
/// The app closes the view a little after the broker would have, as a second
/// lock: a broker that never ends the session does not keep the window open.
const DEADLINE_MARGIN: Duration = Duration::from_secs(30);
const LOGIN_TIMEOUT: Duration = Duration::from_secs(120);
const STOP_TIMEOUT: Duration = Duration::from_secs(30);
const STATUS_TIMEOUT: Duration = Duration::from_secs(25);
const TUNNEL_READY_TIMEOUT: Duration = Duration::from_secs(15);
const TOKEN_LEN: usize = 43;
const MAX_SESSION_ID_LEN: usize = 32;

/// The broker's error reasons the app tells apart. Anything else, including
/// `view_purpose_unknown` (the app always asks for linkedin-login), is
/// `view_unavailable`.
const BROKER_REASONS: [&str; 5] = [
    "view_busy",
    "view_unavailable",
    "login_timeout",
    "token_expired",
    "chromium_sandbox_unavailable",
];

#[derive(Debug, Serialize)]
pub(crate) struct BrokerViewError {
    code: &'static str,
}

fn failure(code: &'static str) -> BrokerViewError {
    BrokerViewError { code }
}

#[derive(Default)]
pub(crate) struct BrokerViewState {
    active: Mutex<Option<ActiveView>>,
    opening: AtomicBool,
}

struct ActiveView {
    session: String,
    /// ws://127.0.0.1:<port>/websockify, without the token.
    url: String,
    token: Option<Zeroizing<String>>,
    token_deadline: Instant,
    deadline: Instant,
    host: ValidatedHost,
    scope: AccountScope,
    tunnel: Option<Child>,
}

impl ActiveView {
    /// The connection URL with the token, at most once and only while the
    /// broker would still accept the token.
    fn take_url(&mut self, now: Instant) -> Result<Zeroizing<String>, &'static str> {
        let token = self.token.take().ok_or("token_expired")?;
        if now >= self.token_deadline {
            return Err("token_expired");
        }
        Ok(Zeroizing::new(format!(
            "{}?token={}",
            self.url,
            token.as_str()
        )))
    }
}

struct ViewGrant {
    port: u16,
    token: Zeroizing<String>,
    session: String,
}

#[derive(Deserialize)]
struct GrantLine {
    ok: bool,
    #[serde(default)]
    reason: Option<String>,
    #[serde(default)]
    port: Option<u16>,
    #[serde(default)]
    path: Option<String>,
    #[serde(default)]
    token: Option<String>,
    #[serde(default)]
    session: Option<String>,
}

impl Drop for GrantLine {
    fn drop(&mut self) {
        if let Some(token) = self.token.as_mut() {
            token.zeroize();
        }
    }
}

/// The last non-empty line of a command's output: the broker answers with one
/// JSON line, the wrapper may print something before it.
fn json_line(stdout: &[u8]) -> Option<&str> {
    std::str::from_utf8(stdout)
        .ok()?
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .last()
}

fn broker_reason(reason: Option<&str>) -> &'static str {
    reason
        .and_then(|reason| BROKER_REASONS.iter().find(|known| **known == reason))
        .copied()
        .unwrap_or("view_unavailable")
}

fn command_failure(result: &Result<ProcessResult, &'static str>) -> &'static str {
    match result {
        Err("process_timeout") => "timeout",
        Err(code) if code.starts_with("account_") || code.starts_with("local_account_") => code,
        Err("runtime_missing") => "runtime_missing",
        Err(_) => "view_unavailable",
        Ok(result) => json_line(&result.stdout)
            .and_then(|line| serde_json::from_str::<GrantLine>(line).ok())
            .map(|line| broker_reason(line.reason.as_deref()))
            .unwrap_or("view_unavailable"),
    }
}

fn valid_token(token: &str) -> bool {
    token.len() == TOKEN_LEN
        && token
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
}

fn valid_session_id(session: &str) -> bool {
    !session.is_empty()
        && session.len() <= MAX_SESSION_ID_LEN
        && session.bytes().all(|byte| byte.is_ascii_hexdigit())
}

/// `jht linkedin login`: the grant, or the broker's reason. Any field out of
/// contract is `view_unavailable`, never a half-trusted session.
fn parse_grant(result: Result<ProcessResult, &'static str>) -> Result<ViewGrant, &'static str> {
    let output = match &result {
        Ok(output) if output.success() => output,
        _ => return Err(command_failure(&result)),
    };
    let mut line: GrantLine = json_line(&output.stdout)
        .and_then(|line| serde_json::from_str(line).ok())
        .ok_or("view_unavailable")?;
    if !line.ok {
        return Err(broker_reason(line.reason.as_deref()));
    }
    let token = Zeroizing::new(line.token.take().unwrap_or_default());
    match (line.port, line.path.as_deref(), line.session.take()) {
        (Some(port), Some(VIEW_PATH), Some(session))
            if port >= 1024 && valid_token(&token) && valid_session_id(&session) =>
        {
            Ok(ViewGrant {
                port,
                token,
                session,
            })
        }
        _ => Err("view_unavailable"),
    }
}

/// Always loopback: the window can only ever connect to this computer.
fn view_url(local_port: u16) -> String {
    format!("ws://127.0.0.1:{local_port}{VIEW_PATH}")
}

fn view_deadline(opened: Instant) -> Instant {
    opened + TOKEN_TTL + SESSION_MAX + DEADLINE_MARGIN
}

/// `ssh -N -L 127.0.0.1:<local>:127.0.0.1:<remote>` with the app's own SSH
/// options. Both ends are written out as 127.0.0.1: the forward never listens
/// on another interface here, and reaches only the VPS's loopback there.
fn tunnel_args(
    host: &ValidatedHost,
    local_port: u16,
    remote_port: u16,
) -> Result<Vec<OsString>, &'static str> {
    let mut args = ssh_base_args(host)?;
    let target = args.pop().ok_or("invalid_host")?;
    args.extend([
        "-N".into(),
        // debug1 says when the forward listens (wait_for_tunnel); it stays in
        // memory, never in a log.
        "-v".into(),
        "-o".into(),
        "ExitOnForwardFailure=yes".into(),
        "-o".into(),
        "GatewayPorts=no".into(),
        "-o".into(),
        "ServerAliveInterval=15".into(),
        "-L".into(),
        format!("127.0.0.1:{local_port}:127.0.0.1:{remote_port}").into(),
        target,
    ]);
    Ok(args)
}

/// A free port on this computer's loopback, chosen by the system.
fn free_loopback_port() -> Result<u16, &'static str> {
    TcpListener::bind(SocketAddrV4::new(Ipv4Addr::LOCALHOST, 0))
        .and_then(|listener| listener.local_addr())
        .map(|address| address.port())
        .map_err(|_| "tunnel_start_failed")
}

/// What ssh's stderr says about the forward.
#[derive(Debug, PartialEq, Eq)]
enum TunnelSignal {
    Ready,
    PortBusy,
}

/// Reads ssh -v in order. "Local forwarding listening on ..." comes BEFORE
/// the bind (seen live: it is followed by "Address already in use" when the
/// port is taken), so it is not proof. With ExitOnForwardFailure ssh only
/// reaches "Entering interactive session." once every forward is bound: that
/// line, after the announcement for our port, is the ready signal.
#[derive(Default)]
struct TunnelOutput {
    announced: bool,
}

impl TunnelOutput {
    fn feed(&mut self, line: &str, local_port: u16) -> Option<TunnelSignal> {
        if line.contains(&format!(
            "bind [127.0.0.1]:{local_port}: Address already in use"
        )) || line.contains(&format!("cannot listen to port: {local_port}"))
        {
            return Some(TunnelSignal::PortBusy);
        }
        if line.contains(&format!(
            "Local forwarding listening on 127.0.0.1 port {local_port}."
        )) {
            self.announced = true;
            return None;
        }
        (self.announced && line.contains("Entering interactive session."))
            .then_some(TunnelSignal::Ready)
    }
}

/// Reads ssh's stderr to the end, so a verbose ssh never blocks on a full
/// pipe, and passes on only what concerns the forward.
fn watch_tunnel_output(
    stderr: impl std::io::Read + Send + 'static,
    local_port: u16,
) -> mpsc::Receiver<TunnelSignal> {
    let (sender, receiver) = mpsc::channel();
    thread::spawn(move || {
        let mut output = TunnelOutput::default();
        for line in BufReader::new(stderr).lines() {
            let Ok(line) = line else { break };
            if let Some(signal) = output.feed(&line, local_port) {
                let _ = sender.send(signal);
            }
        }
    });
    receiver
}

fn port_taken(local_port: u16) -> bool {
    TcpListener::bind(SocketAddrV4::new(Ipv4Addr::LOCALHOST, local_port)).is_err()
}

/// Ready only when ssh itself says its forward on our port is bound
/// (TunnelOutput), and it is still running. A port that is merely taken may belong to another
/// program: that is `tunnel_port_busy`, never our tunnel. The port is never
/// connected to, so the broker's websockify sees nothing before the window.
fn wait_for_tunnel(
    child: &mut Child,
    signals: &mpsc::Receiver<TunnelSignal>,
    local_port: u16,
    within: Duration,
) -> Result<(), &'static str> {
    let started = Instant::now();
    let busy = |code: &'static str| {
        if port_taken(local_port) {
            "tunnel_port_busy"
        } else {
            code
        }
    };
    while started.elapsed() < within {
        match signals.recv_timeout(Duration::from_millis(100)) {
            Ok(TunnelSignal::Ready) => {
                return match child.try_wait() {
                    Ok(None) => Ok(()),
                    _ => Err("tunnel_start_failed"),
                };
            }
            Ok(TunnelSignal::PortBusy) => return Err("tunnel_port_busy"),
            Err(_) => {}
        }
        if !matches!(child.try_wait(), Ok(None)) {
            // Exited: a last look at what it said before going.
            return match signals.recv_timeout(Duration::from_millis(200)) {
                Ok(TunnelSignal::PortBusy) => Err("tunnel_port_busy"),
                _ => Err(busy("tunnel_start_failed")),
            };
        }
    }
    Err(busy("tunnel_verify_failed"))
}

fn spawn_tunnel(
    program: &str,
    args: Vec<OsString>,
    local_port: u16,
) -> Result<(Child, mpsc::Receiver<TunnelSignal>), &'static str> {
    let mut child = Command::new(program)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|_| "tunnel_start_failed")?;
    let stderr = child.stderr.take().ok_or("tunnel_start_failed")?;
    Ok((child, watch_tunnel_output(stderr, local_port)))
}

fn open_tunnel(host: &ValidatedHost, remote_port: u16) -> Result<(u16, Child), &'static str> {
    let local_port = free_loopback_port()?;
    let (mut child, signals) = spawn_tunnel(
        "ssh",
        tunnel_args(host, local_port, remote_port)?,
        local_port,
    )?;
    match wait_for_tunnel(&mut child, &signals, local_port, TUNNEL_READY_TIMEOUT) {
        Ok(()) => Ok((local_port, child)),
        Err(code) => {
            let _ = child.kill();
            let _ = child.wait();
            Err(code)
        }
    }
}

fn stop_tunnel(tunnel: Option<Child>) {
    if let Some(mut child) = tunnel {
        let _ = child.kill();
        let _ = child.wait();
    }
}

/// Takes the active view out of the state when it is due: `session` names the
/// view the timer was set for, so a later view is never closed by an old timer.
fn take_if_due(active: &mut Option<ActiveView>, session: &str, now: Instant) -> Option<ActiveView> {
    match active {
        Some(view) if view.session == session && now >= view.deadline => active.take(),
        _ => None,
    }
}

fn take_active(state: &BrokerViewState, session: Option<&str>) -> Option<ActiveView> {
    let mut active = state.active.lock().ok()?;
    match (active.as_ref(), session) {
        (Some(view), Some(session)) if view.session != session => None,
        _ => active.take(),
    }
}

/// Ends a view: the broker session first (its x11vnc stops, the WebSocket
/// closes normally), then the tunnel, then the window.
fn end_view(app: &tauri::AppHandle, view: ActiveView) {
    let _ = run_linkedin_command(
        app,
        &view.scope,
        &view.host,
        LocalCliOperation::LinkedinLoginStop,
        STOP_TIMEOUT,
    );
    stop_tunnel(view.tunnel);
    if let Some(window) = app.get_webview_window(WINDOW_LABEL) {
        let _ = window.close();
    }
}

fn close_view(app: &tauri::AppHandle, session: Option<&str>) {
    let Some(state) = app.try_state::<BrokerViewState>() else {
        return;
    };
    if let Some(view) = take_active(&state, session) {
        end_view(app, view);
    } else if session.is_none() {
        if let Some(window) = app.get_webview_window(WINDOW_LABEL) {
            let _ = window.close();
        }
    }
}

/// On account change or logout: the view belongs to the account that opened it.
pub(crate) fn teardown(app: &tauri::AppHandle) {
    close_view(app, None);
}

fn active_host(
    app: &tauri::AppHandle,
    scope: &AccountScope,
) -> Result<ValidatedHost, &'static str> {
    let host = crate::direct_chat::load_persisted_host(app, scope)?;
    validate_host(app, &host)
}

fn start_view(app: &tauri::AppHandle, scope: AccountScope) -> Result<ActiveView, &'static str> {
    let host = active_host(app, &scope)?;
    let grant = parse_grant(run_linkedin_command(
        app,
        &scope,
        &host,
        LocalCliOperation::LinkedinLogin,
        LOGIN_TIMEOUT,
    ))?;
    let opened = Instant::now();
    let (local_port, tunnel) = match &host {
        ValidatedHost::Local => (grant.port, None),
        ValidatedHost::Vps { .. } => match open_tunnel(&host, grant.port) {
            Ok((port, child)) => (port, Some(child)),
            Err(code) => {
                let _ = run_linkedin_command(
                    app,
                    &scope,
                    &host,
                    LocalCliOperation::LinkedinLoginStop,
                    STOP_TIMEOUT,
                );
                return Err(code);
            }
        },
    };
    Ok(ActiveView {
        session: grant.session,
        url: view_url(local_port),
        token: Some(grant.token),
        token_deadline: opened + TOKEN_TTL,
        deadline: view_deadline(opened),
        host,
        scope,
        tunnel,
    })
}

fn arm_deadline(app: tauri::AppHandle, session: String, deadline: Instant) {
    thread::spawn(move || {
        thread::sleep(deadline.saturating_duration_since(Instant::now()));
        let Some(state) = app.try_state::<BrokerViewState>() else {
            return;
        };
        let due = state
            .active
            .lock()
            .ok()
            .and_then(|mut active| take_if_due(&mut active, &session, Instant::now()));
        if let Some(view) = due {
            end_view(&app, view);
        }
    });
}

/// Opens the interactive login view, or brings it to the front. `async`: on
/// Windows a window created from a synchronous command blocks its own thread.
#[tauri::command]
pub(crate) async fn broker_login_view_open(
    app: tauri::AppHandle,
    state: State<'_, BrokerViewState>,
    scopes: State<'_, AccountScopeState>,
) -> Result<(), BrokerViewError> {
    let scope = scopes.active().map_err(failure)?;
    if app.get_webview_window(WINDOW_LABEL).is_some() {
        return crate::live_screen::open_window(&app, WINDOW_LABEL, WINDOW_PAGE, WINDOW_TITLE)
            .map(|_| ())
            .map_err(failure);
    }
    if state
        .opening
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        return Err(failure("operation_in_progress"));
    }
    // A view left without its window (closed while the app was busy) ends
    // before a new one starts: the broker allows one session at a time.
    if let Some(stale) = take_active(&state, None) {
        end_view(&app, stale);
    }
    let worker_app = app.clone();
    let started = tauri::async_runtime::spawn_blocking(move || start_view(&worker_app, scope))
        .await
        .unwrap_or(Err("view_unavailable"));
    let result = started.and_then(|view| {
        let session = view.session.clone();
        let deadline = view.deadline;
        if let Ok(mut active) = state.active.lock() {
            *active = Some(view);
        }
        match crate::live_screen::open_window(&app, WINDOW_LABEL, WINDOW_PAGE, WINDOW_TITLE) {
            Ok(window) => {
                if let Some(window) = window {
                    let closing_app = app.clone();
                    let closing_session = session.clone();
                    window.on_window_event(move |event| {
                        if matches!(event, WindowEvent::Destroyed) {
                            let app = closing_app.clone();
                            let session = closing_session.clone();
                            thread::spawn(move || close_view(&app, Some(&session)));
                        }
                    });
                }
                arm_deadline(app.clone(), session, deadline);
                Ok(())
            }
            Err(code) => {
                let app = app.clone();
                thread::spawn(move || close_view(&app, Some(&session)));
                Err(code)
            }
        }
    });
    state.opening.store(false, Ordering::Release);
    result.map_err(failure)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BrokerViewSession {
    url: String,
}

/// The connection URL for the view window, with the token: once per session.
#[tauri::command]
pub(crate) fn broker_login_view_session(
    state: State<'_, BrokerViewState>,
) -> Result<BrokerViewSession, BrokerViewError> {
    let mut active = state
        .active
        .lock()
        .map_err(|_| failure("view_unavailable"))?;
    let view = active.as_mut().ok_or_else(|| failure("token_expired"))?;
    let url = view.take_url(Instant::now()).map_err(failure)?;
    Ok(BrokerViewSession {
        url: url.to_string(),
    })
}

/// Ends the view: called by the window when the login is over.
#[tauri::command]
pub(crate) async fn broker_login_view_close(app: tauri::AppHandle) -> Result<(), BrokerViewError> {
    tauri::async_runtime::spawn_blocking(move || close_view(&app, None))
        .await
        .map_err(|_| failure("view_unavailable"))
}

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BrokerLoginStatus {
    view: &'static str,
    linkedin: &'static str,
    last_reason: Option<&'static str>,
}

#[derive(Deserialize)]
struct StatusLine {
    ok: bool,
    #[serde(default)]
    reason: Option<String>,
    #[serde(default)]
    view: Option<String>,
    #[serde(default)]
    linkedin: Option<String>,
    #[serde(default)]
    last_session: Option<LastSession>,
}

#[derive(Deserialize)]
struct LastSession {
    #[serde(default)]
    reason: Option<String>,
}

fn one_of(value: Option<&str>, allowed: &[&'static str]) -> Option<&'static str> {
    let value = value?;
    allowed
        .iter()
        .find(|candidate| **candidate == value)
        .copied()
}

/// `jht linkedin status --json`: only the known words come through.
fn parse_status(
    result: Result<ProcessResult, &'static str>,
) -> Result<BrokerLoginStatus, &'static str> {
    let output = match &result {
        Ok(output) if output.success() => output,
        _ => return Err(command_failure(&result)),
    };
    let line: StatusLine = json_line(&output.stdout)
        .and_then(|line| serde_json::from_str(line).ok())
        .ok_or("view_unavailable")?;
    if !line.ok {
        return Err(broker_reason(line.reason.as_deref()));
    }
    Ok(BrokerLoginStatus {
        view: one_of(line.view.as_deref(), &["idle", "waiting", "connected"])
            .ok_or("view_unavailable")?,
        linkedin: one_of(line.linkedin.as_deref(), &["logged_in", "login_required"])
            .ok_or("view_unavailable")?,
        last_reason: line.last_session.and_then(|last| {
            one_of(
                last.reason.as_deref(),
                &["logged_in", "token_expired", "login_timeout", "stopped"],
            )
        }),
    })
}

#[tauri::command]
pub(crate) async fn broker_login_status(
    app: tauri::AppHandle,
    scopes: State<'_, AccountScopeState>,
) -> Result<BrokerLoginStatus, BrokerViewError> {
    let scope = scopes.active().map_err(failure)?;
    tauri::async_runtime::spawn_blocking(move || {
        let host = active_host(&app, &scope)?;
        parse_status(run_linkedin_command(
            &app,
            &scope,
            &host,
            LocalCliOperation::LinkedinStatus,
            STATUS_TIMEOUT,
        ))
    })
    .await
    .unwrap_or(Err("view_unavailable"))
    .map_err(failure)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    const TOKEN: &str = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_AbCdE";

    fn output(code: i32, stdout: &str) -> Result<ProcessResult, &'static str> {
        Ok(ProcessResult {
            code,
            stdout: stdout.as_bytes().to_vec(),
        })
    }

    fn grant_line(port: u16, token: &str) -> String {
        format!(
            r#"{{"ok": true, "port": {port}, "path": "/websockify", "token": "{token}", "expires_at": "2026-10-08T10:00:00Z", "session": "a1b2c3d4e5f6"}}"#
        )
    }

    fn scope() -> AccountScope {
        AccountScope::synthetic_local(b"broker-view")
    }

    fn view(opened: Instant) -> ActiveView {
        ActiveView {
            session: "a1b2c3d4e5f6".to_owned(),
            url: view_url(6081),
            token: Some(Zeroizing::new(TOKEN.to_owned())),
            token_deadline: opened + TOKEN_TTL,
            deadline: view_deadline(opened),
            host: ValidatedHost::Local,
            scope: scope(),
            tunnel: None,
        }
    }

    fn vps() -> ValidatedHost {
        ValidatedHost::Vps {
            address: "203.0.113.10".to_owned(),
            user: "jht".to_owned(),
            port: 22,
            key_path: PathBuf::from("/synthetic/id_ed25519"),
            known_hosts: PathBuf::from("/synthetic/known_hosts"),
        }
    }

    #[test]
    fn the_token_is_handed_out_once_and_only_before_it_expires() {
        let opened = Instant::now();
        let mut active = view(opened);
        let url = active.take_url(opened).unwrap();
        assert_eq!(
            url.as_str(),
            format!("ws://127.0.0.1:6081/websockify?token={TOKEN}")
        );
        assert_eq!(active.take_url(opened).unwrap_err(), "token_expired");

        let mut late = view(opened);
        assert_eq!(
            late.take_url(opened + TOKEN_TTL).unwrap_err(),
            "token_expired"
        );
        // Asked too late, the token is gone even if the clock were wrong later.
        assert!(late.token.is_none());
    }

    #[test]
    fn the_view_closes_after_the_broker_limits_and_only_its_own_session() {
        let opened = Instant::now();
        let mut active = Some(view(opened));
        let deadline = view_deadline(opened);
        assert_eq!(deadline - opened, Duration::from_secs(120 + 15 * 60 + 30));

        assert!(take_if_due(
            &mut active,
            "a1b2c3d4e5f6",
            deadline - Duration::from_secs(1)
        )
        .is_none());
        assert!(active.is_some());
        assert!(take_if_due(&mut active, "ffffffffffff", deadline).is_none());
        assert!(active.is_some());
        let due = take_if_due(&mut active, "a1b2c3d4e5f6", deadline).unwrap();
        assert_eq!(due.session, "a1b2c3d4e5f6");
        assert!(active.is_none());
    }

    #[test]
    fn the_window_connects_only_to_this_computers_loopback() {
        assert_eq!(view_url(6081), "ws://127.0.0.1:6081/websockify");
        let port = free_loopback_port().unwrap();
        assert!(port > 0);

        let args: Vec<String> = tunnel_args(&vps(), 50123, 6081)
            .unwrap()
            .into_iter()
            .map(|arg| arg.to_string_lossy().into_owned())
            .collect();
        let forward = args.iter().position(|arg| arg == "-L").unwrap();
        assert_eq!(args[forward + 1], "127.0.0.1:50123:127.0.0.1:6081");
        assert_eq!(args.iter().filter(|arg| *arg == "-L").count(), 1);
        for option in [
            "ExitOnForwardFailure=yes",
            "GatewayPorts=no",
            "StrictHostKeyChecking=yes",
            "BatchMode=yes",
        ] {
            assert!(args.iter().any(|arg| arg == option), "{option}");
        }
        assert!(args.contains(&"-N".to_owned()));
        assert!(!args
            .iter()
            .any(|arg| arg.contains("0.0.0.0") || arg == "-R" || arg == "-D" || arg == "-g"));
        assert_eq!(args.last().unwrap(), "jht@203.0.113.10");
        assert_eq!(
            tunnel_args(&ValidatedHost::Local, 1, 2).unwrap_err(),
            "not_vps"
        );
    }

    #[test]
    fn a_grant_is_accepted_only_inside_the_contract() {
        let grant = parse_grant(output(
            0,
            &format!("wrapper notice\n{}\n", grant_line(6081, TOKEN)),
        ))
        .unwrap();
        assert_eq!(grant.port, 6081);
        assert_eq!(grant.token.as_str(), TOKEN);
        assert_eq!(grant.session, "a1b2c3d4e5f6");

        for bad in [
            grant_line(80, TOKEN),
            grant_line(6081, "short"),
            grant_line(6081, &format!("{}=", &TOKEN[..42])),
            grant_line(6081, &format!("{}/", &TOKEN[..42])),
            grant_line(6081, TOKEN).replace("/websockify", "/other"),
            grant_line(6081, TOKEN).replace("a1b2c3d4e5f6", "../../x"),
            grant_line(6081, TOKEN).replace(r#""session": "a1b2c3d4e5f6""#, r#""session": """#),
            r#"{"ok": true}"#.to_owned(),
            "not json".to_owned(),
            String::new(),
        ] {
            assert_eq!(
                parse_grant(output(0, &bad)).err(),
                Some("view_unavailable"),
                "{bad}"
            );
        }
    }

    #[test]
    fn the_brokers_reasons_come_through_and_nothing_else() {
        for reason in BROKER_REASONS {
            let line = format!(r#"{{"ok": false, "reason": "{reason}"}}"#);
            assert_eq!(parse_grant(output(1, &line)).err(), Some(reason));
            assert_eq!(parse_status(output(1, &line)).err(), Some(reason));
        }
        for line in [
            r#"{"ok": false, "reason": "view_purpose_unknown"}"#,
            r#"{"ok": false, "reason": "a free text with a secret"}"#,
            r#"{"ok": false}"#,
            "Traceback (most recent call last)",
        ] {
            assert_eq!(
                parse_grant(output(1, line)).err(),
                Some("view_unavailable"),
                "{line}"
            );
        }
        assert_eq!(parse_grant(Err("process_timeout")).err(), Some("timeout"));
        assert_eq!(
            parse_grant(Err("ssh_unavailable")).err(),
            Some("view_unavailable")
        );
        assert_eq!(
            parse_grant(Err("runtime_missing")).err(),
            Some("runtime_missing")
        );
        assert_eq!(
            parse_grant(Err("account_scope_changed")).err(),
            Some("account_scope_changed")
        );
    }

    #[test]
    fn the_status_reads_only_known_words() {
        let status = parse_status(output(
            0,
            r#"{"ok": true, "view": "idle", "linkedin": "logged_in", "last_session": {"ended": "2026-10-08T10:00:00Z", "reason": "logged_in"}}"#,
        ))
        .unwrap();
        assert_eq!(
            status,
            BrokerLoginStatus {
                view: "idle",
                linkedin: "logged_in",
                last_reason: Some("logged_in"),
            }
        );
        let waiting = parse_status(output(
            0,
            r#"{"ok": true, "view": "waiting", "linkedin": "login_required"}"#,
        ))
        .unwrap();
        assert_eq!(waiting.last_reason, None);
        let odd_reason = parse_status(output(
            0,
            r#"{"ok": true, "view": "idle", "linkedin": "login_required", "last_session": {"reason": "crashed"}}"#,
        ))
        .unwrap();
        assert_eq!(odd_reason.last_reason, None);
        for bad in [
            r#"{"ok": true, "view": "recording", "linkedin": "logged_in"}"#,
            r#"{"ok": true, "view": "idle", "linkedin": "maybe"}"#,
        ] {
            assert_eq!(
                parse_status(output(0, bad)).err(),
                Some("view_unavailable"),
                "{bad}"
            );
        }
    }

    /// A Sec-WebSocket-Key: base64 of 16 bytes, built here rather than written
    /// as a literal, which a secret scan would read as a key.
    fn websocket_key() -> String {
        const ALPHABET: &[u8; 64] =
            b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        let nonce: Vec<u8> = (0u8..16)
            .map(|index| index.wrapping_mul(37) ^ 0x5a)
            .collect();
        let mut key = String::new();
        for chunk in nonce.chunks(3) {
            let bits = chunk.iter().enumerate().fold(0u32, |bits, (index, byte)| {
                bits | (u32::from(*byte) << (16 - 8 * index))
            });
            for position in 0..4 {
                if position <= chunk.len() {
                    key.push(char::from(
                        ALPHABET[((bits >> (18 - 6 * position)) & 63) as usize],
                    ));
                } else {
                    key.push('=');
                }
            }
        }
        key
    }

    /// One WebSocket handshake to `url` and whatever comes back in 3 s.
    fn websocket_probe(url: &str) -> Vec<u8> {
        use std::io::{Read, Write};
        let rest = url.strip_prefix("ws://").unwrap();
        let (authority, path) = rest.split_at(rest.find('/').unwrap());
        let mut stream = std::net::TcpStream::connect(authority).unwrap();
        stream
            .set_read_timeout(Some(Duration::from_millis(500)))
            .unwrap();
        let key = websocket_key();
        write!(
            stream,
            "GET {path} HTTP/1.1\r\nHost: {authority}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Protocol: binary\r\n\r\n"
        )
        .unwrap();
        let mut received = Vec::new();
        let started = Instant::now();
        let mut buffer = [0u8; 4096];
        while started.elapsed() < Duration::from_secs(3) {
            match stream.read(&mut buffer) {
                Ok(0) => break,
                Ok(count) => received.extend_from_slice(&buffer[..count]),
                Err(_) => {}
            }
        }
        received
    }

    #[test]
    fn the_probe_key_is_sixteen_bytes_of_base64() {
        let key = websocket_key();
        assert_eq!(key.len(), 24);
        assert!(key.ends_with("=="));
        assert_eq!(key.matches('=').count(), 2);
    }

    fn rfb_greeting(bytes: &[u8]) -> bool {
        bytes.windows(8).any(|window| window == b"RFB 003.")
    }

    /// Live check against a test broker reached by SSH, like a VPS. Not run by
    /// default: `cargo test --lib live_ -- --ignored` with
    /// JHT_LIVE_BROKER_SSH=user@host:port, JHT_LIVE_BROKER_KEY and
    /// JHT_LIVE_BROKER_KNOWN_HOSTS. With JHT_LIVE_BROKER_URL_OUT the one-time
    /// URL goes to that file for a real noVNC client, and the test waits for
    /// `<file>.done`; JHT_LIVE_BROKER_EXPIRY=1 also waits out a token.
    #[test]
    #[ignore]
    fn live_one_time_view_through_the_ssh_tunnel() {
        use crate::onboarding::{REMOTE_LINKEDIN_LOGIN, REMOTE_LINKEDIN_LOGIN_STOP};
        use crate::runtime_host::run_ssh;
        let target = std::env::var("JHT_LIVE_BROKER_SSH").unwrap();
        let (user, rest) = target.split_once('@').unwrap();
        let (address, port) = rest.rsplit_once(':').unwrap();
        let host = ValidatedHost::Vps {
            address: address.to_owned(),
            user: user.to_owned(),
            port: port.parse().unwrap(),
            key_path: PathBuf::from(std::env::var("JHT_LIVE_BROKER_KEY").unwrap()),
            known_hosts: PathBuf::from(std::env::var("JHT_LIVE_BROKER_KNOWN_HOSTS").unwrap()),
        };
        let login = || {
            parse_grant(run_ssh(
                &host,
                REMOTE_LINKEDIN_LOGIN,
                None,
                LOGIN_TIMEOUT,
                None,
            ))
        };
        let stop = || run_ssh(&host, REMOTE_LINKEDIN_LOGIN_STOP, None, STOP_TIMEOUT, None);

        let grant = login().unwrap();
        // One session at a time.
        assert_eq!(login().err(), Some("view_busy"));
        let (local_port, tunnel) = open_tunnel(&host, grant.port).unwrap();
        let listening = String::from_utf8(
            Command::new("lsof")
                .args(["-nP", &format!("-iTCP:{local_port}"), "-sTCP:LISTEN"])
                .output()
                .unwrap()
                .stdout,
        )
        .unwrap();
        assert!(
            listening.contains(&format!("127.0.0.1:{local_port}")),
            "{listening}"
        );
        assert!(
            !listening.contains(&format!("*:{local_port}")),
            "{listening}"
        );
        println!(
            "tunnel on 127.0.0.1:{local_port} -> remote 127.0.0.1:{}",
            grant.port
        );

        // A real ssh on a port another program holds: refused, not ready.
        let foreign_port = free_loopback_port().unwrap();
        let foreign =
            TcpListener::bind(SocketAddrV4::new(Ipv4Addr::LOCALHOST, foreign_port)).unwrap();
        let (mut busy, busy_signals) = spawn_tunnel(
            "ssh",
            tunnel_args(&host, foreign_port, grant.port).unwrap(),
            foreign_port,
        )
        .unwrap();
        assert_eq!(
            wait_for_tunnel(&mut busy, &busy_signals, foreign_port, TUNNEL_READY_TIMEOUT)
                .unwrap_err(),
            "tunnel_port_busy"
        );
        let _ = busy.kill();
        let _ = busy.wait();
        drop(foreign);
        println!("ssh on a port held by another program: tunnel_port_busy");

        let opened = Instant::now();
        let mut active = ActiveView {
            session: grant.session.clone(),
            url: view_url(local_port),
            token: Some(grant.token),
            token_deadline: opened + TOKEN_TTL,
            deadline: view_deadline(opened),
            host: host.clone(),
            scope: scope(),
            tunnel: Some(tunnel),
        };
        let url = active.take_url(Instant::now()).unwrap();
        assert_eq!(
            active.take_url(Instant::now()).unwrap_err(),
            "token_expired"
        );

        match std::env::var("JHT_LIVE_BROKER_URL_OUT") {
            Ok(out) => {
                std::fs::write(&out, url.as_bytes()).unwrap();
                let done = PathBuf::from(format!("{out}.done"));
                let waiting = Instant::now();
                while !done.exists() && waiting.elapsed() < Duration::from_secs(600) {
                    thread::sleep(Duration::from_millis(500));
                }
                std::fs::remove_file(&out).ok();
                assert!(done.exists(), "no noVNC client finished");
            }
            Err(_) => {
                let first = websocket_probe(&url);
                assert!(
                    first.starts_with(b"HTTP/1.1 101"),
                    "{}",
                    String::from_utf8_lossy(&first)
                );
                assert!(rfb_greeting(&first), "first use must reach x11vnc");
            }
        }
        // The same token again: refused (websockify gets the dead target).
        let second = websocket_probe(&url);
        assert!(
            !rfb_greeting(&second),
            "a used token must not reach the screen"
        );
        println!(
            "second use refused: {} bytes, no RFB greeting",
            second.len()
        );

        stop().unwrap();
        stop_tunnel(active.tunnel.take());
        assert!(TcpListener::bind(SocketAddrV4::new(Ipv4Addr::LOCALHOST, local_port)).is_ok());

        if std::env::var("JHT_LIVE_BROKER_EXPIRY").is_ok() {
            let grant = login().unwrap();
            let (local_port, tunnel) = open_tunnel(&host, grant.port).unwrap();
            thread::sleep(TOKEN_TTL + Duration::from_secs(5));
            let late = websocket_probe(&format!(
                "{}?token={}",
                view_url(local_port),
                grant.token.as_str()
            ));
            assert!(
                !rfb_greeting(&late),
                "an expired token must not reach the screen"
            );
            println!("token unused for {}s refused", TOKEN_TTL.as_secs() + 5);
            stop().unwrap();
            stop_tunnel(Some(tunnel));
        }
    }

    /// A stand-in for ssh: `sh -c <script>`, stderr read like ssh's.
    #[cfg(unix)]
    fn fake_ssh(script: &str, port: u16) -> (Child, mpsc::Receiver<TunnelSignal>) {
        spawn_tunnel("sh", vec!["-c".into(), script.into()], port).unwrap()
    }

    #[cfg(unix)]
    fn finish(mut child: Child) {
        let _ = child.kill();
        let _ = child.wait();
    }

    #[cfg(unix)]
    #[test]
    fn a_port_taken_by_another_program_is_never_our_tunnel() {
        let within = Duration::from_millis(800);
        let port = free_loopback_port().unwrap();
        let foreign = TcpListener::bind(SocketAddrV4::new(Ipv4Addr::LOCALHOST, port)).unwrap();
        // ssh alive and silent while someone else holds the port: the old
        // check (the port is taken) called this ready.
        let (mut child, signals) = fake_ssh("exec sleep 30", port);
        let started = Instant::now();
        assert_eq!(
            wait_for_tunnel(&mut child, &signals, port, within).unwrap_err(),
            "tunnel_port_busy"
        );
        assert!(started.elapsed() >= within);
        finish(child);

        // What ssh with ExitOnForwardFailure says and does on a taken port.
        let (mut child, signals) = fake_ssh(
            &format!("echo 'bind [127.0.0.1]:{port}: Address already in use' >&2; echo 'channel_setup_fwd_listener_tcpip: cannot listen to port: {port}' >&2; exit 255"),
            port,
        );
        assert_eq!(
            wait_for_tunnel(&mut child, &signals, port, within).unwrap_err(),
            "tunnel_port_busy"
        );
        finish(child);
        drop(foreign);
    }

    /// What a real ssh -v prints around a forward that binds (seen live on
    /// OpenSSH, 08/10/2026).
    #[cfg(unix)]
    fn bound_forward(port: u16) -> String {
        format!(
            "echo 'debug1: Local connections to 127.0.0.1:{port} forwarded to remote address 127.0.0.1:6081' >&2; \
             echo 'debug1: Local forwarding listening on 127.0.0.1 port {port}.' >&2; \
             echo 'debug1: channel 0: new port-listener [port listener] (inactive timeout: 0)' >&2; \
             echo 'debug1: Entering interactive session.' >&2"
        )
    }

    #[cfg(unix)]
    #[test]
    fn a_tunnel_is_ready_only_when_ssh_has_bound_its_forward() {
        let within = Duration::from_millis(800);
        let port = free_loopback_port().unwrap();

        let (mut child, signals) =
            fake_ssh(&format!("{}; exec sleep 30", bound_forward(port)), port);
        assert!(wait_for_tunnel(&mut child, &signals, port, within).is_ok());
        finish(child);

        // The real order on a taken port: announced, then refused, then gone.
        let (mut child, signals) = fake_ssh(
            &format!(
                "echo 'debug1: Local forwarding listening on 127.0.0.1 port {port}.' >&2; \
                      echo 'bind [127.0.0.1]:{port}: Address already in use' >&2; \
                      echo 'channel_setup_fwd_listener_tcpip: cannot listen to port: {port}' >&2; \
                      echo 'Could not request local forwarding.' >&2; exit 255"
            ),
            port,
        );
        assert_eq!(
            wait_for_tunnel(&mut child, &signals, port, within).unwrap_err(),
            "tunnel_port_busy"
        );
        finish(child);

        // Announced but never bound: not ready.
        let (mut child, signals) = fake_ssh(
            &format!("echo 'debug1: Local forwarding listening on 127.0.0.1 port {port}.' >&2; exec sleep 30"),
            port,
        );
        assert_eq!(
            wait_for_tunnel(&mut child, &signals, port, within).unwrap_err(),
            "tunnel_verify_failed"
        );
        finish(child);

        // Bound for another port is not ours.
        let other = port.wrapping_add(1);
        let (mut child, signals) =
            fake_ssh(&format!("{}; exec sleep 30", bound_forward(other)), port);
        assert_eq!(
            wait_for_tunnel(&mut child, &signals, port, within).unwrap_err(),
            "tunnel_verify_failed"
        );
        finish(child);

        // Bound, then died: not a tunnel.
        let (mut child, signals) = fake_ssh(&format!("{}; exit 0", bound_forward(port)), port);
        thread::sleep(Duration::from_millis(200));
        assert_eq!(
            wait_for_tunnel(&mut child, &signals, port, within).unwrap_err(),
            "tunnel_start_failed"
        );
        finish(child);

        // Exited without a word, the port free.
        let (mut child, signals) = fake_ssh("exit 255", port);
        assert_eq!(
            wait_for_tunnel(&mut child, &signals, port, within).unwrap_err(),
            "tunnel_start_failed"
        );
        finish(child);
    }

    #[test]
    fn only_sshs_own_lines_about_our_port_count() {
        let mut output = TunnelOutput::default();
        // Entering the session before our port was announced proves nothing.
        assert_eq!(
            output.feed("debug1: Entering interactive session.", 50123),
            None
        );
        assert_eq!(
            output.feed(
                "debug1: Local forwarding listening on 127.0.0.1 port 501234.",
                50123
            ),
            None
        );
        assert_eq!(
            output.feed(
                "debug1: Local forwarding listening on ::1 port 50123.",
                50123
            ),
            None
        );
        assert_eq!(
            output.feed("debug1: Entering interactive session.", 50123),
            None
        );
        assert_eq!(
            output.feed(
                "debug1: Local forwarding listening on 127.0.0.1 port 50123.",
                50123
            ),
            None
        );
        assert_eq!(
            output.feed("debug1: Entering interactive session.", 50123),
            Some(TunnelSignal::Ready)
        );
        assert_eq!(
            TunnelOutput::default().feed("bind [127.0.0.1]:50123: Address already in use", 50123),
            Some(TunnelSignal::PortBusy)
        );
    }
}
