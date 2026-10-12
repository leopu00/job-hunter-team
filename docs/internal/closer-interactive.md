# One admitted Closer browser mission

This delta is based on459. It does not activate279, change the provider,
authenticate CHAT or alter the personal login display. Local host CLI commands
retain the existing `user_local` technical trust boundary; identifiers correlate
the mission, Page owner and reviewed form and are not identity credentials.

The official host operation first runs
`python3 /app/shared/skills/closer_interactive.py admit POSITION`.
Admission holds the global work lock and the SQLite transaction, checks consent,
existing checkpoint/email/essential holds and cap, and writes the private durable
slot before the selected position's authorisation. It never wakes a worker.
Uncertain admission leaves a blocking slot. The slot remains after completion,
abandonment or failure: no ordinary queue, second position or automatic respawn.
There is deliberately no implicit reset/rearm command in this candidate.

The host then invokes the existing `apply_flow.py` CLI for that position with
`--interactive --headful`, and the usual profile/CV/URL/database arguments.
The existing assisted owner claims the mission once, retains the global and
position/profile locks and owns the true Playwright Page/context on its thread.
No other flow can claim a running, terminal or abandoned mission. Email is
excluded. The normal application gate, consent, cap, checkpoint and receipt
contracts remain in force.

After the recipe's review, `before_submit` publishes a fresh review ID and waits
on the same Page. `closer_interactive.py status` supplies the current mission,
owner, review and phase. The host CLI accepts
`confirm|handoff|observe|finish|abandon POSITION --mission ID --owner ID`
(plus `--review ID` for confirm/handoff). These commands queue a one-time request;
their return does not claim that the owner has executed it. The Page owner
consumes the request durably before effects. Confirm repeats recipe review and
then the normal final gate, atomic cap reservation and durable submit marker.
CHAT and the old assisted socket cannot perform these controls in interactive
mode. CHAT may refine only the already admitted task and forward unrelated work
as the worker through the ordinary inter-agent channel, without granting authority.

## Owned screen and effective input boundary

`closer_interactive_screen.py` is a lifecycle helper for this one owner using
the existing Xvfb/x11vnc/websockify executables, not a general runner/service.
Xvfb selects a new free display via `-displayfd`; only the owned browser launch
receives that DISPLAY. The shared viewer and all existing login displays are
untouched. A private password file and loopback-only ephemeral route are
reported in mission status for future custodial exact-container mapping.
No route/tunnel is deployed by this source commit.

The owned x11vnc initially forces `-viewonly` and disables its remote-command
interface. After an official handoff, the cap and gates are checked, the marker
for possible human submission is saved and only then is that owned view-only
server replaced with an input-enabled server. Old RFB connections are dropped;
the client must reconnect to the owned route. The supervisor independently
checks the mission/parent binding, durable checkpoint marker and authorisation
before enabling input. It rechecks authorisation on lease updates.

The parent holds a private stdin lease. Input requires updates at most two
seconds apart. EOF, stale lease, expiry, terminal mission, finish/abandon,
child failure or revoke closes the owned VNC/WebSocket processes, including
already connected clients. This is bounded route revocation, not a per-event
atomic transaction with the database. Each Linux child also sets PDEATHSIG
before exec and rejects a changed parent; cleanup uses only owned subprocess
handles with bounded terminate/kill/wait. No name-based signals or shared
display changes are used. Revocation may end streaming.

The single-threaded supervisor arms ITIMER_REAL for two seconds when enabling
input and renews it only after an authorised owner tick. The signal handler
sends SIGKILL through non-inheritable pidfds pinned to its own VNC/WebSocket
children before any wait/reap. A slow handshake, frame or client output does
not postpone that cutoff or renew the lease. Unsupported pidfd signalling
fails closed; normal kernel scheduling still applies. Handler cleanup disarms
the timer before closing handles. Hold/revocation checks use the durable submit
marker for recovery, so consuming the last cap slot does not revoke recovery.
After route cutoff the Page/display can remain alive for observation; streaming
and further input are unavailable. An explicit later observe never resubmits.
While awaiting the bounded enable acknowledgement, the owner sends heartbeat
ticks every 200 ms. Server startup accepts only those bound ticks, revalidates
the pending handoff and current holds before each renewal, and never extends
the two-second lease or its five-second readiness deadline. Heartbeat replies
cannot substitute for an enable/revoke acknowledgement. EOF, invalid heartbeat
or gate failure still closes the route; no frame request renews the deadline.
Readiness retains one TCP connection while collecting the complete 12-byte
RFB banner, with short select intervals for those lease checks. It does not
equate TCP accept with readiness or repeatedly abort a delayed greeting after
100 ms. The global readiness deadline remains five seconds.

