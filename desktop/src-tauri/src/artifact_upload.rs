//! `jht artifact upload <file>` with a Windows path, done by the app.
//!
//! The Node CLI runs in the team's container, where a Windows path does not exist: the command ended with ENOENT even when the
//! file was on the computer. The Mac and Linux wrapper reads the file itself and hands the bytes to the CLI on stdin (`artifact
//! upload --stdin --name …`); here the app does the same, once, in one place, and `jht.ps1` only calls it.
//!
//! The path is never translated: the app opens the file on the computer, checks the folder it really is in (the final path of
//! the open file, not the text it was written as) against the folders of the person, and only then reads it, at most 10 MiB.
//! What reaches the container is the bytes, on standard input, and the base name of the file, cleaned (`host_path_policy`).
//! The container's own answer is printed as it is. Nothing falls back on the wrapper: a command that has been given to the
//! container is not given again, and a team that is not up is told so.
//!
//! One question at a time, in a one-shot process (`jht-desktop.exe --artifact-upload <file> [--json]`), like the stdio bridge of
//! the official CLI: no window, no Tauri.

#![cfg_attr(not(windows), allow(dead_code))]

use std::io::Write;
use std::time::Duration;

use crate::host_path_policy as policy;
use crate::runtime_host::ProcessResult;
use crate::team_control::{artifact_upload_command, TeamEngine};

/// The longest document the team takes (the CLI and the wrapper of the other systems say the same).
pub(crate) const MAX_BYTES: u64 = 10 * 1024 * 1024;
const UPLOAD_TIMEOUT: Duration = Duration::from_secs(60);

/// Exit codes of the command: usage and refused documents are 2 as the CLI has it, anything else that failed is 1.
const EXIT_FAILED: i32 = 1;
const EXIT_USAGE: i32 = 2;

/// Why a document could not be read.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ReadError {
    Missing,
    NotAllowed,
    Link,
    NotFile,
    TooBig,
    Unreadable,
}

/// The computer's files, as the command needs them. The real one is Windows'; a test answers.
pub(crate) trait Documents {
    /// The folders a document may be in, as full paths.
    fn allowed_folders(&self) -> Vec<String>;
    /// Opens the file and asks `allow` about the FINAL path of the open file; reads it only if `allow` agrees.
    fn read(&self, path: &str, allow: &dyn Fn(&str) -> bool) -> Result<Vec<u8>, ReadError>;
}

/// What the command ends with.
#[derive(Debug, PartialEq, Eq)]
pub(crate) struct Report {
    pub(crate) code: i32,
    pub(crate) stdout: String,
    pub(crate) stderr: String,
}

impl Report {
    fn refused(code: i32, stderr: String) -> Self {
        Self { code, stdout: String::new(), stderr }
    }
}

/// The folders the person is told about, in their language.
fn folder_labels(italian: bool) -> Vec<&'static str> {
    if italian {
        vec!["Documenti", "Download", "Scrivania", "la tua cartella utente"]
    } else {
        vec!["Documents", "Downloads", "Desktop", "your user folder"]
    }
}

/// `--artifact-upload` arguments: one path and, optionally, `--json`.
pub(crate) fn parse_args(args: &[String]) -> Result<(String, bool), ()> {
    let mut path: Option<&String> = None;
    let mut json = false;
    for arg in args {
        if arg == "--json" {
            json = true;
        } else if arg.starts_with("--") || path.is_some() {
            return Err(());
        } else {
            path = Some(arg);
        }
    }
    path.map(|path| (path.clone(), json)).ok_or(())
}

fn path_refusal(reason: policy::Reason, italian: bool) -> Report {
    let code = match reason {
        policy::Reason::Network => "artifact_path_not_allowed",
        _ => "artifact_path_invalid",
    };
    Report::refused(EXIT_USAGE, policy::refusal_text(code, italian, &folder_labels(italian)))
}

