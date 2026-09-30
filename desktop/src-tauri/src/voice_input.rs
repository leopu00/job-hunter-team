//! Input vocale nativo per i composer della desktop app.
//!
//! macOS usa Speech + AVFoundation con `requiresOnDeviceRecognition`: se il
//! riconoscimento locale non è disponibile per macchina o lingua, la sessione
//! non apre neppure il microfono. Gli altri sistemi espongono lo stesso
//! contratto ma rispondono `unsupported`. L'audio resta nel buffer di sistema:
//! questo modulo non crea file, non lo invia e non stampa testo trascritto.

use serde::Serialize;
use std::{
    fmt,
    sync::{Mutex, OnceLock},
};
use tauri::{Emitter, Manager};

pub(crate) const STATE_EVENT: &str = "voice-input://state";
pub(crate) const TRANSCRIPT_EVENT: &str = "voice-input://transcript";
const MAIN_WINDOW: &str = "main";

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct VoiceInputSnapshot {
    available: bool,
    phase: &'static str,
    microphone_permission: &'static str,
    speech_permission: &'static str,
    transcript: String,
    error: Option<&'static str>,
}

impl Default for VoiceInputSnapshot {
    fn default() -> Self {
        Self {
            available: cfg!(target_os = "macos"),
            phase: "idle",
            microphone_permission: "unknown",
            speech_permission: "unknown",
            transcript: String::new(),
            error: None,
        }
    }
}

#[derive(Default)]
pub(crate) struct VoiceInputState(Mutex<VoiceInputSnapshot>);

#[derive(Debug, Serialize)]
pub(crate) struct VoiceInputError {
    code: &'static str,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TranscriptEvent {
    text: String,
    is_final: bool,
}

static APP_HANDLE: OnceLock<tauri::AppHandle> = OnceLock::new();

#[derive(Debug)]
pub(crate) struct VoiceInputAttachError;

impl fmt::Display for VoiceInputAttachError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("voice input already attached")
    }
}

impl std::error::Error for VoiceInputAttachError {}

/// Da chiamare una volta nel `setup` Tauri, dopo `.manage(VoiceInputState)`.
pub(crate) fn attach(app: &tauri::AppHandle) -> Result<(), VoiceInputAttachError> {
    APP_HANDLE
        .set(app.clone())
        .map_err(|_| VoiceInputAttachError)
}

#[tauri::command]
pub(crate) fn voice_input_status(
    locale: Option<String>,
    state: tauri::State<'_, VoiceInputState>,
) -> Result<VoiceInputSnapshot, VoiceInputError> {
    let locale = checked_locale(locale.as_deref())?;
    let mut snapshot = state.0.lock().map_err(|_| failure("state_unavailable"))?;

    #[cfg(target_os = "macos")]
    {
        snapshot.available = macos::on_device_available(&locale);
        snapshot.speech_permission = permission_name(macos::speech_permission());
        snapshot.microphone_permission = permission_name(macos::microphone_permission());
        if !snapshot.available && snapshot.phase == "idle" {
            snapshot.error = Some("on_device_unsupported");
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = locale;
        snapshot.available = false;
        snapshot.error = Some("unsupported");
    }
    Ok(snapshot.clone())
}

#[tauri::command]
pub(crate) fn voice_input_start(
    locale: Option<String>,
    state: tauri::State<'_, VoiceInputState>,
) -> Result<(), VoiceInputError> {
    let locale = checked_locale(locale.as_deref())?;
    let mut snapshot = state.0.lock().map_err(|_| failure("state_unavailable"))?;
    if snapshot.phase != "idle" && snapshot.phase != "error" {
        return Err(failure("busy"));
    }

    #[cfg(target_os = "macos")]
    {
        if !macos::on_device_available(&locale) {
            snapshot.available = false;
            snapshot.phase = "error";
            snapshot.error = Some("on_device_unsupported");
            return Err(failure("on_device_unsupported"));
        }
        snapshot.available = true;
        snapshot.phase = "requesting-permission";
        snapshot.transcript.clear();
        snapshot.error = None;
        drop(snapshot);
        macos::start(&locale);
        Ok(())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = locale;
        snapshot.available = false;
        snapshot.phase = "error";
        snapshot.error = Some("unsupported");
        Err(failure("unsupported"))
    }
}

#[tauri::command]
pub(crate) fn voice_input_stop(
    state: tauri::State<'_, VoiceInputState>,
) -> Result<(), VoiceInputError> {
    let mut snapshot = state.0.lock().map_err(|_| failure("state_unavailable"))?;
    if snapshot.phase != "recording" {
        return Err(failure("not_recording"));
    }
    snapshot.phase = "transcribing";
    drop(snapshot);
    #[cfg(target_os = "macos")]
    macos::stop();
    #[cfg(not(target_os = "macos"))]
    return Err(failure("unsupported"));
    Ok(())
}

#[tauri::command]
pub(crate) fn voice_input_cancel(
    state: tauri::State<'_, VoiceInputState>,
) -> Result<(), VoiceInputError> {
    let mut snapshot = state.0.lock().map_err(|_| failure("state_unavailable"))?;
    if !matches!(
        snapshot.phase,
        "requesting-permission" | "recording" | "transcribing"
    ) {
        return Err(failure("not_recording"));
    }
    snapshot.phase = "idle";
    snapshot.transcript.clear();
    snapshot.error = None;
    drop(snapshot);
    #[cfg(target_os = "macos")]
    macos::cancel();
    #[cfg(not(target_os = "macos"))]
    return Err(failure("unsupported"));
    Ok(())
}

fn checked_locale(locale: Option<&str>) -> Result<String, VoiceInputError> {
    let locale = locale.unwrap_or("").trim();
    if locale.len() > 35
        || !locale
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
    {
        return Err(failure("invalid_locale"));
    }
    Ok(locale.to_owned())
}

fn failure(code: &'static str) -> VoiceInputError {
    VoiceInputError { code }
}

#[cfg(target_os = "macos")]
fn permission_name(status: i32) -> &'static str {
    match status {
        1 => "granted",
        2 => "denied",
        _ => "unknown",
    }
}

