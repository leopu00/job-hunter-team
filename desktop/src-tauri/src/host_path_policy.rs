//! The rule for a file of the person's that is named by a path written as text, on Windows, and for the name it goes by.
//!
//! A path typed in a terminal (`jht artifact upload C:\Users\…\cv.pdf`) is text the app has to doubt before it opens
//! anything: a `..` that climbs out of where the person is, a name Windows keeps for devices (`CON`, `NUL`, `COM1`…), a
//! `file:stream` that names a hidden stream, a network share, a device path. Everything here is a pure function of the text,
//! with Windows rules whatever computer runs it, so that it is tested everywhere; the Windows API only gives it the list of
//! folders (`allowed_folders` of the caller) and the final path of the file once it is open.
//!
//! Two decisions are kept apart: the TEXT is checked before the file is opened (`check_written_path`), and the FINAL path the
//! open handle reports is checked against the allowed folders before a byte is read (`within`). The name that goes on to the
//! container is only the base name, already cleaned (`clean_name`).

/// Why a path or a name is refused. The words are closed; the person never sees a path of theirs in one.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Reason {
    /// Nothing, or a character no path has (a control character, a direction mark).
    Empty,
    /// `..` in the path.
    Parent,
    /// A name Windows keeps for a device (`CON`, `NUL`, `COM1`…), as a folder or as the file, with or without an extension.
    Reserved,
    /// `file:stream`, or a drive that is not `X:`.
    Stream,
    /// A name Windows does not accept (`< > " | ? *`, a trailing dot or space), too long, or no name at all.
    Name,
    /// `\\server\share`, `\\?\…`, `\\.\…`: not a file of this person's folders.
    Network,
    /// A relative path with a drive (`C:file`): it depends on a current folder of that drive.
    DriveRelative,
}

const MAX_PATH_CHARS: usize = 1024;
const MAX_NAME_CHARS: usize = 120;

/// The characters a person never means in a path or a name: controls and invisible direction marks.
fn hidden(c: char) -> bool {
    c.is_control() || matches!(c, '\u{200b}'..='\u{200f}' | '\u{202a}'..='\u{202e}' | '\u{2066}'..='\u{2069}' | '\u{feff}')
}

/// `CON`, `PRN`, `AUX`, `NUL`, `COM1`-`COM9`, `LPT1`-`LPT9` (also with the superscript digits Windows reads as digits),
/// `CONIN$`, `CONOUT$`: a name Windows opens as a device, with any extension (`NUL.txt`) and with trailing spaces.
pub(crate) fn is_reserved(component: &str) -> bool {
    let stem = component.split('.').next().unwrap_or("").trim_end_matches(' ');
    let upper = stem.to_uppercase();
    if matches!(upper.as_str(), "CON" | "PRN" | "AUX" | "NUL" | "CONIN$" | "CONOUT$" | "CLOCK$") {
        return true;
    }
    let mut chars = upper.chars();
    let head: String = chars.by_ref().take(3).collect();
    if head == "COM" || head == "LPT" {
        let rest: Vec<char> = chars.collect();
        return matches!(rest.as_slice(), [digit] if matches!(digit, '1'..='9' | '\u{b9}' | '\u{b2}' | '\u{b3}'));
    }
    false
}

/// One component of a path or the name of a file: no character Windows refuses, no trailing dot or space (Windows drops them,
/// so `cv.pdf.` would name another file than it says), not a device name.
fn component_ok(component: &str) -> Result<(), Reason> {
    if component.is_empty() || component.chars().count() > MAX_NAME_CHARS {
        return Err(Reason::Name);
    }
    if component.chars().any(|c| matches!(c, '<' | '>' | '"' | '|' | '?' | '*')) {
        return Err(Reason::Name);
    }
    if component.contains(':') {
        return Err(Reason::Stream);
    }
    if component.ends_with('.') || component.ends_with(' ') {
        return Err(Reason::Name);
    }
    if is_reserved(component) {
        return Err(Reason::Reserved);
    }
    Ok(())
}

/// The name a file goes by to the container: the base name of the path, without the invisible characters, checked as a
/// component. Never a path, never `..`, never a device name.
pub(crate) fn clean_name(path: &str) -> Result<String, Reason> {
    let last = path.rsplit(['\\', '/']).next().unwrap_or("");
    let kept: String = last.chars().filter(|c| !hidden(*c)).collect();
    let trimmed = kept.trim_start();
    if trimmed == "." || trimmed == ".." {
        return Err(Reason::Parent);
    }
    component_ok(trimmed)?;
    Ok(trimmed.to_owned())
}

