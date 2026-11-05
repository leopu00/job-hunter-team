//! The agents and the chats of this computer's team, read from the files it keeps on this computer while it is off
//! (JHT-T177): the same line as the saved positions (`host_db`, `host_positions`), for the agents' roster and the chats.
//!
//! The team's folder is the one its container mounts as `/jht_home`. It holds what the pages need whatever the container
//! does: `logs/team-roster.json` (who the launcher started, written at each start that worked) and
//! `agents/<name>/chat.jsonl` (the chat of each agent, the file the container's own reader reads). With the container
//! off nothing of this is gone; what is gone is only the process that read it. So the pages read it here: the agents with
//! the state «off» (a state, not an error) and each chat as it is, to the last message.
//!
//! Read only, and nothing in these files is trusted: no path comes from the page (a closed grammar of agent names
//! builds each one), every folder on the way must be a real folder and every file a regular one with one name,
//! opened without following a link and without blocking; the roster, the lines and the pages have caps. A file that is
//! not safe to read is refused with the code of the saved data (`host_db_unsafe`), never half read.
//!
//! The chat page is the container reader's own (`shared/skills/agent_chat.py`, `_read_page`): the same tail, the same
//! rows, the same ids, roles, texts and times. What it leaves out is what only a running team can say: the open
//! questions, the queued turns, what the agent is doing now, and the suggested replies (nothing can be answered
//! from here).

// Read by the pages' commands, which come in the next pieces of the same ticket.
#![allow(dead_code)]

use serde_json::Value;
use std::path::Path;

#[cfg(unix)]
mod unix {
    use super::*;
    use crate::existing_team_agents::agent_session;
    use serde_json::{json, Map};
    use sha2::{Digest, Sha256};
    use std::{
        collections::BTreeMap,
        fs::{File, OpenOptions},
        io::{BufRead, BufReader, Read, Seek, SeekFrom},
        os::unix::fs::{FileTypeExt, MetadataExt, OpenOptionsExt},
        time::UNIX_EPOCH,
    };

    /// The roster is a few lines per agent: more than this is not one.
    const ROSTER_CAP: u64 = 1 << 20;
    /// The agents the roster may name (the container's own list stops at the same number).
    const MAX_AGENTS: usize = 200;
    /// A first read is the newest page: the last bytes of the file, as the container reader takes them.
    const CHAT_TAIL: u64 = 131_072;
    const CHAT_ROWS: usize = 120;
    /// A line longer than this is skipped, as the container reader skips it.
    const LINE_CAP: usize = 65_536;
    /// What one page may read from the file at most, so that a file of one huge line cannot hold the page.
    const PAGE_BYTES: u64 = 4 << 20;