fn read_refusal(error: ReadError, italian: bool) -> Report {
    let (code, text_it, text_en, exit) = match error {
        ReadError::NotAllowed => {
            return Report::refused(EXIT_USAGE, policy::refusal_text("artifact_path_not_allowed", italian, &folder_labels(italian)))
        }
        ReadError::Missing => ("artifact_file_missing", "il file non esiste", "the file does not exist", EXIT_FAILED),
        ReadError::Link => ("artifact_is_link", "il documento deve essere un file regolare, non un collegamento", "the document must be a regular file, not a link", EXIT_USAGE),
        ReadError::NotFile => ("artifact_not_file", "il documento deve essere un file regolare", "the document must be a regular file", EXIT_USAGE),
        ReadError::TooBig => ("artifact_too_big", "il documento supera i 10 MB", "the document is larger than 10 MB", EXIT_USAGE),
        ReadError::Unreadable => ("artifact_unreadable", "non riesco a leggere il documento", "cannot read the document", EXIT_FAILED),
    };
    Report::refused(exit, format!("{code}: {}", if italian { text_it } else { text_en }))
}

/// The whole command. `engine` is the team's container as the app attests it, or the reason it could not be found.
pub(crate) fn upload(args: &[String], docs: &dyn Documents, engine: Result<&dyn TeamEngine, &'static str>, italian: bool) -> Report {
    let Ok((written, json)) = parse_args(args) else {
        let usage = if italian { "uso: jht artifact upload FILE [--json]" } else { "usage: jht artifact upload FILE [--json]" };
        return Report::refused(EXIT_USAGE, usage.to_owned());
    };
    let path = match policy::check_written_path(&written) {
        Ok(path) => path,
        Err(reason) => return path_refusal(reason, italian),
    };
    let name = match policy::clean_name(&path) {
        Ok(name) => name,
        Err(reason) => return path_refusal(reason, italian),
    };
    let folders = docs.allowed_folders();
    let bytes = match docs.read(&path, &|final_path| policy::within(final_path, &folders)) {
        Ok(bytes) => bytes,
        Err(error) => return read_refusal(error, italian),
    };
    if bytes.len() as u64 > MAX_BYTES {
        return read_refusal(ReadError::TooBig, italian);
    }
    let Ok(engine) = engine else {
        let text = if italian {
            "team_container_unavailable: la squadra non e' accesa su questo computer. Avviala con 'jht up' e riprova."
        } else {
            "team_container_unavailable: the team is not running on this computer. Start it with 'jht up' and try again."
        };
        return Report::refused(EXIT_FAILED, text.to_owned());
    };
    let name_argument = format!("--name={name}");
    let command = artifact_upload_command(&name_argument, json, &bytes);
    match engine.exec(&command, UPLOAD_TIMEOUT) {
        Ok(ProcessResult { code: 0, stdout }) => Report { code: 0, stdout: String::from_utf8_lossy(&stdout).into_owned(), stderr: String::new() },
        Ok(ProcessResult { code, stdout }) => {
            let said = String::from_utf8_lossy(&stdout).trim().to_owned();
            let text = if said.is_empty() {
                format!("artifact_upload_failed: {} ({code})", if italian { "la consegna non e' riuscita" } else { "the delivery did not succeed" })
            } else {
                said
            };
            Report::refused(code.max(EXIT_FAILED), text)
        }
        Err(_) => Report::refused(
            EXIT_FAILED,
            format!("artifact_upload_failed: {}", if italian { "la consegna non e' riuscita" } else { "the delivery did not succeed" }),
        ),
    }
}

