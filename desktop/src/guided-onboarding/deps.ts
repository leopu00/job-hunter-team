/**
 * Where the guided onboarding takes the pieces other people write: the profile card (profile-progress), the
 * team start read (lib/team-start) and the portrait (components/assistant-portrait). Until they are in
 * master-arthur these are the stand-ins in ./stubs, with the types of their contracts; when each arrives, only
 * its line here changes.
 */
export { ProfileProgressCard, useProfileProgress } from "./stubs/profile-progress";
export type { ProfileProgress, ProfileProgressField } from "./stubs/profile-progress";
export { readTeamStart } from "./stubs/team-start";
export type { TeamStart } from "./stubs/team-start";
export { AssistantPortrait } from "./stubs/assistant-portrait";
