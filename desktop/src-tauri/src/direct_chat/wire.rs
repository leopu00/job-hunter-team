use super::*;

pub(super) const CHAT_SYSTEM_CODES: [&str; 2] = ["mail_not_taken", "message_too_long"];

pub(super) fn closed_code<'de, D>(deserializer: D) -> Result<Option<String>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    // Anything that is not one of the closed codes (a number, a name every object has) is no code.
    let raw = Option::<Value>::deserialize(deserializer)?;
    Ok(match raw {
        Some(Value::String(code)) if CHAT_SYSTEM_CODES.contains(&code.as_str()) => Some(code),
        _ => None,
    })
}

/// The kinds an agent may give a message. `question` belongs to the questions only.
pub(super) const MESSAGE_KINDS: [&str; 4] = ["urgent", "blocked", "completed", "info"];
/// The kinds of a question: the kinds of a message, and `question`.
pub(super) const QUESTION_KINDS: [&str; 5] = ["urgent", "blocked", "question", "completed", "info"];
pub(super) const QUESTION_STATES: [&str; 3] = ["open", "answered", "expired"];
/// Who gave an answer: the person, the question's safe option when nobody answered in time, or the system
/// closing a question that has no object any more (the plan was declared another way).
/// Any other origin the team writes is `unknown`, and never said as the person's.
pub(super) const ANSWER_ORIGINS: [&str; 3] = ["user", "expiry", "system"];
pub(super) const MAX_SUBJECT_CHARS: usize = 200;
pub(super) const MAX_QUESTION_CHARS: usize = 4000;
pub(super) const MAX_LABEL_CHARS: usize = 200;
pub(super) const MAX_ANSWER_CHARS: usize = 2000;
pub(super) const MAX_OPTIONS: usize = 8;
pub(super) const MAX_QUESTIONS: usize = 50;

pub(super) fn string_in<'a>(value: Option<&'a Value>, list: &[&str]) -> Option<&'a str> {
    value.and_then(Value::as_str).filter(|v| list.contains(v))
}

/// A closed code of the team's: lower-case letters, digits, `_` and `-`, at most 64. The page says
/// only the codes its catalog has; this keeps anything else (a sentence, markup) from reaching it.
pub(super) fn closed_token(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 64
        && value.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || matches!(b, b'_' | b'-'))
}

/// The id of an option: the same alphabet as a closed code, at most 32.
pub(super) fn option_id(value: &str) -> bool {
    closed_token(value) && value.len() <= 32
}

/// A time in seconds since the epoch, as the chat's read gives every time.
pub(super) fn seconds(value: Option<&Value>) -> Option<f64> {
    value.and_then(Value::as_f64).filter(|v| v.is_finite() && *v >= 0.0)
}

pub(super) fn short_text(value: Option<&Value>, max: usize) -> Option<String> {
    value.and_then(Value::as_str).filter(|v| v.chars().count() <= max).map(str::to_owned)
}

pub(super) fn message_kind<'de, D>(deserializer: D) -> Result<Option<String>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    // Outside the list (an older image, a typo, `question`) the row has no kind: the page shows it as info.
    let raw = Option::<Value>::deserialize(deserializer)?;
    Ok(string_in(raw.as_ref(), &MESSAGE_KINDS).map(str::to_owned))
}

pub(super) const MAX_SUGGESTIONS: usize = 5;
pub(super) const MAX_SUGGESTION_CHARS: usize = 240;

pub(super) fn suggestions<'de, D>(deserializer: D) -> Result<Option<Vec<String>>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    // The replies an agent suggests to its message: one line each, at most 5, and a list only from two
    // up (one is no choice). Anything out of that shape is left out.
    let raw = Option::<Value>::deserialize(deserializer)?;
    let Some(Value::Array(items)) = raw else { return Ok(None) };
    let labels: Vec<String> = items
        .iter()
        .take(MAX_SUGGESTIONS)
        .filter_map(Value::as_str)
        .filter(|l| !l.trim().is_empty() && l.chars().count() <= MAX_SUGGESTION_CHARS && !l.contains(['\n', '\r']))
        .map(str::to_owned)
        .collect();
    Ok((labels.len() >= 2).then_some(labels))
}

pub(super) fn taken_flag<'de, D>(deserializer: D) -> Result<Option<Option<bool>>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    // Present: true, false, or null for «not known». Anything else is «not known» too, never «taken».
    let raw = Value::deserialize(deserializer)?;
    Ok(Some(raw.as_bool()))
}

