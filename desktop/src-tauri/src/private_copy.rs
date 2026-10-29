//! «Open in the reader»: a private copy of a file whose bytes the caller has already checked, opened with
//! the program the system has for its type.
//!
//! One routine for every document the app shows on request (an attachment of the chat, a CV or a letter
//! of the team): the bytes are written ONCE into a folder of the app that nobody else can read, under a
//! name made of 128 random bits and an extension from a fixed list, and the system opens that copy. The
//! original, the team's folder and the person's file name are never in the way:
//!
//! - the folder is `private-copies` in the app's own data folder: made 0700 when absent, refused when it
//!   is a link or someone else's, put back to 0700 when it is ours and open;
//! - the file is made with O_EXCL | O_NOFOLLOW at 0600, written once, fsynced; nothing is renamed or
//!   rewritten, so a link put there between two steps has nothing to redirect;
//! - on macOS the copy carries the quarantine attribute (Gatekeeper asks before anything runs); where the
//!   attribute cannot be set the copy is opened without it, a limit and not an error;
//! - the extension comes from `CopyKind`, never from a string of the caller; the name of the document is
//!   not on the disk, not in a log and not in an error;
//! - a sweep removes copies older than an hour and all but the five newest, at the start, at the exit and
//!   before each new copy; never when a window closes (the reader has its file open).
//!
//! Answers are closed codes of the error catalog: `private_copy_failed` (the copy could not be made) and
//! `document_open_failed` (the system found no program, or could not start it).

use std::path::Path;

/// The type of the copy, therefore its extension: one per extension a document can be shown with.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum CopyKind {
    Pdf,
    Docx,
    Odt,
    Rtf,
    Xlsx,
    Ods,
    Pptx,
    Odp,
    Png,
    Jpg,
    Gif,
    Webp,
    Txt,
    Md,
}

#[allow(dead_code)] // the preview of the team's documents and the attachments of the chat are the callers
impl CopyKind {
    const ALL: [CopyKind; 14] = [
        CopyKind::Pdf,
        CopyKind::Docx,
        CopyKind::Odt,
        CopyKind::Rtf,
        CopyKind::Xlsx,
        CopyKind::Ods,
        CopyKind::Pptx,
        CopyKind::Odp,
        CopyKind::Png,
        CopyKind::Jpg,
        CopyKind::Gif,
        CopyKind::Webp,
        CopyKind::Txt,
        CopyKind::Md,
    ];

    /// The extension of the copy: from this list and nowhere else.
    pub(crate) fn extension(self) -> &'static str {
        match self {
            CopyKind::Pdf => "pdf",
            CopyKind::Docx => "docx",
            CopyKind::Odt => "odt",
            CopyKind::Rtf => "rtf",
            CopyKind::Xlsx => "xlsx",
            CopyKind::Ods => "ods",
            CopyKind::Pptx => "pptx",
            CopyKind::Odp => "odp",
            CopyKind::Png => "png",
            CopyKind::Jpg => "jpg",
            CopyKind::Gif => "gif",
            CopyKind::Webp => "webp",
            CopyKind::Txt => "txt",
            CopyKind::Md => "md",
        }
    }

    /// The kind for an extension the content has already decided (`jpeg` is `jpg`); `None` for anything else.
    pub(crate) fn from_extension(extension: &str) -> Option<CopyKind> {
        let extension = extension.to_ascii_lowercase();
        let extension = if extension == "jpeg" { "jpg" } else { extension.as_str() };
        CopyKind::ALL.into_iter().find(|kind| kind.extension() == extension)
    }
}

/// How long a copy lives and how many stay: the reader may hold its file for a long time, a person opens
/// a handful of documents.
const KEEP_SECONDS: i64 = 3600;
const KEEP_NEWEST: usize = 5;
/// Past this the bytes are not a document the app shows: refused before anything is written.
const MAX_COPY_BYTES: usize = 64 * 1024 * 1024;
pub(crate) const FOLDER: &str = "private-copies";

#[cfg(any(target_os = "macos", target_os = "linux"))]
mod unix {
    use super::*;
    use rustix::fs::{
        fchmod, fstat, fsync, mkdirat, open, openat, statat, unlinkat, AtFlags, Dir, FileType, Mode, OFlags,
    };
    use rustix::io::Errno;
    use std::io::{Read, Write};
    use std::os::fd::OwnedFd;
    use std::path::PathBuf;
    use std::sync::OnceLock;
    use std::time::{SystemTime, UNIX_EPOCH};

    static APP_DIR: OnceLock<PathBuf> = OnceLock::new();

