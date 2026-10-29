/**
 * Where the guided onboarding takes the pieces other people write: the profile card (profile-progress), the
 * team start read (lib/team-start) and the portrait (components/assistant-portrait). The profile card is the real one; the other two are, until they are in
 * master-arthur, the stand-ins in ./stubs, with the types of their contracts; when each arrives, only
 * its line here changes.
 */
export { ProfileProgressCard } from "../profile-progress/ProfileProgressCard";
export { useProfileProgress } from "../profile-progress/useProfileProgress";
export type { ProfileProgress, ProfileProgressField } from "../profile-progress/contract";
export { readTeamStart } from "./stubs/team-start";
export type { TeamStart } from "./stubs/team-start";
export { AssistantPortrait } from "./stubs/assistant-portrait";