/// Why the team does not know whether the agent's CLI took a text: what it saw in the terminal.
/// `unconfirmed`: the text went, and nothing on the screen proved it was taken.
pub(super) const TAKEN_REASONS: [&str; 8] = ["menu", "permission", "login", "busy", "not_ours", "empty_unseen", "unreadable", "unconfirmed"];

pub(super) fn closed_reason<'de, D>(deserializer: D) -> Result<Option<String>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let raw = Option::<Value>::deserialize(deserializer)?;
    Ok(string_in(raw.as_ref(), &TAKEN_REASONS).map(str::to_owned))
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DirectChatMessage {
    pub(super) id: String,
    pub(super) role: String,
    pub(super) text: String,
    pub(super) at: f64,
    /// A closed code on a system line (`mail_not_taken`): the page says it in the person's language.
    /// Only a code of the closed list passes; anything else is dropped here, whatever the host wrote.
    #[serde(default, deserialize_with = "closed_code", skip_serializing_if = "Option::is_none")]
    pub(super) code: Option<String>,
    /// The kind the agent gave the message, on the agent's rows only; outside the list, none.
    #[serde(default, deserialize_with = "message_kind", skip_serializing_if = "Option::is_none")]
    pub(super) kind: Option<String>,
    /// The replies the agent suggests, on its rows only: the page offers them as buttons.
    #[serde(default, deserialize_with = "suggestions", skip_serializing_if = "Option::is_none")]
    pub(super) suggestions: Option<Vec<String>>,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
pub(crate) struct DirectChatOption {
    pub(super) id: String,
    pub(super) label: String,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DirectChatAnswer {
    pub(super) choices: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) text: Option<String>,
    pub(super) at: f64,
    pub(super) origin: &'static str,
    /// When the agent's tool took the answer; null until then.
    pub(super) seen_at: Option<f64>,
}

/// One of the agent's questions, as the page shows it. Built field by field from what the host
/// wrote: a question with one field out of its shape is left out whole, never half shown.
#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DirectChatQuestion {
    pub(super) id: String,
    pub(super) at: f64,
    pub(super) kind: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) subject: Option<String>,
    pub(super) text: String,
    pub(super) options: Vec<DirectChatOption>,
    pub(super) multiple: bool,
    pub(super) free: bool,
    pub(super) expires_at: Option<f64>,
    pub(super) state: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) answer: Option<DirectChatAnswer>,
}