    /// `Ok(true)` for a real folder, `Ok(false)` for none, an error for a link or anything else in its place.
    fn real_folder(path: &Path) -> Result<bool, &'static str> {
        match std::fs::symlink_metadata(path) {
            Ok(meta) if meta.file_type().is_dir() => Ok(true),
            Ok(_) => Err("host_db_unsafe"),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(false),
            Err(_) => Err("host_db_unreadable"),
        }
    }

    /// `None` when the file is not there; an error when it is there and is not safe to read: not a regular file, more
    /// than one name, a link, or over the cap (when there is one).
    fn open_regular(path: &Path, cap: Option<u64>) -> Result<Option<File>, &'static str> {
        let file = match OpenOptions::new().read(true).custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK | libc::O_CLOEXEC).open(path) {
            Ok(file) => file,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(e) if e.raw_os_error() == Some(libc::ELOOP) => return Err("host_db_unsafe"),
            Err(_) => return Err("host_db_unreadable"),
        };
        let meta = file.metadata().map_err(|_| "host_db_unreadable")?;
        if !meta.file_type().is_file() || meta.file_type().is_fifo() || meta.nlink() != 1 || cap.is_some_and(|cap| meta.len() > cap) {
            return Err("host_db_unsafe");
        }
        Ok(Some(file))
    }

    /// The folder the team files an agent's chat under: the launcher's own name («scout-1», `critico-S3`), lower case but
    /// for the writer's number of a critic.
    fn store_name(session: &str) -> Option<String> {
        let (role, instance) = agent_session(session)?;
        Some(match instance {
            Some(instance) => format!("{role}-{instance}"),
            None => role,
        })
    }

    /// Seconds since the epoch of «YYYY-MM-DDTHH:MM:SSZ» (what the roster writes), or nothing for any other text.
    pub(super) fn iso_seconds(text: &str) -> Option<i64> {
        let b = text.as_bytes();
        if !text.is_ascii() || b.len() != 20 || b[4] != b'-' || b[7] != b'-' || b[10] != b'T' || b[13] != b':' || b[16] != b':' || b[19] != b'Z' {
            return None;
        }
        let num = |from: usize, to: usize| -> Option<i64> {
            let part = &text[from..to];
            part.bytes().all(|c| c.is_ascii_digit()).then(|| part.parse::<i64>().ok()).flatten()
        };
        let (year, month, day) = (num(0, 4)?, num(5, 7)?, num(8, 10)?);
        let (hour, minute, second) = (num(11, 13)?, num(14, 16)?, num(17, 19)?);
        if !(1..=12).contains(&month) || !(1..=31).contains(&day) || hour > 23 || minute > 59 || second > 60 || year < 1970 {
            return None;
        }
        // days from the civil date (Howard Hinnant's algorithm)
        let y = if month <= 2 { year - 1 } else { year };
        let era = y.div_euclid(400);
        let yoe = y - era * 400;
        let doy = (153 * (if month > 2 { month - 3 } else { month + 9 }) + 2) / 5 + day - 1;
        let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
        let days = era * 146_097 + doe - 719_468;
        Some(days * 86_400 + hour * 3_600 + minute * 60 + second)
    }

    /// When the chat file of an agent was last written, in seconds; nothing for a file that is not there or not safe.
    fn chat_time(home: &Path, store: &str) -> Option<i64> {
        let file = open_regular(&home.join("agents").join(store).join("chat.jsonl"), None).ok().flatten()?;
        let modified = file.metadata().ok()?.modified().ok()?;
        i64::try_from(modified.duration_since(UNIX_EPOCH).ok()?.as_secs()).ok()
    }

    /// What the roster says of each agent that is still part of the team: first seen and last started, in seconds.
    fn roster_agents(home: &Path) -> Result<BTreeMap<String, (Option<i64>, Option<i64>)>, &'static str> {
        let mut known = BTreeMap::new();
        let logs = home.join("logs");
        if !real_folder(&logs)? {
            return Ok(known);
        }
        let Some(mut file) = open_regular(&logs.join("team-roster.json"), Some(ROSTER_CAP))? else {
            return Ok(known);
        };
        let mut text = String::new();
        (&mut file).take(ROSTER_CAP + 1).read_to_string(&mut text).map_err(|_| "host_db_unreadable")?;
        if text.len() as u64 > ROSTER_CAP {
            return Err("host_db_unsafe");
        }
        // A roster that is not readable says nothing: the folders of the agents answer, as the launcher's own reader does.
        let Ok(Value::Object(root)) = serde_json::from_str::<Value>(&text) else {
            return Ok(known);
        };
        let Some(Value::Object(agents)) = root.get("agents") else {
            return Ok(known);
        };
        for (session, entry) in agents.iter().take(4 * MAX_AGENTS) {
            let Some(entry) = entry.as_object() else { continue };
            if agent_session(session).is_none() || entry.get("status").and_then(Value::as_str) == Some("retired") {
                continue;
            }
            let seconds = |key: &str| entry.get(key).and_then(Value::as_str).and_then(iso_seconds);
            known.insert(session.clone(), (seconds("first_seen"), seconds("last_spawn")));
        }
        Ok(known)
    }

    /// The agents of the team as the container's list would say them with every session gone: each one «off», with the
    /// time it was started first and the last time it did anything the files show. The shape is the script's own
    /// (`agent_control.py list`), for the same shaping as a live answer.
    pub(super) fn roster(home: &Path) -> Result<Value, &'static str> {
        if !real_folder(home)? {
            return Err("host_db_missing");
        }
        let mut known = roster_agents(home)?;
        if known.is_empty() {
            // no roster (or an empty one): the agents' folders are what is known of who the team had
            let agents = home.join("agents");
            if real_folder(&agents)? {
                let entries = std::fs::read_dir(&agents).map_err(|_| "host_db_unreadable")?;
                for entry in entries.flatten().take(4 * MAX_AGENTS) {
                    let Some(name) = entry.file_name().to_str().map(str::to_owned) else { continue };
                    let session = name.to_ascii_uppercase();
                    if store_name(&session).as_deref() == Some(name.as_str()) && real_folder(&agents.join(&name)) == Ok(true) {
                        known.insert(session, (None, None));
                    }
                }
            }
        }
        let mut items = Vec::new();
        for (session, (first, started)) in known.into_iter().take(MAX_AGENTS) {
            let written = store_name(&session).and_then(|store| chat_time(home, &store));
            let activity = [started, written].into_iter().flatten().max();
            let mut item = Map::new();
            item.insert("name".into(), json!(session));
            item.insert("created".into(), json!(first));
            item.insert("activity".into(), json!(activity));
            item.insert("state".into(), json!("spento"));
            item.insert("reason".into(), Value::Null);
            item.insert("since".into(), Value::Null);
            item.insert("until".into(), Value::Null);
            item.insert("identity".into(), Value::Null);
            item.insert("usage".into(), Value::Null);
            item.insert("questions".into(), Value::Null);
            items.push(Value::Object(item));
        }
        Ok(json!({"ok": true, "data": {"items": items, "states": true}}))
    }

    /// Reads up to the end of the line (the newline included) into `line`, keeping at most `LINE_CAP + 1` bytes of it
    /// and throwing the rest away; the second number is how many bytes were read from the file.
    fn read_line(reader: &mut impl BufRead, line: &mut Vec<u8>) -> std::io::Result<u64> {
        line.clear();
        let mut read = reader.by_ref().take(LINE_CAP as u64 + 1).read_until(b'\n', line)? as u64;
        if line.len() > LINE_CAP && line.last() != Some(&b'\n') {
            let mut sink = Vec::new();
            loop {
                sink.clear();
                let more = reader.by_ref().take(LINE_CAP as u64).read_until(b'\n', &mut sink)?;
                read += more as u64;
                if more == 0 || sink.last() == Some(&b'\n') {
                    break;
                }
            }
        }
        Ok(read)
    }

    /// One page of an agent's chat from the file on this computer: the container reader's `_read_page`, without what
    /// only a running team says. `cursor` is the offset a previous page gave; none is the newest page.
    pub(super) fn chat_page(home: &Path, agent: &str, cursor: Option<&str>) -> Result<Value, &'static str> {
        let Some(session) = crate::existing_team_runtime::chat_session(agent) else {
            return Err("host_db_invalid");
        };
        if !crate::existing_team_runtime::chat_agent_ok(agent) {
            return Err("host_db_invalid");
        }
        let Some(store) = store_name(&session) else {
            return Err("host_db_invalid");
        };
        let asked = match cursor {
            None | Some("") => None,
            Some(text) if text.len() <= 12 && text.bytes().all(|c| c.is_ascii_digit()) => Some(text.parse::<u64>().map_err(|_| "host_db_invalid")?),
            Some(_) => return Err("host_db_invalid"),
        };
        if !real_folder(home)? {
            return Err("host_db_missing");
        }
        let empty = || json!({"messages": [], "cursor": "0"});
        let agents = home.join("agents");
        let folder = agents.join(&store);
        if !real_folder(&agents)? || !real_folder(&folder)? {
            return Ok(empty());
        }
        let Some(mut file) = open_regular(&folder.join("chat.jsonl"), None)? else {
            return Ok(empty());
        };
        let size = file.metadata().map_err(|_| "host_db_unreadable")?.len();
        let start = match asked {
            None => size.saturating_sub(CHAT_TAIL),
            Some(offset) => offset.min(size),
        };
        file.seek(SeekFrom::Start(start)).map_err(|_| "host_db_unreadable")?;
        let mut reader = BufReader::new(file);
        let mut line = Vec::new();
        let mut position = start;
        if start > 0 {
            position += read_line(&mut reader, &mut line).map_err(|_| "host_db_unreadable")?;
        }
        let newest = asked.is_none();
        let mut messages: std::collections::VecDeque<Value> = std::collections::VecDeque::new();
        while (newest || messages.len() < CHAT_ROWS) && position - start < PAGE_BYTES {
            let line_start = position;
            let read = read_line(&mut reader, &mut line).map_err(|_| "host_db_unreadable")?;
            if read == 0 {
                break;
            }
            position += read;
            if line.len() > LINE_CAP {
                continue;
            }
            let Ok(Value::Object(row)) = serde_json::from_slice::<Value>(&line) else {
                continue;
            };
            let text = row.get("text").and_then(Value::as_str).map(str::trim).unwrap_or("");
            if text.is_empty() {
                continue;
            }
            let role = match row.get("role").and_then(Value::as_str).map(str::to_lowercase).as_deref() {
                Some("user") => "user",
                Some("assistant") | Some("agent") => "agent",
                _ => "system",
            };
            let at = match row.get("ts") {
                Some(Value::Number(n)) => n.as_f64().unwrap_or(0.0),
                Some(Value::String(s)) => s.trim().parse::<f64>().ok().filter(|v| v.is_finite()).unwrap_or(0.0),
                _ => 0.0,
            };
            let id = match row.get("message_id").and_then(Value::as_str) {
                Some(id) if !id.is_empty() => id.to_owned(),
                _ => {
                    let mut hash = Sha256::new();
                    hash.update(format!("{agent}:{line_start}:").as_bytes());
                    hash.update(&line);
                    hash.finalize().iter().map(|b| format!("{b:02x}")).collect::<String>()
                }
            };
            let mut shown = Map::new();
            shown.insert("id".into(), json!(id));
            shown.insert("role".into(), json!(role));
            shown.insert("text".into(), json!(text));
            shown.insert("at".into(), json!(at));
            if role == "agent" {
                if let Some(kind) = row.get("kind").and_then(Value::as_str) {
                    if matches!(kind, "urgent" | "blocked" | "completed") {
                        shown.insert("kind".into(), json!(kind));
                    }
                }
            }
            if role == "system" {
                if let Some(code) = row.get("code").and_then(Value::as_str) {
                    if matches!(code, "mail_not_taken" | "message_too_long") {
                        shown.insert("code".into(), json!(code));
                    }
                }
            }
            if !newest || messages.len() < CHAT_ROWS {
                messages.push_back(Value::Object(shown));
            } else {
                messages.pop_front();
                messages.push_back(Value::Object(shown));
            }
        }
        Ok(json!({"messages": Vec::from(messages), "cursor": position.to_string()}))
    }
}

