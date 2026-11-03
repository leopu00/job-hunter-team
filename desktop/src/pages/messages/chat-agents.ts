/**
 * Who the chat can talk to. An id is one of the eight fixed ones (the roles with one session, and the bare
 * «scout», «analista», «scorer», «scrittore» for the first instance, as the app has always said them), or an
 * instance of a numbered role: `analista-2` is the session ANALISTA-2, with its own conversation. The same closed
 * grammar as agent_chat.py (NUMBERED_AGENT) and the native side (existing_team_runtime.rs): an id outside it never
 * leaves the page.
 */

export const FIXED_CHAT_AGENTS = ["capitano", "assistente", "mentor", "scout", "analista", "scorer", "scrittore", "critico"] as const;
export type FixedChatAgent = (typeof FIXED_CHAT_AGENTS)[number];

export const NUMBERED_ROLES = ["scout", "analista", "scorer", "scrittore"] as const;
export type NumberedRole = (typeof NUMBERED_ROLES)[number];

const INSTANCE_ID = /^(scout|analista|scorer|scrittore)-([1-9][0-9]{0,3})$/;
const INSTANCE_SESSION = /^(SCOUT|ANALISTA|SCORER|SCRITTORE)-([1-9][0-9]{0,3})$/;

/** An id the chat may be opened with. */
export function isChatAgentId(value: string | null | undefined): value is string {
  return typeof value === "string" && ((FIXED_CHAT_AGENTS as readonly string[]).includes(value) || INSTANCE_ID.test(value));
}

/** The role of an id, and its instance number when it names one («analista-2» → analista, 2; «scout» → scout, 1). */
export function roleOfChatId(id: string): { role: string; instance: number | null } {
  const found = INSTANCE_ID.exec(id);
  return found ? { role: found[1], instance: Number(found[2]) } : { role: id, instance: (NUMBERED_ROLES as readonly string[]).includes(id) ? 1 : null };
}

/**
 * The id of the chat that speaks with exactly this session, or null (the Doctor, a reviewer: no chat). The first
 * instance of a numbered role keeps its bare id, which every team's image knows; the others are named by number.
 */
export function chatIdOfSession(session: string): string | null {
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
    default: {
      const found = INSTANCE_SESSION.exec(session);
      return found ? `${found[1].toLowerCase()}-${found[2]}` : null;
    }
  }
}

/** The tmux session an id speaks with. */
export function sessionOfChatId(id: string): string | null {
  const found = INSTANCE_ID.exec(id);
  if (found) return `${found[1].toUpperCase()}-${found[2]}`;
  if (!isChatAgentId(id)) return null;
  return (NUMBERED_ROLES as readonly string[]).includes(id) ? `${id.toUpperCase()}-1` : id.toUpperCase();
}

/** What the page knows of one session of the team: whether it is up, and the state it shows. */
export type ChatSession = { session: string; up: boolean };

export type Conversation = {
  /** the id the chat reads and writes with */
  id: string;
  session: string;
  /** the name shown: «Capitano», «Analista 2» (the number only where the role has more than one) */
  label: string;
  up: boolean;
};

/**
 * The conversations of the list: the roles with one session always (there is a history to read even when the agent
 * is off), and of each numbered role every instance that is up, or the first one off when none is. Without a list of
 * sessions (an older shell, a team not read yet) it is the eight fixed ones, as it has always been.
 */
export function conversationsOf(
  sessions: readonly ChatSession[] | null,
  roleNames: Readonly<Record<string, string>>,
): Conversation[] {
  const name = (role: string) => roleNames[role] ?? role.charAt(0).toUpperCase() + role.slice(1);
  const out: Conversation[] = [];
  const upByRole = new Map<string, number[]>();
  for (const { session, up } of sessions ?? []) {
    const found = INSTANCE_SESSION.exec(session);
    if (found && up) upByRole.set(found[1].toLowerCase(), [...(upByRole.get(found[1].toLowerCase()) ?? []), Number(found[2])]);
  }
  const isUp = (session: string) => sessions === null || sessions.some((s) => s.session === session && s.up);
  for (const id of FIXED_CHAT_AGENTS) {
    if (!(NUMBERED_ROLES as readonly string[]).includes(id)) {
      out.push({ id, session: id.toUpperCase(), label: name(id), up: isUp(id.toUpperCase()) });
      continue;
    }
    const numbers = [...new Set(upByRole.get(id) ?? [])].sort((a, b) => a - b);
    if (sessions === null || numbers.length === 0) {
      out.push({ id, session: `${id.toUpperCase()}-1`, label: name(id), up: sessions === null });
      continue;
    }
    for (const number of numbers) {
      const session = `${id.toUpperCase()}-${number}`;
      out.push({
        id: chatIdOfSession(session)!,
        session,
        label: numbers.length > 1 ? `${name(id)} ${number}` : name(id),
        up: true,
      });
    }
  }
  return out;
}