/// The command line language: `JHT_LANG` of the environment, else the one `host.env` carries; Italian only when it says `it`.
pub(crate) fn language_is_italian(environment: Option<&str>, host_env: Option<&str>) -> bool {
    let valid = |value: &str| matches!(value, "en" | "it" | "hu" | "es" | "de" | "fr" | "pt");
    let from_file = host_env.and_then(|text| {
        text.lines()
            .filter_map(|line| line.trim().strip_prefix("JHT_LANG="))
            .map(|value| value.trim().trim_matches(|c| c == '"' || c == '\'').to_owned())
            .filter(|value| valid(value))
            .last()
    });
    let chosen = environment.map(str::trim).filter(|value| valid(value)).map(str::to_owned).or(from_file);
    chosen.as_deref() == Some("it")
}

fn write_report(report: &Report) {
    // a window program may have no console to write to: a failed write is not a reason to stop
    let _ = std::io::stdout().write_all(report.stdout.as_bytes());
    if !report.stderr.is_empty() {
        let _ = writeln!(std::io::stderr(), "{}", report.stderr);
    }
}

/// `Some(exit code)` when the process was started as `--artifact-upload …`; `None` for any other start. Runs before Tauri.
pub fn run_if_asked() -> Option<i32> {
    let mut args = std::env::args_os().skip(1);
    if args.next().as_deref() != Some(std::ffi::OsStr::new("--artifact-upload")) {
        return None;
    }
    let rest: Vec<String> = args.map(|arg| arg.to_string_lossy().into_owned()).collect();
    let report = real::run(&rest);
    write_report(&report);
    Some(report.code)
}

#[cfg(windows)]
mod real {
    use super::*;
    use std::ffi::OsString;
    use std::fs::OpenOptions;
    use std::io::Read;
    use std::os::windows::ffi::OsStringExt;
    use std::os::windows::fs::OpenOptionsExt;
    use std::os::windows::io::AsRawHandle;
    use std::path::PathBuf;
    use windows_sys::Win32::Storage::FileSystem::{
        GetFileInformationByHandle, GetFileType, GetFinalPathNameByHandleW, BY_HANDLE_FILE_INFORMATION, FILE_ATTRIBUTE_DIRECTORY,
        FILE_ATTRIBUTE_REPARSE_POINT, FILE_FLAG_OPEN_REPARSE_POINT, FILE_SHARE_DELETE, FILE_SHARE_READ, FILE_SHARE_WRITE, FILE_TYPE_DISK,
    };
    use windows_sys::Win32::System::Com::CoTaskMemFree;
    use windows_sys::Win32::UI::Shell::{SHGetKnownFolderPath, FOLDERID_Desktop, FOLDERID_Documents, FOLDERID_Downloads};

    pub(super) fn run(args: &[String]) -> Report {
        let host_env = std::env::var_os("USERPROFILE")
            .and_then(|profile| std::fs::read_to_string(PathBuf::from(profile).join(".jht").join("host.env")).ok());
        let italian = language_is_italian(std::env::var("JHT_LANG").ok().as_deref(), host_env.as_deref());
        let wrapper = std::env::var_os("USERPROFILE").map(|profile| PathBuf::from(profile).join(".local").join("bin").join("jht.ps1"));
        let runtime = crate::windows_runtime::runtime_dir(std::env::var_os("LOCALAPPDATA"));
        let engine = match (wrapper, runtime) {
            (Some(wrapper), Some(runtime)) => crate::team_control::AttestedTeamEngine::resolve(&wrapper, Some(&runtime), true),
            _ => Err("runtime_missing"),
        };
        upload(args, &Computer, engine.as_ref().map(|engine| engine as &dyn TeamEngine).map_err(|error| *error), italian)
    }

    pub(super) struct Computer;

