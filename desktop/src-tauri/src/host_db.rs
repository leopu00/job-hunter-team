//! The saved data of the team of this computer (`~/.jht/jobs.db`), read while the team is off.
//!
//! The file is written by the agents, so for this module it is hostile input: a link, a pipe, a huge or
//! a corrupt file, a schema built to make a reader burn time or memory. Nothing is ever opened in place.
//! One routine takes a snapshot and one routine reads it:
//!
//! - the folder (`~/.jht`) must be a real folder, not a link; `jobs.db` and `jobs.db-wal` must be regular files
//!   with one name each, opened with O_NOFOLLOW | O_NONBLOCK and checked on the open descriptor (a pipe
//!   cannot hold the app, a link or a second name leads nowhere), under a size cap;
//! - the bytes are copied (read once, at most the cap plus one byte) into a folder of the app that nobody else
//!   can read (0700, files 0600, a random name). The copy is coherent: the stamps (inode, size, change time) of
//!   both files are taken before and after, and a copy that did not stay still is made again, three times at most;
//!   the original is only read, never written, renamed, locked or checkpointed;
//! - the copy is opened read-only, on its own, with defensive mode, no trusted schema, no triggers, no views, no
//!   attached databases, no extension loading (not compiled in), `query_only`, `cell_size_check`, lengths and
//!   depths capped by `sqlite3_limit`, a heap cap, and a time limit per read that interrupts the statement;
//! - the tables the readers need must exist and be plain tables (not views, not virtual tables);
//! - the only SQL is the one the readers of this crate pass in; the page never sends any.
//!
//! Answers are closed codes: `host_db_missing` (no file: the team never ran here), `host_db_unsafe` (a link, not a
//! regular file, two names, over the cap), `host_db_busy` (it did not stay still), `host_db_unreadable` (the copy
//! could not be made), `host_db_invalid` (not a database, corrupt, tables missing, a read refused by a limit),
//! `host_db_timeout` (a read took too long) and `host_db_unavailable` (this system has no host reader yet).
//!
//! Where it stops: a rollback journal (`jobs.db-journal`) is not copied; the saved data are those of a team that is
//! off, so no write is in progress, and a database left in the middle of one is read as it stands in the file.
#![allow(dead_code)] // the readers of the next piece (facets, stats, list, detail) are the callers

use rusqlite::{config::DbConfig, limits::Limit, Connection, ErrorCode, OpenFlags};
use std::{
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Once,
    },
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

const DB_NAME: &str = "jobs.db";
const WAL_NAME: &str = "jobs.db-wal";
const SNAPSHOT_PREFIX: &str = "host-db-";
/// What a copy of the app's own folder may leave behind: the files of a snapshot and the ones sqlite makes beside it.
const SNAPSHOT_FILES: [&str; 4] = [DB_NAME, WAL_NAME, "jobs.db-shm", "jobs.db-journal"];

/// The caps of a snapshot and of a read. `Limits::default()` is the production value; tests pass smaller ones.
#[derive(Clone, Copy, Debug)]
pub(crate) struct Limits {
    pub(crate) max_db_bytes: u64,
    pub(crate) max_wal_bytes: u64,
    /// Time a single read may take before the statement is interrupted.
    pub(crate) read_ms: u64,
    /// How many times a copy that moved is made again.
    pub(crate) attempts: usize,
}

impl Default for Limits {
    fn default() -> Self {
        Limits { max_db_bytes: 512 << 20, max_wal_bytes: 256 << 20, read_ms: 5_000, attempts: 3 }
    }
}

/// The longest string, blob or row sqlite will build for a read: a cell over it is an error, not memory.
const MAX_CELL_BYTES: i32 = 8 << 20;
/// The memory sqlite may use in the whole process; past it a read fails with an error.
const HEAP_CAP_BYTES: i64 = 256 << 20;

pub(crate) struct HostDb {
    // field order is drop order: the connection goes before the files it has open
    conn: Connection,
    snapshot: Snapshot,
    limits: Limits,
    data_time: i64,
}

impl HostDb {
    /// The moment the data were last written, seconds since the epoch: the later modification time of the two files.
    pub(crate) fn data_time(&self) -> i64 {
        self.data_time
    }

    /// One read, on the copy, under the time limit. `f` gets the connection and runs the readers' fixed SQL.
    pub(crate) fn read<T>(&self, f: impl FnOnce(&Connection) -> rusqlite::Result<T>) -> Result<T, &'static str> {
        guarded(&self.conn, self.limits.read_ms, f)
    }

    /// The folder of the copy, for the tests and the sweep only.
    #[cfg(test)]
    fn snapshot_dir(&self) -> &Path {
        &self.snapshot.dir
    }
}

/// The folder of a copy and its files, removed when it goes out of scope.
struct Snapshot {
    dir: PathBuf,
}

impl Drop for Snapshot {
    fn drop(&mut self) {
        remove_snapshot_dir(&self.dir);
    }
}

fn remove_snapshot_dir(dir: &Path) {
    for name in SNAPSHOT_FILES {
        let _ = std::fs::remove_file(dir.join(name));
    }
    let _ = std::fs::remove_dir(dir);
}

fn code(error: &rusqlite::Error) -> &'static str {
    match error {
        rusqlite::Error::SqliteFailure(failure, _) if failure.code == ErrorCode::OperationInterrupted => "host_db_timeout",
        _ => "host_db_invalid",
    }
}

