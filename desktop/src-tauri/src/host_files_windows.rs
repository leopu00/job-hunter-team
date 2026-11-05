//! Opening a file the team's agents wrote, on Windows, so that nothing but a plain file is read (JHT-T174, JHT-T177).
//!
//! The counterpart of `O_NOFOLLOW | O_NONBLOCK` + `fstat` of the Unix reader in `host_db`. The file is hostile input:
//! a link, a junction, a second name, a folder or a device in its place must lead nowhere.
//!
//! - the file is opened with `FILE_FLAG_OPEN_REPARSE_POINT`, so a symbolic link or a junction is opened as itself and
//!   not followed; the checks are then made on the OPEN handle (`GetFileInformationByHandle`), not on the path: no
//!   reparse point, not a folder, a disk file (`GetFileType`, so not a pipe or a device), one name (`nNumberOfLinks`),
//!   under the size cap;
//! - the share mode allows others to read, write and delete: the reader never stops the team from writing or from
//!   replacing the file, it only notices it (the stamp below);
//! - what identifies the file at a moment is its volume, its index on the volume, its size and its last write time. A
//!   copy whose stamp is the same before and after, on the handle and on the path opened again, is of that file.
//!
//! Answers are the closed codes of the saved data: `host_db_unsafe`, `host_db_unreadable`; a file that is not there is
//! `Ok(None)`. Read only: nothing here writes, renames or locks a file of the team.

use std::{
    fs::{File, OpenOptions},
    io::{Read, Write},
    os::windows::{fs::OpenOptionsExt, io::AsRawHandle},
    path::Path,
};

use windows_sys::Win32::{
    Security::Cryptography::{BCryptGenRandom, BCRYPT_USE_SYSTEM_PREFERRED_RNG},
    Storage::FileSystem::{
        GetFileInformationByHandle, GetFileType, BY_HANDLE_FILE_INFORMATION, FILE_ATTRIBUTE_DIRECTORY, FILE_ATTRIBUTE_REPARSE_POINT,
        FILE_FLAG_OPEN_REPARSE_POINT, FILE_SHARE_DELETE, FILE_SHARE_READ, FILE_SHARE_WRITE, FILE_TYPE_DISK,
    },
};

/// Seconds between 1601-01-01 (the Windows epoch) and 1970-01-01.
const EPOCH_GAP_SECONDS: u64 = 11_644_473_600;

/// What identifies a file at a moment: if all of it is the same before and after a copy, the copy is of that file.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) struct Stamp {
    volume: u32,
    index: u64,
    size: u64,
    /// Last write time, 100 ns ticks since 1601.
    written: u64,
}

impl Stamp {
    /// The last write time, seconds since 1970.
    pub(crate) fn written_unix(&self) -> i64 {
        (self.written / 10_000_000).saturating_sub(EPOCH_GAP_SECONDS) as i64
    }
}

/// A source file, open and checked: a regular file with one name, under the cap.
pub(crate) struct Source {
    file: File,
    stamp: Stamp,
}

impl Source {
    pub(crate) fn stamp(&self) -> Stamp {
        self.stamp
    }

    /// The file this handle has open, still the same file and still with one name.
    pub(crate) fn still_the_same(&self) -> bool {
        match info_of(&self.file) {
            Ok(info) => stamp_of(&info) == self.stamp && info.nNumberOfLinks == 1,
            Err(_) => false,
        }
    }

    /// The path opened again names the very file this handle has open.
    pub(crate) fn path_names_it(&self, path: &Path, cap: u64) -> bool {
        matches!(open_source(path, cap), Ok(Some(again)) if again.stamp == self.stamp)
    }
}

