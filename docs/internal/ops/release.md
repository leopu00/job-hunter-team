# Release runbook

A release is a `vX.Y.Z` tag on the current `production` HEAD. The tag starts
[`.github/workflows/release.yml`](../../../.github/workflows/release.yml), which
checks version coherence, builds the Tauri 2 desktop on Windows/macOS/Linux,
promotes the immutable runtime image and creates a draft GitHub Release. The
draft becomes public only after its downloaded bytes pass the independent
provenance audit.

`game/` is retained as migration history and a development reference. It is
not built or distributed by the release or desktop distribution gate.

## Required gates

Do not promote, tag or publish until all of these are true for the exact SHA:

- onboarding is complete and verified on the supported subscription path;
- direct desktop chat uses the native SSH/VPS tunnel, never an API/database
  message transport; the composer remains visible and the message list scrolls;
- Hosea has issued `PUBBLICABILE @ <SHA>`;
- HQ-SICUREZZA is green for the same SHA;
- required `master` checks and the Tauri distribution matrix are green;
- the release bundle login gate proves that `VITE_SUPABASE_URL` and the public
  `VITE_SUPABASE_ANON_KEY` reached the frontend bundle and that no service-role
  or privileged key marker is present.

The metered team API/OpenAI-key mode remains rehearsal-only and is not a 0.4
product path.

## Version contract

Run:

```bash
scripts/check-release-version.sh vX.Y.Z
```

The checker requires the tag version in the root and shipped package manifests
and lockfiles, `desktop/package.json`, `desktop/src-tauri/tauri.conf.json`, the
Tauri crate, displayed web payload versions, `CHANGELOG.md` and the immutable
runtime manifest. Godot metadata is deliberately outside this release contract.

Before the final version commit, wait for the green Docker build of the chosen
source SHA, record its multi-architecture digest and OCI revision in
`release/runtime-image.v1.json`, update its consumers, then run
`python scripts/runtime_image_pin.py verify-source`.

## Release assets

| Platform | Tauri bundle | Stable asset |
|---|---|---|
| Windows x64 | NSIS | `job-hunter-team-windows-x64-setup.exe` |
| macOS Universal 2 | DMG | `job-hunter-team-macos-universal.dmg` |
| Linux x64 | AppImage | `job-hunter-team-linux-x64.AppImage` |
| Linux x64 | Debian package | `job-hunter-team-linux-x64.deb` |

The macOS build requires all five existing Apple secrets. Tauri signs with the
Developer ID identity, notarizes with Apple and staples the result; the job
then verifies `codesign`, `spctl`, `stapler` and `hdiutil`. Windows and Linux
are currently unsigned and the public copy says so explicitly.

Each runner records a tag/commit/size/SHA-256 sidecar after packaging. The
final job downloads those artifacts, adds `RUNTIME-IMAGE.json`, verifies the
complete expected set and writes `SHA256SUMS` plus
`RELEASE-PROVENANCE.json`. Release notes are rendered from that verified
provenance, so filenames and checksums have one authority.

## Pre-release checklist

- [ ] Integrate onboarding, then the native SSH/VPS chat bridge and UI.
- [ ] Obtain Hosea and HQ-SICUREZZA verdicts for the exact integration SHA.
- [ ] Configure repository variables `VITE_SUPABASE_URL` and
      `VITE_SUPABASE_ANON_KEY`; never add their values to the repository or
      logs, and never supply a service-role/private/admin key.
- [ ] Bump all checked versions and regenerate affected npm/Cargo locks.
- [ ] Add `## [X.Y.Z] — YYYY-MM-DD` to `CHANGELOG.md` with user-visible notes.
- [ ] Freeze and verify the runtime image manifest.
- [ ] Run `scripts/check-release-version.sh vX.Y.Z` locally.
- [ ] Run the relevant local suites through the shared-machine build turn.
- [ ] Push only the SHA approved by Hosea and follow all CI runs to green.

## Promotion and publication

1. Merge approved `master-arthur` into `master` using the merge protocol.
2. Wait for every required and non-required release-relevant workflow.
3. Merge `master` into `production`; the release refuses any other source.
4. Run **Tag Production Release** with the semantic version without `v`.
5. Follow `release.yml` through all three Tauri builders, runtime promotion and
   draft creation. Never tag on red or while a required run is pending.
6. Audit the draft bytes and publish only after the audit succeeds:

```bash
TAG=vX.Y.Z
AUDIT_DIR="$(mktemp -d)"
gh release download "$TAG" --dir "$AUDIT_DIR"
python scripts/release_artifacts.py audit \
  --directory "$AUDIT_DIR" \
  --tag "$TAG" \
  --commit "$(git rev-list -n 1 "$TAG")" \
  --repository leopu00/job-hunter-team
gh release edit "$TAG" --draft=false --latest
```

Never replace a published tag or asset. Fix forward with the next patch
release.

## Local desktop checks

Heavy commands use the shared-machine build turn:

```bash
npm run app:test
npm run desktop:build
npm run app:dist
```

Local macOS packages are not a substitute for the tagged workflow: only the
release job has the Developer ID and notarization credentials.
