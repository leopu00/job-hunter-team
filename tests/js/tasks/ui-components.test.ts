/** Test vitest componenti UI — JobCard, CompanyCard, InterviewCard, TimelineCard, StatsWidget, KanbanBoard, ApplicationProgress. */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const WEB = path.resolve(__dirname, "../../../web");
function read(rel: string) {
  const raw = fs.readFileSync(path.join(WEB, rel), "utf-8").replace(/\r\n/g, "\n");
  const singleQuoted = raw.replace(/"/g, "'");
  const squashed = singleQuoted.replace(/\s+/g, " ").trim();
  return [raw, singleQuoted, squashed].join("\n/* normalized */\n");
}

describe("JobCard", () => {
  const src = read("components/JobCard.tsx");
  it("export default function + tipi Job, JobCardProps, ApplicationStatus, JobType", () => {
    expect(src).toMatch(/export default function JobCard/);
    expect(src).toContain("export interface Job");
    expect(src).toContain("export interface JobCardProps");
    expect(src).toContain("export type ApplicationStatus");
    expect(src).toContain("export type JobType");
  });
  it("STATUS_CFG copre 7 stati candidatura", () => {
    for (const s of ["not_applied", "applied", "screening", "interview", "offer", "rejected", "withdrawn"])
      expect(src).toContain(s);
  });
  it("TYPE_LABEL copre 5 tipi lavoro", () => {
    for (const t of ["full-time", "part-time", "contract", "remote", "hybrid"])
      expect(src).toContain(t);
  });
  it("fmtSalary gestisce min, max, currency", () => {
    expect(src).toContain("fmtSalary");
    expect(src).toContain("currency");
    expect(src).toContain("/ 1000)");
  });
  it("supporta compact mode e showDescription", () => {
    expect(src).toContain("compact");
    expect(src).toContain("showDescription");
  });
});

describe("CompanyCard", () => {
  const src = read("components/CompanyCard.tsx");
  it("export default function + tipi Company, CompanyCardProps, CompanySize", () => {
    expect(src).toMatch(/export default function CompanyCard/);
    expect(src).toContain("export interface Company");
    expect(src).toContain("export interface CompanyCardProps");
    expect(src).toContain("export type CompanySize");
  });
  it("SIZE_LABEL copre 5 dimensioni azienda", () => {
    for (const s of ["startup", "small", "medium", "large", "enterprise"])
      expect(src).toContain(s);
  });
  it("sub-componenti StarRating e LogoPlaceholder", () => {
    expect(src).toContain("function StarRating");
    expect(src).toContain("function LogoPlaceholder");
  });
});

describe("InterviewCard", () => {
  const src = read("components/InterviewCard.tsx");
  it("export default function + tipi Interview, InterviewCardProps", () => {
    expect(src).toMatch(/export default function InterviewCard/);
    expect(src).toContain("export interface Interview");
    expect(src).toContain("export interface InterviewCardProps");
  });
  it("TYPE_CFG copre phone/video/onsite/technical/hr", () => {
    for (const t of ["phone", "video", "onsite", "technical", "hr"])
      expect(src).toContain(t);
  });
  it("STATUS_CFG copre scheduled/completed/cancelled/rescheduled", () => {
    for (const s of ["scheduled", "completed", "cancelled", "rescheduled"])
      expect(src).toContain(s);
  });
  it("countdown calcola giorni/ore/minuti + stati urgenti", () => {
    expect(src).toContain("function countdown");
    expect(src).toContain("oggi");
    expect(src).toContain("domani");
    expect(src).toContain("urgent");
  });
});

describe("ApplicationProgress", () => {
  const src = read("components/ApplicationProgress.tsx");
  it("export default function + tipo ApplicationStep", () => {
    expect(src).toMatch(/export default function ApplicationProgress/);
    expect(src).toContain("export type ApplicationStep");
    expect(src).toContain("export interface ApplicationProgressProps");
  });
  it("MAIN_STEPS ha 5 step in ordine corretto", () => {
    const m = src.match(/MAIN_STEPS[^=]*=\s*\[([^\]]+)\]/);
    expect(m).toBeTruthy();
    const steps = m![1].match(/'(\w+)'/g)!.map(s => s.replace(/'/g, ""));
    expect(steps).toEqual(["saved", "applied", "screening", "interview", "offer"]);
  });
  it("STEP_LABEL copre tutti gli stati inclusi terminali rejected/withdrawn", () => {
    for (const s of ["saved", "applied", "screening", "interview", "offer", "rejected", "withdrawn"])
      expect(src).toContain(s);
  });
});

describe("StatsWidget", () => {
  const src = read("app/components/StatsWidget.tsx");
  it("'use client', export StatsWidget + StatsWidgetProps", () => {
    expect(src).toContain("use client");
    expect(src).toMatch(/export function StatsWidget/);
    expect(src).toContain("export type StatsWidgetProps");
  });
  it("sub-componenti Sparkline e TrendBadge", () => {
    expect(src).toContain("function Sparkline");
    expect(src).toContain("function TrendBadge");
  });
  it("supporta 3 taglie sm/md/lg", () => {
    for (const s of ["sm", "md", "lg"]) expect(src).toContain(`'${s}'`);
  });
});

describe("KanbanBoard", () => {
  const src = read("app/components/KanbanBoard.tsx");
  it("'use client', export KanbanBoard + DEFAULT_KANBAN_COLUMNS + tipi", () => {
    expect(src).toContain("use client");
    expect(src).toMatch(/export function KanbanBoard/);
    expect(src).toContain("export const DEFAULT_KANBAN_COLUMNS");
    expect(src).toContain("export type KanbanCard");
    expect(src).toContain("export type KanbanColumn");
  });
  it("5 colonne default: saved, applied, interview, offer, rejected", () => {
    for (const id of ["saved", "applied", "interview", "offer", "rejected"])
      expect(src).toContain(`id: '${id}'`);
  });
  it("drag-and-drop: handleDragStart, handleDrop, onDragOver", () => {
    expect(src).toContain("handleDragStart");
    expect(src).toContain("handleDrop");
    expect(src).toContain("onDragOver");
    expect(src).toContain("draggable");
  });
});

describe("TimelineCard", () => {
  const src = read("app/components/TimelineCard.tsx");
  it("'use client', export Timeline + TimelineCard", () => {
    expect(src).toContain("use client");
    expect(src).toMatch(/export function Timeline/);
    expect(src).toMatch(/export function TimelineCard/);
    expect(src).toContain("export type TimelineEvent");
  });
  it("TYPE_CFG copre 8 tipi evento", () => {
    for (const t of ["application_sent", "interview_scheduled", "offer_received", "rejected", "follow_up", "note", "viewed", "custom"])
      expect(src).toContain(t);
  });
  it("gestisce lista eventi vuota con messaggio", () => {
    expect(src).toContain("Nessun evento");
  });
});
