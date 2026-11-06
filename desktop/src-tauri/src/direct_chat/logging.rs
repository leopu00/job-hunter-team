use super::*;

/// How long a call of the chat may take before it is written to the runtime log although it worked: a window that
/// "does not answer" is a call that is slow, and the log must say which one and for how long.
pub(super) const SLOW_CHAT_CALL: Duration = Duration::from_secs(5);
/// A slow call of the same kind is written again after this long, not at every slow call.
pub(super) const SLOW_CHAT_CALL_AGAIN: Duration = Duration::from_secs(30);

/// What was last written to the runtime log for one kind of call: its failure (a read that fails every two seconds
/// writes one line, and a new one only when its code changes; a call that works ends the failure) and when a slow one was.
#[derive(Clone, Copy)]
pub(super) struct LoggedCall {
    pub(super) failure: Option<(&'static str, Option<&'static str>)>,
    pub(super) slow_at: Option<Instant>,
}

impl LoggedCall {
    pub(super) const NONE: Self = Self { failure: None, slow_at: None };
}

pub(super) static LOGGED_CHAT_CALL: Mutex<[LoggedCall; 6]> = Mutex::new([LoggedCall::NONE; 6]);

/// What a call of the chat leaves in the log, by the rules above: `None` when nothing new is to be said. A failure
/// is written when it is not the one just written; a call that worked is written only when it was slow, and not
/// again before `SLOW_CHAT_CALL_AGAIN`.
pub(super) fn chat_call_line(
    last: &mut LoggedCall,
    outcome: Result<(), (&'static str, Option<&'static str>)>,
    took: Duration,
    now: Instant,
) -> Option<(&'static str, Option<&'static str>)> {
    match outcome {
        Err(failure) => {
            if last.failure == Some(failure) {
                return None;
            }
            last.failure = Some(failure);
            Some(failure)
        }
        Ok(()) => {
            last.failure = None;
            if took < SLOW_CHAT_CALL || last.slow_at.is_some_and(|at| now.saturating_duration_since(at) < SLOW_CHAT_CALL_AGAIN) {
                return None;
            }
            last.slow_at = Some(now);
            Some(("ok_slow", None))
        }
    }
}

/// The rule the last container check stopped at, in the fixed words of `runtime_log::ATTEST_REASONS`; it
/// goes to the runtime log with the failure it explains, and nowhere else.
pub(super) static ATTEST_REASON: Mutex<Option<&'static str>> = Mutex::new(None);

pub(super) fn note_attest_reason(reason: &'static str) {
    if let Ok(mut said) = ATTEST_REASON.lock() {
        *said = Some(reason);
    }
}

/// A call of the chat (`runtime_log::CHAT_CALLS`) has ended: its failure, or its slowness, goes to the runtime log with the
/// closed code, the operation and how long it took (T191: a chat that "did not answer" left nothing, and nobody could say
/// which call was waiting for what). A log that cannot be written never stops the call.
pub(super) fn log_chat_call(app: Option<&tauri::AppHandle>, operation: &'static str, outcome: Result<(), &'static str>, took: Duration) {
    log_chat_call_in(&LOGGED_CHAT_CALL, app.and_then(crate::runtime_log::RuntimeLog::new).as_ref(), operation, outcome, took);
}

pub(super) fn log_chat_call_in(
    memory: &Mutex<[LoggedCall; 6]>,
    log: Option<&crate::runtime_log::RuntimeLog>,
    operation: &'static str,
    outcome: Result<(), &'static str>,
    took: Duration,
) {
    let Some(slot) = crate::runtime_log::CHAT_CALLS.iter().position(|call| *call == operation) else {
        return;
    };
    let outcome = outcome.map_err(|code| {
        let reason = if matches!(code, "local_container_not_attested" | "container_unavailable") {
            ATTEST_REASON.lock().ok().and_then(|mut said| said.take())
        } else {
            None
        };
        (code, reason)
    });
    let line = match memory.lock() {
        Ok(mut last) => chat_call_line(&mut last[slot], outcome, took, Instant::now()),
        Err(_) => None,
    };
    if let (Some((code, reason)), Some(log)) = (line, log) {
        log.record_chat_call(operation, code, reason, took);
    }
}