    fn known_folder(id: &windows_sys::core::GUID) -> Option<String> {
        let mut raw: windows_sys::core::PWSTR = std::ptr::null_mut();
        // SAFETY: the id is a valid GUID, no flags, no token (the current user); on success `raw` is a string the shell allocated.
        let result = unsafe { SHGetKnownFolderPath(id, 0, std::ptr::null_mut(), &mut raw) };
        if result < 0 || raw.is_null() {
            // SAFETY: freeing what the shell may have allocated, whatever the result.
            unsafe { CoTaskMemFree(raw as *const core::ffi::c_void) };
            return None;
        }
        // SAFETY: a null-terminated wide string from the shell, read once and then freed.
        let text = unsafe {
            let mut length = 0usize;
            while *raw.add(length) != 0 {
                length += 1;
            }
            let text = OsString::from_wide(std::slice::from_raw_parts(raw, length)).to_string_lossy().into_owned();
            CoTaskMemFree(raw as *const core::ffi::c_void);
            text
        };
        Some(text)
    }

    fn info_of(file: &std::fs::File) -> Option<BY_HANDLE_FILE_INFORMATION> {
        // SAFETY: an all-zero BY_HANDLE_FILE_INFORMATION is a valid value (integers only).
        let mut info: BY_HANDLE_FILE_INFORMATION = unsafe { std::mem::zeroed() };
        // SAFETY: the handle is open for as long as `file` lives; `info` is a valid, writable out structure.
        (unsafe { GetFileInformationByHandle(file.as_raw_handle(), &mut info) } != 0).then_some(info)
    }

    fn identity(info: &BY_HANDLE_FILE_INFORMATION) -> (u32, u64) {
        (info.dwVolumeSerialNumber, (u64::from(info.nFileIndexHigh) << 32) | u64::from(info.nFileIndexLow))
    }

    /// The path the open file really has, `\\?\C:\…`, whatever it was written as.
    fn final_path(file: &std::fs::File) -> Option<String> {
        let mut buffer = vec![0u16; 1024];
        loop {
            // SAFETY: the handle is open; the buffer is `buffer.len()` writable wide characters; flags 0 = the normalized DOS name.
            let length = unsafe { GetFinalPathNameByHandleW(file.as_raw_handle(), buffer.as_mut_ptr(), buffer.len() as u32, 0) } as usize;
            if length == 0 {
                return None;
            }
            if length < buffer.len() {
                return Some(OsString::from_wide(&buffer[..length]).to_string_lossy().into_owned());
            }
            if length > 32_768 {
                return None;
            }
            buffer.resize(length + 1, 0);
        }
    }

    impl Documents for Computer {
        fn allowed_folders(&self) -> Vec<String> {
            let mut folders = Vec::new();
            if let Some(profile) = std::env::var_os("USERPROFILE") {
                folders.push(profile.to_string_lossy().into_owned());
            }
            for id in [&FOLDERID_Documents, &FOLDERID_Downloads, &FOLDERID_Desktop] {
                if let Some(folder) = known_folder(id) {
                    folders.push(folder);
                }
            }
            folders
        }

