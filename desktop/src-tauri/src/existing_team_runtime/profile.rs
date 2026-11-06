use super::*;

/// A read that failed before anything ran on the VPS, with its kind for the app
/// (vps_link): a pin that no longer reads blocks, anything else is the application.
pub(super) fn positions_failure(code: &'static str) -> Value {
    vps_link::failure_reply(vps_link::classify_setup_failure(code))
}

pub(super) fn positions_answer_failure(code: &'static str) -> Value {
    vps_link::failure_reply(vps_link::LinkOutcome { kind: vps_link::LinkKind::Application, code })
}

/// The top-level keys of candidate_profile.yml the candidate's profile is built from: exactly the
/// ones the cloud's own mapper reads (web/lib/profile-yaml-map.ts). Any other key of the file is
/// counted and dropped here, so it never reaches the app or the CLI.
pub(super) const PROFILE_FIELDS: &[&str] = &[
    "aspirations",
    "birth_year",
    "candidate",
    "certifications",
    "domain_expertise",
    "education",
    "email",
    "experience",
    "experience_months",
    "experience_years",
    "goals",
    "has_degree",
    "industry",
    "interests",
    "languages",
    "location",
    "location_preferences",
    "name",
    "nationality",
    "notes",
    "personal",
    "positioning",
    "preferences",
    "projects",
    "sector_details",
    "seniority_target",
    "skills",
    "strengths",
    "target_role",
    "target_role_category_id",
    "target_roles",
    "target_roles_priority",
    "target_specialty",
    "timezone",
    "work_authorization",
];

/// A YAML anchor (`&name`) and an alias (`*name`) both in the text: expanding aliases can blow a
/// small file up without bound, and the parser does not limit it, so such a file is refused with
/// its own reason instead of being parsed. Prose rarely has both as separate words.
pub(super) fn profile_has_aliases(text: &str) -> bool {
    let bytes = text.as_bytes();
    let (mut anchor, mut alias) = (false, false);
    for (index, &byte) in bytes.iter().enumerate() {
        if byte != b'&' && byte != b'*' {
            continue;
        }
        let starts_token = index == 0
            || matches!(bytes[index - 1], b' ' | b'\t' | b'\n' | b'\r' | b'[' | b'{' | b',' | b':' | b'-');
        let named = bytes
            .get(index + 1)
            .is_some_and(|next| next.is_ascii_alphanumeric() || matches!(next, b'_' | b'-'));
        if starts_token && named {
            if byte == b'&' {
                anchor = true;
            } else {
                alias = true;
            }
        }
    }
    anchor && alias
}

/// What the profile file says: `("ok", fields, kept, dropped)` with only the whitelisted keys, or
/// the reason it could not be read as a profile, with no field at all.
pub(super) fn profile_fields(text: &str) -> (&'static str, Value, usize, usize) {
    if profile_has_aliases(text) {
        return ("aliases_unsupported", Value::Null, 0, 0);
    }
    match serde_yaml::from_str::<Value>(text) {
        Ok(Value::Object(top)) => {
            let total = top.len();
            let kept: serde_json::Map<String, Value> = top
                .into_iter()
                .filter(|(key, _)| PROFILE_FIELDS.contains(&key.as_str()))
                .collect();
            let count = kept.len();
            ("ok", Value::Object(kept), count, total - count)
        }
        Ok(_) => ("not_a_mapping", Value::Null, 0, 0),
        Err(_) => ("invalid_yaml", Value::Null, 0, 0),
    }
}

/// The reader sends the profile file as text; the app and the CLI get it as fields. The raw text
/// is dropped here, with the keys outside the whitelist, and the reply says how the file was read
/// (`parse`), how many keys were kept and how many dropped.
pub(super) fn shape_profile(mut reply: Value) -> Value {
    let Some(profile) = reply
        .get_mut("data")
        .and_then(|data| data.get_mut("profile"))
        .and_then(Value::as_object_mut)
    else {
        return positions_failure("positions_unavailable");
    };
    let text = profile.remove("text");
    let (parse, fields, kept, dropped) = match text.as_ref().and_then(Value::as_str) {
        Some(text) => profile_fields(text),
        None => ("none", Value::Null, 0, 0),
    };
    profile.insert("parse".into(), json!(parse));
    profile.insert("fields".into(), fields);
    profile.insert("kept".into(), json!(kept));
    profile.insert("dropped".into(), json!(dropped));
    reply
}