    /// The folder of the app the copies live in, set once at the start; the first sweep is here.
    pub(crate) fn init(app_dir: PathBuf) {
        if APP_DIR.set(app_dir).is_ok() {
            sweep_private_copies();
        }
    }

    fn now() -> i64 {
        SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0)
    }

    /// 128 random bits as 32 lower-case hex digits.
    fn random_name() -> Result<String, &'static str> {
        let mut bits = [0u8; 16];
        std::fs::File::open("/dev/urandom")
            .and_then(|mut source| source.read_exact(&mut bits))
            .map_err(|_| "private_copy_failed")?;
        Ok(bits.iter().map(|byte| format!("{byte:02x}")).collect())
    }

    /// A name this module made: 32 hex digits, a dot, one of the fixed extensions. Nothing else in the folder is ours.
    fn is_ours(name: &[u8]) -> bool {
        let Some(dot) = name.iter().position(|b| *b == b'.') else { return false };
        let (stem, extension) = (&name[..dot], &name[dot + 1..]);
        stem.len() == 32
            && stem.iter().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(b))
            && CopyKind::ALL.iter().any(|kind| kind.extension().as_bytes() == extension)
    }

    /// The `private-copies` folder as a descriptor: the app's folder is opened as it is, the folder itself
    /// without following a link, made 0700 when absent; one that is not ours is refused, one that is ours and
    /// open to others is closed to them.
    fn open_folder(app_dir: &Path) -> Result<OwnedFd, &'static str> {
        let directory = OFlags::RDONLY | OFlags::DIRECTORY | OFlags::CLOEXEC;
        let root = open(app_dir, directory, Mode::empty()).map_err(|_| "private_copy_failed")?;
        let own = |fd: &OwnedFd| -> Result<OwnedFd, Errno> { openat(fd, FOLDER, directory | OFlags::NOFOLLOW, Mode::empty()) };
        let folder = match own(&root) {
            Ok(folder) => folder,
            Err(Errno::NOENT) => {
                mkdirat(&root, FOLDER, Mode::RWXU).map_err(|_| "private_copy_failed")?;
                own(&root).map_err(|_| "private_copy_failed")?
            }
            Err(_) => return Err("private_copy_failed"),
        };
        let stat = fstat(&folder).map_err(|_| "private_copy_failed")?;
        // SAFETY: geteuid takes no argument and cannot fail.
        if FileType::from_raw_mode(stat.st_mode) != FileType::Directory || stat.st_uid != unsafe { libc::geteuid() } {
            return Err("private_copy_failed");
        }
        if stat.st_mode & 0o777 != 0o700 {
            fchmod(&folder, Mode::RWXU).map_err(|_| "private_copy_failed")?;
        }
        Ok(folder)
    }

    /// Removes the copies older than an hour and all but the five newest. Only names this module makes; a link
    /// with such a name is removed as a link, never followed.
    fn sweep_folder(folder: &OwnedFd, at: i64) {
        let Ok(dir) = Dir::read_from(folder) else { return };
        let mut ours: Vec<(i64, std::ffi::CString)> = Vec::new();
        for entry in dir.flatten() {
            if !is_ours(entry.file_name().to_bytes()) {
                continue;
            }
            let Ok(stat) = statat(folder, entry.file_name(), AtFlags::SYMLINK_NOFOLLOW) else { continue };
            ours.push((stat.st_mtime as i64, entry.file_name().to_owned()));
        }
        ours.sort_by(|a, b| b.0.cmp(&a.0));
        for (position, (modified, name)) in ours.iter().enumerate() {
            if position >= KEEP_NEWEST || at - modified > KEEP_SECONDS {
                let _ = unlinkat(folder, name.as_c_str(), AtFlags::empty());
            }
        }
    }

    pub(crate) fn sweep_dir(app_dir: &Path) {
        if let Ok(folder) = open_folder(app_dir) {
            sweep_folder(&folder, now());
        }
    }

    /// The quarantine attribute of macOS on the copy: the system asks the person before a program runs. A volume
    /// that cannot hold it is a declared limit, the copy is opened as it is.
    #[cfg(target_os = "macos")]
    fn quarantine(file: &std::fs::File, at: i64) {
        use std::os::fd::AsRawFd;
        let value = format!("0081;{at:x};Job Hunter Team;");
        // SAFETY: the name is a NUL-terminated literal, the value a live buffer of the length given.
        unsafe {
            libc::fsetxattr(
                file.as_raw_fd(),
                c"com.apple.quarantine".as_ptr(),
                value.as_ptr().cast(),
                value.len(),
                0,
                0,
            );
        }
    }

    #[cfg(not(target_os = "macos"))]
    fn quarantine(_file: &std::fs::File, _at: i64) {}

    pub(crate) fn open_private_copy_with(
        dir: &Path,
        kind: CopyKind,
        bytes: &[u8],
        open_it: impl FnOnce(&Path) -> std::io::Result<()>,
    ) -> Result<(), &'static str> {
        if bytes.is_empty() || bytes.len() > MAX_COPY_BYTES {
            return Err("private_copy_failed");
        }
        let folder = open_folder(dir)?;
        let at = now();
        sweep_folder(&folder, at);
        let name = format!("{}.{}", random_name()?, kind.extension());
        let created = openat(
            &folder,
            name.as_str(),
            OFlags::WRONLY | OFlags::CREATE | OFlags::EXCL | OFlags::NOFOLLOW | OFlags::CLOEXEC,
            Mode::RUSR | Mode::WUSR,
        )
        .map_err(|_| "private_copy_failed")?;
        let mut file = std::fs::File::from(created);
        let written = (|| -> Result<(), &'static str> {
            fchmod(&file, Mode::RUSR | Mode::WUSR).map_err(|_| "private_copy_failed")?;
            file.write_all(bytes).map_err(|_| "private_copy_failed")?;
            fsync(&file).map_err(|_| "private_copy_failed")?;
            quarantine(&file, at);
            Ok(())
        })();
        if let Err(code) = written {
            let _ = unlinkat(&folder, name.as_str(), AtFlags::empty());
            return Err(code);
        }
        drop(file);
        // the system opens the copy by its path in the folder we just checked: a name nobody can guess, in a folder
        // nobody else can write
        let path = dir.join(FOLDER).join(&name);
        if open_it(&path).is_err() {
            let _ = unlinkat(&folder, name.as_str(), AtFlags::empty());
            return Err("document_open_failed");
        }
        Ok(())
    }

    pub(crate) fn app_dir() -> Option<&'static PathBuf> {
        APP_DIR.get()
    }
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
mod unix {
    use super::*;
    use std::path::PathBuf;

