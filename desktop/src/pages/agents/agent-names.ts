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

export { chatIdOfSession } from "../messages/chat-agents";
