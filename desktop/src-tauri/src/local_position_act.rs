//! What the person does on the page of a position, when the profile shows the team of this computer (no cloud
//! account): one closed command, `local_team_position_act`, with a request `{ op, id, token, ...closed fields }`.
//!
//! It runs under the same rules as the verdict of the Swipe (local_swipe.rs, design D1-D6): the `main` window
//! only; only the team of THIS computer and only when this account owns its folder; the position is named by its
//! number in one database, so the request carries the token of the read it was made on (the Swipe's deck, or a
//! detail read of the position: `data.token`) and a database that is no longer that one is `deck_outdated`;
//! every field is closed here again; the one free text travels on stdin; the gates and the run are one
//! synchronous closure that holds the account scope; the script is the team's own `position_judgement.py`, and
//! the answer is closed again, so no text of the team's script reaches the page.
//!
//! After a write that worked the app drops what the state stream kept and tells the page that the positions
//! changed (`state-stream://event`, topic `positions`), so it reads the detail again.
use crate::{
    account_scope::AccountScopeState,
    direct_chat,
    local_swipe::{failure, local_wrapper, on_worker, run_script, scope_tag, team_is_up},
};
use serde_json::Value;
use std::{cell::RefCell, path::PathBuf};
use tauri::State;

/// The whole decision of one act, with the app-bound steps injected. `after_write` runs only when the team
/// wrote what was asked.
#[allow(clippy::too_many_arguments)]
pub(crate) fn act_with(
    request: Value,
    window_is_main: bool,
    tag: &str,
    gate: impl FnOnce() -> Result<(), &'static str>,
    run: impl FnOnce(&[u8]) -> Result<crate::runtime_host::ProcessResult, &'static str>,
    team_is_up: impl FnOnce() -> bool,
    after_write: impl FnOnce(),
) -> Value {
    let reply = crate::local_swipe::judge_with(request, window_is_main, tag, gate, run, team_is_up);
    if reply.get("ok") == Some(&Value::Bool(true)) {
        after_write();
    }
    reply
}

/// The person's act on a position of the team on this computer, written in its database.
#[tauri::command]
pub(crate) async fn local_team_position_act(
    app: tauri::AppHandle,
    window: tauri::Window,
    scopes: State<'_, AccountScopeState>,
    request: Value,
) -> Result<Value, String> {
    let expected = match scopes.active() {
        Ok(scope) => scope,
        Err(_) => return Ok(failure("account_scope_unavailable")),
    };
    let main = direct_chat::window_may_write(window.label());
    Ok(on_worker(scopes.inner(), expected, move |scope| {
        let wrapper: RefCell<Option<PathBuf>> = RefCell::new(None);
        act_with(
            request,
            main,
            &scope_tag(scope),
            || {
                *wrapper.borrow_mut() = Some(local_wrapper(&app, scope, true)?);
                Ok(())
            },
            |input| run_script(wrapper.borrow().as_ref().ok_or("runtime_missing")?, input),
            || wrapper.borrow().as_ref().is_some_and(|path| team_is_up(path)),
            || {
                let (Some(wrapper), Ok(runtime)) = (wrapper.borrow().clone(), direct_chat::local_runtime_path(&app)) else { return };
                crate::state_stream::positions_written(&crate::state_stream::LocalContext { app: &app, scope, wrapper: &wrapper, runtime: &runtime });
            },
        )
    })
    .await)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::runtime_host::ProcessResult;
    use serde_json::json;
    use std::cell::Cell;

    const TAG: &str = "0123456789abcdef";

    fn request() -> Value {
        json!({"op": "restore", "id": "12", "token": format!("{TAG}.77.5")})
    }

    fn said(code: i32, text: &str) -> Result<ProcessResult, &'static str> {
        Ok(ProcessResult { code, stdout: text.as_bytes().to_vec() })
    }

    fn drive(request: Value, main: bool, gate: Result<(), &'static str>, ran: Result<ProcessResult, &'static str>) -> (Value, u32, u32) {
        let (runs, told) = (Cell::new(0), Cell::new(0));
        let reply = act_with(request, main, TAG, || gate, |_| {
            runs.set(runs.get() + 1);
            ran
        }, || true, || told.set(told.get() + 1));
        (reply, runs.get(), told.get())
    }

    #[test]
    fn the_page_is_told_only_when_the_team_wrote_what_was_asked() {
        let ok = r#"{"ok":true,"op":"restore","id":"12","status":"scored","previous_status":"excluded"}"#;
        let (reply, runs, told) = drive(request(), true, Ok(()), said(0, ok));
        assert_eq!(reply, json!({"ok": true, "op": "restore", "status": "scored", "previous_status": "excluded"}));
        assert_eq!((runs, told), (1, 1));
        // a refusal of the script, a request that is not closed, another window, another team, an old token: nobody is told
        let refused = r#"{"ok":false,"op":"restore","id":"12","code":"position_not_found"}"#;
        assert_eq!(drive(request(), true, Ok(()), said(1, refused)), (failure("position_not_found"), 1, 0));
        assert_eq!(drive(json!({"op": "restore", "id": "12"}), true, Ok(()), said(0, ok)), (failure("position_write_request_invalid"), 0, 0));
        assert_eq!(drive(request(), false, Ok(()), said(0, ok)), (failure("position_write_window_refused"), 0, 0));
        assert_eq!(drive(request(), true, Err("position_write_read_only"), said(0, ok)), (failure("position_write_read_only"), 0, 0));
        let old = json!({"op": "restore", "id": "12", "token": "ffffffffffffffff.77.5"});
        assert_eq!(drive(old, true, Ok(()), said(0, ok)), (failure("deck_outdated"), 0, 0));
    }
}