    pub(crate) fn init(_app_dir: PathBuf) {}
    pub(crate) fn sweep_dir(_app_dir: &Path) {}
    pub(crate) fn open_private_copy_with(
        _dir: &Path,
        _kind: CopyKind,
        _bytes: &[u8],
        _open_it: impl FnOnce(&Path) -> std::io::Result<()>,
    ) -> Result<(), &'static str> {
        Err("private_copy_failed")
    }
    pub(crate) fn app_dir() -> Option<&'static PathBuf> {
        None
    }
}

/// Sets the app's folder once, at the start (and sweeps once).
pub(crate) fn init(app_dir: std::path::PathBuf) {
    unix::init(app_dir);
}

/// The copy of `bytes` (already checked by the caller; they are not read again from the team) opened with the
/// system's program for its type. `document_open_failed`: nothing opened it; `private_copy_failed`: no copy.
#[allow(dead_code)]
pub(crate) fn open_private_copy(kind: CopyKind, bytes: &[u8]) -> Result<(), &'static str> {
    let Some(dir) = unix::app_dir() else { return Err("private_copy_failed") };
    unix::open_private_copy_with(dir, kind, bytes, |path| open::that_detached(path))
}

/// The same with the folder and the opener given: for the tests, which open nothing.
#[allow(dead_code)]
pub(crate) fn open_private_copy_with(
    dir: &Path,
    kind: CopyKind,
    bytes: &[u8],
    open_it: impl FnOnce(&Path) -> std::io::Result<()>,
) -> Result<(), &'static str> {
    unix::open_private_copy_with(dir, kind, bytes, open_it)
}

/// At the start, at the exit and before each new copy: the copies past an hour and all but the five newest go.
#[allow(dead_code)]
pub(crate) fn sweep_private_copies() {
    if let Some(dir) = unix::app_dir() {
        unix::sweep_dir(dir);
    }
}

#[cfg(all(test, any(target_os = "macos", target_os = "linux")))]
mod tests {
    use super::*;
    use std::os::unix::fs::{symlink, MetadataExt, PermissionsExt};
    use std::time::{Duration, SystemTime};