/// A path as the person wrote it, checked as text. The path comes back with `\` for separators and without `.` and empty
/// components; it may be relative (the folder the command was run from), never with a `..`, a drive-relative form, a
/// network or device prefix, a stream or a device name in any component.
pub(crate) fn check_written_path(raw: &str) -> Result<String, Reason> {
    let text = raw.trim();
    if text.is_empty() || text.chars().any(hidden) || text.chars().count() > MAX_PATH_CHARS {
        return Err(Reason::Empty);
    }
    let unified = text.replace('/', "\\");
    if unified.starts_with("\\\\") {
        return Err(Reason::Network);
    }
    let mut components = unified.split('\\').filter(|part| !part.is_empty() && *part != ".").peekable();
    let mut checked: Vec<&str> = Vec::new();
    let mut drive = 0usize;
    // a first component with a colon in its second place is a drive: `X:` followed by a separator, nothing else
    if let Some(first) = components.peek().copied() {
        let bytes = first.as_bytes();
        if bytes.len() >= 2 && bytes[1] == b':' {
            if !bytes[0].is_ascii_alphabetic() || !unified.starts_with(first) {
                return Err(Reason::Stream);
            }
            if bytes.len() != 2 || !unified[2..].starts_with('\\') {
                return Err(Reason::DriveRelative);
            }
            checked.push(first);
            drive = 1;
            components.next();
        }
    }
    for component in components {
        if component == ".." {
            return Err(Reason::Parent);
        }
        component_ok(component)?;
        checked.push(component);
    }
    if checked.len() == drive {
        return Err(Reason::Empty);
    }
    let normalized = checked.join("\\");
    Ok(if unified.starts_with('\\') { format!("\\{normalized}") } else { normalized })
}

/// The final path an open file reports (`\\?\C:\Users\…`), as the plain path: the prefix taken off; a network path
/// (`\\?\UNC\…`) or a device path is no path of a folder of the person's.
pub(crate) fn plain_final_path(reported: &str) -> Option<String> {
    let text = reported.trim_end_matches('\0').replace('/', "\\");
    let text = text.as_str();
    if let Some(rest) = text.strip_prefix("\\\\?\\") {
        if rest.len() >= 3 && rest.as_bytes()[1] == b':' && rest.as_bytes()[2] == b'\\' && rest.as_bytes()[0].is_ascii_alphabetic() {
            return Some(rest.to_owned());
        }
        return None;
    }
    let bytes = text.as_bytes();
    (bytes.len() >= 3 && bytes[1] == b':' && bytes[2] == b'\\' && bytes[0].is_ascii_alphabetic()).then(|| text.to_owned())
}

fn comparable(path: &str) -> Vec<String> {
    path.replace('/', "\\").split('\\').filter(|part| !part.is_empty()).map(str::to_lowercase).collect()
}

/// Whether `final_path` is inside one of the `folders`, by whole components and without telling capitals apart. A folder that
/// is only a drive (`C:\`) is no allowed folder: it would allow the whole disk.
pub(crate) fn within(final_path: &str, folders: &[String]) -> bool {
    let Some(plain) = plain_final_path(final_path) else { return false };
    let wanted = comparable(&plain);
    folders.iter().any(|folder| {
        let allowed = comparable(folder);
        allowed.len() >= 2 && wanted.len() > allowed.len() && wanted[..allowed.len()] == allowed[..]
    })
}

