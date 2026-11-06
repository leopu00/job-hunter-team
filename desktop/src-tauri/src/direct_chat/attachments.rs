use super::*;

/// Whether an attachment can go now, and if not the closed reason the page says. The files are
/// copied on this computer for this computer's team only: a VPS has its own disk, a read-only view
/// writes nothing, and there is no copy without a connected team.
pub(super) fn attach_refusal(connection: &Connection) -> Option<&'static str> {
    if !cfg!(any(target_os = "macos", target_os = "linux")) {
        return Some("attach_platform");
    }
    if !matches!(&connection.validated, ValidatedHost::Local) {
        return Some("attach_vps");
    }
    let own_refusal = own_vps_write_refusal(connection);
    if !link_allows_writing(connection.runtime.as_ref(), own_refusal.is_none(), |target| {
        existing_team_runtime::full_link_granted(&connection.scope, target)
    }) {
        return Some("attach_read_only");
    }
    if connection.local_wrapper.is_none() || connection.local_runtime.is_none() {
        return Some("attach_not_connected");
    }
    None
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DirectChatAttachState {
    pub(super) available: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) code: Option<&'static str>,
}

/// What the 📎 button says: on, or off with the reason. Reads the connection only: nothing is probed.
#[tauri::command]
pub(crate) async fn direct_chat_attach_state(
    state: State<'_, DirectChatState>,
    scopes: State<'_, AccountScopeState>,
) -> Result<DirectChatAttachState, DirectChatError> {
    let inner = Arc::clone(&state.inner);
    let scope_state = scopes.inner().clone();
    // It only reads the connection, but the connection's lock may be held by a probe or a read: it waits off the main thread.
    tauri::async_runtime::spawn_blocking(move || {
        let scope = scope_state.lock_active().map_err(failure)?;
        let slot = inner.connection.lock().map_err(|_| failure("state_failed"))?;
        let code = match slot.as_ref() {
            Some(connection) if &connection.scope == scope.scope() => attach_refusal(connection),
            Some(_) => return Err(failure("account_scope_mismatch")),
            None => Some("attach_not_connected"),
        };
        Ok(DirectChatAttachState { available: code.is_none(), code })
    })
    .await
    .map_err(|_| failure("state_failed"))?
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DirectChatAttachment {
    /// `sent`, `saved_not_sent` (the file is in the folder, the Assistant was not told: `code` says
    /// why) or `cancelled` (the person closed the window: not an error).
    pub(super) outcome: &'static str,
    /// The person's own file name, for their screen only.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) display_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) code: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) receipt: Option<DirectChatReceipt>,
}

/// Held while an attachment is in hand: a second click is refused, not queued.
pub(super) struct AttachGuard(pub(super) Arc<std::sync::atomic::AtomicBool>);

impl AttachGuard {
    pub(super) fn take(busy: &Arc<std::sync::atomic::AtomicBool>) -> Option<Self> {
        use std::sync::atomic::Ordering;
        busy.compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .ok()
            .map(|_| Self(Arc::clone(busy)))
    }
}

impl Drop for AttachGuard {
    fn drop(&mut self) {
        self.0.store(false, std::sync::atomic::Ordering::Release);
    }
}

/// The message of an attachment. The person reads one short sentence in their language; behind it,
/// on the same line, the Assistant gets the path of OUR copy in its container (the page hides that
/// bracket: `withoutAttachmentPath` in DirectChatScreen.tsx reads exactly this shape). Nothing of the
/// person's file name or content is in it. An unknown language gets English.
/// «My CV» only for the kinds of file a CV comes in (a document); a picture or a plain text is not
/// known to be one, and gets «a file».
pub(super) fn attachment_message(locale: &str, file: &str) -> String {
    let document = file
        .rsplit_once('.')
        .is_some_and(|(_, extension)| crate::chat_attachment::DOCUMENT_EXTENSIONS.contains(&extension));
    let said = match (locale, document) {
        ("it", true) => "Ho allegato il mio CV.",
        ("it", false) => "Ho allegato un file.",
        ("de", true) => "Ich habe meinen Lebenslauf angehängt.",
        ("de", false) => "Ich habe eine Datei angehängt.",
        ("es", true) => "He adjuntado mi CV.",
        ("es", false) => "He adjuntado un archivo.",
        ("fr", true) => "J'ai joint mon CV.",
        ("fr", false) => "J'ai joint un fichier.",
        ("hu", true) => "Csatoltam az önéletrajzomat.",
        ("hu", false) => "Csatoltam egy fájlt.",
        ("pt", true) => "Anexei o meu CV.",
        ("pt", false) => "Anexei um ficheiro.",
        (_, true) => "I attached my CV.",
        (_, false) => "I attached a file.",
    };
    format!("{said} [attachment for my profile: /jht_user/{}/{file}]", crate::chat_attachment::FOLDER)
}

/// Where the system's window opens: the Downloads folder of the person, where a CV usually is, and
/// not Documents, which holds their personal files. Without that folder the system chooses.
pub(super) fn downloads_of(home: &Path) -> Option<PathBuf> {
    let downloads = home.join("Downloads");
    downloads.is_dir().then_some(downloads)
}

pub(super) struct AttachTarget {
    pub(super) wrapper: PathBuf,
    pub(super) runtime: PathBuf,
    pub(super) user_dir: PathBuf,
    pub(super) start_dir: Option<PathBuf>,
}

/// The same gate as a message, then the places the copy needs. Runs off the main thread.
pub(super) fn attach_target(
    inner: &DirectChatInner,
    scopes: &AccountScopeState,
    expected: &AccountScope,
) -> Result<AttachTarget, DirectChatError> {
    let scope = scopes.lock_expected(expected).map_err(failure)?;
    let slot = inner.connection.lock().map_err(|_| failure("state_failed"))?;
    let connection = slot.as_ref().ok_or_else(|| failure("disconnected"))?;
    if &connection.scope != scope.scope() {
        return Err(failure("account_scope_mismatch"));
    }
    refuse_writing(connection)?;
    if let Some(code) = attach_refusal(connection) {
        return Err(failure(code));
    }
    let home = std::env::var_os("HOME").map(PathBuf::from).ok_or_else(|| failure("attach_platform"))?;
    Ok(AttachTarget {
        wrapper: connection.local_wrapper.clone().ok_or_else(|| failure("runtime_missing"))?,
        runtime: connection.local_runtime.clone().ok_or_else(|| failure("runtime_missing"))?,
        start_dir: downloads_of(&home),
        user_dir: home.join("Documents").join("Job Hunter Team"),
    })
}

/// The copy is in the folder on this computer; the team must see the same file there. A mount that
/// does not show it (another folder, an engine that shares less) takes the copy back: nothing is
/// told to the Assistant about a file it cannot open.
pub(super) fn team_sees_the_copy(target: &AttachTarget, saved: &crate::chat_attachment::Saved) -> bool {
    let path = format!("/jht_user/{}/{}", crate::chat_attachment::FOLDER, saved.file);
    let Ok(team) = local_chat_team(&target.wrapper, &target.runtime, READ_TIMEOUT) else { return false };
    matches!(
        team.exec(&["stat", "-c", "%s", path.as_str()], None, READ_TIMEOUT),
        Ok(done) if done.success() && String::from_utf8_lossy(&done.stdout).trim() == saved.size.to_string()
    )
}
