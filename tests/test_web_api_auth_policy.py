"""Static contract: every API route declares an authentication lane.

Next middleware is defense-in-depth only; App Router handlers are responsible
for their own gate.  A newly added route must therefore use a session/local
token gate, a sync-token gate, or be reviewed into the small public allowlist.
"""

from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
API_ROOT = ROOT / "web" / "app" / "api"

# Public by product contract, not by omission. Keep this list deliberately
# explicit: adding route.ts without choosing a lane must fail CI.
PUBLIC_ROUTES = {
    "[...catchall]/route.ts",       # deterministic 404
    "about/route.ts",               # public project metadata
    "canary/route.ts",              # public availability probe
    "cloud-sync/device-init/route.ts",      # device-flow bootstrap
    "cloud-sync/device-poll/route.ts",      # possession of device code
    "cloud-sync/device-register/route.ts",  # one-time pairing secret
    "demo/route.ts",                # static demo-cookie state only
    "feedback/route.ts",            # pre-login support, rate-limited
    "health/route.ts",              # readiness probe, no dependencies/data
    "i18n/route.ts",                # public locale catalogs
    "preferences/route.ts",         # landing theme/locale; DB write session-bound
    "stats/route.ts",               # public project statistics
}

STANDARD_GATES = (
    "requireAuth(",          # Supabase session or local device token
    "verifyBearerToken(",    # cloud-sync device token
    "resolveUser(",          # explicit session-or-device-token resolver
)


def _routes():
    return sorted(API_ROOT.rglob("route.ts"))


def _relative(path):
    return path.relative_to(API_ROOT).as_posix()


def test_every_api_route_has_a_gate_or_reviewed_public_contract():
    missing = []
    stale_public = []
    for route in _routes():
        rel = _relative(route)
        source = route.read_text(encoding="utf-8")
        gated = any(token in source for token in STANDARD_GATES)
        # A few account-management routes implement the Supabase session gate
        # inline. Requiring the 401 branch prevents an optional getUser() probe
        # from being mistaken for authentication.
        inline_session_gate = (
            ".auth.getUser()" in source and "status: 401" in source
        )
        if not gated and not inline_session_gate and rel not in PUBLIC_ROUTES:
            missing.append(rel)
        if rel in PUBLIC_ROUTES and (gated or inline_session_gate):
            stale_public.append(rel)

    assert not missing, (
        "API senza auth policy: aggiungi requireAuth/verifyBearerToken/"
        "resolveUser oppure documenta e revisiona l'eccezione pubblica:\n  "
        + "\n  ".join(missing)
    )
    assert not stale_public, (
        "Route ora protette ma ancora nell'allowlist pubblica:\n  "
        + "\n  ".join(stale_public)
    )


def test_local_write_is_never_treated_as_authentication():
    """requireLocalWrite selects the writable plane; it authenticates nobody."""
    missing = []
    for route in _routes():
        source = route.read_text(encoding="utf-8")
        if "requireLocalWrite(" not in source:
            continue
        if not any(token in source for token in STANDARD_GATES):
            missing.append(_relative(route))
    assert not missing, (
        "requireLocalWrite senza un auth gate separato:\n  "
        + "\n  ".join(missing)
    )


def test_local_sensitive_routes_use_the_uniform_auth_helper():
    """Local files/SQLite must not rely on spoofable request routing alone."""
    sensitive_markers = (
        "JHT_DB_PATH",
        "JHT_CONFIG_PATH",
        "JHT_PROFILE_DIR",
        "JHT_USER_UPLOADS_DIR",
        "localDbExists(",
        "isLocalRequest(",
    )
    missing = []
    for route in _routes():
        rel = _relative(route)
        if rel in PUBLIC_ROUTES:
            continue
        source = route.read_text(encoding="utf-8")
        if any(marker in source for marker in sensitive_markers):
            if "requireAuth(" not in source:
                missing.append(rel)
    assert not missing, (
        "Route local-sensitive senza requireAuth (session/local-token):\n  "
        + "\n  ".join(missing)
    )