fn info_of(file: &File) -> Result<BY_HANDLE_FILE_INFORMATION, &'static str> {
    // SAFETY: an all-zero BY_HANDLE_FILE_INFORMATION is a valid value (integers only).
    let mut info: BY_HANDLE_FILE_INFORMATION = unsafe { std::mem::zeroed() };
    // SAFETY: the handle is open for as long as `file` lives; `info` is a valid, writable out structure.
    let done = unsafe { GetFileInformationByHandle(file.as_raw_handle(), &mut info) };
    if done == 0 {
        return Err("host_db_unreadable");
    }
    Ok(info)
}

fn stamp_of(info: &BY_HANDLE_FILE_INFORMATION) -> Stamp {
    Stamp {
        volume: info.dwVolumeSerialNumber,
        index: ((info.nFileIndexHigh as u64) << 32) | info.nFileIndexLow as u64,
        size: ((info.nFileSizeHigh as u64) << 32) | info.nFileSizeLow as u64,
        written: ((info.ftLastWriteTime.dwHighDateTime as u64) << 32) | info.ftLastWriteTime.dwLowDateTime as u64,
    }
}

/// True when the node at `path` is itself a link or a junction (it is not followed to say so).
pub(crate) fn is_reparse_point(path: &Path) -> Option<bool> {
    use std::os::windows::fs::MetadataExt;
    let meta = std::fs::symlink_metadata(path).ok()?;
    Some(meta.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 || meta.file_type().is_symlink())
}

/// `None` when the file is not there; an error when it is there and is not safe to read.
pub(crate) fn open_source(path: &Path, cap: u64) -> Result<Option<Source>, &'static str> {
    let opened = OpenOptions::new()
        .read(true)
        .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE)
        .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT)
        .open(path);
    let file = match opened {
        Ok(file) => file,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        // a folder cannot be opened as a file (access denied): it is there and it is not a file
        Err(_) => {
            return match std::fs::symlink_metadata(path) {
                Ok(meta) if meta.is_dir() || is_reparse_point(path) == Some(true) => Err("host_db_unsafe"),
                _ => Err("host_db_unreadable"),
            }
        }
    };
    let info = info_of(&file)?;
    // SAFETY: the handle is open for as long as `file` lives.
    let kind = unsafe { GetFileType(file.as_raw_handle()) };
    let stamp = stamp_of(&info);
    if info.dwFileAttributes & (FILE_ATTRIBUTE_DIRECTORY | FILE_ATTRIBUTE_REPARSE_POINT) != 0
        || kind != FILE_TYPE_DISK
        || info.nNumberOfLinks != 1
        || stamp.size > cap
    {
        return Err("host_db_unsafe");
    }
    Ok(Some(Source { file, stamp }))
}

/// Read `source` once into a new private file, at most `cap` bytes plus one to tell that it grew.
pub(crate) fn copy_into(source: &Source, to: &Path, cap: u64) -> Result<(), &'static str> {
    let mut out = OpenOptions::new()
        .write(true)
        .create_new(true)
        .share_mode(0)
        .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT)
        .open(to)
        .map_err(|_| "host_db_unreadable")?;
    let mut reader = (&source.file).take(cap + 1);
    let copied = std::io::copy(&mut reader, &mut out).map_err(|_| "host_db_unreadable")?;
    if copied > cap {
        return Err("host_db_unsafe");
    }
    out.flush().map_err(|_| "host_db_unreadable")?;
    out.sync_all().map_err(|_| "host_db_unreadable")?;
    Ok(())
}

/// 128 random bits as 32 lower-case hex digits, from the system generator.
pub(crate) fn random_name() -> Result<String, &'static str> {
    let mut bytes = [0u8; 16];
    // SAFETY: a null algorithm handle with BCRYPT_USE_SYSTEM_PREFERRED_RNG asks for the system generator; the buffer
    // is 16 writable bytes and its length is passed.
    let status = unsafe { BCryptGenRandom(std::ptr::null_mut(), bytes.as_mut_ptr(), bytes.len() as u32, BCRYPT_USE_SYSTEM_PREFERRED_RNG) };
    if status < 0 {
        return Err("host_db_unreadable");
    }
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}
