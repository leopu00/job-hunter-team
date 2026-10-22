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


# The single door of the actions the site does for the user (JHT web-capace). Two ways in, both ending in
# the database function `request_action`, which decides the user (auth.uid(), no user = refused before any
# effect), the origin of the call, the confirmation and the limits:
#   - `requestAction` (lib/request-action.ts): the route hands over its whole request;
#   - `callDoor` (lib/door-rpc.ts): the route, or a helper of the route, calls the function with the
#     client of the user's session (the desktop uses the same one).
# Either counts as a gate ONLY if the route really USES it: it imports the name from the module that
# defines it AND calls it in code. An import that is never used, a name in a comment or in a string, a call
# to another function whose name contains it, or a call to one imported from elsewhere gates nothing.
DOOR_GATES = {
    "requestAction": "@/lib/request-action",
    "callDoor": "@/lib/door-rpc",
}


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


def _uses_gate(source, name, module):
    imported = re.search(
        r"import\s*\{[^}]*\b" + re.escape(name) + r"\b[^}]*\}\s*from\s*[\"']" + re.escape(module) + r"[\"']",
        source,
    )
    return bool(imported) and bool(re.search(r"\b" + re.escape(name) + r"\s*\(", _code_only(source)))


def calls_the_door(source):
    """True when the route imports a way into the door from its module AND calls it in code."""
    return any(_uses_gate(source, name, module) for name, module in DOOR_GATES.items())


def calls_request_action(source):
    return _uses_gate(source, "requestAction", DOOR_GATES["requestAction"])


def calls_call_door(source):
    return _uses_gate(source, "callDoor", DOOR_GATES["callDoor"])


def has_gate(source):
    return any(token in source for token in STANDARD_GATES) or calls_the_door(source)


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


def test_call_door_is_a_gate_only_when_the_route_uses_it():
    """Same rigour as for requestAction: imported from the door's module and called in code."""
    imp = 'import { callDoor } from "@/lib/door-rpc";\n'
    called = imp + "export async function POST() { return callDoor(client, { action: 'x', level: 'L1' }); }\n"
    assert calls_call_door(called) and calls_the_door(called) and has_gate(called)
    # with other names in the same import
    multi = 'import { DOOR_REFUSAL_STATUS, callDoor } from "@/lib/door-rpc";\nexport async function POST() { return callDoor(c, {}); }\n'
    assert calls_call_door(multi)
    # imported, never called
    assert not calls_call_door(imp + "export async function POST() { return new Response(null); }\n")
    # the constant imported, the function not
    assert not calls_call_door(
        'import { DOOR_REFUSAL_STATUS } from "@/lib/door-rpc";\nexport async function POST() { return callDoor(c, {}); }\n'
    )
    # called but imported from somewhere else, or not imported
    assert not calls_call_door('import { callDoor } from "@/lib/other";\nexport async function POST() { return callDoor(c, {}); }\n')
    assert not calls_call_door("export async function POST() { return callDoor(c, {}); }\n")
    # only named in a comment, a block comment, a string or a template
    for mention in (
        "// return callDoor(c, {});\n",
        "/* callDoor(c, {}) */\n",
        'const t = "callDoor(c)";\n',
        "const t = `callDoor(c)`;\n",
    ):
        assert not calls_call_door(imp + mention + "export async function POST() {}\n")
    # a function whose name merely contains it
    assert not calls_call_door(imp + "export async function POST() { return mycallDoor(c, {}); }\n")
    # the two ways do not stand in for each other
    assert not calls_request_action(called)
    assert not calls_call_door(
        'import { requestAction } from "@/lib/request-action";\nexport async function POST(r) { return requestAction(r, {}); }\n'
    )
