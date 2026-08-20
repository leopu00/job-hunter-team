import { z } from "zod";

import type { ScoutWorkerInput } from "./contract.js";

const ProfileTextSchema = z.string().trim().min(1).max(160);

export const CandidateProfileSchema = z.strictObject({
  profileVersion: z.literal("1"),
  targets: z.strictObject({
    roles: z.array(ProfileTextSchema).min(1).max(8),
    locations: z.array(ProfileTextSchema).min(1).max(12),
    workModes: z
      .array(z.enum(["remote", "hybrid", "onsite"]))
      .min(1)
      .max(3),
  }),
  skills: z.array(ProfileTextSchema).max(30).default([]),
  experienceYears: z.number().min(0).max(80).optional(),
  languages: z.array(ProfileTextSchema).max(12).default([]),
  workAuthorization: z.array(ProfileTextSchema).max(20).default([]),
  relocation: z.boolean().default(false),
  search: z
    .strictObject({
      postedWithinDays: z.number().int().min(1).max(30).default(7),
      maxCandidates: z.number().int().min(1).max(10).default(3),
    })
    .default({ postedWithinDays: 7, maxCandidates: 3 }),
});

export type CandidateProfile = z.infer<typeof CandidateProfileSchema>;

export type SearchLane = {
  targetRole: string;
  location: string;
  workMode: "remote" | "hybrid" | "onsite";
};

export function profileSearchLanes(profile: CandidateProfile): SearchLane[] {
  const lanes: SearchLane[] = [];
  for (const targetRole of profile.targets.roles) {
    for (const location of profile.targets.locations) {
      for (const workMode of profile.targets.workModes) {
        lanes.push({ targetRole, location, workMode });
      }
    }
  }
  return lanes;
}

export function laneKey(lane: SearchLane): string {
  return [lane.targetRole, lane.location, lane.workMode]
    .map((part) => part.trim().toLocaleLowerCase("en-US").replace(/\s+/g, "-"))
    .join(":");
}

export function buildWorkerInput(
  profile: CandidateProfile,
  runId: string,
  limits: ScoutWorkerInput["limits"],
  lane?: SearchLane,
): ScoutWorkerInput {
  return {
    contractVersion: "1",
    runId,
    role: "scout",
    search: {
      targetRoles: lane ? [lane.targetRole] : profile.targets.roles,
      locations: lane ? [lane.location] : profile.targets.locations,
      workModes: lane ? [lane.workMode] : profile.targets.workModes,
      skills: profile.skills,
      postedWithinDays: profile.search.postedWithinDays,
      maxCandidates: profile.search.maxCandidates,
    },
    candidate: {
      experienceYears: profile.experienceYears,
      languages: profile.languages,
      workAuthorization: profile.workAuthorization,
      relocation: profile.relocation,
    },
    limits,
  };
}
