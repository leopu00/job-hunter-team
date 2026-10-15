# Assisted browser inside Tauri (#281)

This React frontend targets the existing Tauri 2 desktop **0.4.0**,
`ai.jobhunterteam.desktop`, from `fc38ebb623ff5853089624d00693e560c5ecf9bd`.
The Godot desktop and its exports are separate artifacts.

Team → Open assisted browser mounts the frame view inside the app WebView.
It calls only `invoke("closer_desktop_request", {request})`. The Rust backend
owns the account-scoped trusted binding, host comparison, exact container/image
attestation, SSH without a PTY, bounded output and request deadline. Desktop
requests have no target, host, path, port, password or runtime-pin setter and no fallback to `jht`.
Missing/invalid binding makes the browser unavailable; it does not start a runtime.

Before team preparation, FIRSTSETUP → environment also provides an explicit
browser-assistance connection. Select VPS and use the existing SSH fields/key
picker, then choose **Connect for browser assistance**. This calls only
`invoke("closer_desktop_register_host", {host:ExecutionHostVPS})`.
The accepted reply is `{ok:true,registered:true,assistance_ready:false}`;
registration is not runtime readiness. A missing SSH host key uses the existing
probe/explicit fingerprint confirmation, then returns to registration, never
to team preparation. Denied, malformed or stale-host results do not open the view.
The actual assisted-browser component then displays the trusted runtime's state,
including unavailable when the producer's receipt/binding is absent. No team-ready
marker, provider login, team startup or runtime provisioning is triggered.
**Return to setup** preserves the wizard's host, provider and current step; closing
the view does not finish or abandon a browser mission.

Login and FIRSTSETUP use the same existing locale policy: explicit cookie,
legacy preference, supported system language, then English. No preference is
written just to align them. New steps reset scrolling and focus their heading;
same-step field changes leave focus and scrolling alone.

The producer supplies a private regular non-symlink file, at most 8 KiB, in
`app_local_data/accounts/<existing AccountScope.digest64>/closer-desktop-binding.json`:
`{schema:1,host:ExecutionHost,browser_runtime:{container_id,oci_revision,image_id,digest}}`.
The integration step prepares the delivery from attested receipts. Installation in the actual
account scope is a separate delivery step. A host/account change invalidates it.
Actual runtime pins, installed app resources and end-to-end delivery remain
pending until the integrated artifact is attested; UI tests do not establish them.

The remote flat API is runtime source
`a0936ded520cc7c21cc3c1e136ca95b1080274f5`'s `desktop_request`:

| Operation | Binding in addition to `op` |
| --- | --- |
| descriptor | none |
| frame | mission, position, owner, generation, display, frame sequence |
| input | frame binding plus pointer coordinates/button/pressed, or key/pressed |
| snapshot / delete_snapshot | mission, position, owner, generation, event |
| confirm / handoff | mission, position, owner, generation, current review ID (nullable for non-review handoff) |
| observe / finish / abandon | mission, position, owner, generation |

Wire names are `mission_id`, `position_id`, `owner_id`, `generation`,
`display_id`, `frame_sequence`, `event_id`, `review_id`. Generation is 1.
The server's `allowed_actions` list is mandatory. No action is inferred from a
block reason, label, chat message, image, or exhausted counter. Confirm is also
limited to `review_wait` with a current review ID. An existing last-slot handoff
reservation can still allow observe; the frontend never adds another cap check.

The main image is a PNG frame of the owner's actual 1440×1000 DISPLAY, including
browser dialogs and windows. The private blocked-Page PNG is a separate artifact.
Page images expire from access after 24 hours; purge is opportunistic. Deletion,
expiry and revoked availability clear that image and its event binding even if
desktop frames remain available. Images stay in component memory, never storage/logs.

Input requires fresh descriptor, fresh frame, matching binding, `handoff`,
`input_ready`, and server `input` permission. Events retain the exact identity and
sequence of the pixels at enqueue. A changed identity, changed sequence or stale
view discards the event without replay. Another client's frame can invalidate a
sequence; server denial requires a refresh, not silent resubmission. Calls are
serialized. The frontend is not a substitute for the server's RFB input barrier.
No clipboard/file transfer, terminal, file manager, IME composition forwarding,
or generic command execution is provided. Keyboard navigation supports scrolling.

Official controls are distinct from pointer/keyboard input. A `queued` reply is
not execution, an application outcome or a receipt. After possible human submit,
Observe result performs receipt/unknown observation only; it does not re-fill or
submit again. Observe is terminal in the current runtime, so finish/abandon tests
need separate fresh synthetic missions. Closing the panel only closes its view.

Frontend checks use inert transport replies and actual synthetic PNG bytes.
They establish the React/TS request bindings, stale-event rejection, action gating,
artifact clearing, and Team entry. They do **not** establish server RFB revocation,
actual display pixels, target isolation, an installed binding or an app export.
Native runtime/driver fixtures and the final visual app test are separate steps.
The driver's vendor layout/import gate must be satisfied on the future corrected
bundle before collection or owner startup; the old bundle is not ready.