/// Run `f` on the connection and interrupt the statement when `ms` pass.
fn guarded<T>(conn: &Connection, ms: u64, f: impl FnOnce(&Connection) -> rusqlite::Result<T>) -> Result<T, &'static str> {
    let handle = conn.get_interrupt_handle();
    let (stop, wait) = mpsc::channel::<()>();
    let fired = std::sync::Arc::new(AtomicBool::new(false));
    let seen = std::sync::Arc::clone(&fired);
    let timer = thread::spawn(move || {
        if let Err(mpsc::RecvTimeoutError::Timeout) = wait.recv_timeout(Duration::from_millis(ms)) {
            seen.store(true, Ordering::SeqCst);
            handle.interrupt();
        }
    });
    let result = f(conn);
    drop(stop);
    let _ = timer.join();
    match result {
        Ok(value) => Ok(value),
        Err(error) if fired.load(Ordering::SeqCst) && code(&error) == "host_db_timeout" => Err("host_db_timeout"),
        Err(error) => Err(code(&error)),
    }
}

fn set_heap_cap() {
    static ONCE: Once = Once::new();
    ONCE.call_once(|| {
        // Process-wide, and sqlite is used by this module only. A failure here leaves the other caps in place.
        unsafe {
            rusqlite::ffi::sqlite3_hard_heap_limit64(HEAP_CAP_BYTES);
        }
    });
}

/// Open the copy and close every door before the first statement.
fn open_hardened(path: &Path, required: &[&str], read_ms: u64) -> Result<Connection, &'static str> {
    set_heap_cap();
    let conn = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX | OpenFlags::SQLITE_OPEN_NOFOLLOW,
    )
    .map_err(|e| code(&e))?;
    let shut = |config: DbConfig, on: bool| conn.set_db_config(config, on).map(|_| ()).map_err(|e| code(&e));
    shut(DbConfig::SQLITE_DBCONFIG_DEFENSIVE, true)?;
    shut(DbConfig::SQLITE_DBCONFIG_TRUSTED_SCHEMA, false)?;
    shut(DbConfig::SQLITE_DBCONFIG_ENABLE_TRIGGER, false)?;
    shut(DbConfig::SQLITE_DBCONFIG_ENABLE_VIEW, false)?;
    for (limit, value) in [
        (Limit::SQLITE_LIMIT_LENGTH, MAX_CELL_BYTES),
        (Limit::SQLITE_LIMIT_SQL_LENGTH, 64 << 10),
        (Limit::SQLITE_LIMIT_COLUMN, 200),
        (Limit::SQLITE_LIMIT_EXPR_DEPTH, 50),
        (Limit::SQLITE_LIMIT_COMPOUND_SELECT, 8),
        (Limit::SQLITE_LIMIT_FUNCTION_ARG, 16),
        (Limit::SQLITE_LIMIT_ATTACHED, 0),
        (Limit::SQLITE_LIMIT_LIKE_PATTERN_LENGTH, 256),
        (Limit::SQLITE_LIMIT_VARIABLE_NUMBER, 64),
        (Limit::SQLITE_LIMIT_TRIGGER_DEPTH, 0),
        (Limit::SQLITE_LIMIT_WORKER_THREADS, 0),
    ] {
        conn.set_limit(limit, value).map_err(|e| code(&e))?;
    }
    guarded(&conn, read_ms, |c| {
        c.execute_batch("PRAGMA query_only=ON; PRAGMA cell_size_check=ON; PRAGMA temp_store=MEMORY; PRAGMA mmap_size=0;")
    })?;
    guarded(&conn, read_ms, |c| {
        let mut seen = 0usize;
        let mut statement =
            c.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")?;
        let mut rows = statement.query([])?;
        while let Some(row) = rows.next()? {
            let name: String = row.get(0)?;
            let sql: Option<String> = row.get(1)?;
            let virtual_table = sql.map(|s| s.trim_start().to_ascii_uppercase().starts_with("CREATE VIRTUAL")).unwrap_or(false);
            if required.contains(&name.as_str()) {
                if virtual_table {
                    return Err(rusqlite::Error::InvalidQuery);
                }
                seen += 1;
            }
        }
        if seen == required.len() {
            Ok(())
        } else {
            Err(rusqlite::Error::InvalidQuery)
        }
    })?;
    Ok(conn)
}

/// Take the snapshot of `home/jobs.db` into a private folder under `work` and open it. `home` is the data folder of
/// the team of this computer (`~/.jht`), already attested as the active account's by the caller.
#[cfg(unix)]
pub(crate) fn open_snapshot(home: &Path, work: &Path, required: &[&str]) -> Result<HostDb, &'static str> {
    open_snapshot_with(home, work, required, Limits::default(), |_| {})
}

#[cfg(not(unix))]
pub(crate) fn open_snapshot(_home: &Path, _work: &Path, _required: &[&str]) -> Result<HostDb, &'static str> {
    Err("host_db_unavailable")
}

#[cfg(unix)]
mod unix {
    use super::*;
    use std::{
        fs::{File, OpenOptions},
        io::{Read, Write},
        os::unix::fs::{DirBuilderExt, FileTypeExt, MetadataExt, OpenOptionsExt, PermissionsExt},
    };

