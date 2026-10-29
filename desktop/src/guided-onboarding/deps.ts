/**
 * Where the guided onboarding takes the pieces other people write: the profile card (profile-progress), the
 * team start read (lib/team-start) and the portrait (components/assistant-portrait). Its one import point: a
 * test replaces what it needs here.
 */
export { ProfileProgressCard } from "../profile-progress/ProfileProgressCard";
export { useProfileProgress } from "../profile-progress/useProfileProgress";
export type { ProfileProgress, ProfileProgressField } from "../profile-progress/contract";
export { readTeamStart } from "../lib/team-start";
export type { TeamStart } from "../lib/team-start";
export { AssistantPortrait } from "../components/assistant-portrait";
