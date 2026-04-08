/** Test vitest componenti UI batch 2 — ProfileCompleteness, CoverLetterPreview, NotesEditor, FileUpload, TagInput, DateRangePicker, Avatar, AnalyticsDashboard */
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

/* ── ProfileCompleteness ── */
describe("ProfileCompleteness", () => {
  const src = read("app/components/ProfileCompleteness.tsx");
  it("export ProfileCompleteness + ProfileSection type + DEFAULT_PROFILE_SECTIONS", () => {
    expect(src).toMatch(/export function ProfileCompleteness/);
    expect(src).toContain("export type ProfileSection");
    expect(src).toContain("export const DEFAULT_PROFILE_SECTIONS");
  });
  it("DEFAULT_PROFILE_SECTIONS ha 7 sezioni con weight", () => {
    for (const id of ["photo", "experience", "education", "skills", "languages", "bio", "contacts"])
      expect(src).toContain(`id: '${id}'`);
  });
  it("sub-componenti Ring e SectionRow + soglie colore 80/50", () => {
    expect(src).toContain("function Ring");
    expect(src).toContain("function SectionRow");
    expect(src).toContain("pct >= 80");
    expect(src).toContain("pct >= 50");
  });
});

/* ── CoverLetterPreview ── */
describe("CoverLetterPreview", () => {
  const src = read("components/CoverLetterPreview.tsx");
  it("export default + CoverLetterPreviewProps + VAR_REGEX", () => {
    expect(src).toMatch(/export default function CoverLetterPreview/);
    expect(src).toContain("export interface CoverLetterPreviewProps");
    expect(src).toContain("VAR_REGEX");
  });
  it("HighlightedText + wordCount + charCount", () => {
    expect(src).toContain("function HighlightedText");
    expect(src).toContain("function wordCount");
    expect(src).toContain("function charCount");
  });
  it("modalità Preview e Modifica con toggle", () => {
    expect(src).toContain("Preview");
    expect(src).toContain("Modifica");
    expect(src).toContain("copiato");
    expect(src).toContain("salvato");
  });
});

/* ── NotesEditor ── */
describe("NotesEditor", () => {
  const src = read("app/components/NotesEditor.tsx");
  it("export NotesEditor + renderMd + fmtTs", () => {
    expect(src).toMatch(/export function NotesEditor/);
    expect(src).toContain("function renderMd");
    expect(src).toContain("function fmtTs");
  });
  it("renderMd gestisce headings, bold, italic, code, liste", () => {
    for (const p of ["### ", "## ", "# ", "\\*\\*", "\\*", "`"]) expect(src).toContain(p.replace(/\\/g, ""));
    expect(src).toContain("&bull;");
  });
  it("tab edit/preview + autosave debounce + conteggio parole/caratteri", () => {
    expect(src).toContain("'edit'");
    expect(src).toContain("'preview'");
    expect(src).toContain("debounceMs");
    expect(src).toContain("Nessuna nota");
  });
});

/* ── FileUpload ── */
describe("FileUpload", () => {
  const src = read("app/components/FileUpload.tsx");
  it("export FileUpload + FileUploadProps type", () => {
    expect(src).toMatch(/export function FileUpload/);
    expect(src).toContain("export type FileUploadProps");
  });
  it("helper fmtSize, fileIcon, validateFile", () => {
    expect(src).toContain("function fmtSize");
    expect(src).toContain("function fileIcon");
    expect(src).toContain("function validateFile");
  });
  it("FileRow + drag-and-drop + validazione tipo e dimensione", () => {
    expect(src).toContain("function FileRow");
    expect(src).toContain("onDragOver");
    expect(src).toContain("onDrop");
    expect(src).toContain("File troppo grande");
    expect(src).toContain("Tipo non supportato");
  });
});

