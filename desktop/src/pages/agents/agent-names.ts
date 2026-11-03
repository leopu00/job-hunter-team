import type { DirectChatAgentId } from "../messages/DirectChatScreen";

/** A tmux session of the team: the closed grammar the native side lets through (agent_control.py NAME). */
export const SESSION_NAME = /^[A-Z][A-Z0-9-]{0,39}$/;

/**
 * The agent's name as the person reads it: «Analista 2», «Critico S3», «Capitano». The role is written in the
 * app's language where the chat has a word for it; any other role (the Doctor, the Maintainer…) is its own name,
 * capitalised.
 */
export function agentTitle(session: string, roleNames: Partial<Record<string, string>>): string {
  const [role, ...rest] = session.toLowerCase().split("-");
  const word = roleNames[role] ?? role.charAt(0).toUpperCase() + role.slice(1);
  return [word, ...rest.map((part) => part.toUpperCase())].join(" ");
}

/**
 * The chat's id of this exact session, or null: the chat speaks with the roles that have one session
 * («capitano») and with the first of those that have several («scout» is SCOUT-1). SCOUT-2 is not it, and
 * a button «Write to Scout» on it would write to the other one.
 */
export function chatIdOfSession(session: string): DirectChatAgentId | null {
  switch (session) {
    case "CAPITANO":
      return "capitano";
    case "ASSISTENTE":
      return "assistente";
    case "MENTOR":
      return "mentor";
    case "CRITICO":
      return "critico";
    case "SCOUT-1":
      return "scout";
    case "ANALISTA-1":
      return "analista";
    case "SCORER-1":
      return "scorer";
    case "SCRITTORE-1":
      return "scrittore";
    default:
      return null;
  }
}
