import { mkdirSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { dirname } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";

import type { SearchLane } from "./candidate-profile.js";
import { laneKey } from "./candidate-profile.js";
import type { ScoutCandidateProposal } from "./contract.js";

export type ActiveScout = {
  agentId: string;
  runId: string;
  lane: string | null;
  leaseExpiresAt: string;
};

export type CoordinationResult = {
  mode: "solo" | "coordinated";
  peers: ActiveScout[];
  lane?: SearchLane;
};

export type PersistenceResult = {
  inserted: number[];
  skipped: Array<{ sourceId: string; level: 1 | 2 | 3; existingId: number }>;
};

export class StandaloneScoutDb {
  private readonly db: DatabaseSync;

  constructor(
    readonly path: string,
    private readonly now: () => Date = () => new Date(),
  ) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(
      "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=10000;",
    );
    this.migrate();
  }

  close(): void {
    this.db.close();
  }

  coordinate(
    agentId: string,
    runId: string,
    lanes: SearchLane[],
    leaseMs: number,
  ): CoordinationResult {
    const now = this.now();
    const nowIso = now.toISOString();
    const expiresAt = new Date(now.getTime() + leaseMs).toISOString();
    this.transaction(() => {
      this.db
        .prepare("DELETE FROM source_claims WHERE lease_expires_at <= ?")
        .run(nowIso);
      this.db
        .prepare(
          "UPDATE scout_agents SET status='stale', updated_at=? " +
            "WHERE status='active' AND lease_expires_at <= ?",
        )
        .run(nowIso, nowIso);
    });

    const peers = this.db
      .prepare(
        "SELECT agent_id, run_id, lane, lease_expires_at FROM scout_agents " +
          "WHERE agent_id <> ? AND status='active' AND lease_expires_at > ? " +
          "ORDER BY agent_id",
      )
      .all(agentId, nowIso)
      .map((row) => ({
        agentId: String(row.agent_id),
        runId: String(row.run_id),
        lane: row.lane === null ? null : String(row.lane),
        leaseExpiresAt: String(row.lease_expires_at),
      }));

    const lane =
      peers.length > 0
        ? this.claimFirstFreeLane(agentId, runId, lanes, expiresAt)
        : undefined;
    const selectedLane = lane ? laneKey(lane) : null;
    this.transaction(() => {
      this.db
        .prepare(
          "INSERT INTO scout_agents(agent_id, run_id, status, lane, lease_expires_at, updated_at) " +
            "VALUES (?, ?, 'active', ?, ?, ?) " +
            "ON CONFLICT(agent_id) DO UPDATE SET run_id=excluded.run_id, status='active', " +
            "lane=excluded.lane, lease_expires_at=excluded.lease_expires_at, updated_at=excluded.updated_at",
        )
        .run(agentId, runId, selectedLane, expiresAt, nowIso);
      this.recordCoordinationEvent(
        runId,
        agentId,
        peers.length > 0 ? "coordinated" : "solo",
        selectedLane,
        peers.length,
      );
    });
    return { mode: peers.length > 0 ? "coordinated" : "solo", peers, lane };
  }

  heartbeat(agentId: string, runId: string, leaseMs: number): void {
    const now = this.now();
    const expiresAt = new Date(now.getTime() + leaseMs).toISOString();
    this.transaction(() => {
      this.db
        .prepare(
          "UPDATE scout_agents SET lease_expires_at=?, updated_at=? " +
            "WHERE agent_id=? AND run_id=? AND status='active'",
        )
        .run(expiresAt, now.toISOString(), agentId, runId);
      this.db
        .prepare(
          "UPDATE source_claims SET lease_expires_at=? WHERE agent_id=? AND run_id=?",
        )
        .run(expiresAt, agentId, runId);
    });
  }

  finish(agentId: string, runId: string, status: "idle" | "failed"): void {
    const timestamp = this.now().toISOString();
    this.transaction(() => {
      this.db
        .prepare("DELETE FROM source_claims WHERE agent_id=? AND run_id=?")
        .run(agentId, runId);
      this.db
        .prepare(
          "UPDATE scout_agents SET status=?, lane=NULL, updated_at=? WHERE agent_id=? AND run_id=?",
        )
        .run(status, timestamp, agentId, runId);
    });
  }

  persist(
    runId: string,
    agentId: string,
    proposals: ScoutCandidateProposal[],
  ): PersistenceResult {
    const result: PersistenceResult = { inserted: [], skipped: [] };
    this.transaction(() => {
      for (const proposal of proposals) {
        const duplicate = this.findDuplicate(proposal);
        if (duplicate) {
          result.skipped.push({ sourceId: proposal.sourceId, ...duplicate });
          this.db
            .prepare(
              "INSERT INTO position_events(position_id, run_id, agent_id, event, detail, created_at) " +
                "VALUES (?, ?, ?, 'duplicate_skipped', ?, ?)",
            )
            .run(
              duplicate.existingId,
              runId,
              agentId,
              JSON.stringify({
                sourceId: proposal.sourceId,
                level: duplicate.level,
              }),
              this.now().toISOString(),
            );
          continue;
        }

        const inserted = this.db
          .prepare(
            "INSERT INTO positions(external_id, title, company, location, remote_type, url, " +
              "url_normalized, source, posted_at, jd_text, requirements_json, matched_criteria_json, " +
              "status, found_by, found_at, run_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, " +
              "'new', ?, ?, ?)",
          )
          .run(
            proposal.sourceId,
            proposal.title,
            proposal.company,
            proposal.location,
            proposal.remoteType,
            proposal.url,
            normalizeUrl(proposal.url),
            proposal.source,
            proposal.postedAt,
            proposal.jdText,
            JSON.stringify(proposal.requirements),
            JSON.stringify(proposal.matchedCriteria),
            agentId,
            this.now().toISOString(),
            runId,
          );
        const id = Number(inserted.lastInsertRowid);
        result.inserted.push(id);
        this.db
          .prepare(
            "INSERT INTO position_events(position_id, run_id, agent_id, event, detail, created_at) " +
              "VALUES (?, ?, ?, 'inserted', ?, ?)",
          )
          .run(
            id,
            runId,
            agentId,
            JSON.stringify({ sourceId: proposal.sourceId }),
            this.now().toISOString(),
          );
      }
    });
    return result;
  }

  listPositions(): Array<Record<string, unknown>> {
    return this.db
      .prepare("SELECT * FROM positions ORDER BY id")
      .all() as Array<Record<string, unknown>>;
  }

  private claimFirstFreeLane(
    agentId: string,
    runId: string,
    lanes: SearchLane[],
    expiresAt: string,
  ): SearchLane {
    let selected: SearchLane | undefined;
    this.transaction(() => {
      for (const lane of lanes) {
        const key = laneKey(lane);
        const existing = this.db
          .prepare(
            "SELECT agent_id FROM source_claims WHERE lane=? AND lease_expires_at > ?",
          )
          .get(key, this.now().toISOString());
        if (existing) continue;
        this.db
          .prepare(
            "INSERT OR REPLACE INTO source_claims(lane, agent_id, run_id, lease_expires_at) VALUES (?, ?, ?, ?)",
          )
          .run(key, agentId, runId, expiresAt);
        selected = lane;
        break;
      }
    });
    if (!selected) {
      const fallback = lanes[hashIndex(agentId, lanes.length)];
      if (!fallback) throw new Error("No search lanes are available");
      return fallback;
    }
    return selected;
  }

  private findDuplicate(
    proposal: ScoutCandidateProposal,
  ): { level: 1 | 2 | 3; existingId: number } | undefined {
    const url = this.db
      .prepare("SELECT id FROM positions WHERE url_normalized=?")
      .get(normalizeUrl(proposal.url));
    if (url) return { level: 1, existingId: Number(url.id) };

    const exact = this.db
      .prepare(
        "SELECT id FROM positions WHERE lower(company)=lower(?) AND lower(title)=lower(?) " +
          "AND lower(coalesce(location,''))=lower(coalesce(?,'')) ORDER BY id LIMIT 1",
      )
      .get(proposal.company, proposal.title, proposal.location);
    if (exact) return { level: 2, existingId: Number(exact.id) };

    const nearby = this.db
      .prepare(
        "SELECT id, title FROM positions WHERE lower(company)=lower(?) " +
          "AND lower(coalesce(location,''))=lower(coalesce(?,''))",
      )
      .all(proposal.company, proposal.location);
    for (const row of nearby) {
      if (
        jaccard(tokenize(proposal.title), tokenize(String(row.title))) > 0.85
      ) {
        return { level: 3, existingId: Number(row.id) };
      }
    }
    return undefined;
  }

  private recordCoordinationEvent(
    runId: string,
    agentId: string,
    mode: string,
    lane: string | null,
    peerCount: number,
  ): void {
    this.db
      .prepare(
        "INSERT INTO coordination_events(id, run_id, agent_id, mode, lane, peer_count, created_at) " +
          "VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        randomUUID(),
        runId,
        agentId,
        mode,
        lane,
        peerCount,
        this.now().toISOString(),
      );
  }

  private transaction(operation: () => void): void {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      operation();
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS scout_agents (
        agent_id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('active','idle','failed','stale')),
        lane TEXT,
        lease_expires_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS source_claims (
        lane TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        run_id TEXT NOT NULL,
        lease_expires_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS coordination_events (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        mode TEXT NOT NULL,
        lane TEXT,
        peer_count INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS positions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        external_id TEXT NOT NULL,
        title TEXT NOT NULL,
        company TEXT NOT NULL,
        location TEXT NOT NULL,
        remote_type TEXT NOT NULL,
        url TEXT NOT NULL,
        url_normalized TEXT NOT NULL,
        source TEXT NOT NULL,
        posted_at TEXT NOT NULL,
        jd_text TEXT NOT NULL,
        requirements_json TEXT NOT NULL,
        matched_criteria_json TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status='new'),
        found_by TEXT NOT NULL,
        found_at TEXT NOT NULL,
        run_id TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS positions_url_normalized_uq ON positions(url_normalized);
      CREATE INDEX IF NOT EXISTS positions_identity_idx ON positions(company, title, location);
      CREATE TABLE IF NOT EXISTS position_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        position_id INTEGER NOT NULL REFERENCES positions(id),
        run_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        event TEXT NOT NULL,
        detail TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
  }
}

function normalizeUrl(raw: string): string {
  const url = new URL(raw);
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    if (/^(utm_|ref$|source$|trk$)/i.test(key)) url.searchParams.delete(key);
  }
  url.hostname = url.hostname.toLowerCase();
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString();
}

function tokenize(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((part) => part.length > 1),
  );
}

function jaccard(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 && right.size === 0) return 1;
  const intersection = [...left].filter((value) => right.has(value)).length;
  return intersection / new Set([...left, ...right]).size;
}

function hashIndex(value: string, size: number): number {
  if (size <= 0) return 0;
  const digest = createHash("sha256").update(value).digest();
  return digest.readUInt32BE(0) % size;
}