        fn read(&self, path: &str, allow: &dyn Fn(&str) -> bool) -> Result<Vec<u8>, ReadError> {
            let absolute = std::path::absolute(path).map_err(|_| ReadError::Unreadable)?;
            let share = FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE;
            let first = match OpenOptions::new().read(true).share_mode(share).custom_flags(FILE_FLAG_OPEN_REPARSE_POINT).open(&absolute) {
                Ok(file) => file,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Err(ReadError::Missing),
                Err(_) => {
                    // a folder cannot be opened as a file (access denied): it is there and it is not a file
                    return Err(match std::fs::symlink_metadata(&absolute) {
                        Ok(meta) if meta.file_type().is_symlink() => ReadError::Link,
                        Ok(meta) if meta.is_dir() => ReadError::NotFile,
                        _ => ReadError::Unreadable,
                    });
                }
            };
            let info = info_of(&first).ok_or(ReadError::Unreadable)?;
            // a link or a junction is refused; any other kind of reparse point (a file OneDrive keeps online only) is opened
            // again the usual way, and accepted only when it is the same file
            let (file, info) = if info.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
                if std::fs::symlink_metadata(&absolute).is_ok_and(|meta| meta.file_type().is_symlink()) {
                    return Err(ReadError::Link);
                }
                let again = OpenOptions::new().read(true).share_mode(share).open(&absolute).map_err(|_| ReadError::Unreadable)?;
                let again_info = info_of(&again).ok_or(ReadError::Unreadable)?;
                if identity(&again_info) != identity(&info) {
                    return Err(ReadError::Unreadable);
                }
                (again, again_info)
            } else {
                (first, info)
            };
            // where the OPEN file really is, before a byte is read
            let real = final_path(&file).ok_or(ReadError::Unreadable)?;
            if !allow(&real) {
                return Err(ReadError::NotAllowed);
            }
            // SAFETY: the handle is open for as long as `file` lives.
            let kind = unsafe { GetFileType(file.as_raw_handle()) };
            if info.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY != 0 || kind != FILE_TYPE_DISK {
                return Err(ReadError::NotFile);
            }
            if info.nNumberOfLinks != 1 {
                return Err(ReadError::NotFile);
            }
            let size = (u64::from(info.nFileSizeHigh) << 32) | u64::from(info.nFileSizeLow);
            if size > MAX_BYTES {
                return Err(ReadError::TooBig);
            }
            let mut bytes = Vec::new();
            file.take(MAX_BYTES + 1).read_to_end(&mut bytes).map_err(|_| ReadError::Unreadable)?;
            if bytes.len() as u64 > MAX_BYTES {
                return Err(ReadError::TooBig);
            }
            Ok(bytes)
        }
    }
}

#[cfg(not(windows))]
mod real {
    use super::*;