pub(super) fn closed_static(value: Option<&Value>, list: &[&'static str]) -> Option<&'static str> {
    let value = value.and_then(Value::as_str)?;
    list.iter().copied().find(|item| *item == value)
}

impl DirectChatQuestion {
    pub(super) fn from_value(value: &Value) -> Option<Self> {
        let id = value.get("id").and_then(Value::as_str).filter(|v| existing_team_runtime::chat_question_id(v))?;
        let options = value.get("options").and_then(Value::as_array)?;
        if options.len() > MAX_OPTIONS {
            return None;
        }
        let mut seen = Vec::with_capacity(options.len());
        for option in options {
            let option_key = option.get("id").and_then(Value::as_str).filter(|v| option_id(v))?;
            let label = short_text(option.get("label"), MAX_LABEL_CHARS)?;
            if seen.iter().any(|o: &DirectChatOption| o.id == option_key) {
                return None;
            }
            seen.push(DirectChatOption { id: option_key.to_owned(), label });
        }
        let state = closed_static(value.get("state"), &QUESTION_STATES)?;
        let answer = match value.get("answer") {
            None | Some(Value::Null) => None,
            Some(answer) => Some(DirectChatAnswer::from_value(answer, &seen)?),
        };
        Some(DirectChatQuestion {
            id: id.to_owned(),
            at: seconds(value.get("at"))?,
            // A kind outside the list is a question that still waits for its answer: shown plain.
            kind: closed_static(value.get("kind"), &QUESTION_KINDS).unwrap_or("question"),
            subject: short_text(value.get("subject"), MAX_SUBJECT_CHARS),
            text: short_text(value.get("text"), MAX_QUESTION_CHARS)?,
            options: seen,
            multiple: value.get("multiple").and_then(Value::as_bool).unwrap_or(false),
            free: value.get("free").and_then(Value::as_bool).unwrap_or(false),
            expires_at: seconds(value.get("expiresAt")),
            state,
            answer,
        })
    }
}

impl DirectChatAnswer {
    pub(super) fn from_value(value: &Value, options: &[DirectChatOption]) -> Option<Self> {
        let choices = value.get("choices").and_then(Value::as_array)?;
        let mut taken = Vec::with_capacity(choices.len());
        for choice in choices {
            let choice = choice.as_str().filter(|c| options.iter().any(|o| o.id == *c))?;
            taken.push(choice.to_owned());
        }
        Some(DirectChatAnswer {
            choices: taken,
            text: short_text(value.get("text"), MAX_ANSWER_CHARS),
            at: seconds(value.get("at"))?,
            origin: closed_static(value.get("origin"), &ANSWER_ORIGINS).unwrap_or("unknown"),
            seen_at: seconds(value.get("seenAt")),
        })
    }
}

/// How many queued message ids a page may carry, and how long one may be.
pub(super) const MAX_QUEUED_IDS: usize = 64;
pub(super) const MAX_QUEUED_ID_LEN: usize = 128;

pub(super) fn queued_ids<'de, D>(deserializer: D) -> Result<Option<Vec<String>>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    // Absent (an older image, or a chat that never queued): none. A list: the ids of the turns still
    // held back, each a short plain word; anything else in it is left out.
    let raw = Option::<Value>::deserialize(deserializer)?;
    Ok(match raw {
        Some(Value::Array(items)) => Some(
            items
                .iter()
                .filter_map(Value::as_str)
                .filter(|id| !id.is_empty() && id.len() <= MAX_QUEUED_ID_LEN && id.chars().all(|c| c.is_ascii_alphanumeric() || "-_.:".contains(c)))
                .take(MAX_QUEUED_IDS)
                .map(str::to_owned)
                .collect(),
        ),
        _ => None,
    })
}

/// How a queued turn ended, as the team says it: typed and taken, typed and still in the composer,
/// typed with no proof, typed and given its Enter after the time (`late`), or never typed because it waited too long.
pub(super) const QUEUE_ENDINGS: [&str; 5] = ["taken", "pending", "late", "unconfirmed", "expired"];

#[derive(Clone, Debug, Serialize, PartialEq)]
pub(crate) struct DirectChatQueueEnding {
    pub(super) id: String,
    pub(super) how: String,
}

pub(super) fn queue_endings<'de, D>(deserializer: D) -> Result<Option<Vec<DirectChatQueueEnding>>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    // Absent (an older image, or a chat that never queued): none. A list: the endings in their shape,
    // each id a short plain word and each `how` of the closed list; the others are left out.
    let raw = Option::<Value>::deserialize(deserializer)?;
    Ok(match raw {
        Some(Value::Array(items)) => Some(
            items
                .iter()
                .filter_map(|item| {
                    let id = item.get("id")?.as_str()?;
                    let how = string_in(item.get("how"), &QUEUE_ENDINGS)?;
                    let plain = !id.is_empty() && id.len() <= MAX_QUEUED_ID_LEN && id.chars().all(|c| c.is_ascii_alphanumeric() || "-_.:".contains(c));
                    plain.then(|| DirectChatQueueEnding { id: id.to_owned(), how: how.to_owned() })
                })
                .take(MAX_QUEUED_IDS)
                .collect(),
        ),
        _ => None,
    })
}

pub(super) fn closed_queue<'de, D>(deserializer: D) -> Result<Option<String>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let raw = Option::<Value>::deserialize(deserializer)?;
    Ok(string_in(raw.as_ref(), &["terminal"]).map(str::to_owned))
}

/// What the agent's terminal shows while the person waits for an answer: a running turn, or an empty
/// prompt. Any other word is left out: absent is «not known» and is never shown as idle.
pub(super) fn closed_activity<'de, D>(deserializer: D) -> Result<Option<String>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let raw = Option::<Value>::deserialize(deserializer)?;
    Ok(string_in(raw.as_ref(), &["working", "idle"]).map(str::to_owned))
}