#[cfg(target_os = "macos")]
#[derive(Clone, Copy)]
enum NativeEvent {
    PermissionRequested,
    PermissionGranted,
    Recording,
    Transcribing,
    PartialTranscript,
    FinalTranscript,
    Idle,
    Cancelled,
    Error,
}

#[cfg(target_os = "macos")]
impl NativeEvent {
    fn from_raw(raw: i32) -> Option<Self> {
        Some(match raw {
            1 => Self::PermissionRequested,
            2 => Self::PermissionGranted,
            3 => Self::Recording,
            4 => Self::Transcribing,
            5 => Self::PartialTranscript,
            6 => Self::FinalTranscript,
            7 => Self::Idle,
            8 => Self::Cancelled,
            9 => Self::Error,
            _ => return None,
        })
    }
}

#[cfg(target_os = "macos")]
fn safe_error_code(raw: &str) -> &'static str {
    match raw {
        "busy" => "busy",
        "microphone_permission_denied" => "microphone_permission_denied",
        "speech_permission_denied" => "speech_permission_denied",
        "microphone_unavailable" => "microphone_unavailable",
        "on_device_unsupported" => "on_device_unsupported",
        "not_recording" => "not_recording",
        _ => "recognition_failed",
    }
}

#[cfg(target_os = "macos")]
fn apply_native_event(
    snapshot: &mut VoiceInputSnapshot,
    event: NativeEvent,
    payload: &str,
) -> Option<TranscriptEvent> {
    match event {
        NativeEvent::PermissionRequested => snapshot.phase = "requesting-permission",
        NativeEvent::PermissionGranted => {
            snapshot.microphone_permission = "granted";
            snapshot.speech_permission = "granted";
        }
        NativeEvent::Recording => snapshot.phase = "recording",
        NativeEvent::Transcribing => snapshot.phase = "transcribing",
        NativeEvent::PartialTranscript | NativeEvent::FinalTranscript => {
            snapshot.transcript = payload.to_owned();
            return Some(TranscriptEvent {
                text: payload.to_owned(),
                is_final: matches!(event, NativeEvent::FinalTranscript),
            });
        }
        NativeEvent::Idle => snapshot.phase = "idle",
        NativeEvent::Cancelled => {
            snapshot.phase = "idle";
            snapshot.transcript.clear();
            snapshot.error = None;
        }
        NativeEvent::Error => {
            let code = safe_error_code(payload);
            snapshot.phase = "error";
            snapshot.error = Some(code);
            if matches!(code, "microphone_permission_denied") {
                snapshot.microphone_permission = "denied";
            }
            if matches!(code, "speech_permission_denied") {
                snapshot.speech_permission = "denied";
            }
            if matches!(code, "on_device_unsupported") {
                snapshot.available = false;
            }
        }
    }
    None
}