    /// On a Mac or Linux the wrapper does this itself (`jht-wrapper.sh`); the app has nothing to add.
    pub(super) fn run(_args: &[String]) -> Report {
        Report::refused(EXIT_USAGE, "artifact_upload_windows_only: this command is the Windows one; use `jht artifact upload` in a terminal".to_owned())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::team_control::TeamCommand;
    use std::cell::RefCell;

    /// A computer with a few files, the folders the person has, and the final path each file really has.
    struct Fake {
        folders: Vec<String>,
        /// (written path, final path, bytes or the error)
        files: Vec<(&'static str, &'static str, Result<Vec<u8>, ReadError>)>,
        opened: RefCell<Vec<String>>,
    }

    impl Documents for Fake {
        fn allowed_folders(&self) -> Vec<String> {
            self.folders.clone()
        }

        fn read(&self, path: &str, allow: &dyn Fn(&str) -> bool) -> Result<Vec<u8>, ReadError> {
            self.opened.borrow_mut().push(path.to_owned());
            let (_, real, content) = self.files.iter().find(|(written, _, _)| *written == path).ok_or(ReadError::Missing)?;
            if !allow(real) {
                return Err(ReadError::NotAllowed);
            }
            content.clone()
        }
    }

    /// The container: remembers what it was given.
    struct Container {
        given: RefCell<Vec<(Vec<String>, Vec<u8>)>>,
        answer: Result<ProcessResult, &'static str>,
    }

    impl TeamEngine for Container {
        fn exec(&self, command: &TeamCommand<'_>, _timeout: Duration) -> Result<ProcessResult, &'static str> {
            self.given.borrow_mut().push((command.argv.iter().map(|word| (*word).to_owned()).collect(), command.input.unwrap_or(&[]).to_vec()));
            match &self.answer {
                Ok(result) => Ok(ProcessResult { code: result.code, stdout: result.stdout.clone() }),
                Err(error) => Err(error),
            }
        }
    }

    fn container(code: i32, said: &str) -> Container {
        Container { given: RefCell::new(Vec::new()), answer: Ok(ProcessResult { code, stdout: said.as_bytes().to_vec() }) }
    }

    fn computer() -> Fake {
        Fake {
            folders: vec!["C:\\Users\\Ada Test".to_owned(), "D:\\Sync\\Documents".to_owned()],
            files: vec![
                ("C:\\Users\\Ada Test\\Documents\\My CV (final).pdf", "\\\\?\\C:\\Users\\Ada Test\\Documents\\My CV (final).pdf", Ok(b"%PDF-1 made up".to_vec())),
                ("D:\\Sync\\Documents\\cv.pdf", "\\\\?\\D:\\Sync\\Documents\\cv.pdf", Ok(b"%PDF-1 on another drive".to_vec())),
                ("C:\\Users\\Ada Test\\Links\\cv.pdf", "\\\\?\\C:\\Data\\Elsewhere\\cv.pdf", Ok(b"reached through a folder junction".to_vec())),
                ("C:\\Windows\\System32\\config\\SAM", "\\\\?\\C:\\Windows\\System32\\config\\SAM", Ok(b"never read".to_vec())),
                ("C:\\Users\\Ada Test\\big.pdf", "\\\\?\\C:\\Users\\Ada Test\\big.pdf", Err(ReadError::TooBig)),
                ("C:\\Users\\Ada Test\\folder", "\\\\?\\C:\\Users\\Ada Test\\folder", Err(ReadError::NotFile)),
                ("C:\\Users\\Ada Test\\alias.pdf", "\\\\?\\C:\\Users\\Ada Test\\alias.pdf", Err(ReadError::Link)),
            ],
            opened: RefCell::new(Vec::new()),
        }
    }

    fn args(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| (*value).to_owned()).collect()
    }

    #[test]
    fn a_document_with_spaces_goes_to_the_container_as_bytes_with_its_base_name() {
        let team = container(0, "/jht_user/allegati/My CV (final).pdf — 14 bytes\n");
        let report = upload(&args(&["C:\\Users\\Ada Test\\Documents\\My CV (final).pdf"]), &computer(), Ok(&team), true);
        assert_eq!(report, Report { code: 0, stdout: "/jht_user/allegati/My CV (final).pdf — 14 bytes\n".to_owned(), stderr: String::new() });
        let given = team.given.borrow();
        assert_eq!(given.len(), 1, "given to the container once");
        let (argv, input) = &given[0];
        assert_eq!(argv[..5], ["node", "/app/cli/bin/jht.js", "artifact", "upload", "--stdin"]);
        assert_eq!(argv[5], "--name=My CV (final).pdf", "the base name only, as one word");
        assert_eq!(argv.len(), 6);
        assert_eq!(input, b"%PDF-1 made up");
        assert!(argv.iter().all(|word| !word.contains("Users") && !word.contains('\\')), "no path reaches the container: {argv:?}");
    }

    #[test]
    fn json_is_asked_of_the_container_and_a_file_on_another_allowed_drive_is_taken() {
        let team = container(0, "{\"ok\":true}\n");
        let report = upload(&args(&["--json", "D:/Sync/Documents/cv.pdf"]), &computer(), Ok(&team), false);
        assert_eq!(report.code, 0);
        // the written path of this fake is with backslashes: the check normalizes slashes before the file is asked for
        let given = team.given.borrow();
        assert_eq!(given[0].0.last().map(String::as_str), Some("--json"));
    }

    #[test]
    fn a_file_outside_the_allowed_folders_is_refused_with_the_folders_and_never_read_by_the_container() {
        for written in ["C:\\Windows\\System32\\config\\SAM", "C:\\Users\\Ada Test\\Links\\cv.pdf"] {
            let team = container(0, "");
            let report = upload(&args(&[written]), &computer(), Ok(&team), true);
            assert_eq!(report.code, 2, "{written}");
            assert!(report.stderr.starts_with("artifact_path_not_allowed:"), "{}", report.stderr);
            assert!(report.stderr.contains("Documenti, Download, Scrivania, la tua cartella utente"), "{}", report.stderr);
            assert!(report.stdout.is_empty());
            assert!(team.given.borrow().is_empty(), "nothing given to the container for {written}");
        }
        let team = container(0, "");
        let english = upload(&args(&["C:\\Windows\\System32\\config\\SAM"]), &computer(), Ok(&team), false);
        assert!(english.stderr.contains("not in an allowed folder") && english.stderr.contains("Documents, Downloads, Desktop, your user folder"));
    }

    #[test]
    fn a_path_that_climbs_names_a_device_a_stream_or_a_share_is_refused_before_the_file_is_asked_for() {
        let cases = [
            ("C:\\Users\\Ada Test\\..\\Bob\\cv.pdf", "artifact_path_invalid"),
            ("C:\\Users\\Ada Test\\Documents\\NUL", "artifact_path_invalid"),
            ("C:\\Users\\Ada Test\\CON\\cv.pdf", "artifact_path_invalid"),
            ("C:\\Users\\Ada Test\\cv.pdf:hidden", "artifact_path_invalid"),
            ("C:cv.pdf", "artifact_path_invalid"),
            ("", "artifact_path_invalid"),
            ("\\\\server\\share\\cv.pdf", "artifact_path_not_allowed"),
            ("\\\\?\\C:\\Users\\Ada Test\\cv.pdf", "artifact_path_not_allowed"),
        ];
        for (written, code) in cases {
            let team = container(0, "");
            let computer = computer();
            let report = upload(&args(&[written]), &computer, Ok(&team), true);
            assert_eq!((report.code, report.stderr.starts_with(&format!("{code}:"))), (2, true), "{written:?}: {}", report.stderr);
            assert!(report.stderr.contains("Documenti"), "the allowed folders are named: {}", report.stderr);
            assert!(computer.opened.borrow().is_empty(), "{written:?} was never opened");
            assert!(team.given.borrow().is_empty());
        }
    }

    #[test]
    fn what_cannot_be_read_ends_with_its_own_word_and_the_container_is_not_asked() {
        let cases = [
            ("C:\\Users\\Ada Test\\big.pdf", "artifact_too_big", 2),
            ("C:\\Users\\Ada Test\\folder", "artifact_not_file", 2),
            ("C:\\Users\\Ada Test\\alias.pdf", "artifact_is_link", 2),
            ("C:\\Users\\Ada Test\\nothing.pdf", "artifact_file_missing", 1),
        ];
        for (written, code, exit) in cases {
            let team = container(0, "");
            let report = upload(&args(&[written]), &computer(), Ok(&team), false);
            assert_eq!((report.code, report.stderr.starts_with(&format!("{code}:"))), (exit, true), "{written}: {}", report.stderr);
            assert!(team.given.borrow().is_empty());
        }
    }

    #[test]
    fn a_team_that_is_not_up_is_told_so_and_nothing_falls_back_on_the_wrapper() {
        let report = upload(&args(&["C:\\Users\\Ada Test\\Documents\\My CV (final).pdf"]), &computer(), Err("container_not_found"), true);
        assert_eq!(report.code, 1);
        assert!(report.stderr.starts_with("team_container_unavailable:") && report.stderr.contains("jht up"));
        // a container that answers with an error is not asked again
        let team = container(2, "");
        let failed = upload(&args(&["C:\\Users\\Ada Test\\Documents\\My CV (final).pdf"]), &computer(), Ok(&team), false);
        assert_eq!(failed.code, 2);
        assert!(failed.stderr.starts_with("artifact_upload_failed:"));
        assert_eq!(team.given.borrow().len(), 1);
        let said = container(2, ": the document is larger than 10 MB\n");
        let own = upload(&args(&["C:\\Users\\Ada Test\\Documents\\My CV (final).pdf"]), &computer(), Ok(&said), false);
        assert_eq!((own.code, own.stderr.as_str()), (2, ": the document is larger than 10 MB"));
        let timeout = Container { given: RefCell::new(Vec::new()), answer: Err("process_timeout") };
        assert_eq!(upload(&args(&["C:\\Users\\Ada Test\\Documents\\My CV (final).pdf"]), &computer(), Ok(&timeout), false).code, 1);
    }

    #[test]
    fn the_arguments_are_one_path_and_perhaps_json() {
        assert_eq!(parse_args(&args(&["a.pdf"])), Ok(("a.pdf".to_owned(), false)));
        assert_eq!(parse_args(&args(&["a b.pdf", "--json"])), Ok(("a b.pdf".to_owned(), true)));
        assert_eq!(parse_args(&args(&["--json", "a.pdf"])), Ok(("a.pdf".to_owned(), true)));
        for bad in [args(&[]), args(&["--json"]), args(&["a.pdf", "b.pdf"]), args(&["--help"]), args(&["a.pdf", "--name=x"])] {
            assert_eq!(parse_args(&bad), Err(()), "{bad:?}");
        }
        let team = container(0, "");
        let usage = upload(&args(&["a.pdf", "b.pdf"]), &computer(), Ok(&team), true);
        assert_eq!((usage.code, usage.stderr.as_str()), (2, "uso: jht artifact upload FILE [--json]"));
    }

    #[test]
    fn the_language_is_the_variable_then_host_env_and_only_italian_is_italian() {
        assert!(language_is_italian(Some("it"), None));
        assert!(!language_is_italian(Some("en"), Some("JHT_LANG=it\n")), "the environment wins");
        assert!(language_is_italian(None, Some("# comment\nJHT_HOST_TYPE=local\nJHT_LANG=\"it\"\n")));
        assert!(!language_is_italian(None, Some("JHT_LANG=de\n")));
        assert!(!language_is_italian(Some("xx"), Some("JHT_LANG=bogus\n")));
        assert!(!language_is_italian(None, None));
    }
}

#[cfg(all(test, windows))]
mod windows_tests {
    use super::*;

