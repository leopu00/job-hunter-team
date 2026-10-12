# Assisted browser test candidate: app and runtime

This package joins the one-position assisted flow, its private owner DISPLAY,
and the native Godot viewer. It is a test candidate, not a release. Source
integration and build success do not establish runtime acceptance.

The runtime derives from the immutable assisted-flow parent in the Dockerfile.
Only the explicitly listed source files and operational manifests are copied,
root-owned. OS packages, browser builds and installed dependencies are inherited;
the four existing build gates are retained. The default image runs as UID/GID
1001 in maintenance (`tini -g -- sleep infinity`), with no legacy CLI, agents,
watchdogs, automatic work or ownership repair. A controlled test owner is started
explicitly. The entrypoint repair procedure is fail-closed if separately invoked;
NoNewPrivs requires writable mount ownership to be prepared on the host.

`ops/closer-interactive/runtime-source.json` is authoritative for this package's
changed files. The inherited assisted-flow manifest describes the parent and is
not a validation manifest for overwritten modules. Image OCI revision must equal
the complete independently reviewed integration SHA; implementation branch SHAs
are provenance only. Digests are acquired from CI and never guessed from a tag.

The app is Godot, with inherited version 0.3.9 plus the candidate source identity;
no release version bump is implied. Team > Assisted browser displays frames from
the actual private owner DISPLAY. A blocked Page screenshot is a distinct private
resource with reason and next action. Required app resources and their source
hashes are in `app-runtime-resources.json`; resource inclusion in the actual
running/exported app must be verified separately. No temporary desktop, terminal
or file-manager installation is part of this package.

Initial connection uses the private four-field `[browser_runtime]` delivery in
`user://vps.cfg`, documented in `assisted-desktop-app-binding.md`. Values come only
from approved deployment readbacks; preserve the existing `[vps]` section. Bound
mode exposes the desktop bridge and candidate health probes. Ordinary team/chat
SSH operations are unavailable and cannot fall back to the preserved original.
The UI takes no target/path/port. Queued requests do not prove owner execution.

Automation permits view-only access. Official monouse confirmation is bound to
mission, position, owner and review. Only a live authorized handoff enables the
server input route; automation remains paused. The server validates sequence,
freshness, owner, lease and gates independently of UI state. Preopened clients
must lose the owned route on hold, stale lease, owner loss, EOF or terminal action.
Observe reads receipt/unknown on the retained Page, never retries submission.
Chat markers and shared-UID JSON do not confer operator identity or #279 grants.

Before promotion, require exact-source package review, immutable CI image/OCI
binding, native AMD64 fixtures using image modules without source overlay, real
DISPLAY/frame/input/revocation/lifecycle/privacy proofs, and effective UID/GID,
NoNewPrivs and all capability sets. Missing pidfd or crypto interfaces fail
closed. Scope network isolation separately: bridge membership and capdrop alone
do not prove denial of host, peers, DNAT or IPv6. Reviewed exact network policy,
rollback and fixture must also preserve required DNS/public egress and the app's
authenticated host-initiated route. A synthetic namespace result is not target
network acceptance. No generic firewall flush/backend migration is permitted.

Cutover requires an operator safe point, graceful quiescence, verified consistent
backup including DB/WAL/checkpoints/receipts/profile state, exact mount allowlist
and one writer. Preserve the original stopped object, baseline image and backup.
Never stop, copy or migrate a browser profile while personal login is in use.
Stop destroys Page RAM even if its container object is retained. Rollback is an
explicit separate baseline maintenance clone after stopping the candidate; never
restart legacy PID1 or reset hold/throttle/checkpoint/unknown state automatically.

The active app's exact candidate binding, artifact/source hashes and resource
presence must reach the visual tester before a ready flag. Native input,
rendered pixels and operator-path E2E are distinct from headless UI/model tests.
Pending or failed evidence remains visible; no release, provider, ATS submission
or general sandbox certification follows from this candidate.

The source EOF acceptance is recorded separately from image acceptance. The
final source freeze retains the native local ARM64 test using a test-only source
overlay: the preopened RFB route closes after owned EOF, the three observed child
identities cease, pipes/socket/auth files close and both locks can be reacquired.
A separate live inert-controller case propagates the original browser error.
These scoped tests preserve the durable unknown marker without a second submit
or cap reservation; diagnostic EOF/Future messages remain in the evidence. They
do not attest the final AMD64 image, app export, network isolation or cutover.