    /// What identifies a file at a moment: if all of it is the same before and after a copy, the copy is of that file.
    #[derive(Clone, Copy, PartialEq, Eq, Debug)]
    struct Stamp {
        dev: u64,
        ino: u64,
        size: u64,
        ctime: i64,
        ctime_ns: i64,
        mtime: i64,
        mtime_ns: i64,
    }

    impl Stamp {
        fn of(meta: &std::fs::Metadata) -> Stamp {
            Stamp {
                dev: meta.dev(),
                ino: meta.ino(),
                size: meta.size(),
                ctime: meta.ctime(),
                ctime_ns: meta.ctime_nsec(),
                mtime: meta.mtime(),
                mtime_ns: meta.mtime_nsec(),
            }
        }
    }

    /// A source file, open and checked: a regular file with one name, under the cap.
    pub(super) struct Source {
        file: File,
        stamp: Stamp,
    }

    /// `None` when the file is not there; an error when it is there and is not safe to read.
    pub(super) fn open_source(path: &Path, cap: u64) -> Result<Option<Source>, &'static str> {
        let file = match OpenOptions::new().read(true).custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK | libc::O_CLOEXEC).open(path) {
            Ok(file) => file,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            // ELOOP for a link; EACCES, ENXIO... for anything else we cannot read
            Err(e) if e.raw_os_error() == Some(libc::ELOOP) => return Err("host_db_unsafe"),
            Err(_) => return Err("host_db_unreadable"),
        };
        let meta = file.metadata().map_err(|_| "host_db_unreadable")?;
        if !meta.file_type().is_file() || meta.file_type().is_fifo() || meta.nlink() != 1 || meta.len() > cap {
            return Err("host_db_unsafe");
        }
        Ok(Some(Source { stamp: Stamp::of(&meta), file }))
    }

    fn real_folder(path: &Path) -> Result<(), &'static str> {
        match std::fs::symlink_metadata(path) {
            Ok(meta) if meta.file_type().is_dir() => Ok(()),
            Ok(_) => Err("host_db_unsafe"),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Err("host_db_missing"),
            Err(_) => Err("host_db_unreadable"),
        }
    }

    fn random_name() -> Result<String, &'static str> {
        let mut bytes = [0u8; 16];
        File::open("/dev/urandom").and_then(|mut f| f.read_exact(&mut bytes)).map_err(|_| "host_db_unreadable")?;
        Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
    }

    /// The folder of the app where the copies live: made 0700 when absent; refused when it is a link or someone
    /// else's; put back to 0700 when it is ours.
    fn private_folder(path: &Path) -> Result<(), &'static str> {
        match std::fs::symlink_metadata(path) {
            Ok(meta) => {
                if !meta.file_type().is_dir() || meta.uid() != unsafe { libc::geteuid() } {
                    return Err("host_db_unsafe");
                }
                if meta.permissions().mode() & 0o077 != 0 {
                    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o700)).map_err(|_| "host_db_unreadable")?;
                }
                Ok(())
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                std::fs::DirBuilder::new().recursive(true).mode(0o700).create(path).map_err(|_| "host_db_unreadable")
            }
            Err(_) => Err("host_db_unreadable"),
        }
    }

    /// Read `source` once into a new private file, at most `cap` bytes plus one to tell that it grew.
    pub(super) fn copy_into(source: &Source, to: &Path, cap: u64) -> Result<(), &'static str> {
        let mut out = OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC)
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

    /// The moment the data were last written: the later modification time of the two files.
    fn later(meta: &Stamp, other: Option<&Stamp>) -> i64 {
        other.map(|o| meta.mtime.max(o.mtime)).unwrap_or(meta.mtime)
    }

    pub(super) fn open_snapshot_with(
        home: &Path,
        work: &Path,
        required: &[&str],
        limits: Limits,
        mut on_copied: impl FnMut(usize),
    ) -> Result<HostDb, &'static str> {
        real_folder(home)?;
        private_folder(work)?;
        let db_path = home.join(DB_NAME);
        let wal_path = home.join(WAL_NAME);
        for attempt in 0..limits.attempts.max(1) {
            let db = open_source(&db_path, limits.max_db_bytes)?.ok_or("host_db_missing")?;
            let wal = open_source(&wal_path, limits.max_wal_bytes)?;
            let dir = work.join(format!("{SNAPSHOT_PREFIX}{}", random_name()?));
            std::fs::DirBuilder::new().mode(0o700).create(&dir).map_err(|_| "host_db_unreadable")?;
            let snapshot = Snapshot { dir };
            copy_into(&db, &snapshot.dir.join(DB_NAME), limits.max_db_bytes)?;
            if let Some(wal) = &wal {
                copy_into(wal, &snapshot.dir.join(WAL_NAME), limits.max_wal_bytes)?;
            }
            on_copied(attempt);
            // the same descriptors, the same names: nothing changed, nothing was swapped, no wal appeared
            let still = |source: &Source| source.file.metadata().map(|m| Stamp::of(&m) == source.stamp && m.nlink() == 1).unwrap_or(false);
            let same_path = |path: &Path, source: &Source| std::fs::symlink_metadata(path).map(|m| Stamp::of(&m) == source.stamp).unwrap_or(false);
            let wal_ok = match &wal {
                Some(wal) => still(wal) && same_path(&wal_path, wal),
                None => matches!(std::fs::symlink_metadata(&wal_path), Err(e) if e.kind() == std::io::ErrorKind::NotFound),
            };
            if !(still(&db) && same_path(&db_path, &db) && wal_ok) {
                continue; // the snapshot goes out of scope here and its files are removed
            }
            // sqlite's NOFOLLOW refuses a path with a link in ANY component (on macOS the temp folder is under /var, a link to
            // /private/var): the folder is ours, made a moment ago, so it is opened by its resolved name
            let resolved = std::fs::canonicalize(&snapshot.dir).map_err(|_| "host_db_unreadable")?;
            let conn = open_hardened(&resolved.join(DB_NAME), required, limits.read_ms)?;
            return Ok(HostDb { conn, data_time: later(&db.stamp, wal.as_ref().map(|w| &w.stamp)), snapshot, limits });
        }
        Err("host_db_busy")
    }

    /// Remove the folders of copies the app left behind (a crash, a kill): ours by name, older than an hour.
    pub(crate) fn sweep(work: &Path, older_than_s: i64) {
        let now = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0);
        let Ok(entries) = std::fs::read_dir(work) else { return };
        for entry in entries.flatten() {
            let name = entry.file_name();
            let Some(name) = name.to_str() else { continue };
            let Some(tail) = name.strip_prefix(SNAPSHOT_PREFIX) else { continue };
            if tail.len() != 32 || !tail.bytes().all(|b| b.is_ascii_hexdigit()) {
                continue;
            }
            let Ok(meta) = std::fs::symlink_metadata(entry.path()) else { continue };
            if !meta.file_type().is_dir() || meta.uid() != unsafe { libc::geteuid() } || now - meta.mtime() < older_than_s {
                continue;
            }
            remove_snapshot_dir(&entry.path());
        }
    }
}