    fn app_dir(tag: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("jht-private-copy-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir.canonicalize().unwrap()
    }

    fn copies(dir: &Path) -> Vec<std::path::PathBuf> {
        let mut found: Vec<_> = std::fs::read_dir(dir.join(FOLDER))
            .map(|entries| entries.flatten().map(|e| e.path()).collect())
            .unwrap_or_default();
        found.sort();
        found
    }

    fn open_nothing(_: &Path) -> std::io::Result<()> {
        Ok(())
    }

    /// The modification time of the link itself, not of what it points to.
    fn age_link(path: &Path, seconds: i64) {
        let cpath = std::ffi::CString::new(path.to_str().unwrap()).unwrap();
        let then = libc::time_t::try_from(SystemTime::now().duration_since(SystemTime::UNIX_EPOCH).unwrap().as_secs() as i64 - seconds).unwrap();
        let stamp = libc::timespec { tv_sec: then, tv_nsec: 0 };
        let times = [stamp, stamp];
        // SAFETY: a NUL-terminated path and two valid timespecs.
        let done = unsafe { libc::utimensat(libc::AT_FDCWD, cpath.as_ptr(), times.as_ptr(), libc::AT_SYMLINK_NOFOLLOW) };
        assert_eq!(done, 0);
    }

    fn age(path: &Path, seconds: u64) {
        let file = std::fs::OpenOptions::new().write(true).open(path).unwrap();
        file.set_modified(SystemTime::now() - Duration::from_secs(seconds)).unwrap();
    }

    #[test]
    fn the_copy_is_private_random_and_has_the_bytes_and_the_extension_of_its_kind() {
        let dir = app_dir("basic");
        let mut opened = None;
        open_private_copy_with(&dir, CopyKind::Pdf, b"%PDF-1.4 bytes", |path| {
            opened = Some(path.to_path_buf());
            Ok(())
        })
        .unwrap();
        let path = opened.unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"%PDF-1.4 bytes");
        let name = path.file_name().unwrap().to_str().unwrap();
        assert!(name.ends_with(".pdf") && name.len() == 32 + 4, "{name}");
        assert!(name[..32].bytes().all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase()));
        assert_eq!(std::fs::metadata(&path).unwrap().mode() & 0o777, 0o600);
        assert_eq!(std::fs::metadata(dir.join(FOLDER)).unwrap().mode() & 0o777, 0o700);
        assert_eq!(path.parent().unwrap(), dir.join(FOLDER));
        open_private_copy_with(&dir, CopyKind::Pdf, b"%PDF-1.4 bytes", open_nothing).unwrap();
        let names: std::collections::HashSet<_> = copies(&dir).iter().map(|p| p.file_name().unwrap().to_owned()).collect();
        assert_eq!(names.len(), 2, "two copies never share a name");
    }

    #[test]
    fn a_folder_that_is_a_link_is_refused_and_nothing_goes_through_it() {
        let dir = app_dir("link");
        let target = app_dir("link-target");
        symlink(&target, dir.join(FOLDER)).unwrap();
        assert_eq!(open_private_copy_with(&dir, CopyKind::Pdf, b"x", open_nothing), Err("private_copy_failed"));
        assert!(std::fs::read_dir(&target).unwrap().next().is_none(), "the target of the link stays empty");
    }

    #[test]
    fn a_folder_that_is_ours_and_open_to_others_is_closed_to_them() {
        let dir = app_dir("mode");
        std::fs::create_dir(dir.join(FOLDER)).unwrap();
        std::fs::set_permissions(dir.join(FOLDER), std::fs::Permissions::from_mode(0o755)).unwrap();
        open_private_copy_with(&dir, CopyKind::Txt, b"hello", open_nothing).unwrap();
        assert_eq!(std::fs::metadata(dir.join(FOLDER)).unwrap().mode() & 0o777, 0o700);
    }

    #[test]
    fn nothing_is_made_for_empty_bytes_or_bytes_over_the_limit() {
        let dir = app_dir("size");
        assert_eq!(open_private_copy_with(&dir, CopyKind::Pdf, b"", open_nothing), Err("private_copy_failed"));
        let big = vec![0u8; MAX_COPY_BYTES + 1];
        assert_eq!(open_private_copy_with(&dir, CopyKind::Pdf, &big, open_nothing), Err("private_copy_failed"));
        assert!(copies(&dir).is_empty());
    }

    #[test]
    fn when_nothing_opens_the_copy_the_code_says_so_and_the_copy_is_removed() {
        let dir = app_dir("noopen");
        let result = open_private_copy_with(&dir, CopyKind::Docx, b"PK", |_| {
            Err(std::io::Error::new(std::io::ErrorKind::NotFound, "no program"))
        });
        assert_eq!(result, Err("document_open_failed"));
        assert!(copies(&dir).is_empty());
    }

    #[test]
    fn an_app_folder_that_is_not_there_is_a_failed_copy_not_a_panic() {
        let missing = app_dir("missing").join("not-there");
        assert_eq!(open_private_copy_with(&missing, CopyKind::Pdf, b"x", open_nothing), Err("private_copy_failed"));
    }

    #[test]
    fn the_sweep_removes_what_is_over_an_hour_old_and_all_but_the_five_newest_and_only_our_names() {
        let dir = app_dir("sweep");
        std::fs::create_dir(dir.join(FOLDER)).unwrap();
        std::fs::set_permissions(dir.join(FOLDER), std::fs::Permissions::from_mode(0o700)).unwrap();
        let folder = dir.join(FOLDER);
        let make = |stem: char, extension: &str, seconds: u64| {
            let path = folder.join(format!("{}.{extension}", stem.to_string().repeat(32)));
            std::fs::write(&path, b"x").unwrap();
            age(&path, seconds);
            path
        };
        let old = make('a', "pdf", 3 * 3600);
        let fresh: Vec<_> = ['b', 'c', 'd', 'e', 'f', '0', '1'].iter().enumerate().map(|(i, c)| make(*c, "pdf", 60 * (i as u64 + 1))).collect();
        let foreign = folder.join("notes.txt");
        std::fs::write(&foreign, b"mine").unwrap();
        age(&foreign, 10 * 3600);
        let outside = dir.join("outside.pdf");
        std::fs::write(&outside, b"must stay").unwrap();
        let link = folder.join(format!("{}.pdf", "9".repeat(32)));
        symlink(&outside, &link).unwrap();
        age_link(&link, 3 * 3600);
        unix::sweep_dir(&dir);
        assert!(!old.exists(), "older than an hour");
        assert!(std::fs::symlink_metadata(&link).is_err(), "an old link with one of our names goes, as a link");
        let kept: Vec<_> = fresh.iter().filter(|p| p.exists()).collect();
        assert_eq!(kept.len(), KEEP_NEWEST, "{kept:?}");
        assert!(fresh[..KEEP_NEWEST].iter().all(|p| p.exists()), "the five newest are the ones that stay");
        assert!(foreign.exists(), "a file that is not ours is not ours to remove");
        assert!(outside.exists(), "a link is removed as a link, never followed");
    }

    #[test]
    fn a_new_copy_sweeps_first_and_the_five_newest_stay_with_it() {
        let dir = app_dir("before");
        for _ in 0..8 {
            open_private_copy_with(&dir, CopyKind::Png, b"\x89PNG", open_nothing).unwrap();
        }
        assert!(copies(&dir).len() <= KEEP_NEWEST + 1, "{}", copies(&dir).len());
        let old = copies(&dir).remove(0);
        age(&old, 2 * 3600);
        open_private_copy_with(&dir, CopyKind::Png, b"\x89PNG", open_nothing).unwrap();
        assert!(!old.exists());
    }

    #[test]
    fn the_extension_comes_from_the_kind_and_a_name_is_never_the_callers() {
        for kind in CopyKind::ALL {
            assert_eq!(CopyKind::from_extension(kind.extension()), Some(kind));
            assert!(kind.extension().bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit()));
        }
        assert_eq!(CopyKind::from_extension("JPEG"), Some(CopyKind::Jpg));
        for refused in ["exe", "sh", "app", "html", "", "pdf/../x", "docm", "zip"] {
            assert_eq!(CopyKind::from_extension(refused), None, "{refused}");
        }
    }

    #[test]
    fn before_the_start_has_set_the_folder_there_is_no_copy() {
        // `init` has not run in the tests of this module that use a folder of their own
        if app_dir_is_unset() {
            assert_eq!(open_private_copy(CopyKind::Pdf, b"x"), Err("private_copy_failed"));
        }
    }

    fn app_dir_is_unset() -> bool {
        unix::app_dir().is_none()
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn on_macos_the_copy_carries_the_quarantine_attribute() {
        let dir = app_dir("quarantine");
        let mut opened = None;
        open_private_copy_with(&dir, CopyKind::Pdf, b"%PDF", |path| {
            opened = Some(path.to_path_buf());
            Ok(())
        })
        .unwrap();
        let path = std::ffi::CString::new(opened.unwrap().to_str().unwrap()).unwrap();
        // SAFETY: a NUL-terminated path and name, a null buffer with size 0 only asks for the attribute's size.
        let size = unsafe { libc::getxattr(path.as_ptr(), c"com.apple.quarantine".as_ptr(), std::ptr::null_mut(), 0, 0, 0) };
        assert!(size > 0, "the quarantine attribute is on the copy");
    }
}
