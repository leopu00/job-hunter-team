import { z } from "zod";

import {
  CandidateProfileSchema,
  type CandidateProfile,
} from "./candidate-profile.js";
import type { WriterWorkerInput } from "./prototype-roles.js";

const ExternalText = z.string().trim().min(1).max(10_000);
const ExternalCandidateProfileSchema = z.object({
  target_role: ExternalText,
  location: ExternalText,
  experience_years: z.number().min(0).max(80).optional(),
  skills: z.object({
    primary: z.array(ExternalText).default([]),
    secondary: z.array(ExternalText).default([]),
  }),
  languages: z
    .array(
      z.object({
        language: ExternalText,
        level: ExternalText,
      }),
    )
    .default([]),
  job_titles: z.array(ExternalText).default([]),
  location_preferences: z.array(z.object({ type: ExternalText })).default([]),
  work_authorization: z
    .array(
      z.object({
        region: ExternalText,
        status: ExternalText,
      }),
    )
    .default([]),
  positioning: z
    .object({
      seniority_target: ExternalText.optional(),
      projects: z
        .array(
          z.object({
            name: ExternalText,
            description: ExternalText,
          }),
        )
        .default([]),
      experience: z
        .array(
          z.object({
            role: ExternalText,
            company: ExternalText,
            summary: ExternalText,
          }),
        )
        .default([]),
    })
    .default({ projects: [], experience: [] }),
});

export type ImportedCandidateContext = {
  profile: CandidateProfile;
  writerEvidence: WriterWorkerInput["candidateEvidence"];
};

export function importCandidateProfile2026(
  raw: unknown,
  options: { maxCandidates?: number; postedWithinDays?: number } = {},
): ImportedCandidateContext {
  const source = ExternalCandidateProfileSchema.parse(raw);
  const locationPreferences = source.location_preferences.map(
    (entry) => entry.type,
  );
  const locations = unique([
    ...locationPreferences.flatMap(normalizeLocationPreference),
    bounded(source.location, 160),
  ]).slice(0, 12);
  const workModes = unique(
    locationPreferences.flatMap(workModesFromPreference),
  );
  if (workModes.length === 0) workModes.push("remote");

  const skills = unique([
    ...source.skills.primary,
    ...source.skills.secondary,
  ]).map((value) => bounded(value, 160));
  const profile = CandidateProfileSchema.parse({
    profileVersion: "1",
    targets: {
      roles: unique([source.target_role, ...source.job_titles])
        .map((value) => bounded(value, 160))
        .slice(0, 8),
      locations,
      workModes,
    },
    skills: skills.slice(0, 30),
    experienceYears: source.experience_years,
    languages: source.languages
      .map((entry) => bounded(`${entry.language} ${entry.level}`, 160))
      .slice(0, 12),
    workAuthorization: source.work_authorization
      .map((entry) => bounded(`${entry.region}: ${entry.status}`, 160))
      .slice(0, 20),
    relocation: locationPreferences.some((preference) =>
      /relocat/i.test(preference),
    ),
    search: {
      postedWithinDays: options.postedWithinDays ?? 30,
      maxCandidates: options.maxCandidates ?? 5,
    },
  });

  const experienceHighlights = [
    ...source.positioning.experience.map((entry) =>
      bounded(`${entry.role} — ${entry.company}: ${entry.summary}`, 500),
    ),
    ...source.positioning.projects.map((entry) =>
      bounded(`${entry.name}: ${entry.description}`, 500),
    ),
  ].slice(0, 20);

  return {
    profile,
    writerEvidence: {
      headline: bounded(
        source.positioning.seniority_target
          ? `${source.target_role} — ${source.positioning.seniority_target}`
          : source.target_role,
        500,
      ),
      skills: profile.skills,
      experienceHighlights,
    },
  };
}

function normalizeLocationPreference(value: string): string[] {
  if (/remote\s*\(?eu|eu-wide/i.test(value)) return ["Remote EU"];
  if (/remote\s+world/i.test(value)) return ["Remote Worldwide"];
  if (/relocat/i.test(value)) return [];
  return [bounded(value, 160)];
}

function workModesFromPreference(
  value: string,
): Array<"remote" | "hybrid" | "onsite"> {
  const modes: Array<"remote" | "hybrid" | "onsite"> = [];
  if (/remote/i.test(value)) modes.push("remote");
  if (/hybrid/i.test(value)) modes.push("hybrid");
  if (/on[ -]?site|presen[cz]a/i.test(value)) modes.push("onsite");
  return modes;
}

function unique<T extends string>(values: T[]): T[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = value.trim().toLocaleLowerCase("en-US");
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function bounded(value: string, maximum: number): string {
  return value.trim().slice(0, maximum);
}