#[cfg(unix)]
use unix::open_snapshot_with;
#[cfg(unix)]
pub(crate) use unix::sweep as sweep_snapshots;

#[cfg(not(unix))]
pub(crate) fn sweep_snapshots(_work: &Path, _older_than_s: i64) {}

#[cfg(test)]
mod tests {
    #![cfg(unix)]
    use super::*;
    use sha2::{Digest, Sha256};
    use std::{
        os::unix::fs::{symlink, MetadataExt, PermissionsExt},
        time::Instant,
    };

    const REQUIRED: [&str; 3] = ["positions", "scores", "applications"];

    fn base(tag: &str) -> PathBuf {
        let nanos = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let dir = std::env::temp_dir().join(format!("jht-host-db-{tag}-{}-{nanos}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    struct World {
        base: PathBuf,
        home: PathBuf,
        work: PathBuf,
    }

    impl World {
        fn new(tag: &str) -> World {
            let base = base(tag);
            let home = base.join("home");
            std::fs::create_dir(&home).unwrap();
            World { work: base.join("work"), home, base }
        }
        fn db(&self) -> PathBuf {
            self.home.join(DB_NAME)
        }
        fn snapshots(&self) -> usize {
            std::fs::read_dir(&self.work).map(|d| d.count()).unwrap_or(0)
        }
    }

    impl Drop for World {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.base);
        }
    }

    fn schema(conn: &Connection) {
        conn.execute_batch(
            "CREATE TABLE positions(id TEXT PRIMARY KEY, title TEXT, status TEXT, description TEXT);
             CREATE TABLE scores(position_id TEXT, total_score INTEGER);
             CREATE TABLE applications(position_id TEXT, cv_path TEXT);",
        )
        .unwrap();
    }

    fn insert(conn: &Connection, id: &str) {
        conn.execute("INSERT INTO positions(id, title, status) VALUES (?1, ?2, 'new')", [id, "Data Engineer"]).unwrap();
    }

    fn plain_db(world: &World, rows: usize) {
        let conn = Connection::open(world.db()).unwrap();
        schema(&conn);
        for i in 0..rows {
            insert(&conn, &format!("p{i}"));
        }
    }

    fn count(db: &HostDb) -> i64 {
        db.read(|c| c.query_row("SELECT COUNT(*) FROM positions", [], |r| r.get(0))).unwrap()
    }

