"""Static contract: every API route declares an authentication lane.

Next middleware is defense-in-depth only; App Router handlers are responsible
for their own gate.  A newly added route must therefore use a session/local
token gate, a sync-token gate, or be reviewed into the small public allowlist.
"""

import re
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
    # Latest published release, read from GitHub server-side. Reads nothing
    # user-owned and takes no input: the answer is identical for every
    # caller, which is why it is cached for the whole instance. A gate here
    # would authenticate a request in order to return a public version tag.
    "latest-release/route.ts",
    "preferences/route.ts",         # landing theme/locale; DB write session-bound
    "stats/route.ts",               # public project statistics
    # Where the browser reports what the strict CSP (sent as Report-Only) would block. A report carries
    # no cookie and no session, so there is nothing to authenticate. The route reads at most 16 KiB,
    # answers 204 to anything, is rate limited per sender and writes ONE log line per report made of a
    # closed alphabet (directive, blocked origin, page path without query); it stores nothing, calls
    # nothing out and touches no table or file. Reviewed in the Report-Only change.
    "csp-report/route.ts",
}

STANDARD_GATES = (
    "requireAuth(",          # Supabase session or local device token
    "verifyBearerToken(",    # cloud-sync device token
    "resolveUser(",          # explicit session-or-device-token resolver
)


# The single door of the actions the site does for the user (JHT web-capace). `requestAction` checks the
# session itself (no user = 401, before any database call), the origin, the confirmation and the limits, so
# a route that hands its request to it has a gate. It counts as one ONLY if the route really CALLS it:
# an import, a name in a comment or a string that merely mentions it gates nothing.
REQUEST_ACTION_IMPORT = re.compile(r"""from\s+["']@/lib/request-action["']""")
REQUEST_ACTION_CALL = re.compile(r"\brequestAction\s*\(")


def _code_only(source):
    """The source without its comments and string literals, so a mention is not a call."""
    out = []
    i = 0
    n = len(source)
    while i < n:
        two = source[i:i + 2]
        c = source[i]
        if two == "//":
            while i < n and source[i] != "\n":
                i += 1
        elif two == "/*":
            end = source.find("*/", i + 2)
            i = n if end < 0 else end + 2
        elif c in "\"'`":
            quote = c
            i += 1
            while i < n and source[i] != quote:
                i += 2 if source[i] == "\\" else 1
            i += 1
            out.append('""')
        else:
            out.append(c)
            i += 1
    return "".join(out)


def calls_request_action(source):
    """True when the route imports `requestAction` from the door AND calls it in code."""
    return bool(REQUEST_ACTION_IMPORT.search(source)) and bool(
        REQUEST_ACTION_CALL.search(_code_only(source))
    )


def has_gate(source):
    return any(token in source for token in STANDARD_GATES) or calls_request_action(source)


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
        gated = has_gate(source)
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
        if not has_gate(source):
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


def test_request_action_is_a_gate_only_when_the_route_calls_it():
    """A mention is not a call: the policy must not be satisfied by an import, a comment or a string."""
    imp = 'import { requestAction } from "@/lib/request-action";\n'
    called = imp + "export async function POST(req) { return requestAction(req, { action: 'x', level: 'L2' }); }\n"
    assert calls_request_action(called)
    # imported but never called
    assert not calls_request_action(imp + "export async function POST() { return new Response(null); }\n")
    # called from nowhere it was imported from
    assert not calls_request_action("export async function POST(req) { return requestAction(req, {}); }\n")
    assert not calls_request_action(
        'import { requestAction } from "@/lib/other";\nexport async function POST(r) { return requestAction(r, {}); }\n'
    )
    # only named in a comment, a block comment or a string
    assert not calls_request_action(imp + "// return requestAction(req, spec);\nexport async function POST() {}\n")
    assert not calls_request_action(imp + "/* requestAction(req, spec) */\nexport async function POST() {}\n")
    assert not calls_request_action(imp + 'const text = "requestAction(req)";\nexport async function POST() {}\n')
    assert not calls_request_action(imp + "const t = `requestAction(req)`;\nexport async function POST() {}\n")
    # another function that merely contains the name
    assert not calls_request_action(imp + "export async function POST(r) { return myrequestAction(r); }\n")
    # the call is seen after a comment and a string that contain slashes
    assert calls_request_action(imp + 'const u = "a//b"; // note\nexport async function POST(r) { return requestAction(r, {}); }\n')


def test_the_routes_that_hand_over_to_the_door_really_call_it():
    """The routes that rely on the door as their gate are listed here, and each one calls it."""
    through_the_door = [
        "team/command/start/route.ts",
        "team/command/stop/route.ts",
        "team/command/restart/route.ts",
        "team-state/emergency-stop/route.ts",
        "team/settings/route.ts",
        "positions/[legacyId]/apply-request/route.ts",
    ]
    not_calling = [
        rel for rel in through_the_door
        if not (API_ROOT / rel).exists() or not calls_request_action((API_ROOT / rel).read_text(encoding="utf-8"))
    ]
    assert not not_calling, "route che non chiamano requestAction:\n  " + "\n  ".join(not_calling)