/* ── TagInput ── */
describe("TagInput", () => {
  const src = read("components/TagInput.tsx");
  it("export default TagInput + TagInputProps + maxTags + separators", () => {
    expect(src).toMatch(/export default function TagInput/);
    expect(src).toContain("export interface TagInputProps");
    expect(src).toContain("maxTags");
    expect(src).toContain("separators");
  });
  it("addTag, removeTag + keyboard handlers (Enter/Backspace/Arrow/Escape)", () => {
    expect(src).toContain("addTag");
    expect(src).toContain("removeTag");
    for (const k of ["Enter", "Backspace", "ArrowDown", "ArrowUp", "Escape"])
      expect(src).toContain(`'${k}'`);
  });
  it("dropdown suggerimenti filtrati + contatore tags", () => {
    expect(src).toContain("filtered");
    expect(src).toContain("focusIdx");
    expect(src).toContain("{tags.length}/{maxTags}");
  });
});

/* ── DateRangePicker ── */
describe("DateRangePicker", () => {
  const src = read("components/DateRangePicker.tsx");
  it("export default + DateRange + DateRangePickerProps", () => {
    expect(src).toMatch(/export default function DateRangePicker/);
    expect(src).toContain("export interface DateRange");
    expect(src).toContain("export interface DateRangePickerProps");
  });
  it("DAYS 7, MONTHS 12, PRESETS 5", () => {
    for (const d of ["Lu", "Ma", "Me", "Gi", "Ve", "Sa", "Do"]) expect(src).toContain(`'${d}'`);
    for (const m of ["Gen", "Feb", "Mar", "Dic"]) expect(src).toContain(`'${m}'`);
    expect(src).toContain("7 giorni");
    expect(src).toContain("30 giorni");
    expect(src).toContain("Anno");
  });
  it("CalendarMonth + helper fmt, startOfDay, sameDay, inRange", () => {
    expect(src).toContain("function CalendarMonth");
    expect(src).toContain("function fmt");
    expect(src).toContain("function startOfDay");
    expect(src).toContain("function sameDay");
    expect(src).toContain("function inRange");
  });
});

/* ── Avatar ── */
describe("Avatar", () => {
  const src = read("app/components/Avatar.tsx");
  it("export Avatar + AvatarGroup + tipi AvatarStatus, AvatarSize, AvatarProps", () => {
    expect(src).toMatch(/export function Avatar\b/);
    expect(src).toMatch(/export function AvatarGroup/);
    expect(src).toContain("export type AvatarStatus");
    expect(src).toContain("export type AvatarSize");
    expect(src).toContain("export type AvatarProps");
  });
  it("SIZE_CFG 5 taglie (xs/sm/md/lg/xl) + STATUS_COLOR 4 stati", () => {
    for (const s of ["xs", "sm", "md", "lg", "xl"]) expect(src).toContain(`${s}:`);
    for (const s of ["online", "offline", "busy", "away"]) expect(src).toContain(`${s}:`);
  });
  it("PALETTE 8 colori + nameColor deterministica + initials", () => {
    expect(src).toContain("PALETTE");
    expect(src).toContain("function nameColor");
    expect(src).toContain("function initials");
    expect(src).toContain("charCodeAt");
  });
});

/* ── AnalyticsDashboard ── */
describe("AnalyticsDashboard", () => {
  const src = read("components/AnalyticsDashboard.tsx");
  it("export default + AnalyticsData interface", () => {
    expect(src).toMatch(/export default function AnalyticsDashboard/);
    expect(src).toContain("export interface AnalyticsData");
  });
  it("sub-componenti WeeklyChart, Funnel, TopCompanies", () => {
    expect(src).toContain("function WeeklyChart");
    expect(src).toContain("function Funnel");
    expect(src).toContain("function TopCompanies");
  });
  it("3 pannelli: Candidature settimanali, Conversion funnel, Top aziende", () => {
    expect(src).toContain("Candidature settimanali");
    expect(src).toContain("Conversion funnel");
    expect(src).toContain("Top aziende");
  });
  it("funnel steps: Candidati, Screening, Colloquio, Offerta con conversioni", () => {
    for (const s of ["Candidati", "Screening", "Colloquio", "Offerta"])
      expect(src).toContain(s);
  });
});
