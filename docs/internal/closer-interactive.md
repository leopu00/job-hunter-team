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
