/**
 * Monitor — log aggregator dai vari agenti JHT.
 *
 * Aggrega i log dal forum e dalle sessioni tmux degli agenti attivi.
 * Filtra per livello e agente, stampa un summary formattato.
 *
 * Uso:
 *   npx tsx shared/deploy/monitor.ts
 *   npx tsx shared/deploy/monitor.ts --json
 *   npx tsx shared/deploy/monitor.ts --tail 50
 *   npx tsx shared/deploy/monitor.ts --agent Ace
 *   npx tsx shared/deploy/monitor.ts --level error
 */

import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";

const JHT_HOME = process.env.JHT_HOME ?? `${homedir()}/.jht`;
const FORUM_LOG = process.env.JHT_FORUM_LOG ?? `${JHT_HOME}/forum.log`;

export type LogLevel = "info" | "warn" | "error" | "all";

export type LogEntry = {
  ts: string;
  agent: string;
  level: LogLevel;
  message: string;
  raw: string;
};

export type AgentStatus = {
  name: string;
  session: string;
  active: boolean;
};

export type MonitorReport = {
  ts: number;
  agents: AgentStatus[];
  entries: LogEntry[];
  errorCount: number;
  warnCount: number;
};

function parseLevel(line: string): LogLevel {
  const lower = line.toLowerCase();
  if (lower.includes("[urg]") || lower.includes("error") || lower.includes("errore")) {
    return "error";
  }
  if (lower.includes("warn") || lower.includes("attenzione") || lower.includes("problema")) {
    return "warn";
  }
  return "info";
}

function parseForumLog(
  filePath: string,
  opts: { tail?: number; agentFilter?: string; level?: LogLevel },
): LogEntry[] {
  if (!existsSync(filePath)) {
    return [];
  }

  const raw = readFileSync(filePath, "utf8");
  const lines = raw.split("\n").filter(Boolean);
  const tail = opts.tail ?? 100;
  const recent = lines.slice(-tail);

  return recent
    .map((line): LogEntry | null => {
      const match = line.match(/^\[([^\]]+)\]\s+\[([^\]]+)\]\s+(.+)$/);
      if (!match) return null;
      const [, ts, agent, message] = match;
      const level = parseLevel(line);
      return { ts: ts ?? "", agent: agent ?? "", level, message: message ?? "", raw: line };
    })
    .filter((entry): entry is LogEntry => {
      if (!entry) return false;
      if (opts.agentFilter && !entry.agent.toLowerCase().includes(opts.agentFilter.toLowerCase())) {
        return false;
      }
      if (opts.level && opts.level !== "all" && entry.level !== opts.level) {
        return entry.level === "error";
      }
      return true;
    });
}

function listActiveSessions(): AgentStatus[] {
  try {
    const output = execSync("tmux list-sessions -F '#{session_name}' 2>/dev/null || true", {
      encoding: "utf8",
    });
    return output
      .split("\n")
      .filter((line) => line.startsWith("JHT-"))
      .map((name) => ({
        name: name.replace("JHT-", ""),
        session: name,
        active: true,
      }));
  } catch {
    return [];
  }
}

export function buildReport(opts: {
  tail?: number;
  agentFilter?: string;
  level?: LogLevel;
}): MonitorReport {
  const entries = parseForumLog(FORUM_LOG, opts);
  const agents = listActiveSessions();

  const errorCount = entries.filter((e) => e.level === "error").length;
  const warnCount = entries.filter((e) => e.level === "warn").length;

  return {
    ts: Date.now(),
    agents,
    entries,
    errorCount,
    warnCount,
  };
}

function formatReport(report: MonitorReport): void {
  const ts = new Date(report.ts).toISOString();
  console.log(`\n[monitor] ${ts}\n`);

  console.log(`Sessioni tmux attive (${report.agents.length}):`);
  if (report.agents.length === 0) {
    console.log("  (nessuna)");
  } else {
    for (const a of report.agents) {
      console.log(`  • ${a.session}`);
    }
  }

  console.log(`\nLog recenti — ${report.entries.length} righe`);
  console.log(`  errori: ${report.errorCount}  avvisi: ${report.warnCount}\n`);

  for (const entry of report.entries) {
    const prefix =
      entry.level === "error" ? "ERR" : entry.level === "warn" ? "WRN" : "   ";
    console.log(`  ${prefix} [${entry.agent}] ${entry.message}`);
  }
  console.log();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  const tailIdx = args.indexOf("--tail");
  const tail = tailIdx >= 0 ? parseInt(args[tailIdx + 1] ?? "100", 10) : 100;
  const agentIdx = args.indexOf("--agent");
  const agentFilter = agentIdx >= 0 ? args[agentIdx + 1] : undefined;
  const levelIdx = args.indexOf("--level");
  const level = (levelIdx >= 0 ? args[levelIdx + 1] : "all") as LogLevel;

  const report = buildReport({ tail, agentFilter, level });

  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    formatReport(report);
  }
}
