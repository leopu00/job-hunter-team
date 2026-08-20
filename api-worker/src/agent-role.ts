import { z } from "zod";

export const AgentRoleSchema = z.enum([
  "scout",
  "analyst",
  "scorer",
  "writer",
  "critic",
  "assistant",
  "mentor",
  "captain",
  "sentinel",
  "doctor",
  "maintainer",
]);

export type AgentRole = z.infer<typeof AgentRoleSchema>;

export const API_ROLE_ORDER: readonly AgentRole[] = [
  "scout",
  "analyst",
  "scorer",
  "writer",
  "critic",
  "assistant",
  "mentor",
  "captain",
  "sentinel",
  "doctor",
  "maintainer",
] as const;