    fn open(world: &World) -> Result<HostDb, &'static str> {
        open_snapshot(&world.home, &world.work, &REQUIRED)
    }

    fn open_small(world: &World, limits: Limits) -> Result<HostDb, &'static str> {
        open_snapshot_with(&world.home, &world.work, &REQUIRED, limits, |_| {})
    }

    fn listing(dir: &Path) -> Vec<(String, u64, i64)> {
        let mut all: Vec<_> = std::fs::read_dir(dir)
            .unwrap()
            .map(|e| {
                let e = e.unwrap();
                let m = e.metadata().unwrap();
                (e.file_name().to_string_lossy().into_owned(), m.len(), m.mtime())
            })
            .collect();
        all.sort();
        all
    }

    fn digest(path: &Path) -> String {
        format!("{:x}", Sha256::digest(std::fs::read(path).unwrap()))
    }

    // ── what is read ───────────────────────────────────────────────────────────────────────────────────

    #[test]
    fn the_rows_of_a_plain_database_are_read_from_the_copy() {
        let world = World::new("plain");
        plain_db(&world, 5);
        let db = open(&world).unwrap();
        assert_eq!(count(&db), 5);
        let title: String = db.read(|c| c.query_row("SELECT title FROM positions WHERE id='p3'", [], |r| r.get(0))).unwrap();
        assert_eq!(title, "Data Engineer");
        assert!(db.data_time() > 1_600_000_000);
    }

    #[test]
    fn rows_that_are_only_in_the_wal_are_in_the_snapshot() {
        let world = World::new("wal");
        let writer = Connection::open(world.db()).unwrap();
        writer.execute_batch("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0;").unwrap();
        schema(&writer);
        writer.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);").unwrap();
        for i in 0..4 {
            insert(&writer, &format!("w{i}"));
        }
        assert!(world.home.join(WAL_NAME).metadata().unwrap().len() > 0, "the rows must be in the wal, not in the file");
        let db = open(&world).unwrap();
        assert_eq!(count(&db), 4);
        drop(writer);
    }

    #[test]
    fn a_wal_database_without_a_wal_file_is_read() {
        let world = World::new("nowal");
        {
            let conn = Connection::open(world.db()).unwrap();
            conn.execute_batch("PRAGMA journal_mode=WAL;").unwrap();
            schema(&conn);
            insert(&conn, "a");
        } // the last connection closes: checkpoint, the wal file is removed
        assert!(!world.home.join(WAL_NAME).exists());
        assert_eq!(count(&open(&world).unwrap()), 1);
    }

    #[test]
    fn the_original_is_never_touched_and_nothing_appears_next_to_it() {
        let world = World::new("untouched");
        plain_db(&world, 3);
        let before = (digest(&world.db()), listing(&world.home), world.db().metadata().unwrap().permissions().mode());
        let db = open(&world).unwrap();
        assert_eq!(count(&db), 3);
        drop(db);
        assert_eq!((digest(&world.db()), listing(&world.home), world.db().metadata().unwrap().permissions().mode()), before);
    }

    // ── what is refused before any byte is read ────────────────────────────────────────────────────────

    #[test]
    fn no_file_is_missing_and_a_home_that_is_a_link_or_a_file_is_unsafe() {
        let world = World::new("missing");
        assert_eq!(open(&world).err(), Some("host_db_missing"));
        std::fs::remove_dir(&world.home).unwrap();
        assert_eq!(open(&world).err(), Some("host_db_missing"));
        let real = world.base.join("real");
        std::fs::create_dir(&real).unwrap();
        symlink(&real, &world.home).unwrap();
        assert_eq!(open(&world).err(), Some("host_db_unsafe"));
        std::fs::remove_file(&world.home).unwrap();
        std::fs::write(&world.home, b"x").unwrap();
        assert_eq!(open(&world).err(), Some("host_db_unsafe"));
        assert_eq!(world.snapshots(), 0);
    }

    #[test]
    fn a_link_a_folder_a_pipe_or_a_second_name_in_place_of_the_file_is_refused() {
        let world = World::new("kinds");
        plain_db(&world, 1);
        let real = world.base.join("elsewhere.db");
        std::fs::rename(world.db(), &real).unwrap();
        // a link
        symlink(&real, world.db()).unwrap();
        assert_eq!(open(&world).err(), Some("host_db_unsafe"));
        std::fs::remove_file(world.db()).unwrap();
        // a folder
        std::fs::create_dir(world.db()).unwrap();
        assert_eq!(open(&world).err(), Some("host_db_unsafe"));
        std::fs::remove_dir(world.db()).unwrap();
        // a second name for the same file
        std::fs::hard_link(&real, world.db()).unwrap();
        assert_eq!(open(&world).err(), Some("host_db_unsafe"));
        std::fs::remove_file(world.db()).unwrap();
        // a pipe: the open must not wait for a writer
        let path = std::ffi::CString::new(world.db().to_str().unwrap()).unwrap();
        assert_eq!(unsafe { libc::mkfifo(path.as_ptr(), 0o600) }, 0);
        let (tx, rx) = mpsc::channel();
        let (home, work) = (world.home.clone(), world.work.clone());
        thread::spawn(move || tx.send(open_snapshot(&home, &work, &REQUIRED).err()).unwrap());
        assert_eq!(rx.recv_timeout(Duration::from_secs(10)).expect("a pipe must not hold the reader"), Some("host_db_unsafe"));
        assert_eq!(world.snapshots(), 0);
    }

    #[test]
    fn a_wal_that_is_a_link_or_has_a_second_name_is_refused() {
        let world = World::new("walkinds");
        plain_db(&world, 1);
        let other = world.base.join("other-wal");
        std::fs::write(&other, b"x").unwrap();
        symlink(&other, world.home.join(WAL_NAME)).unwrap();
        assert_eq!(open(&world).err(), Some("host_db_unsafe"));
        std::fs::remove_file(world.home.join(WAL_NAME)).unwrap();
        std::fs::hard_link(&other, world.home.join(WAL_NAME)).unwrap();
        assert_eq!(open(&world).err(), Some("host_db_unsafe"));
        assert_eq!(world.snapshots(), 0);
    }

    #[test]
    fn a_file_over_the_cap_is_refused_unread_and_so_is_a_wal() {
        let world = World::new("caps");
        plain_db(&world, 50);
        let size = world.db().metadata().unwrap().len();
        let small = Limits { max_db_bytes: size - 1, ..Limits::default() };
        assert_eq!(open_small(&world, small).err(), Some("host_db_unsafe"));
        assert_eq!(world.snapshots(), 0, "refused before a single byte is copied");
        assert!(open_small(&world, Limits { max_db_bytes: size, ..Limits::default() }).is_ok());
        std::fs::write(world.home.join(WAL_NAME), vec![0u8; 5000]).unwrap();
        assert_eq!(open_small(&world, Limits { max_wal_bytes: 4999, ..Limits::default() }).err(), Some("host_db_unsafe"));
    }

    // ── what is not a database ─────────────────────────────────────────────────────────────────────────

    #[test]
    fn the_copy_itself_stops_at_the_cap_even_when_the_file_looked_smaller_at_the_open() {
        // the open checks the size once; a file that grows after it is cut by the copy, which reads the cap plus one byte
        let world = World::new("grows");
        let path = world.base.join("grows.bin");
        std::fs::write(&path, vec![7u8; 10_000]).unwrap();
        let source = unix::open_source(&path, 20_000).unwrap().unwrap();
        let into = world.base.join("copy.bin");
        assert_eq!(unix::copy_into(&source, &into, 9_999), Err("host_db_unsafe"));
        let again = unix::open_source(&path, 20_000).unwrap().unwrap();
        assert_eq!(unix::copy_into(&again, &world.base.join("copy2.bin"), 10_000), Ok(()));
        assert_eq!(std::fs::metadata(world.base.join("copy2.bin")).unwrap().len(), 10_000);
    }

    #[test]
    fn bytes_that_are_not_a_database_a_cut_one_and_a_header_with_garbage_are_invalid() {
        let world = World::new("garbage");
        std::fs::write(world.db(), b"this is not sqlite").unwrap();
        assert_eq!(open(&world).err(), Some("host_db_invalid"));
        std::fs::write(world.db(), b"").unwrap();
        assert_eq!(open(&world).err(), Some("host_db_invalid"));
        // a header and then noise
        let mut noise = b"SQLite format 3\0".to_vec();
        noise.extend((0..8192u32).map(|i| (i.wrapping_mul(2_654_435_761) >> 13) as u8));
        std::fs::write(world.db(), &noise).unwrap();
        assert_eq!(open(&world).err(), Some("host_db_invalid"));
        // a good database cut in the middle of its pages
        std::fs::remove_file(world.db()).unwrap();
        plain_db(&world, 200);
        let size = world.db().metadata().unwrap().len();
        std::fs::OpenOptions::new().write(true).open(world.db()).unwrap().set_len(size / 2 + 13).unwrap();
        let outcome = open(&world).and_then(|db| db.read(|c| c.query_row("SELECT COUNT(*) FROM positions", [], |r| r.get::<_, i64>(0))));
        assert!(matches!(outcome, Ok(_) | Err("host_db_invalid")), "{outcome:?}");
        assert_eq!(world.snapshots(), 0, "a refused snapshot leaves no folder");
    }

    #[test]
    fn a_page_of_the_file_overwritten_with_noise_is_an_error_and_not_a_crash() {
        let world = World::new("damaged");
        plain_db(&world, 400);
        let mut bytes = std::fs::read(world.db()).unwrap();
        let from = bytes.len() / 2;
        for (i, byte) in bytes[from..from + 4096].iter_mut().enumerate() {
            *byte = (i * 31 % 251) as u8;
        }
        std::fs::write(world.db(), &bytes).unwrap();
        let outcome = open(&world).and_then(|db| db.read(|c| c.query_row("SELECT COUNT(*), MAX(title) FROM positions", [], |r| r.get::<_, i64>(0))));
        assert!(matches!(outcome, Ok(_) | Err("host_db_invalid")), "{outcome:?}");
    }

    #[test]
    fn missing_tables_and_tables_that_are_views_or_virtual_are_invalid() {
        let world = World::new("tables");
        {
            let conn = Connection::open(world.db()).unwrap();
            conn.execute_batch("CREATE TABLE positions(id TEXT); CREATE TABLE scores(position_id TEXT);").unwrap();
        }
        assert_eq!(open(&world).err(), Some("host_db_invalid"), "applications is missing");
        std::fs::remove_file(world.db()).unwrap();
        {
            let conn = Connection::open(world.db()).unwrap();
            conn.execute_batch(
                "CREATE TABLE real_positions(id TEXT); CREATE VIEW positions AS SELECT id FROM real_positions;
                 CREATE TABLE scores(position_id TEXT); CREATE TABLE applications(position_id TEXT);",
            )
            .unwrap();
        }
        assert_eq!(open(&world).err(), Some("host_db_invalid"), "a view is not the table");
    }

    // ── what a reader cannot do, whatever SQL it is given ──────────────────────────────────────────────

    #[test]
    fn the_connection_cannot_write_attach_or_use_views() {
        let world = World::new("closed");
        plain_db(&world, 2);
        {
            let conn = Connection::open(world.db()).unwrap();
            conn.execute_batch("CREATE VIEW v AS SELECT id FROM positions;").unwrap();
        }
        let db = open(&world).unwrap();
        assert_eq!(db.read(|c| c.execute("INSERT INTO positions(id) VALUES ('x')", [])), Err("host_db_invalid"));
        assert_eq!(db.read(|c| c.execute("CREATE TABLE t(a)", [])), Err("host_db_invalid"));
        assert_eq!(db.read(|c| c.execute("UPDATE sqlite_master SET sql = sql", [])), Err("host_db_invalid"));
        assert_eq!(db.read(|c| c.execute_batch("ATTACH DATABASE ':memory:' AS other;")), Err("host_db_invalid"));
        assert_eq!(db.read(|c| c.execute_batch("PRAGMA writable_schema=ON; DROP TABLE positions;")), Err("host_db_invalid"));
        assert_eq!(db.read(|c| c.query_row("SELECT COUNT(*) FROM v", [], |r| r.get::<_, i64>(0))), Err("host_db_invalid"));
        assert_eq!(count(&db), 2, "and nothing changed");
    }

    #[test]
    fn a_statement_that_never_ends_is_interrupted_by_the_time_limit() {
        let world = World::new("bomb");
        plain_db(&world, 1);
        let db = open_small(&world, Limits { read_ms: 300, ..Limits::default() }).unwrap();
        let started = Instant::now();
        let outcome = db.read(|c| {
            c.query_row("WITH RECURSIVE r(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM r) SELECT COUNT(*) FROM r", [], |r| r.get::<_, i64>(0))
        });
        assert_eq!(outcome, Err("host_db_timeout"));
        assert!(started.elapsed() < Duration::from_secs(5), "{:?}", started.elapsed());
        assert_eq!(count(&db), 1, "the connection is good after an interrupt");
    }

    #[test]
    fn a_cell_over_the_length_limit_is_an_error_and_not_a_big_allocation() {
        let world = World::new("bigcell");
        {
            let conn = Connection::open(world.db()).unwrap();
            schema(&conn);
            let blob = "x".repeat((MAX_CELL_BYTES as usize) + 1024);
            conn.execute("INSERT INTO positions(id, title, description) VALUES ('big', 't', ?1)", [blob]).unwrap();
            insert(&conn, "small");
        }
        let db = open(&world).unwrap();
        assert_eq!(db.read(|c| c.query_row("SELECT description FROM positions WHERE id='big'", [], |r| r.get::<_, String>(0))), Err("host_db_invalid"));
        assert_eq!(db.read(|c| c.query_row("SELECT title FROM positions WHERE id='small'", [], |r| r.get::<_, String>(0))), Ok("Data Engineer".to_string()));
    }

    #[test]
    fn a_long_expression_a_wide_union_and_a_long_statement_are_refused() {
        let world = World::new("shape");
        plain_db(&world, 1);
        let db = open(&world).unwrap();
        let deep = format!("SELECT {}", vec!["1"; 200].join(" + ")); // a sum of 200 terms is a tree 200 deep
        assert_eq!(db.read(|c| c.query_row(&deep, [], |r| r.get::<_, i64>(0))), Err("host_db_invalid"));
        let wide = vec!["SELECT 1"; 20].join(" UNION ALL ");
        assert_eq!(db.read(|c| c.query_row(&wide, [], |r| r.get::<_, i64>(0))), Err("host_db_invalid"));
        let long = format!("SELECT {}", ["1"; 40_000].join(","));
        assert_eq!(db.read(|c| c.prepare(&long).map(|_| ())), Err("host_db_invalid"));
    }

    // ── the copy: where it lives, how long, and what it does when the original moves ───────────────────

    #[test]
    fn the_copy_is_private_and_goes_away_with_the_handle() {
        let world = World::new("private");
        plain_db(&world, 1);
        let db = open(&world).unwrap();
        let dir = db.snapshot_dir().to_path_buf();
        assert_eq!(world.work.metadata().unwrap().permissions().mode() & 0o777, 0o700);
        assert_eq!(dir.metadata().unwrap().permissions().mode() & 0o777, 0o700);
        assert_eq!(dir.join(DB_NAME).metadata().unwrap().permissions().mode() & 0o777, 0o600);
        assert!(dir.file_name().unwrap().to_str().unwrap().starts_with(SNAPSHOT_PREFIX));
        drop(db);
        assert!(!dir.exists());
        assert_eq!(world.snapshots(), 0);
    }

    #[test]
    fn a_work_folder_reached_through_a_link_in_its_path_is_read() {
        // macOS: the temp folder is /var/folders/..., and /var is a link to /private/var. sqlite refuses such a path with
        // NOFOLLOW, so the copy is opened by its resolved name; the same shape, made here, fails without it on every system
        let world = World::new("pathlink");
        plain_db(&world, 2);
        let real = world.base.join("real-parent");
        std::fs::create_dir(&real).unwrap();
        let through = world.base.join("link-parent");
        symlink(&real, &through).unwrap();
        let db = open_snapshot(&world.home, &through.join("work"), &REQUIRED).unwrap();
        assert_eq!(count(&db), 2);
        assert!(real.join("work").is_dir(), "the copy lives in the real folder");
        // and a home reached through a link in its path is read too: only its last name must be a real folder
        let home_through = through.join("home");
        std::fs::rename(&world.home, real.join("home")).unwrap();
        let again = open_snapshot(&home_through, &world.work, &REQUIRED).unwrap();
        assert_eq!(count(&again), 2);
    }

    #[test]
    fn a_work_folder_that_is_a_link_is_refused_and_one_open_to_others_is_closed() {
        let world = World::new("work");
        plain_db(&world, 1);
        let elsewhere = world.base.join("elsewhere");
        std::fs::create_dir(&elsewhere).unwrap();
        symlink(&elsewhere, &world.work).unwrap();
        assert_eq!(open(&world).err(), Some("host_db_unsafe"));
        assert_eq!(std::fs::read_dir(&elsewhere).unwrap().count(), 0, "nothing went through the link");
        std::fs::remove_file(&world.work).unwrap();
        std::fs::create_dir(&world.work).unwrap();
        std::fs::set_permissions(&world.work, std::fs::Permissions::from_mode(0o755)).unwrap();
        assert!(open(&world).is_ok());
        assert_eq!(world.work.metadata().unwrap().permissions().mode() & 0o777, 0o700);
    }

    #[test]
    fn a_copy_taken_while_the_original_moved_is_made_again_and_after_three_it_is_busy() {
        let world = World::new("moving");
        plain_db(&world, 1);
        // moves once: the second copy is the good one and sees the new row
        let home = world.home.clone();
        let db = open_snapshot_with(&world.home, &world.work, &REQUIRED, Limits::default(), |attempt| {
            if attempt == 0 {
                let conn = Connection::open(home.join(DB_NAME)).unwrap();
                insert(&conn, "late");
            }
        })
        .unwrap();
        assert_eq!(count(&db), 2);
        assert_eq!(world.snapshots(), 1, "the first, discarded copy is gone");
        drop(db);
        // moves every time
        let mut n = 0;
        let home = world.home.clone();
        let outcome = open_snapshot_with(&world.home, &world.work, &REQUIRED, Limits::default(), |_| {
            n += 1;
            let conn = Connection::open(home.join(DB_NAME)).unwrap();
            insert(&conn, &format!("again{n}"));
        });
        assert_eq!(outcome.err(), Some("host_db_busy"));
        assert_eq!(n, 3);
        assert_eq!(world.snapshots(), 0);
    }

    #[test]
    fn a_file_swapped_for_another_between_the_open_and_the_end_of_the_copy_is_not_trusted() {
        let world = World::new("swap");
        plain_db(&world, 1);
        let other = world.base.join("other.db");
        {
            let conn = Connection::open(&other).unwrap();
            schema(&conn);
        }
        let home = world.home.clone();
        let outcome = open_snapshot_with(&world.home, &world.work, &REQUIRED, Limits::default(), |_| {
            std::fs::rename(&other, home.join(DB_NAME)).ok();
        });
        // the first attempt saw the swap and was thrown away; the copy after it is of the new file, which then stays still
        let rows = outcome.as_ref().map(count).map_err(|e| *e);
        assert_eq!(rows, Ok(0), "the rows are those of the file that stayed");
        assert_eq!(world.snapshots(), 1);
    }

    #[test]
    fn the_sweep_removes_only_old_folders_of_ours_by_name() {
        let world = World::new("sweep");
        plain_db(&world, 1);
        let young = open(&world).unwrap();
        let old = world.work.join(format!("{SNAPSHOT_PREFIX}{}", "ab".repeat(16)));
        std::fs::create_dir(&old).unwrap();
        std::fs::write(old.join(DB_NAME), b"x").unwrap();
        let stranger = world.work.join("keep-me");
        std::fs::create_dir(&stranger).unwrap();
        let shaped = world.work.join(format!("{SNAPSHOT_PREFIX}not-ours"));
        std::fs::create_dir(&shaped).unwrap();
        let then = libc::time_t::try_from(SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs() as i64 - 7200).unwrap();
        for dir in [&old, &stranger, &shaped] {
            let cpath = std::ffi::CString::new(dir.to_str().unwrap()).unwrap();
            let stamp = libc::timespec { tv_sec: then, tv_nsec: 0 };
            let times = [stamp, stamp];
            assert_eq!(unsafe { libc::utimensat(libc::AT_FDCWD, cpath.as_ptr(), times.as_ptr(), 0) }, 0);
        }
        sweep_snapshots(&world.work, 3600);
        assert!(!old.exists(), "an old folder of ours goes");
        assert!(stranger.exists() && shaped.exists(), "what is not ours by name stays");
        assert!(young.snapshot_dir().exists(), "and a young one stays");
    }

    // ── the source of the module ───────────────────────────────────────────────────────────────────────

    fn production() -> String {
        let source = include_str!("host_db.rs");
        let code = source.split("\n#[cfg(test)]\nmod tests {").next().unwrap();
        code.lines().filter(|line| !line.trim_start().starts_with("//")).collect::<Vec<_>>().join("\n")
    }

    #[test]
    fn the_module_only_reads_and_opens_nothing_in_place() {
        let code = production();
        assert!(code.contains("SQLITE_OPEN_READ_ONLY") && !code.contains("SQLITE_OPEN_READ_WRITE") && !code.contains("SQLITE_OPEN_CREATE"));
        for forbidden in ["Command::new", "load_extension", "enable_load_extension", "Connection::open(", "open_in_memory", "backup", "wal_checkpoint"] {
            assert!(!code.contains(forbidden), "{forbidden}");
        }
        // the original is opened for reading only, in one place
        assert_eq!(code.matches(".open(path)").count(), 1);
        assert_eq!(code.matches("set_db_config(").count(), 1);
        for door in ["DEFENSIVE, true", "TRUSTED_SCHEMA, false", "ENABLE_TRIGGER, false", "ENABLE_VIEW, false"] {
            assert!(code.contains(door), "{door}");
        }
        assert_eq!(code.matches("SQLITE_LIMIT_ATTACHED, 0").count(), 1);
        // the copy is made from descriptors that were checked, and the page has no way in
        assert!(code.contains("O_NOFOLLOW") && code.contains("O_NONBLOCK") && code.contains("nlink() != 1"));
        assert!(!code.contains("tauri::command"));
    }
}
