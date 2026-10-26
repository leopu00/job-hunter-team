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
- the publication review has issued `PUBBLICABILE @ <SHA>`;
- the security review is green for the same SHA;
- required `master` checks and the Tauri distribution matrix are green;
- the release bundle login gate proves that `VITE_SUPABASE_URL` and the public
  `VITE_SUPABASE_ANON_KEY` reached the frontend bundle and that no service-role
  or privileged key marker is present.

The metered team API/OpenAI-key mode remains rehearsal-only and is not a 0.4
product path.

## Order of a release

1. **Pin** — at the release candidate, on the attested image built from the
   candidate's own SHA (green Docker build of that SHA): `runtime_image_pin.py
   update`, then `verify-tree` and `verify-source` (see below). The pins are not
   moved before: until then the repository keeps the previous image.
2. **Version commit** — versions, `CHANGELOG.md`, the site's download tag, with
   the pins of step 1 already in the tree. `release.yml` checks the tree of the
   tagged commit and cannot change it.
3. **Tag** — the production HEAD (Tag Production Release).
4. **Draft** — `release.yml` builds the three desktop apps, promotes the image
   and creates the draft Release. Nobody who is not logged in can download a
   draft.
5. **Publish** — the operator, after the audit of the draft bytes
   (`gh release edit "$TAG" --draft=false --latest`, below).
6. **Public release check** — started by publishing, green means anyone can
   download the files the site's button links.

Nothing is tagged on red, and the release is not published before the audit.

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
source SHA, then move the manifest and every consumer to that image in one step:

```bash
python scripts/runtime_image_pin.py update --from-registry   # digest of the `master` image + the commit it was built from
# or, for an image that is not the current `master` one:
python scripts/runtime_image_pin.py update --digest sha256:<index digest> --source-revision <commit>
python scripts/runtime_image_pin.py verify-tree --root .      # contract + no other copy of the pin in the repository
python scripts/runtime_image_pin.py verify-source             # the image carries that commit on both platforms
```

`update` rewrites the manifest and the consumers listed in
`PINNED_CONSUMERS` (compose, installers, wrappers, the Windows enabler, the
CLI, the guide) with the patterns `verify-tree` reads them with, and changes
nothing if one of them is not found. `verify-tree` also fails if a tracked file
that is not on that list names a JHT image by another digest: a new copy of the
pin must be added to the list, or it is red at the next release.

## Release assets

| Platform | Tauri bundle | Stable asset |
|---|---|---|
| Windows x64 | NSIS | `job-hunter-team-windows-x64-setup.exe` |
| macOS Apple silicon (arm64) | DMG | `job-hunter-team-macos-universal.dmg` |
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
- [ ] Obtain the publication review and the security review verdicts for the
      exact integration SHA.
- [ ] Configure repository variables `VITE_SUPABASE_URL` and
      `VITE_SUPABASE_ANON_KEY`; never add their values to the repository or
      logs, and never supply a service-role/private/admin key.
- [ ] Bump all checked versions and regenerate affected npm/Cargo locks.
- [ ] Add `## [X.Y.Z] — YYYY-MM-DD` to `CHANGELOG.md` with user-visible notes.
- [ ] At the release candidate: move the runtime image pins with `runtime_image_pin.py update` (see the version contract) before the version commit.
- [ ] Run `scripts/check-release-version.sh vX.Y.Z` locally.
- [ ] Run the relevant local suites through the shared-machine build turn.
- [ ] Push only the SHA approved by the publication review and follow all CI runs to green.

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

7. Publishing starts **Public release check** (`public-release-check.yml`): with
   no token it downloads the three files the site's button links, and
   `SHA256SUMS`, and compares sizes and hashes. A draft cannot be downloaded by
   anyone who is not logged in, so until step 6 the site's `/download` button
   has nothing to lead to; only a green run says that it does. By hand:
   `python scripts/ci/check_public_release.py --tag "$TAG"` (`--no-bytes` only
   asks that each address answers). A 403 from the anonymous GitHub API on a shared
   runner is not the release's fault: re-run the workflow.

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
