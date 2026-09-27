//! What the API team spent, read from the database its runs leave on this
//! machine (<app data>/api-team/data/team.db, written by api-worker inside the
//! container). Read only: the connection is opened with SQLITE_OPEN_READ_ONLY,
//! and nothing here writes, creates or migrates the file. No run yet means no
//! file, and the page says so.

use crate::team::{workspace_dir, AGENT_MAX_COST_USD, TEAM_MAX_COST_USD};
use rusqlite::{Connection, OpenFlags};
use serde::Serialize;
use std::path::Path;

/// The newest runs the page lists: enough for the history, bounded.
const RUN_LIMIT: u32 = 50;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SpendReport {
    /// false when no run has written a database yet
    found: bool,
    team_cap_usd: f64,
    agent_cap_usd: f64,
    runs: Vec<SpendRun>,
    agents: Vec<SpendAgent>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SpendRun {
    run_id: String,
    status: String,
    budget_usd: f64,
    spent_usd: f64,
    created_at: String,
    updated_at: String,
}

/// One agent of one run: the captain, scout and sentinel from team_agent_runs,
/// the pipeline roles (analyst, scorer, writer, critic) summed over their tasks.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SpendAgent {
    run_id: String,
    role: String,
    agent_id: Option<String>,
    /// team_agent_runs' own status; a pipeline role has none of its own
    status: Option<String>,
    /// how many tasks the row sums (1 for team_agent_runs)
    tasks: u32,
    cost_usd: f64,
    input_tokens: u64,
    output_tokens: u64,
    last_error: Option<String>,
    updated_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SpendError {
    code: &'static str,
}

#[tauri::command]
pub(crate) async fn api_team_spend(app: tauri::AppHandle) -> Result<SpendReport, SpendError> {
    let Some(workspace) = workspace_dir(&app) else {
        return Err(SpendError {
            code: "storage_missing",
        });
    };
    tauri::async_runtime::spawn_blocking(move || {
        read_spend(&workspace.join("data").join("team.db"))
    })
    .await
    .unwrap_or(Err(SpendError {
        code: "read_failed",
    }))
}

pub(crate) fn read_spend(db_path: &Path) -> Result<SpendReport, SpendError> {
    let team_cap_usd = TEAM_MAX_COST_USD.parse().unwrap_or(0.0);
    let agent_cap_usd = AGENT_MAX_COST_USD.parse().unwrap_or(0.0);
    if !db_path.is_file() {
        return Ok(SpendReport {
            found: false,
            team_cap_usd,
            agent_cap_usd,
            runs: Vec::new(),
            agents: Vec::new(),
        });
    }
    let failed = |_: rusqlite::Error| SpendError {
        code: "read_failed",
    };
    let db = open_read_only(db_path).map_err(failed)?;
    let runs = read_runs(&db).map_err(failed)?;
    let agents = read_agents(&db, &runs).map_err(failed)?;
    Ok(SpendReport {
        found: true,
        team_cap_usd,
        agent_cap_usd,
        runs,
        agents,
    })
}

/// The only way this module opens the database: read only, never created.
fn open_read_only(db_path: &Path) -> rusqlite::Result<Connection> {
    let db = Connection::open_with_flags(
        db_path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )?;
    // A run in progress holds the writer lock for short moments.
    db.busy_timeout(std::time::Duration::from_secs(5))?;
    Ok(db)
}

fn read_runs(db: &Connection) -> rusqlite::Result<Vec<SpendRun>> {
    let mut stmt = db.prepare(
        "SELECT run_id, status, budget_usd, spent_usd, created_at, updated_at
           FROM team_runs ORDER BY created_at DESC LIMIT ?1",
    )?;
    let rows = stmt.query_map([RUN_LIMIT], |r| {
        Ok(SpendRun {
            run_id: r.get(0)?,
            status: r.get(1)?,
            budget_usd: r.get(2)?,
            spent_usd: r.get(3)?,
            created_at: r.get(4)?,
            updated_at: r.get(5)?,
        })
    })?;
    rows.collect()
}

/// The agents of the listed runs only, so the two lists always agree.
fn read_agents(db: &Connection, runs: &[SpendRun]) -> rusqlite::Result<Vec<SpendAgent>> {
    let mut agents = Vec::new();
    let mut own = db.prepare(
        "SELECT role, agent_id, status, cost_usd, input_tokens, output_tokens, last_error, updated_at
           FROM team_agent_runs WHERE run_id = ?1 ORDER BY created_at",
    )?;
    let mut tasks = db.prepare(
        "SELECT t.role, t.agent_id, COUNT(*), SUM(t.cost_usd), SUM(t.input_tokens), SUM(t.output_tokens),
                (SELECT e.last_error FROM team_tasks e
                  WHERE e.run_id = t.run_id AND e.role = t.role
                    AND e.agent_id IS t.agent_id AND e.last_error IS NOT NULL
                  ORDER BY e.updated_at DESC LIMIT 1),
                MAX(t.updated_at)
           FROM team_tasks t WHERE t.run_id = ?1
          GROUP BY t.role, t.agent_id ORDER BY MIN(t.created_at)",
    )?;
    for run in runs {
        let rows = own.query_map([&run.run_id], |r| {
            Ok(SpendAgent {
                run_id: run.run_id.clone(),
                role: r.get(0)?,
                agent_id: r.get(1)?,
                status: r.get(2)?,
                tasks: 1,
                cost_usd: r.get(3)?,
                input_tokens: r.get(4)?,
                output_tokens: r.get(5)?,
                last_error: r.get(6)?,
                updated_at: r.get(7)?,
            })
        })?;
        for row in rows {
            agents.push(row?);
        }
        let rows = tasks.query_map([&run.run_id], |r| {
            Ok(SpendAgent {
                run_id: run.run_id.clone(),
                role: r.get(0)?,
                agent_id: r.get(1)?,
                status: None,
                tasks: r.get(2)?,
                cost_usd: r.get(3)?,
                input_tokens: r.get(4)?,
                output_tokens: r.get(5)?,
                last_error: r.get(6)?,
                updated_at: r.get(7)?,
            })
        })?;
        for row in rows {
            agents.push(row?);
        }
    }
    Ok(agents)
}

#[cfg(test)]
mod tests {
    use super::{open_read_only, read_spend};
    use rusqlite::Connection;
    use std::{
        fs,
        path::PathBuf,
        sync::atomic::{AtomicU32, Ordering},
        time::{SystemTime, UNIX_EPOCH},
    };

    // Tests run in parallel: the clock alone can hand two of them the same folder.
    static NEXT: AtomicU32 = AtomicU32::new(0);

    fn temp_db() -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let n = NEXT.fetch_add(1, Ordering::Relaxed);
        let dir =
            std::env::temp_dir().join(format!("jht-spend-{}-{nanos}-{n}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        dir.join("team.db")
    }

    /// The tables as api-worker/src/team-db.ts creates them (the columns read here).
    fn seed(path: &PathBuf) {
        let db = Connection::open(path).unwrap();
        db.execute_batch(
            "PRAGMA journal_mode=WAL;
             CREATE TABLE team_runs (run_id TEXT PRIMARY KEY, status TEXT NOT NULL, target_scores INTEGER NOT NULL,
               target_reviews INTEGER NOT NULL, budget_usd REAL NOT NULL, spent_usd REAL NOT NULL,
               created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
             CREATE TABLE team_tasks (id TEXT PRIMARY KEY, run_id TEXT NOT NULL, source_id TEXT NOT NULL, role TEXT NOT NULL,
               status TEXT NOT NULL, agent_id TEXT, claim_token TEXT, reservation_usd REAL NOT NULL, cost_usd REAL NOT NULL,
               input_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL, attempts INTEGER NOT NULL, last_error TEXT,
               created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
             CREATE TABLE team_agent_runs (id TEXT PRIMARY KEY, run_id TEXT NOT NULL, role TEXT NOT NULL, agent_id TEXT NOT NULL,
               status TEXT NOT NULL, claim_token TEXT NOT NULL, reservation_usd REAL NOT NULL, cost_usd REAL NOT NULL,
               input_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL, last_error TEXT,
               created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
             INSERT INTO team_runs VALUES
               ('run-old', 'completed', 5, 2, 0.10, 0.031, '2026-09-26T10:00:00Z', '2026-09-26T10:20:00Z'),
               ('run-new', 'failed', 5, 2, 0.10, 0.1, '2026-09-27T10:00:00Z', '2026-09-27T10:09:00Z');
             INSERT INTO team_agent_runs VALUES
               ('a1', 'run-new', 'captain', 'captain-1', 'completed', 'c', 0.02, 0.004, 1000, 200, NULL, '2026-09-27T10:00:01Z', '2026-09-27T10:05:00Z'),
               ('a2', 'run-new', 'scout', 'scout-1', 'failed', 'c', 0.02, 0.02, 9000, 900, 'budget_exhausted', '2026-09-27T10:00:02Z', '2026-09-27T10:06:00Z');
             INSERT INTO team_tasks VALUES
               ('t1', 'run-new', 'job-1', 'scorer', 'completed', 'scorer-1', NULL, 0.01, 0.003, 500, 50, 1, NULL, '2026-09-27T10:01:00Z', '2026-09-27T10:02:00Z'),
               ('t2', 'run-new', 'job-2', 'scorer', 'completed', 'scorer-1', NULL, 0.01, 0.002, 400, 40, 2, 'rate_limited', '2026-09-27T10:03:00Z', '2026-09-27T10:04:00Z'),
               ('t3', 'run-new', 'job-3', 'writer', 'queued', NULL, NULL, 0.01, 0, 0, 0, 0, NULL, '2026-09-27T10:05:00Z', '2026-09-27T10:05:00Z');",
        )
        .unwrap();
    }

    #[test]
    fn no_database_is_an_empty_report_not_an_error() {
        let report = read_spend(&temp_db()).expect("empty report");
        assert!(!report.found);
        assert!(report.runs.is_empty());
        assert_eq!(report.team_cap_usd, 0.10);
        assert_eq!(report.agent_cap_usd, 0.02);
    }

    #[test]
    fn reads_runs_newest_first_and_their_agents() {
        let path = temp_db();
        seed(&path);
        let report = read_spend(&path).expect("report");
        assert!(report.found);
        let ids: Vec<_> = report.runs.iter().map(|r| r.run_id.as_str()).collect();
        assert_eq!(ids, ["run-new", "run-old"]);
        assert_eq!(report.runs[0].spent_usd, 0.1);

        let scout = report.agents.iter().find(|a| a.role == "scout").unwrap();
        assert_eq!(scout.status.as_deref(), Some("failed"));
        assert_eq!(scout.last_error.as_deref(), Some("budget_exhausted"));

        // two scorer tasks, one row: summed, with the latest error
        let scorer = report.agents.iter().find(|a| a.role == "scorer").unwrap();
        assert_eq!(scorer.tasks, 2);
        assert!((scorer.cost_usd - 0.005).abs() < 1e-9);
        assert_eq!(scorer.input_tokens, 900);
        assert_eq!(scorer.last_error.as_deref(), Some("rate_limited"));
        assert_eq!(scorer.status, None);

        // a task nobody claimed yet has no agent
        let writer = report.agents.iter().find(|a| a.role == "writer").unwrap();
        assert_eq!(writer.agent_id, None);
        assert_eq!(
            report
                .agents
                .iter()
                .filter(|a| a.run_id == "run-old")
                .count(),
            0
        );
    }

    #[test]
    fn the_connection_cannot_write_or_create() {
        let path = temp_db();
        seed(&path);
        let db = open_read_only(&path).expect("opens");
        assert!(db.execute("DELETE FROM team_runs", []).is_err());
        drop(db);
        assert_eq!(read_spend(&path).expect("report").runs.len(), 2);

        let missing = temp_db();
        assert!(open_read_only(&missing).is_err());
        assert!(!missing.exists());
    }
}
