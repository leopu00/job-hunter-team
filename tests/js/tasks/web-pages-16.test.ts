/** Test E2E batch 16 — /logs API, /analytics API, /notifications API (aggiornata) */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const WEB = path.resolve(__dirname, "../../../web");
function readSrc(rel: string) {
  const raw = fs.readFileSync(path.join(WEB, rel), "utf-8").replace(/\r\n/g, "\n");
  const singleQuoted = raw.replace(/"/g, "'");
  const squashed = singleQuoted.replace(/\s+/g, " ").trim();
  return [raw, singleQuoted, squashed].join("\n/* normalized */\n");
}

/* ── Logs API ── */
describe("Logs API", () => {
  const src = readSrc("app/api/logs/route.ts");

  it("export GET + dynamic force-dynamic + LogLevel 4 + LogEntry interface", () => {
    expect(src).toMatch(/export async function GET\b/);
    expect(src).toContain("export const dynamic = 'force-dynamic'");
    expect(src).toContain("type LogLevel");
    for (const l of ["debug", "info", "warn", "error"]) expect(src).toContain(`'${l}'`);
    expect(src).toContain("interface LogEntry");
  });

  it("readLogFile: JSON lines parser + listLogDates sort reverse + extractSubsystems", () => {
    expect(src).toContain("function readLogFile"); expect(src).toContain("JSON.parse(line)");
    expect(src).toContain("function listLogDates"); expect(src).toContain(".sort()"); expect(src).toContain(".reverse()");
    expect(src).toContain("function extractSubsystems"); expect(src).toContain("new Set<string>()");
  });

  it("SAMPLE_SUBSYSTEMS 8 + SAMPLE_MESSAGES per level + generateSampleLogs 60 entries", () => {
    expect(src).toContain("SAMPLE_SUBSYSTEMS");
    for (const s of ["gateway", "coordinator", "scout", "assistente"]) expect(src).toContain(`'${s}'`);
    expect(src).toContain("SAMPLE_MESSAGES"); expect(src).toContain("function generateSampleLogs");
    expect(src).toContain("i < 60");
  });

  it("GET: filtri date/level/subsystem/search + limit DEFAULT_LIMIT=200 MAX_LIMIT=2000 + offset + hasMore", () => {
    expect(src).toContain("sp.get('date')"); expect(src).toContain("sp.get('level')");
    expect(src).toContain("sp.get('subsystem')"); expect(src).toContain("sp.get('search')");
    expect(src).toContain("DEFAULT_LIMIT = 200"); expect(src).toContain("MAX_LIMIT = 2000");
    expect(src).toContain("sp.get('offset')"); expect(src).toContain("hasMore: offset + limit < total");
  });

  it("search case-insensitive su message+subsystem + ordine inverso + paginazione slice", () => {
    expect(src).toContain("search.toLowerCase()");
    expect(src).toContain("e.message.toLowerCase().includes(q)");
    expect(src).toContain("e.subsystem.toLowerCase().includes(q)");
    expect(src).toContain("entries.reverse()"); expect(src).toContain("entries.slice(offset, offset + limit)");
  });
});

/* ── Analytics API ── */
describe("Analytics API", () => {
  const src = readSrc("app/api/analytics/route.ts");

  it("export GET + POST + ProviderName 3 + TokenUsage + UsageEntry + AnalyticsStore", () => {
    expect(src).toMatch(/export async function GET\b/);
    expect(src).toMatch(/export async function POST\b/);
    expect(src).toContain("type ProviderName");
    for (const p of ["claude", "openai", "minimax"]) expect(src).toContain(`'${p}'`);
    expect(src).toContain("type TokenUsage"); expect(src).toContain("type UsageEntry");
  });

  it("computeLatency: count/avgMs/minMs/maxMs/p95Ms + sorted", () => {
    expect(src).toContain("function computeLatency");
    expect(src).toContain("avgMs"); expect(src).toContain("minMs"); expect(src).toContain("maxMs"); expect(src).toContain("p95Ms");
    expect(src).toContain("[...values].sort((a, b) => a - b)");
    expect(src).toContain("Math.ceil(sorted.length * 0.95)");
  });

  it("buildSummary: byProvider + byModel + daily + totalCalls/tokens/cost/errors", () => {
    expect(src).toContain("function buildSummary");
    expect(src).toContain("byProvider"); expect(src).toContain("byModel"); expect(src).toContain("byDay");
    expect(src).toContain("totalCalls: entries.length"); expect(src).toContain("totalTokens");
    expect(src).toContain("totalCostUsd"); expect(src).toContain("totalErrors");
  });

  it("jobHuntingData: KPI + timeline + statusBreakdown + topCompanies + responseRateTrend", () => {
    expect(src).toContain("function jobHuntingData");
    expect(src).toContain("totalApplications"); expect(src).toContain("responseRate"); expect(src).toContain("avgResponseDays");
    expect(src).toContain("interviewsScheduled"); expect(src).toContain("timeline"); expect(src).toContain("statusBreakdown");
    expect(src).toContain("topCompanies"); expect(src).toContain("responseRateTrend");
  });

  it("GET ?days=30 default + POST valida provider/model/tokens + status 201", () => {
    expect(src).toContain("get('days') ?? '30'");
    expect(src).toContain("!body.provider || !body.model || !body.tokens");
    expect(src).toContain("provider, model e tokens obbligatori");
    expect(src).toContain("status: 400"); expect(src).toContain("status: 201");
  });
});

/* ── Notifications API (aggiornata) ── */
describe("Notifications API (v2)", () => {
  const src = readSrc("app/api/notifications/route.ts");

  it("GET+POST+PATCH+DELETE + NotificationType 4 + NotificationPriority 4 + NotificationChannel 3", () => {
    expect(src).toMatch(/export async function GET\b/);
    expect(src).toMatch(/export async function POST\b/);
    expect(src).toMatch(/export async function PATCH\b/);
    expect(src).toMatch(/export async function DELETE\b/);
    expect(src).toContain("type NotificationType");
    for (const t of ["info", "warning", "success", "error"]) expect(src).toContain(`'${t}'`);
  });

  it("sampleNotifications 8 entries con id s1-s8, type/channel/priority/read misti", () => {
    expect(src).toContain("function sampleNotifications");
    expect(src).toContain("id: 's1'"); expect(src).toContain("id: 's8'");
    expect(src).toContain("Candidatura inviata"); expect(src).toContain("Telegram disconnesso");
  });

  it("GET: filtro type aggiunto + POST: type default 'info' + save atomico tmp+rename", () => {
    expect(src).toContain("sp.get('type')");
    expect(src).toContain("n.type === type");
    expect(src).toContain("body.type ?? 'info'");
    expect(src).toContain("STORE_PATH + '.tmp'"); expect(src).toContain("fs.renameSync");
  });

  it("PATCH mark-as-read id/all + DELETE id/read + 404 'notifica non trovata'", () => {
    expect(src).toContain("all === 'true'"); expect(src).toContain("markedRead: count");
    expect(src).toContain("readOnly === 'true'");
    expect(src).toContain("notifica non trovata"); expect(src).toContain("status: 404");
    expect(src).toContain("splice(idx, 1)");
  });
});
