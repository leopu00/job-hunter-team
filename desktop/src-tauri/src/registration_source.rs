//! Shared source boundary: setup ends at the builder's actual handler registration.
pub(crate) fn before_handler_registration() -> &'static str {
    include_str!("lib.rs")
        .split_once(".invoke_handler(")
        .expect("the application builder registers its native handler")
        .0
}