pub(super) fn questions<'de, D>(deserializer: D) -> Result<Option<Vec<DirectChatQuestion>>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    // Absent (an older image): none, and the page shows no buttons. A list: every question in its
    // shape, the others left out.
    let raw = Option::<Value>::deserialize(deserializer)?;
    Ok(match raw {
        Some(Value::Array(items)) => Some(items.iter().take(MAX_QUESTIONS).filter_map(DirectChatQuestion::from_value).collect()),
        _ => None,
    })
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub(crate) struct DirectChatPage {
    pub(super) messages: Vec<DirectChatMessage>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) cursor: Option<String>,
    /// The agent's open questions and its latest closed ones; absent from an older image.
    #[serde(default, deserialize_with = "questions", skip_serializing_if = "Option::is_none")]
    pub(super) questions: Option<Vec<DirectChatQuestion>>,
    /// The ids of the turns the team holds back while its agent works, each typed when the agent is idle;
    /// absent from an older image or a chat that never queued. A sent turn that was queued is delivered
    /// once its id is no longer here.
    #[serde(default, deserialize_with = "queued_ids", skip_serializing_if = "Option::is_none")]
    pub(super) queued: Option<Vec<String>>,
    /// How the turns that left the queue ended, for the last day: the page settles a queued turn only
    /// from here, never from its absence in `queued`.
    #[serde(default, deserialize_with = "queue_endings", skip_serializing_if = "Option::is_none")]
    pub(super) settled: Option<Vec<DirectChatQueueEnding>>,
    /// `working` or `idle`, within half an hour of the person's last turn (the agent may answer first and go
    /// on working); absent when the team does not say (an older image, a screen it cannot read, an older
    /// turn): the page never reads absent as idle.
    #[serde(default, deserialize_with = "closed_activity", skip_serializing_if = "Option::is_none")]
    pub(super) activity: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", from = "ReceiptAsWritten")]
pub(crate) struct DirectChatReceipt {
    pub(super) client_message_id: String,
    pub(super) accepted: bool,
    pub(super) message_id: String,
    pub(super) at: f64,
    /// `queued` when the agent's mailbox holds the turn and nobody has taken it yet; absent when the
    /// turn was typed into the agent's terminal, which is the only way a receipt says «delivered».
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) state: Option<String>,
    /// Whether the agent's CLI took the text, with proof: true, false (still in its composer: only
    /// Enter may be pressed again) or null (not known: nothing may be pressed). Absent from an older
    /// image. Anything but a boolean is null: a receipt never says «taken» by mistake.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) taken: Option<Option<bool>>,
    /// With `taken: null`, why it is not known: one of TAKEN_REASONS, or none.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) reason: Option<String>,
    /// `terminal` with `state: queued`: the turn waits in the team for its agent to be idle, and the next
    /// pages say when it is gone; absent for a mailbox turn, which nothing watches.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) queue: Option<String>,
}

/// A receipt as the team wrote it, before the one rule that ties two of its fields: a reason is said
/// only for a text whose fate is not known (`taken: null`).
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ReceiptAsWritten {
    pub(super) client_message_id: String,
    pub(super) accepted: bool,
    pub(super) message_id: String,
    pub(super) at: f64,
    #[serde(default)]
    pub(super) state: Option<String>,
    #[serde(default, deserialize_with = "taken_flag")]
    pub(super) taken: Option<Option<bool>>,
    #[serde(default, deserialize_with = "closed_reason")]
    pub(super) reason: Option<String>,
    #[serde(default, deserialize_with = "closed_queue")]
    pub(super) queue: Option<String>,
}

impl From<ReceiptAsWritten> for DirectChatReceipt {
    fn from(raw: ReceiptAsWritten) -> Self {
        let reason = if raw.taken == Some(None) { raw.reason } else { None };
        let queue = if raw.state.as_deref() == Some("queued") { raw.queue } else { None };
        DirectChatReceipt {
            client_message_id: raw.client_message_id,
            accepted: raw.accepted,
            message_id: raw.message_id,
            at: raw.at,
            state: raw.state,
            taken: raw.taken,
            reason,
            queue,
        }
    }
}

/// The receipt of an answer: the question it answered, and when the team wrote it.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DirectChatAnswerReceipt {
    pub(super) question_id: String,
    pub(super) accepted: bool,
    pub(super) at: f64,
}

#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub(crate) enum DirectChatEvent {
    Status {
        status: DirectChatStatus,
    },
    Messages {
        #[serde(rename = "agentId")]
        agent_id: String,
        page: DirectChatPage,
    },
    Send {
        receipt: DirectChatReceipt,
    },
    Error {
        operation: &'static str,
        code: &'static str,
    },
}

