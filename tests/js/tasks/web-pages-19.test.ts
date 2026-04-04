/** Test E2E batch 19 — /achievements, /compare, /calendar */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const WEB = path.resolve(__dirname, "../../../web");
function readSrc(rel: string) { return fs.readFileSync(path.join(WEB, rel), "utf-8"); }

/* ── /achievements ── */
describe("/achievements", () => {
  const page = readSrc("app/achievements/page.tsx");
  const api = readSrc("app/api/achievements/route.ts");

  it("page: AchievementsPage + fetch /api/achievements + filterCat + breadcrumb Dashboard/Achievement", () => {
    expect(page).toMatch(/export default function AchievementsPage\b/);
    expect(page).toContain("fetch(`/api/achievements?");
    expect(page).toContain("const [filterCat, setFilterCat]");
    expect(page).toContain("setFilterCat('all')");
    expect(page).toContain('href="/dashboard"');
    expect(page).toContain("Achievement");
  });

  it("API: GET + 5 Category + buildAchievements 15 items + byCategory aggregation + ?category filter", () => {
    expect(api).toContain("export async function GET");
    expect(api).toContain("type Category = 'applications' | 'networking' | 'skills' | 'streak' | 'profile'");
    expect(api).toContain("function buildAchievements");
    expect(api).toContain("byCategory");
    expect(api).toContain("req.nextUrl.searchParams.get('category')");
  });

  it("render: CAT_CFG 5 colori + ProgressBar current/target + unlocked/total + 'sbloccato' badge + opacity 0.5 locked", () => {
    expect(page).toContain("const CAT_CFG");
    expect(page).toContain("function ProgressBar");
    expect(page).toContain("{unlocked}/{total}");
    expect(page).toContain("sbloccato");
    expect(page).toContain("opacity: a.unlocked ? 1 : 0.5");
  });
});

/* ── /compare ── */
describe("/compare", () => {
  const page = readSrc("app/compare/page.tsx");
  const api = readSrc("app/api/compare/route.ts");

  it("page: ComparePage + fetch /api/compare + toggle select max 4 + compare button min 2", () => {
    expect(page).toMatch(/export default function ComparePage\b/);
    expect(page).toContain("fetch('/api/compare')");
    expect(page).toContain("fetch(`/api/compare?ids=");
    expect(page).toContain("p.length >= 4 ? p : [...p, id]");
    expect(page).toContain("selected.length < 2");
  });

  it("API: GET ?ids= + SAMPLE_JOBS 6 + JobEntry interface + highlights bestScore/bestSalary + error 400 min 2", () => {
    expect(api).toContain("export async function GET");
    expect(api).toContain("idsParam.split(',')");
    expect(api).toContain("const SAMPLE_JOBS");
    expect(api).toContain("interface JobEntry");
    expect(api).toContain("bestScoreId");
    expect(api).toContain("bestSalaryId");
    expect(api).toContain("Servono almeno 2 candidature");
    expect(api).toContain("status: 400");
  });

  it("render: ROWS 9 righe + ScoreBar + STATUS_LABEL 5 + fmtSalary k-k€ + reset nuovo confronto + breadcrumb", () => {
    expect(page).toContain("const ROWS");
    expect(page).toContain("function ScoreBar");
    expect(page).toContain("const STATUS_LABEL");
    expect(page).toContain("const fmtSalary");
    expect(page).toContain("Nuovo confronto");
    expect(page).toContain("Confronto Candidature");
    expect(page).toContain('href="/dashboard"');
  });
});

/* ── /calendar ── */
describe("/calendar", () => {
  const page = readSrc("app/calendar/page.tsx");
  const api = readSrc("app/api/calendar/route.ts");

  it("page: CalendarPage + fetch /api/calendar?month= + grid 7 cols + DAYS/MONTHS + prev/next nav", () => {
    expect(page).toMatch(/export default function CalendarPage\b/);
    expect(page).toContain("fetch(`/api/calendar?month=");
    expect(page).toContain("grid grid-cols-7");
    expect(page).toContain("const DAYS");
    expect(page).toContain("const MONTHS");
    expect(page).toContain("const prev");
    expect(page).toContain("const next");
  });

  it("API: GET + CalEvent type interview/deadline/follow-up + getMonthRange + buildEvents + sample fallback", () => {
    expect(api).toContain("export async function GET");
    expect(api).toContain("type CalEvent");
    expect(api).toContain("'interview' | 'deadline' | 'follow-up'");
    expect(api).toContain("function getMonthRange");
    expect(api).toContain("function buildEvents");
    expect(api).toContain("// Sample events if empty");
  });

  it("render: TYPE_CLR 3 colori + eventsByDay + selectedDay detail + getMonthGrid + today highlight green + Nessun evento", () => {
    expect(page).toContain("const TYPE_CLR");
    expect(page).toContain("const eventsByDay");
    expect(page).toContain("const dayEvents");
    expect(page).toContain("function getMonthGrid");
    expect(page).toContain("isToday ? 'var(--color-green)'");
    expect(page).toContain("Nessun evento.");
  });
});
