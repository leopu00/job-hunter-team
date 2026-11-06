use super::*;

/// The read once the host and the pinned target are known: one SSH run, then
/// its reply. A failed run says why, in vps_link's kinds: the network (retried
/// by the app), the team, a team that is not the pinned one, a changed SSH key.
pub(super) fn positions_read_with(
    request: &PositionsRequest,
    request_bytes: &[u8],
    run: impl FnOnce(&[u8]) -> Result<ProcessResult, &'static str>,
    key_matches_pin: impl FnOnce() -> Option<bool>,
) -> Value {
    let mut input = hex_encode(POSITIONS_READ_PY.as_bytes()).into_bytes();
    input.push(b'\n');
    input.extend_from_slice(request_bytes);
    input.push(b'\n');
    let output = match run(&input) {
        Ok(output) if output.success() => output,
        failed => {
            return vps_link::failure_reply(vps_link::classify_failure(
                &failed,
                key_matches_pin,
                "positions_unavailable",
            ))
        }
    };
    positions_reply_from_output(request, output, None)
}

/// What the reader printed, as the page's reply: a bounded, well-formed answer of the shape the request asked
/// for, or why it is not one. The same for the VPS and for this computer's container.
pub(super) fn positions_reply_from_output(request: &PositionsRequest, output: ProcessResult, token_tag: Option<&str>) -> Value {
    if output.stdout.len() > 2 * 1024 * 1024 {
        return positions_answer_failure("positions_unavailable");
    }
    let mut reply: Value = match serde_json::from_slice(&output.stdout) {
        Ok(reply) => reply,
        Err(_) => return positions_answer_failure("positions_unavailable"),
    };
    // The identity of the database file, which only a detail read of this computer's team turns into a token.
    let ident = reply.as_object_mut().and_then(|object| object.remove("ident"));
    if valid_positions_reply(request, &reply) {
        if matches!(request, PositionsRequest::Profile) {
            return shape_profile(reply);
        }
        if let (Some(tag), PositionsRequest::Detail { .. }, Some(ident)) = (token_tag, request, ident) {
            if let Some(token) = crate::local_swipe::token_from_ident(tag, &ident) {
                if let Some(data) = reply.get_mut("data").and_then(Value::as_object_mut) {
                    data.insert("token".into(), Value::String(token));
                }
            }
        }
        return reply;
    }
    match reply.get("error").and_then(Value::as_str) {
        Some("positions_request_invalid") => positions_answer_failure("positions_request_invalid"),
        _ => positions_answer_failure("positions_unavailable"),
    }
}