/// The agents of this computer's team with the container off: `agent_control.py list`'s own answer, every agent «off».
/// `Err` is the code of the saved data (`host_db_*`); a system without this reader says `host_db_unavailable`.
#[cfg(unix)]
pub(crate) fn read_roster(home: &Path) -> Result<Value, &'static str> {
    unix::roster(home)
}

#[cfg(not(unix))]
pub(crate) fn read_roster(_home: &Path) -> Result<Value, &'static str> {
    Err("host_db_unavailable")
}

/// One page of an agent's chat from the file on this computer: `{messages, cursor}`, the container reader's own shape.
#[cfg(unix)]
pub(crate) fn read_chat(home: &Path, agent: &str, cursor: Option<&str>) -> Result<Value, &'static str> {
    unix::chat_page(home, agent, cursor)
}

#[cfg(not(unix))]
pub(crate) fn read_chat(_home: &Path, _agent: &str, _cursor: Option<&str>) -> Result<Value, &'static str> {
    Err("host_db_unavailable")
}

#[cfg(test)]
mod tests {
    #![cfg(unix)]
    use super::*;
    use serde_json::json;
    use std::{
        path::PathBuf,
        process::{Command, Stdio},
        time::{SystemTime, UNIX_EPOCH},
    };

    struct World {
        base: PathBuf,
        home: PathBuf,
    }

