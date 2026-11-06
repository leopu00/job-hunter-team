use super::*;

/// The agents the chat may be opened with: the closed list of `agent_chat.py`, which refuses any
/// other name again on its side.
pub(crate) const CHAT_AGENTS: [&str; 8] = [
    "capitano", "assistente", "mentor", "scout", "analista", "scorer", "scrittore", "critico",
];

/// The roles that have several sessions and are also spoken to by instance: `analista-2` is the session
/// ANALISTA-2 and the folder `agents/analista-2` (the launcher's own names). `agent_chat.py` has the same grammar.
pub(super) const NUMBERED_CHAT_ROLES: [&str; 4] = ["scout", "analista", "scorer", "scrittore"];

/// An instance of a numbered role: the role, then a number from 1 to 9999 with no zero in front. Nothing else.
pub(crate) fn chat_instance(agent: &str) -> Option<(&'static str, u16)> {
    let (role, number) = agent.split_once('-')?;
    let role = NUMBERED_CHAT_ROLES.iter().copied().find(|known| *known == role)?;
    if number.is_empty() || number.len() > 4 || number.starts_with('0') || !number.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    Some((role, number.parse().ok()?))
}

/// An id the chat may be opened with: the eight fixed ones, or an instance of a numbered role.
pub(crate) fn chat_agent_ok(agent: &str) -> bool {
    CHAT_AGENTS.contains(&agent) || chat_instance(agent).is_some()
}

/// The tmux session of a chat id («scout» is the first instance, SCOUT-1).
pub(crate) fn chat_session(agent: &str) -> Option<String> {
    let fixed = match agent {
        "capitano" => "CAPITANO",
        "assistente" => "ASSISTENTE",
        "mentor" => "MENTOR",
        "scout" => "SCOUT-1",
        "analista" => "ANALISTA-1",
        "scorer" => "SCORER-1",
        "scrittore" => "SCRITTORE-1",
        "critico" => "CRITICO",
        _ => "",
    };
    if !fixed.is_empty() {
        return Some(fixed.to_owned());
    }
    let (role, number) = chat_instance(agent)?;
    Some(format!("{}-{number}", role.to_ascii_uppercase()))
}

/// A session the chat may write to: the session of an id above, in capitals and nothing else.
pub(crate) fn chat_session_ok(session: &str) -> bool {
    session == session.to_ascii_uppercase() && chat_session(&session.to_ascii_lowercase()).is_some_and(|known| known == session)
}

/// What the app asks of the chat in a pinned container: four operations, each with its few
/// arguments. The user's text is never one of them: it goes on standard input (the words of an
/// answer too, with the options taken).
pub(crate) enum ChatOperation<'a> {
    Read { agent: &'a str, cursor: Option<&'a str> },
    Send { agent: &'a str, client_message_id: &'a str },
    /// The person's answer to one of the agent's questions.
    Answer { agent: &'a str, question_id: &'a str },
    /// Enter pressed once more on a message still in the agent's composer: never the text again.
    Enter { agent: &'a str, message_id: &'a str },
}

impl ChatOperation<'_> {
    /// Answer and Enter came after the first chat actions: a host's wrapper must say it has them.
    pub(crate) fn needs_answer_actions(&self) -> bool {
        matches!(self, ChatOperation::Answer { .. } | ChatOperation::Enter { .. })
    }
}

/// The id of a question as the chat's read gives it (`aq:<agent>:<seconds>-<hex>`): letters,
/// digits, `:`, `_` and `-`, at most 96.
pub(crate) fn chat_question_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 96
        && value.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b':' | b'_' | b'-'))
}

pub(super) fn chat_token(value: &str, max: usize, digits_only: bool) -> bool {
    !value.is_empty()
        && value.len() <= max
        && value.bytes().all(|b| {
            if digits_only {
                b.is_ascii_digit()
            } else {
                b.is_ascii_alphanumeric() || b == b'-'
            }
        })
}

/// The arguments of a chat operation, every one checked against its closed list or alphabet:
/// the operation word, the agent, then the cursor or the client id. Whatever builds a command
/// for the chat takes them from here, so there is one place that says what may enter one.
/// The fixed tokens sent to `agent_chat.py`, validated before they become process arguments.
/// Local and pinned runtimes use this same list, so neither has a wider command surface.
pub(crate) fn chat_arguments(operation: &ChatOperation<'_>) -> Result<Vec<String>, &'static str> {
    match operation {
        ChatOperation::Read { agent, cursor } => {
            if !chat_agent_ok(agent) {
                return Err("invalid_agent");
            }
            let mut arguments = vec!["read".to_owned(), (*agent).to_owned()];
            match cursor {
                None => {}
                Some(cursor) if chat_token(cursor, 12, true) => arguments.push((*cursor).to_owned()),
                Some(_) => return Err("invalid_request"),
            }
            Ok(arguments)
        }
        ChatOperation::Send { agent, client_message_id } => {
            if !chat_agent_ok(agent) {
                return Err("invalid_agent");
            }
            if !chat_token(client_message_id, 64, false) {
                return Err("invalid_request");
            }
            Ok(vec!["send".to_owned(), (*agent).to_owned(), (*client_message_id).to_owned()])
        }
        ChatOperation::Answer { agent, question_id } => {
            if !chat_agent_ok(agent) {
                return Err("invalid_agent");
            }
            if !chat_question_id(question_id) {
                return Err("invalid_request");
            }
            Ok(vec!["answer".to_owned(), (*agent).to_owned(), (*question_id).to_owned()])
        }
        ChatOperation::Enter { agent, message_id } => {
            if !chat_agent_ok(agent) {
                return Err("invalid_agent");
            }
            if !chat_token(message_id, 64, false) {
                return Err("invalid_request");
            }
            Ok(vec!["enter".to_owned(), (*agent).to_owned(), (*message_id).to_owned()])
        }
    }
}

pub(super) fn quoted(arguments: &[String]) -> String {
    arguments
        .iter()
        .enumerate()
        .map(|(index, argument)| if index == 0 { argument.clone() } else { format!("'{argument}'") })
        .collect::<Vec<_>>()
        .join(" ")
}

/// The chat of a pinned team: `agent_chat.py` with fixed arguments, in the verified container
/// (`command` checks container, image, platform and digest first: exit 70 otherwise). Every token
/// is checked before it enters the string, so the string holds nothing the person or the renderer
/// wrote. It replaces `python_command` for the chat: no interpreter that runs what it is sent.
pub(crate) fn chat_command(
    target: &RuntimeTarget,
    operation: &ChatOperation<'_>,
) -> Result<String, &'static str> {
    let arguments = quoted(&chat_arguments(operation)?);
    command(
        target,
        &format!("exec \"$JHT_ENGINE\" exec -i \"$JHT_CID\" python3 -I /app/shared/skills/agent_chat.py {arguments}"),
    )
}

/// The same operation through the host's `jht` wrapper (a local team, a VPS that was never
/// pinned): `desktop-chat read|chat-send|chat-answer|chat-enter ...`. The wrapper runs the same
/// script in the container. An older wrapper answers 2 to an action it does not know: for read
/// and send the caller keeps the older path, answer and enter have none.
pub(crate) fn chat_wrapper_arguments(operation: &ChatOperation<'_>) -> Result<Vec<String>, &'static str> {
    let mut arguments = chat_arguments(operation)?;
    if matches!(arguments[0].as_str(), "send" | "answer" | "enter") {
        arguments[0] = format!("chat-{}", arguments[0]);
    }
    arguments.insert(0, "desktop-chat".to_owned());
    Ok(arguments)
}
