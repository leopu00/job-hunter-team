use super::*;

pub(super) fn request_has_explicit_null_filter(request: &Value) -> bool {
    let Some(object) = request.as_object() else {
        return false;
    };
    match object.get("filters") {
        None => false,
        Some(Value::Null) => true,
        Some(Value::Object(filters)) => filters.values().any(Value::is_null),
        Some(_) => false,
    }
}

pub(super) fn parse_positions_request(request: Value) -> Result<PositionsRequest, ()> {
    if request_has_explicit_null_filter(&request) {
        return Err(());
    }
    match serde_json::from_value::<PositionsRequest>(request) {
        Ok(request) if request.valid() => Ok(request),
        _ => Err(()),
    }
}

/// Runs the read unless this VPS's key is already known to have changed; remembers the block when the read
/// finds it. `pinned` is the fingerprint of the pin the read goes out against.
pub(super) fn read_unless_blocked(block_key: Option<String>, pinned: Option<String>, read: impl FnOnce() -> Value) -> Value {
    if let Some(key) = &block_key {
        if vps_link::remembered_block(key, pinned.as_deref()) {
            return vps_link::blocked_reply();
        }
    }
    let reply = read();
    if vps_link::is_key_changed(&reply) {
        if let (Some(key), Some(pinned)) = (&block_key, &pinned) {
            vps_link::remember_block(key, pinned);
        }
    }
    reply
}