After handoff, observe first revokes the input route and then only reads a
receipt or preserves an unknown outcome on the retained Page. It cannot run
another submit or the verification-code click path. No checkpoint, cap or
authorisation is reset. Finish/abandon/owner exit preserves possible-submit
uncertainty and closes the resources.

## Validation boundary

The initial freeze has AST/import/bash syntax/diff checks and five lightweight
actual private-state checks (selected-only, wrong review, one consumption,
replay, terminal reservation). These are not browser/RFB/admission coverage.
Independent admission tests belong to Bill; true Page/review and actual RFB
input/connected-client revocation tests belong to Sadie. Linux Xvfb/x11vnc/
websockify and a cached test image are prerequisites for the latter. No mock
viewer, Python input refusal or command-line inspection is an effective RFB
proof. This source is not ready for packaging/dispatch until those tests and
exact review succeed.

Review follow-up: the launcher holds the same position-zero flock from its
ordinary-allowed check through spawn/delivery. Tmux clients and detached helpers
close fd 8 as well as fd 9, preventing a server/helper from retaining that lease.
Mission update/consume require position and current owner PID in addition to IDs;
a rejected ordinary flow returns before loading or rewriting any checkpoint.
State CLI/owner contention waits at most two seconds, then fails closed. Expiry
revokes input immediately but releases the outer Page/locks only after nested
flow locks unwind. Handoff recovery reads the durable submit marker, preserving
its existing cap reservation even when it consumed the last daily slot.

# Desktop block and frame contract (#281)

`closer_interactive.desktop_request(request)` is the fixed entrypoint for the
existing authenticated own-user host transport, executed in the exact selected
container as its configured user. No request accepts a path, host, port, shell
command, clipboard, or file transfer. IDs correlate an already admitted mission;
this does not authenticate CHAT or solve #279. Descriptor/queued controls are not
application outcomes. Errors are flat `{ok:false,error:code}` without input logs.

Descriptor reports mission_id, position_id, owner_id, generation (1: no rebind),
review_id, phase, input_ready, advisory allowed_actions, display_id and latest
frame_sequence. `snapshot`/`delete_snapshot` additionally require event_id.
Controls require the complete mission binding; confirm/handoff require review_id.
Intermediate blockers explicitly disallow confirm and retain their actual Page;
only handoff with current gates, finish/abandon or expiry can leave that wait.
There is no automatic retry or next position. After possible human submission,
observe reads a receipt/unknown and never returns to filling or a second submit.

Every interactive stop captures the retained Page with secret fields hidden.
Review itself is also a stop. PNGs and metadata are private mode 0600 in the fixed
owner events directory, named only by random event IDs. No image enters Git,
issues, or normal logs. The last eight events are retained; access expires after
24 hours and expired files are purged on new events/descriptor reads. This is
opportunistic deletion, not a background hard expiry when no process accesses
that home. The explicit delete_snapshot operation removes just that bound event.
Capture failure is reported as unavailable, never fabricated as a screenshot.
Metadata/publication failure removes only the newly allocated PNG/JSON event,
including a partial metadata file, preserving the primary error. Filesystem
cleanup errors cannot be claimed as successful deletion.

`frame`/`input` additionally require opaque display_id and frame_sequence. Frame
is the actual 1440x1000 private X display, including browser windows/dialogs; it is
not the block Page screenshot. PNG responses are bounded at 8 MiB. The specific
OwnedScreen supervisor serves a private mode 0600 Unix endpoint and uses a small
loopback RFB raw client against its own x11vnc. Frame encoding uses stdlib PNG;
VNC compatibility authentication uses installed libcrypto.so.3 DES functions.
The wire formats follow RFC 6143 (https://www.rfc-editor.org/rfc/rfc6143.html);
OpenSSL DES API: https://docs.openssl.org/3.0/man3/DES_random_key/ . These are not
new operator authentication or an external network listener.

Input requires handoff phase, durable marker/reserved cap before enable, current
consent/position gates, current owner lease, exact display and latest frame no
older than two seconds. Pointer coordinates/buttons and key names or single
printable Unicode characters are bounded. No arbitrary command/clipboard exists.
Both backend input and any existing route use the SAME RFB server: view-only
before handoff, restarted on enable (old clients dropped), closed on revoke.
Display helpers and supervisor have Linux parent-death signals. No XFCE, terminal,
file manager, desktop shell, or generic runner is introduced by this source.
Private endpoint/socket checks are within the existing shared-user technical
boundary; this does not claim worker segregation or #279 operator authentication.

New source requires independent real display/RFB input/revoke and app/backend
integration tests, plus package dependency/mount review. AST and inert protocol
fixtures alone are not those proofs. Runtime confinement belongs to the reviewed
package, not to this TOML/source description. Personal display/login567 is unused.
