import type {
  Application,
  Company,
  Position,
  PositionHighlight,
  PositionTicket,
  PositionWithScore,
  Score,
} from "../../../web/lib/types";
import type { PositionDetail, PositionFacet } from "../../../web/lib/queries";

export const syntheticPosition = {
  id: "101",
  legacy_id: 101,
  title: "Synthetic role A",
  company: "Synthetic Co A",
  company_id: "201",
  location: "Alpha, AA",
  remote_type: "full_remote",
  salary_declared_min: null,
  salary_declared_max: null,
  salary_declared_currency: null,
  salary_estimated_min: 90000,
  salary_estimated_max: 110000,
  salary_estimated_currency: "XXX",
  salary_estimated_source: "synthetic",
  url: "https://invalid.example/synthetic-a",
  source: "synthetic",
  jd_text: null,
  jd_summary: "Synthetic summary A",
  requirements: null,
  found_by: "synthetic",
  found_at: "2026-01-02T03:04:05Z",
  deadline: null,
  status: "scored",
  notes: null,
  last_checked: null,
  role_family: "Data",
  loc_country: "AA",
  loc_city: "Alpha",
  score: 91,
  critic_score: 8,
  critic_verdict: "PASS",
  written_at: "2026-01-03T00:00:00Z",
  applied_at: null,
} satisfies PositionWithScore;

const score = {
  id: "301",
  position_id: "101",
  total_score: 91,
  stack_match: 90,
  remote_fit: 95,
  salary_fit: 88,
  experience_fit: 92,
  strategic_fit: 89,
  breakdown: "synthetic",
  notes: null,
  scored_by: "synthetic",
  scored_at: "2026-01-02T04:00:00Z",
} satisfies Score;

const highlight = {
  id: "401",
  position_id: "101",
  type: "pro",
  text: "Synthetic highlight A",
} satisfies PositionHighlight;

const company = {
  id: "201",
  name: "Synthetic Co A",
  website: null,
  hq: null,
  sector: "synthetic",
  size: null,
  glassdoor_rating: null,
  red_flags: null,
  culture_notes: null,
  analyzed_by: "synthetic",
  analyzed_at: "2026-01-02T04:01:00Z",
  verdict: "GO",
  logo: null,
} satisfies Company;

const application = {
  id: "501",
  position_id: "101",
  cv_path: null,
  cl_path: null,
  cv_pdf_path: null,
  cl_pdf_path: null,
  cv_drive_id: null,
  cl_drive_id: null,
  critic_verdict: "PASS",
  critic_score: 8,
  critic_notes: null,
  status: "ready",
  written_at: "2026-01-03T00:00:00Z",
  applied_at: null,
  applied_via: null,
  response: null,
  response_at: null,
  written_by: "synthetic",
  reviewed_by: "synthetic",
  applied: false,
  interview_round: null,
} satisfies Application;

const ticket = {
  id: "601",
  position_id: "101",
  request_text: "Synthetic ticket",
  kind: "custom",
  status: "open",
  assigned_agent: null,
  response_text: null,
  created_at: "2026-01-03T01:00:00Z",
  resolved_at: null,
} satisfies PositionTicket;

const {
  score: _listScore,
  critic_score: _listCriticScore,
  critic_verdict: _listCriticVerdict,
  written_at: _listWrittenAt,
  applied_at: _listAppliedAt,
  ...detailPosition
} = syntheticPosition;
void [_listScore, _listCriticScore, _listCriticVerdict, _listWrittenAt, _listAppliedAt];
const typedDetailPosition = detailPosition satisfies Position;

export const syntheticDetail = {
  position: typedDetailPosition,
  score,
  highlights: [highlight],
  company,
  application,
  tickets: [ticket],
  userNote: null,
  exclusionEventAt: null,
} satisfies PositionDetail;

export const syntheticFacets = [
  {
    id: "101",
    status: "scored",
    title: "Synthetic role A",
    company: "Synthetic Co A",
    role_family: "Data",
    score: 91,
    critic_score: 8,
    loc_country: "AA",
    loc_city: "Alpha",
  },
  {
    id: "102",
    status: "review",
    title: "Synthetic role B",
    company: "Synthetic Co B",
    role_family: "Platform",
    score: 64,
    critic_score: 5,
    loc_country: "BB",
    loc_city: "Beta",
  },
] satisfies PositionFacet[];