    impl World {
        fn new(tag: &str) -> World {
            let nanos = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
            let base = std::env::temp_dir().join(format!("jht-host-agents-{tag}-{}-{nanos}", std::process::id()));
            let home = base.join("home");
            std::fs::create_dir_all(&home).unwrap();
            World { home, base }
        }

        fn put(&self, relative: &str, bytes: &[u8]) {
            let path = self.home.join(relative);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, bytes).unwrap();
        }
    }

    impl Drop for World {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.base);
        }
    }

    fn names(reply: &Value) -> Vec<String> {
        reply["data"]["items"].as_array().unwrap().iter().map(|i| i["name"].as_str().unwrap().to_owned()).collect()
    }

    const ROSTER: &str = r#"{"version":1,"agents":{
      "CAPITANO":{"session":"CAPITANO","role":"capitano","instance":null,"status":"active","first_seen":"2026-11-01T10:00:00Z","last_spawn":"2026-11-04T23:04:05Z"},
      "SCOUT-1":{"session":"SCOUT-1","role":"scout","instance":1,"status":"active","first_seen":"2026-11-02T08:30:00Z","last_spawn":"2026-11-04T22:00:00Z"},
      "SCOUT-2":{"session":"SCOUT-2","role":"scout","instance":2,"status":"retired","first_seen":"2026-11-02T08:30:00Z","last_spawn":"2026-11-02T08:30:00Z"},
      "CRITICO-S3":{"session":"CRITICO-S3","role":"critico","instance":3,"status":"contained","first_seen":"2026-11-03T08:30:00Z","last_spawn":"not a time"},
      "SCOUT-01":{"status":"active"},
      "rm -rf":{"status":"active"},
      "ANALISTA-1":"not an entry"}}"#;

    #[test]
    fn the_roster_lists_every_agent_still_in_the_team_as_off_with_the_times_the_files_give() {
        let world = World::new("roster");
        world.put("logs/team-roster.json", ROSTER.as_bytes());
        world.put("agents/scout-1/chat.jsonl", b"{\"text\":\"hi\"}\n");
        // the chat file's own time (2026-11-05T00:00:00Z), later than the last start of that agent
        std::fs::File::options().write(true).open(world.home.join("agents/scout-1/chat.jsonl")).unwrap().set_modified(UNIX_EPOCH + std::time::Duration::from_secs(1_793_836_800)).unwrap();
        let reply = read_roster(&world.home).unwrap();
        assert_eq!(names(&reply), ["CAPITANO", "CRITICO-S3", "SCOUT-1"], "retired, malformed and made-up names are not agents");
        assert_eq!(reply["data"]["states"], json!(true));
        let items = reply["data"]["items"].as_array().unwrap();
        for item in items {
            assert_eq!(item["state"], json!("spento"));
            assert!(item["reason"].is_null() && item["identity"].is_null() && item["usage"].is_null() && item["questions"].is_null());
        }
        // 2026-11-01T10:00:00Z and 2026-11-04T23:04:05Z
        assert_eq!(items[0]["created"], json!(1_793_527_200));
        assert_eq!(items[0]["activity"], json!(1_793_833_445));
        // a time that is not one is nothing, never a guess
        assert!(items[1]["activity"].is_null());
        // the chat file is newer than the last start: the later of the two is the last activity
        assert_eq!(items[2]["activity"], json!(1_793_836_800));
    }

    #[test]
    fn without_a_roster_the_folders_of_the_agents_say_who_the_team_had() {
        let world = World::new("folders");
        for name in ["capitano", "scout-1", "critico-S3", "Scout-2", "scout-0", "mentor"] {
            world.put(&format!("agents/{name}/chat.jsonl"), b"");
        }
        world.put("agents/stray-file", b"x");
        assert_eq!(names(&read_roster(&world.home).unwrap()), ["CAPITANO", "CRITICO-S3", "MENTOR", "SCOUT-1"]);
        // a team that never ran has no agents to show, and that is an answer
        let nothing = World::new("never");
        assert_eq!(names(&read_roster(&nothing.home).unwrap()), Vec::<String>::new());
        // a folder that is not there is not a team
        assert_eq!(read_roster(&nothing.base.join("absent")), Err("host_db_missing"));
        // a roster that is not JSON says nothing: the folders answer
        let broken = World::new("broken");
        broken.put("logs/team-roster.json", b"{not json");
        broken.put("agents/capitano/chat.jsonl", b"");
        assert_eq!(names(&read_roster(&broken.home).unwrap()), ["CAPITANO"]);
    }

    #[test]
    fn what_is_not_safe_to_read_is_refused_and_never_followed() {
        use std::os::unix::fs::symlink;
        // the roster as a link, a folder in its place, a hard link, and a roster over the cap
        let linked = World::new("roster-link");
        linked.put("elsewhere.json", ROSTER.as_bytes());
        std::fs::create_dir_all(linked.home.join("logs")).unwrap();
        symlink(linked.home.join("elsewhere.json"), linked.home.join("logs/team-roster.json")).unwrap();
        assert_eq!(read_roster(&linked.home), Err("host_db_unsafe"));
        let dir = World::new("roster-dir");
        std::fs::create_dir_all(dir.home.join("logs/team-roster.json")).unwrap();
        assert_eq!(read_roster(&dir.home), Err("host_db_unsafe"));
        let hard = World::new("roster-hard");
        hard.put("logs/team-roster.json", ROSTER.as_bytes());
        std::fs::hard_link(hard.home.join("logs/team-roster.json"), hard.home.join("logs/other.json")).unwrap();
        assert_eq!(read_roster(&hard.home), Err("host_db_unsafe"));
        let big = World::new("roster-big");
        big.put("logs/team-roster.json", &vec![b' '; (1 << 20) + 1]);
        assert_eq!(read_roster(&big.home), Err("host_db_unsafe"));
        // the logs folder as a link
        let logs = World::new("logs-link");
        logs.put("real/team-roster.json", ROSTER.as_bytes());
        symlink(logs.home.join("real"), logs.home.join("logs")).unwrap();
        assert_eq!(read_roster(&logs.home), Err("host_db_unsafe"));
        // a chat as a link, a hard link, a folder, and the agents' folder as a link
        let chat = World::new("chat-link");
        chat.put("elsewhere.jsonl", b"{\"role\":\"user\",\"text\":\"secret\"}\n");
        std::fs::create_dir_all(chat.home.join("agents/capitano")).unwrap();
        symlink(chat.home.join("elsewhere.jsonl"), chat.home.join("agents/capitano/chat.jsonl")).unwrap();
        assert_eq!(read_chat(&chat.home, "capitano", None), Err("host_db_unsafe"));
        let hard = World::new("chat-hard");
        hard.put("agents/capitano/chat.jsonl", b"{\"text\":\"x\"}\n");
        std::fs::hard_link(hard.home.join("agents/capitano/chat.jsonl"), hard.home.join("copy.jsonl")).unwrap();
        assert_eq!(read_chat(&hard.home, "capitano", None), Err("host_db_unsafe"));
        let folder = World::new("chat-dir");
        std::fs::create_dir_all(folder.home.join("agents/capitano/chat.jsonl")).unwrap();
        assert_eq!(read_chat(&folder.home, "capitano", None), Err("host_db_unsafe"));
        let agents = World::new("agents-link");
        agents.put("real/capitano/chat.jsonl", b"{\"text\":\"x\"}\n");
        symlink(agents.home.join("real"), agents.home.join("agents")).unwrap();
        assert_eq!(read_chat(&agents.home, "capitano", None), Err("host_db_unsafe"));
    }

    #[test]
    fn an_agent_that_is_not_one_of_the_closed_grammar_is_never_a_path() {
        let world = World::new("grammar");
        world.put("agents/capitano/chat.jsonl", b"{\"text\":\"x\"}\n");
        for bad in ["", "../capitano", "capitano/..", "CAPITANO", "scout-0", "scout-01", "scout-", "critico-S3", "capitano\n", "a b", "/etc/passwd"] {
            assert_eq!(read_chat(&world.home, bad, None), Err("host_db_invalid"), "{bad:?}");
        }
        for bad in ["-1", "1.5", "abc", "1234567890123", " 1"] {
            assert_eq!(read_chat(&world.home, "capitano", Some(bad)), Err("host_db_invalid"), "{bad:?}");
        }
        assert!(read_chat(&world.home, "scout-12", None).is_ok());
        // an agent that never wrote has an empty chat: that is a state, not a failure
        assert_eq!(read_chat(&world.home, "mentor", None).unwrap(), json!({"messages": [], "cursor": "0"}));
    }

    /// The container's reader on the same folder, run with python3 (`None` where there is none).
    fn script_page(home: &Path, agent: &str, cursor: Option<&str>) -> Option<Value> {
        let script = concat!(env!("CARGO_MANIFEST_DIR"), "/../../shared/skills/agent_chat.py");
        let mut command = Command::new("python3");
        command.arg(script).args(["read", agent]);
        if let Some(cursor) = cursor {
            command.arg(cursor);
        }
        let out = command
            .env("JHT_HOME", home)
            .env("JHT_CHAT_FLUSH_ON_READ", "0")
            .env("PYTHONDONTWRITEBYTECODE", "1")
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
            .ok()?;
        assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
        let mut page: Value = serde_json::from_slice(&out.stdout).unwrap_or_else(|e| panic!("{e}: {}", String::from_utf8_lossy(&out.stdout)));
        // what only a running team says
        if let Some(object) = page.as_object_mut() {
            for key in ["questions", "queued", "settled", "activity"] {
                object.remove(key);
            }
            for message in object.get_mut("messages").and_then(Value::as_array_mut).into_iter().flatten() {
                message.as_object_mut().unwrap().remove("suggestions");
            }
        }
        Some(page)
    }

    /// Lines of every kind the chat file has: both sides, the kinds and codes, ids given and not, times in the shapes
    /// they come in, text with spaces round it, text of other languages, and lines that say nothing.
    fn chat_file(rows: usize) -> Vec<u8> {
        let mut out = Vec::new();
        for i in 0..rows {
            let row = match i % 9 {
                0 => json!({"role": "user", "text": format!("  question {i} with an accent: è, and a line\nbreak  "), "ts": 1_793_000_000.0 + i as f64, "message_id": format!("u{i}")}),
                1 => json!({"role": "agent", "text": format!("answer {i} — «quoted» 日本語"), "ts": 1_793_000_000 + i as i64, "kind": "urgent"}),
                2 => json!({"role": "assistant", "text": format!("same as agent {i}"), "ts": "1793000001.5"}),
                3 => json!({"role": "SYSTEM", "text": format!("the mail was not taken {i}"), "code": "mail_not_taken"}),
                4 => json!({"role": "agent", "text": format!("info kind {i}"), "kind": "info", "ts": null}),
                5 => json!({"role": "agent", "text": "   ", "ts": 5}),
                6 => json!({"role": "robot", "text": format!("unknown role {i}"), "kind": "blocked", "code": "mail_not_taken"}),
                7 => json!({"role": "agent", "text": format!("completed {i}"), "kind": "completed", "ts": 12, "message_id": ""}),
                _ => json!({"role": "user", "text": format!("plain {i}")}),
            };
            out.extend_from_slice(serde_json::to_string(&row).unwrap().as_bytes());
            out.push(b'\n');
            if i % 17 == 0 {
                out.extend_from_slice(b"this is not json\n");
            }
            if i % 29 == 0 {
                out.extend_from_slice(b"[1,2,3]\n");
            }
        }
        out
    }

    #[test]
    fn the_page_is_the_container_readers_own_for_the_newest_page_and_for_every_page_after() {
        let world = World::new("differential");
        let mut file = chat_file(2500);
        // a line over the cap in the middle of the tail, and one in the middle of the part before it
        let long = serde_json::to_string(&json!({"role": "agent", "text": "x".repeat(70_000)})).unwrap();
        let at = file.len() - 40_000;
        let cut = at + file[at..].iter().position(|b| *b == b'\n').unwrap() + 1;
        let mut with_long = file[..cut].to_vec();
        with_long.extend_from_slice(long.as_bytes());
        with_long.push(b'\n');
        with_long.extend_from_slice(&file[cut..]);
        file = with_long;
        assert!(file.len() > 200_000, "a file longer than the tail the first page reads");
        world.put("agents/scout-1/chat.jsonl", &file);
        let Some(first) = script_page(&world.home, "scout", None) else { return };
        assert_eq!(read_chat(&world.home, "scout", None).unwrap(), first, "the newest page");
        assert_eq!(first["messages"].as_array().unwrap().len(), CHAT_ROWS_FOR_TEST);
        // the pages after it, from a cursor, to the end of the file and one past it
        for start in [None, Some("0"), Some("1"), Some("7777"), Some("50000")] {
            let mut cursor = start.map(str::to_owned);
            let mut pages = 0;
            loop {
                let ours = read_chat(&world.home, "scout", cursor.as_deref()).unwrap();
                let theirs = script_page(&world.home, "scout", cursor.as_deref()).unwrap();
                assert_eq!(ours, theirs, "from {cursor:?}");
                pages += 1;
                let next = ours["cursor"].as_str().unwrap().to_owned();
                if ours["messages"].as_array().unwrap().is_empty() || Some(next.clone()) == cursor || pages > 40 {
                    break;
                }
                cursor = Some(next);
            }
            assert!(pages > 1 || start.is_none(), "{start:?} went through more than one page");
        }
        // the two sides of the cap: a line of exactly 65536 bytes (its newline counted) is read, one of 65537 is skipped
        let base = serde_json::to_string(&json!({"role": "agent", "text": ""})).unwrap().len() + 1;
        let mut edge = b"{\"role\":\"user\",\"text\":\"before the cap\"}\n".to_vec();
        for (length, text) in [(65_536usize, "at the cap"), (65_537, "over the cap")] {
            let mut row = serde_json::to_string(&json!({"role": "agent", "text": format!("{text} {}", "y".repeat(length - base - text.len() - 1))})).unwrap().into_bytes();
            row.push(b'\n');
            assert_eq!(row.len(), length);
            edge.extend_from_slice(&row);
        }
        edge.extend_from_slice(b"{\"role\":\"user\",\"text\":\"after the cap\"}\n");
        world.put("agents/analista-1/chat.jsonl", &edge);
        let ours = read_chat(&world.home, "analista", None).unwrap();
        assert_eq!(ours, script_page(&world.home, "analista", None).unwrap());
        let texts: Vec<String> = ours["messages"].as_array().unwrap().iter().map(|m| m["text"].as_str().unwrap().chars().take(10).collect()).collect();
        assert_eq!(texts, ["before the", "at the cap", "after the "], "the line at the cap is read, the one over it is not");
        // a cursor past the end is the end; the other agents of the closed list read their own folders
        let end = read_chat(&world.home, "scout", Some("999999999")).unwrap();
        assert_eq!(end, script_page(&world.home, "scout", Some("999999999")).unwrap());
        world.put("agents/capitano/chat.jsonl", &chat_file(30));
        world.put("agents/critico/chat.jsonl", &chat_file(5));
        world.put("agents/scout-12/chat.jsonl", &chat_file(7));
        for agent in ["capitano", "critico", "scout-12", "mentor"] {
            assert_eq!(read_chat(&world.home, agent, None).unwrap(), script_page(&world.home, agent, None).unwrap(), "{agent}");
        }
    }

    const CHAT_ROWS_FOR_TEST: usize = 120;

    #[test]
    fn a_line_longer_than_the_cap_does_not_hold_the_page_and_odd_rows_do_not_break_it() {
        let world = World::new("odd");
        let mut file = Vec::new();
        file.extend_from_slice(b"{\"role\":\"user\",\"text\":\"first\"}\n");
        // a line of megabytes with no newline at the end of it, then good lines after
        file.extend_from_slice(&vec![b'a'; 3 << 20]);
        file.push(b'\n');
        file.extend_from_slice(b"{\"role\":\"user\",\"text\":42}\n{\"role\":7,\"text\":\"role is a number\"}\n{\"text\":\"no role\",\"ts\":true}\n\xff\xfe broken utf-8\n");
        file.extend_from_slice(b"{\"role\":\"agent\",\"text\":\"last\",\"ts\":\"nan\"}\n");
        world.put("agents/capitano/chat.jsonl", &file);
        let page = read_chat(&world.home, "capitano", Some("0")).unwrap();
        let texts: Vec<&str> = page["messages"].as_array().unwrap().iter().map(|m| m["text"].as_str().unwrap()).collect();
        assert_eq!(texts, ["first", "role is a number", "no role", "last"]);
        assert_eq!(page["cursor"], json!(file.len().to_string()));
        assert_eq!(page["messages"][1]["role"], json!("system"));
        assert_eq!(page["messages"][3]["at"], json!(0.0));
        // the newest page of the same file: only what the tail holds, never the part before it
        let newest = read_chat(&world.home, "capitano", None).unwrap();
        assert_eq!(newest["messages"].as_array().unwrap().last().unwrap()["text"], json!("last"));
    }

    #[test]
    fn the_roster_time_is_read_as_utc_and_nothing_else_is_a_time() {
        use super::unix::iso_seconds;
        assert_eq!(iso_seconds("1970-01-01T00:00:00Z"), Some(0));
        assert_eq!(iso_seconds("2026-11-04T23:04:05Z"), Some(1_793_833_445));
        assert_eq!(iso_seconds("2024-02-29T12:00:00Z"), Some(1_709_208_000));
        for bad in ["", "2026-11-04T23:04:05", "2026-11-04 23:04:05Z", "2026-13-04T23:04:05Z", "2026-11-04T24:04:05Z", "2026-11-04T23:04:05+00:00", "not a time", "1969-12-31T23:59:59Z", "2026-11-0aT23:04:05Z"] {
            assert_eq!(iso_seconds(bad), None, "{bad}");
        }
    }
}
