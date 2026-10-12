# Private assisted desktop: initial runtime binding

The app's configured SSH connection remains the existing `[vps]` section in
`user://vps.cfg`. A reviewed private delivery additionally supplies exactly
these four fields in `[browser_runtime]`:

- `container_id`: lowercase hexadecimal, 64 characters, exact container ID.
- `oci_revision`: lowercase hexadecimal, 40 characters, the complete integrated
  candidate source revision, with no default to an earlier runtime.
- `image_id`: `sha256:` followed by 64 lowercase hexadecimal characters.
- `digest`: `sha256:` followed by 64 lowercase hexadecimal characters, the
  immutable delivered index digest. Image RepoDigests must contain `@digest`.

The integration owner prepares these values from approved candidate/image
readbacks in a private JSON file with mode 0600. The authorized delivery applies
only this section using ConfigFile, preserving `[vps]`. No real identifiers or
connection data belong in source control. The panel does not accept a target,
path, port, command or these pins as request arguments. This procedure correlates
an already authorized deployment; it does not confer operator identity or #279
consent.

BackendBus reads the section before backend.start, including manual reconnect.
An environment override preserves it only for the same effective host, key path
and SSH user. Changing that connection invalidates the binding and requires a
new trusted delivery; it never silently adopts another container or falls back
to legacy desktop discovery. Saving the same connection preserves the section.
Absent binding leaves the ordinary backend available, but assisted desktop
unavailable. Present invalid binding prevents connection before handshake.

In bound mode, handshake and every descriptor/frame/control request inspect
only the exact container and its exact image. Running state, image ID, both OCI
revision labels and immutable RepoDigest must match. Handshake is inspect-only;
the first descriptor then executes the fixed helper in that same container as
UID 1001. The old `jht` container may remain stopped under its original name.
There is no start, rename, adoption or selector fallback. Periodic health probes
use these same pins. Ordinary roster/chat/team commands are explicitly
unavailable in bound mode, so their historical `jht` commands cannot target the
preserved original. A changed/stopped/missing candidate fails closed.

The native UI binds each input event to the mission, position, owner, generation,
display and frame sequence visible when the event is created. A changed binding
or sequence discards queued input and requests refreshed pixels; it never replays
that event with a newer sequence. The server still independently validates every
event and controls the actual RFB input route.

Private Page images and DISPLAY frames are separate resources. Revoked, expired
or deleted image availability clears the image pixels and event binding without
clearing an independently permitted desktop view. Images expire for access after
24 hours, with opportunistic file purge; no physical deletion deadline is
promised. Server controls, real native RFB revocation, exported-resource presence
and operator visual tests remain separate acceptance checks.