/// What the person is told when a path is refused, in the language of the command line (Italian or English).
pub(crate) fn refusal_text(code: &str, italian: bool, folders: &[&str]) -> String {
    let list = folders.join(", ");
    match (code, italian) {
        ("artifact_path_not_allowed", true) => format!(
            "artifact_path_not_allowed: il file non e' in una cartella ammessa. Sono ammesse: {list}. Sposta il file in una di queste e riprova."
        ),
        ("artifact_path_not_allowed", false) => format!(
            "artifact_path_not_allowed: the file is not in an allowed folder. Allowed: {list}. Move the file to one of them and try again."
        ),
        ("artifact_path_invalid", true) => format!(
            "artifact_path_invalid: il percorso non e' valido (niente '..', nomi riservati di Windows come CON o NUL, flussi 'file:nome'). Cartelle ammesse: {list}."
        ),
        ("artifact_path_invalid", false) => format!(
            "artifact_path_invalid: the path is not valid (no '..', no Windows device names such as CON or NUL, no 'file:name' streams). Allowed folders: {list}."
        ),
        (other, _) => other.to_owned(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn device_names_are_reserved_with_any_extension_and_case_and_trailing_spaces() {
        for name in ["CON", "con", "Nul", "NUL.txt", "aux.pdf", "PRN ", "COM1", "com9.pdf", "LPT3", "lpt1.cv.pdf", "CONIN$", "CONOUT$", "COM\u{b9}", "LPT\u{b2}.txt"] {
            assert!(is_reserved(name), "{name:?}");
        }
        for name in ["CONFIG", "console.pdf", "COM", "COM10", "COM0", "LPT", "nulled.pdf", "cv.pdf", "my.con", "ACON"] {
            assert!(!is_reserved(name), "{name:?}");
        }
    }

    #[test]
    fn the_name_that_goes_on_is_only_the_cleaned_base_name() {
        assert_eq!(clean_name("C:\\Users\\Ada Test\\Documents\\My CV (final).pdf").as_deref(), Ok("My CV (final).pdf"));
        assert_eq!(clean_name("cv.pdf").as_deref(), Ok("cv.pdf"));
        assert_eq!(clean_name("folder/with/slashes/cv.pdf").as_deref(), Ok("cv.pdf"));
        // invisible characters and direction marks are taken out
        assert_eq!(clean_name("C:\\x\\cv\u{202e}fdp.pdf\u{200b}").as_deref(), Ok("cvfdp.pdf"));
        assert_eq!(clean_name("  cv.pdf").as_deref(), Ok("cv.pdf"));
        // a name that starts with a dash is a name; the caller passes it with `--name=`
        assert_eq!(clean_name("C:\\x\\-weird.pdf").as_deref(), Ok("-weird.pdf"));
        for bad in ["", "C:\\x\\", "C:\\x\\..", "..", "C:\\x\\con.pdf", "C:\\x\\NUL", "C:\\x\\a:b.pdf", "C:\\x\\a<b.pdf", "C:\\x\\a?.pdf", "C:\\x\\cv.pdf.", "C:\\x\\cv.pdf ", &"a".repeat(121)] {
            assert!(clean_name(bad).is_err(), "{bad:?}");
        }
        assert_eq!(clean_name("C:\\x\\.."), Err(Reason::Parent));
        assert_eq!(clean_name("C:\\x\\con.pdf"), Err(Reason::Reserved));
        assert_eq!(clean_name("C:\\x\\a:b.pdf"), Err(Reason::Stream));
    }

    #[test]
    fn a_written_path_with_spaces_and_either_slash_is_normalized() {
        assert_eq!(check_written_path("C:\\Users\\Ada Test\\Documents\\My CV.pdf").as_deref(), Ok("C:\\Users\\Ada Test\\Documents\\My CV.pdf"));
        assert_eq!(check_written_path("  C:/Users/Ada Test/Downloads/cv.pdf  ").as_deref(), Ok("C:\\Users\\Ada Test\\Downloads\\cv.pdf"));
        assert_eq!(check_written_path("C:\\Users\\\\Ada\\.\\cv.pdf").as_deref(), Ok("C:\\Users\\Ada\\cv.pdf"));
        // relative: the folder the command was run from
        assert_eq!(check_written_path(".\\cv.pdf").as_deref(), Ok("cv.pdf"));
        assert_eq!(check_written_path("sub folder\\cv.pdf").as_deref(), Ok("sub folder\\cv.pdf"));
        // another drive letter is a path like any other: whether it is allowed is decided by the final path
        assert_eq!(check_written_path("D:\\Papers\\cv.pdf").as_deref(), Ok("D:\\Papers\\cv.pdf"));
    }

    #[test]
    fn a_path_rooted_on_the_current_drive_keeps_its_root() {
        for raw in [r"\Users\Ada Test\Documents\cv.pdf", "/Users/Ada Test/Documents/cv.pdf"] {
            assert_eq!(check_written_path(raw).as_deref(), Ok(r"\Users\Ada Test\Documents\cv.pdf"));
        }
    }

    #[test]
    fn a_written_path_that_climbs_names_a_device_a_stream_or_a_share_is_refused() {
        let cases: [(&str, Reason); 16] = [
            ("", Reason::Empty),
            ("   ", Reason::Empty),
            ("C:\\Users\\Ada\\..\\Bob\\cv.pdf", Reason::Parent),
            ("..\\cv.pdf", Reason::Parent),
            ("C:/Users/Ada/Documents/../../x.pdf", Reason::Parent),
            ("C:\\Users\\Ada\\CON\\cv.pdf", Reason::Reserved),
            ("C:\\Users\\Ada\\NUL", Reason::Reserved),
            ("C:\\Users\\Ada\\com1.txt", Reason::Reserved),
            ("C:\\Users\\Ada\\cv.pdf:hidden", Reason::Stream),
            ("C:\\Users\\Ada\\cv.pdf:hidden:$DATA", Reason::Stream),
            ("1:\\x\\cv.pdf", Reason::Stream),
            ("C:cv.pdf", Reason::DriveRelative),
            ("\\\\server\\share\\cv.pdf", Reason::Network),
            ("//server/share/cv.pdf", Reason::Network),
            ("\\\\?\\C:\\Users\\Ada\\cv.pdf", Reason::Network),
            ("\\\\.\\PhysicalDrive0", Reason::Network),
        ];
        for (text, reason) in cases {
            assert_eq!(check_written_path(text), Err(reason), "{text:?}");
        }
        assert_eq!(check_written_path("C:\\x\\a\u{0}b.pdf"), Err(Reason::Empty));
        assert_eq!(check_written_path("C:\\x\\a\nb.pdf"), Err(Reason::Empty));
        assert_eq!(check_written_path(&format!("C:\\{}", "a\\".repeat(600))), Err(Reason::Empty));
    }

    #[test]
    fn the_final_path_an_open_file_reports_is_plain_or_nothing() {
        assert_eq!(plain_final_path("\\\\?\\C:\\Users\\Ada Test\\cv.pdf").as_deref(), Some("C:\\Users\\Ada Test\\cv.pdf"));
        assert_eq!(plain_final_path("C:\\Users\\Ada\\cv.pdf").as_deref(), Some("C:\\Users\\Ada\\cv.pdf"));
        assert_eq!(plain_final_path("\\\\?\\UNC\\server\\share\\cv.pdf"), None);
        assert_eq!(plain_final_path("\\\\server\\share\\cv.pdf"), None);
        assert_eq!(plain_final_path("\\\\.\\C:\\x"), None);
        assert_eq!(plain_final_path("\\\\?\\Volume{0000-0000}\\x"), None);
        assert_eq!(plain_final_path("relative\\cv.pdf"), None);
    }

    #[test]
    fn a_file_is_inside_when_a_whole_allowed_folder_leads_to_it() {
        let folders = vec![
            "C:\\Users\\Ada Test".to_owned(),
            "D:\\Sync\\Documents".to_owned(),
            "C:\\Users\\Ada Test\\OneDrive - Acme\\Documents".to_owned(),
        ];
        for inside in [
            "C:\\Users\\Ada Test\\Documents\\cv.pdf",
            "\\\\?\\C:\\Users\\Ada Test\\Downloads\\a b\\cv.pdf",
            "c:\\users\\ADA TEST\\cv.pdf",
            "D:\\Sync\\Documents\\cv.pdf",
            "d:/sync/documents/sub/cv.pdf",
        ] {
            assert!(within(inside, &folders), "{inside}");
        }
        for outside in [
            "C:\\Windows\\System32\\config\\SAM",
            "C:\\Users\\Bob\\Documents\\cv.pdf",
            "C:\\Users\\Ada Testing\\cv.pdf",
            "C:\\Users\\Ada Test",
            "D:\\Other\\cv.pdf",
            "D:\\Sync\\cv.pdf",
            "\\\\?\\UNC\\server\\share\\cv.pdf",
            "\\\\server\\share\\Users\\Ada Test\\cv.pdf",
            "E:\\Users\\Ada Test\\cv.pdf",
            "cv.pdf",
        ] {
            assert!(!within(outside, &folders), "{outside}");
        }
    }

    #[test]
    fn a_drive_root_or_a_folder_without_a_name_never_allows_the_disk() {
        assert!(!within("C:\\Users\\Ada\\cv.pdf", &["C:\\".to_owned()]));
        assert!(!within("C:\\Users\\Ada\\cv.pdf", &["C:".to_owned()]));
        assert!(!within("C:\\Users\\Ada\\cv.pdf", &[]));
        assert!(!within("C:\\Users\\Ada\\cv.pdf", &["".to_owned()]));
    }

    #[test]
    fn the_refusal_names_the_allowed_folders_in_both_languages() {
        let folders = ["Documenti", "Download", "Scrivania"];
        for (code, italian) in [("artifact_path_not_allowed", true), ("artifact_path_not_allowed", false), ("artifact_path_invalid", true), ("artifact_path_invalid", false)] {
            let text = refusal_text(code, italian, &folders);
            assert!(text.starts_with(code), "{text}");
            assert!(text.contains("Documenti, Download, Scrivania"), "{text}");
        }
        assert!(refusal_text("artifact_path_not_allowed", true, &folders).contains("Sposta il file"));
        assert!(refusal_text("artifact_path_not_allowed", false, &folders).contains("Move the file"));
    }
}