    fn folder(name: &str) -> std::path::PathBuf {
        let path = std::env::temp_dir().join(format!("jht-upload-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&path);
        std::fs::create_dir_all(&path).unwrap();
        path
    }

    #[test]
    fn a_real_file_is_opened_once_its_final_path_is_asked_and_only_then_it_is_read() {
        let dir = folder("read");
        let file = dir.join("My CV (final).pdf");
        std::fs::write(&file, b"made-up document").unwrap();
        let written = file.to_string_lossy().into_owned();
        let seen = std::cell::RefCell::new(String::new());
        let bytes = real::Computer.read(&written, &|final_path| {
            *seen.borrow_mut() = final_path.to_owned();
            true
        });
        assert_eq!(bytes, Ok(b"made-up document".to_vec()));
        assert!(seen.borrow().starts_with("\\\\?\\") && seen.borrow().ends_with("My CV (final).pdf"), "{}", seen.borrow());
        // a file the rule does not allow is not read: the answer is the refusal, whatever the bytes are
        assert_eq!(real::Computer.read(&written, &|_| false), Err(ReadError::NotAllowed));
        // a folder is not a document, a file that is not there is missing
        assert_eq!(real::Computer.read(&dir.to_string_lossy(), &|_| true), Err(ReadError::NotFile));
        assert_eq!(real::Computer.read(&dir.join("nothing.pdf").to_string_lossy(), &|_| true), Err(ReadError::Missing));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_file_over_the_limit_is_too_big_before_it_is_read() {
        let dir = folder("big");
        let file = dir.join("big.pdf");
        let handle = std::fs::File::create(&file).unwrap();
        handle.set_len(MAX_BYTES + 1).unwrap();
        drop(handle);
        assert_eq!(real::Computer.read(&file.to_string_lossy(), &|_| true), Err(ReadError::TooBig));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_known_folders_of_the_person_are_asked_of_windows() {
        let folders = real::Computer.allowed_folders();
        assert!(folders.len() >= 2, "{folders:?}");
        assert!(folders.iter().all(|folder| folder.len() > 3 && folder.as_bytes()[1] == b':'), "{folders:?}");
    }
}