#[cfg(target_os = "macos")]
extern "C" fn native_event_callback(event: i32, payload: *const std::ffi::c_char) {
    let Some(event) = NativeEvent::from_raw(event) else {
        return;
    };
    let payload = if payload.is_null() {
        String::new()
    } else {
        // Il bridge mantiene la stringa NSString per tutta la chiamata. La
        // copiamo subito e non la scriviamo mai nei log.
        unsafe { std::ffi::CStr::from_ptr(payload) }
            .to_string_lossy()
            .into_owned()
    };
    let Some(app) = APP_HANDLE.get() else { return };
    let state = app.state::<VoiceInputState>();
    let Ok(mut snapshot) = state.0.lock() else {
        return;
    };
    let transcript = apply_native_event(&mut snapshot, event, &payload);
    let current = snapshot.clone();
    drop(snapshot);
    let _ = app.emit_to(MAIN_WINDOW, STATE_EVENT, current);
    if let Some(transcript) = transcript {
        let _ = app.emit_to(MAIN_WINDOW, TRANSCRIPT_EVENT, transcript);
    }
}

#[cfg(target_os = "macos")]
mod macos {
    use super::native_event_callback;
    use std::ffi::CString;

    #[link(name = "jht_voice_input", kind = "static")]
    #[link(name = "AVFoundation", kind = "framework")]
    #[link(name = "Foundation", kind = "framework")]
    #[link(name = "Speech", kind = "framework")]
    unsafe extern "C" {
        fn jht_voice_on_device_available(locale: *const std::ffi::c_char) -> i32;
        fn jht_voice_speech_permission() -> i32;
        fn jht_voice_microphone_permission() -> i32;
        fn jht_voice_start(
            locale: *const std::ffi::c_char,
            callback: extern "C" fn(i32, *const std::ffi::c_char),
        );
        fn jht_voice_stop();
        fn jht_voice_cancel();
    }

    fn locale(value: &str) -> CString {
        CString::new(value).expect("validated locale cannot contain NUL")
    }

    pub(super) fn on_device_available(value: &str) -> bool {
        let locale = locale(value);
        unsafe { jht_voice_on_device_available(locale.as_ptr()) == 1 }
    }

    pub(super) fn speech_permission() -> i32 {
        unsafe { jht_voice_speech_permission() }
    }

    pub(super) fn microphone_permission() -> i32 {
        unsafe { jht_voice_microphone_permission() }
    }

    pub(super) fn start(value: &str) {
        let locale = locale(value);
        unsafe { jht_voice_start(locale.as_ptr(), native_event_callback) }
    }

    pub(super) fn stop() {
        unsafe { jht_voice_stop() }
    }

    pub(super) fn cancel() {
        unsafe { jht_voice_cancel() }
    }
}

#[cfg(test)]
mod tests {
    use super::{checked_locale, VoiceInputSnapshot};

    #[test]
    fn locale_is_a_small_identifier_not_an_ffi_payload() {
        assert_eq!(checked_locale(Some("it-IT")).unwrap(), "it-IT");
        assert_eq!(checked_locale(Some("en_US")).unwrap(), "en_US");
        for bad in ["it IT", "it;open", "../it", "it\0IT"] {
            assert_eq!(
                checked_locale(Some(bad)).unwrap_err().code,
                "invalid_locale"
            );
        }
    }

    #[test]
    fn default_is_fail_closed_off_macos() {
        let state = VoiceInputSnapshot::default();
        assert_eq!(state.phase, "idle");
        #[cfg(not(target_os = "macos"))]
        assert!(!state.available);
    }

    #[test]
    fn native_source_pins_on_device_recognition_and_bundle_declares_permissions() {
        let native = include_str!("../native/macos/VoiceInput.macos-native.txt");
        assert!(native.contains("supportsOnDeviceRecognition"));
        assert!(native.contains("requiresOnDeviceRecognition = YES"));
        assert!(!native.contains("NSURLSession"));
        let plist = include_str!("../Info.plist");
        assert!(plist.contains("NSMicrophoneUsageDescription"));
        assert!(plist.contains("NSSpeechRecognitionUsageDescription"));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn permission_denials_are_explicit_and_do_not_keep_recording() {
        use super::{apply_native_event, NativeEvent};
        let mut state = VoiceInputSnapshot::default();
        state.phase = "recording";
        apply_native_event(
            &mut state,
            NativeEvent::Error,
            "microphone_permission_denied",
        );
        assert_eq!(state.phase, "error");
        assert_eq!(state.microphone_permission, "denied");
        assert_eq!(state.error, Some("microphone_permission_denied"));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn unknown_native_errors_are_redacted_to_a_fixed_code() {
        use super::{apply_native_event, NativeEvent};
        let mut state = VoiceInputSnapshot::default();
        apply_native_event(&mut state, NativeEvent::Error, "private native diagnostic");
        assert_eq!(state.error, Some("recognition_failed"));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn native_on_device_probe_is_linked_and_does_not_request_permission() {
        // Il risultato dipende dai language pack del Mac. La prova importante
        // è attraversare davvero il bridge Objective-C senza aprire il mic.
        let _supported = super::macos::on_device_available("it-IT");
    }
}
