# 🚢 Release

Cutting a release means pushing a `vX.Y.Z` tag that points at the **`production` HEAD**. CI then runs [`.github/workflows/release.yml`](../../../.github/workflows/release.yml): it verifies the tag against every version field, builds the **native Godot desktop application** on three runners, signs and notarizes the macOS build, builds the web app as a regression gate, and creates a **draft** GitHub Release with the four platform artifacts attached. The release becomes public only after the downloaded draft passes the independent audit below.

Every platform runner also records the exact tag commit, byte size and SHA-256
of its final asset **after** signing and packaging. The release job recomputes
those hashes after downloading the artifacts and refuses publication unless
all five sidecars name the same tag commit. The published release includes
`SHA256SUMS`, `RELEASE-PROVENANCE.json` and the versioned
`RUNTIME-IMAGE.json`; checksums prepared before the tag are never reused
because signing changes the final bytes.

> 🖥️ **The desktop application is the Godot office in [`game/`](../../../game/).** The Electron launcher (`desktop/`) was removed with the native migration on 2026-07-19 — nothing in the release pipeline uses electron-builder any more. If a doc still mentions `desktop/package.json`, it predates that change.

---

## 🔢 Release version fields

`scripts/check-release-version.sh` is the first CI job. It compares the tag
against the application metadata below, every distributed package manifest and
lockfile, the NSIS fallback, the embedded payload displays, and every
production container reference. All of them must be bumped together:

| Where                                      | Field                                                     | Format for tag `v0.2.1`                  |
| ------------------------------------------ | --------------------------------------------------------- | ---------------------------------------- |
| `package.json` (repo root)                 | `version`                                                 | `0.2.1`                                  |
| `game/project.godot`                       | `config/version`                                          | `0.2.1`                                  |
| `game/export_presets.cfg` (macOS preset)   | `application/short_version`, `application/version`        | `0.2.1`                                  |
| `game/export_presets.cfg` (Windows preset) | `application/file_version`, `application/product_version` | `0.2.1.0` — **numeric, four components** |

The Windows fields take the tag version with `.0` appended (`X.Y.Z` → `X.Y.Z.0`); a prerelease suffix is stripped first (`v0.3.0-rc1` → `0.3.0.0`).

Reproduce the check locally before tagging anything:

```bash
scripts/check-release-version.sh v0.2.1
# [check-release-version] OK — all versions aligned with tag v0.2.1
```

Exit codes: `1` no tag resolvable · `2` malformed tag · `3` version mismatch.

### The other `package.json` files and lockfiles

`web/`, `cli/`, `cli/wizard/`, `shared/`, `shared/cron/` and `e2e/` follow the
root release version. Some are private packages.

The rule used to cover `desktop/app-payload/` as well — a legacy tree that
`release.yml` did not build, kept version-aligned so it would not identify
itself as another release. **That tree was removed in #177**: it was the
residue of the Electron app, the thin launcher had already dropped it from
`extraResources`, and it was riding into the runtime image through the build
context with a copy of the authorisation code from before #158. A tree nobody
builds does not need a version; it needs to not be there.

**Rule (updated 2026-08-04): manifests and both version fields in every matching
`package-lock.json` follow the root version.** Regenerate locks with
`npm install --package-lock-only --ignore-scripts`; do not edit only the first
JSON field, because a stale `packages[""]` entry makes `npm ci` install a tree
different from the manifest.

```bash
scripts/check-release-version.sh vX.Y.Z
```

`tests/js` is the only package deliberately excluded: it is a repository test
runner and is not shipped. `scripts/dev-up.sh` likewise stays on the moving
`latest` development image. Every installer, production compose and runtime
fallback repeats the content-addressed identity in
`release/runtime-image.v1.json`; `runtime_image_pin.py verify-tree` rejects a
semver or `latest` fallback even when the digest copy is still present.

---

## ✅ Pre-release checklist

- [ ] **Bump every checked version field and regenerate every lockfile** for the new `X.Y.Z`.
- [ ] **Update `CHANGELOG.md`** — rename the `[Unreleased]` heading to `[X.Y.Z] — YYYY-MM-DD` and open a fresh empty `[Unreleased]` block above it. The release job extracts the body of `## [X.Y.Z]` as the GitHub Release notes; if that block is missing it silently falls back to a `git log` dump, which is how a release ends up with unreadable notes.
- [ ] **Freeze the runtime before the pin commit.** Wait for the green Docker
  workflow of the chosen master commit, record its multi-arch digest plus OCI
  `revision` in `release/runtime-image.v1.json`, and update every consumer to
  the resulting `repository@sha256:…`. The source revision must be an ancestor
  of the release commit. The pin commit is host/release metadata and does not
  redefine the already-built runtime bytes. Run
  `python scripts/runtime_image_pin.py verify-source` to attest the recorded
  digest directly, without depending on the moving `master` tag.
- [ ] Run `scripts/check-release-version.sh vX.Y.Z` locally — it must print `OK`.
- [ ] **Decide the provider CLI versions** this release installs — `shared/config/provider-versions.json` (issue #130). Leaving them as they are is a decision too, and the right one unless a bump has been tested: the setup installs exactly what that file declares, so a machine on `vX.Y.Z` runs the same provider CLI as every other. If you do bump one, change `version`, `pinned_at` and `note` together (the diff is the release trace), and run the e2e of the affected platform: the pin is the only thing standing between a release and an untested runtime. `jht providers versions` prints expected vs installed on any machine.
- [ ] Run the test suites: `npm test` (vitest + pytest) and, if the game changed, `npm run app:test`.
- [ ] Commit as `chore(release): prepare vX.Y.Z` and push to `master`.
- [ ] **Merge `master` into `production`** and push it — the release job refuses any tag that does not point at `origin/production` HEAD.
- [ ] Create the tag. Preferred: run the **Tag Production Release** workflow (`workflow_dispatch`, input = version without the leading `v`) — it tags `origin/production` for you and refuses an existing tag. Manual equivalent:

```bash
git checkout production && git pull
git tag -a v0.2.1 -m "Job Hunter Team v0.2.1"
git push origin v0.2.1
```

---

## ⚙️ What CI does with the tag

**1 · `check-version`** — runs `scripts/check-release-version.sh` on the tag name. Fails the whole workflow on any mismatch.

**2 · `build-game`** — one job per platform (`windows-2022`, `macos-14`, `ubuntu-22.04`), Godot **4.7.0** with export templates:

- runs the **canonical `gate` tier** — `game/tools/run.sh test gate`, or
  `game/tools/run.ps1 test gate` on Windows — *before* the export, so the
  heaviest step never runs behind a red gate. Until 2026-08-14 this step
  carried its own copy of the self-test list, which had to be kept in step with
  `game.yml` by hand; the list now lives only in
  [`game/tools/test-matrix.txt`](../../../game/tools/test-matrix.txt) and adding
  a `gate` row there makes the test blocking for the release too, with no
  parallel list to update. The single declared exclusion is causal: `run.ps1`
  skips the `posix` rows out loud, because they cannot execute on Windows. The
  `watch` tier is reported but never blocks;
- exports the release preset;
- **macOS only**: signs with the Developer ID identity, submits to `notarytool --wait`, staples the ticket and asserts `spctl --assess`. The five Apple secrets are **mandatory** — the job fails fast with an explicit error when they are missing (see the playbook in [`MAINTAINERS.md`](MAINTAINERS.md#-macos-code-signing--notarization));
- smoke-tests the exported binary (`--headless --quit-after 3` with `JHT_NOVPS=1`), so a build that cannot even boot never reaches a release;
- gates the **packaged** title footer on the bytes that become the assets — the
  Windows portable after NSIS packaging, the binary extracted from the Linux
  tarball, the app extracted from the signed and notarized macOS zip. It builds
  the real title screen and refuses a mismatch between the version it displays
  and the tag being released;
- records a provenance sidecar for the final asset, tied to the resolved tag
  commit and its SHA-256;
- uploads the artifact.

**3 · `publish-runtime`** — reads the canonical manifest, verifies the pinned
multi-arch index and both amd64/arm64 OCI `revision` labels, then handles the
semver tag. An absent tag is created from the digest; an existing identical
tag is accepted; an existing different tag stops the release without being
overwritten. The full Git ref is the publication claim: workflow concurrency
serializes the registry check/create/readback window for every rerun of that
release, with cancellation disabled. `.github/workflows/docker.yml` never
publishes semver tags.

**4 · `release`** — re-checks that the tag is `origin/production` HEAD, builds the web app (`npm ci` in `web/` **and** `shared/`, because the web build imports `shared/config/schema.ts` which needs `zod`), extracts the release notes from `CHANGELOG.md`, downloads the four platform artifacts, adds `RUNTIME-IMAGE.json`, verifies their provenance and hashes, generates `SHA256SUMS` plus `RELEASE-PROVENANCE.json`, and then creates the GitHub Release as a **draft**. The release body prints the same SHA-256 lines under the human-readable notes: `scripts/release_artifacts.py notes` consumes the already-verified `RELEASE-PROVENANCE.json`, so it cannot drift into a second platform-asset list. A tag containing `-` (e.g. `v0.3.0-rc1`) is marked as a **prerelease** when published.

**5 · independent draft audit and publication** — download the assets back from
GitHub, verify the exact public bytes and only then publish:

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

The audit requires the downloaded asset set to match provenance exactly and
recomputes every size and SHA-256. If it fails, leave the release in draft and
fix forward; never publish or replace one file by hand.

### Artifacts

| Platform          | Preset            | Asset                                                                                                             |
| ----------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------- |
| Windows x64       | `Windows Desktop` | `job-hunter-team-windows-x64-setup.exe` (primary per-user installer) + `job-hunter-team-windows-x64-portable.exe` |
| macOS Universal 2 | `macOS`           | `job-hunter-team.zip` (signed, notarized, stapled)                                                                |
| Linux x64         | `Linux`           | `job-hunter-team-linux-x64.tar.gz`                                                                                |
| Runtime identity  | —                 | `RUNTIME-IMAGE.json` (repository, release version, digest, source revision)                                      |
| All assets        | —                 | `SHA256SUMS` + `RELEASE-PROVENANCE.json` (tag commit, byte size, SHA-256)                                         |

Asset names do **not** carry the version — the GitHub Release tag is the version. There is no separate Windows ARM64 installer any more (the Electron pipeline produced one; the Godot export targets x64, which runs under Windows-on-ARM emulation).

The Windows runner exports the portable Godot executable, builds and
smoke-tests the per-user NSIS package, then publishes the installer as the
primary asset and the renamed portable executable as a secondary option. Both
are covered by the same tag-bound provenance and checksum gate.

> The public `/download` page offers both install modes: the terminal path uses
> `curl -fsSL https://jobhunterteam.ai/install.sh | bash`, while the desktop
> path links to the stable asset names on the latest GitHub Release. Windows
> presents the NSIS installer first and labels the portable executable as the
> alternative.

---

## 🧪 Building locally before tagging

```bash
npm run app:test          # game/tools/run.sh test — the full matrix, gate + watch
npm run app:dist          # scripts/build-release.sh auto — export for the host OS
```

`build-release.sh` runs `run.sh test gate` / `run.ps1 test gate` before
exporting, the same tier CI blocks on, so a local build cannot skip a gate the
release would have failed on. It only builds for the host platform (macOS builds need macOS, and so on); `all` is deliberately rejected — use the Release workflow for the three-runner matrix. The local export is **unsigned**: only CI has the Apple credentials.

---

## 🔧 If CI fails

**Version check.** Don't force-push the tag. Delete it, fix every reported field, commit, re-tag:

```bash
git push origin :refs/tags/vX.Y.Z     # remove the broken tag remote-side
git tag -d vX.Y.Z                     # remove it locally
# …fix versions, commit, merge to production, then re-tag…
git tag -a vX.Y.Z -m "Job Hunter Team vX.Y.Z"
git push origin vX.Y.Z
```

Same rule for any other failure: fix forward, delete the tag, re-tag the new `production` HEAD. A release that failed does not get a bumped version number — keep the one that failed (memory `feedback_fix_release_no_bump`).

**Tag ≠ production HEAD.** The `release` job stops with `Tag releases only from the current production HEAD`. Merge `master` into `production`, push, then re-tag.

**Runtime tag mismatch.** Do not repair or overwrite it. Confirm the manifest
against the intended green master build. If the registry tag moved, leave the
release red and investigate; the digest remains runnable and is the authority.

**macOS credentials missing.** `macOS game releases require signing and notarization credentials` — configure the five secrets listed in [`MAINTAINERS.md`](MAINTAINERS.md#-macos-code-signing--notarization). There is no unsigned fallback: an unsigned build would be blocked by Gatekeeper on the user's machine.

---

## Windows desktop-only 0.3.10 distribution

This explicit exception distributes the already tested Windows installer,
not a full-product release or a newly built runtime. Its tag is
`desktop-windows-v0.3.10`, pointing **exactly** to
`450945129f025a25d18adfd72c1da65b7ec4d319`: base public `v0.3.9`
(`8227b1cb…`), protected-directory ACL fix `c03add105…`, then desktop metadata
0.3.10. Root package manifests and runtime remain 0.3.9. The separate Mac
shutdown experiments do not belong to this source or distribution.

The normal `vX.Y.Z` tag workflow is inappropriate: it checks all package
versions and builds/publishes the complete product. The desktop tag does not
match `release.yml`; it does not trigger Docker or deployment workflows.
Existing `game.yml` and `windows-config-acl.yml` **do** run on its tag push:
they have only push path filters, which GitHub ignores for tag pushes. Leave
these checks enabled and observe their outcomes. Their newly built Actions
artifacts never replace the approved installer bytes. No skip, cancellation,
workflow modification or implicit full-product version alignment is part of
this procedure. Recheck actual workflows before performing any push.

Use title **Desktop Windows 0.3.10 — correzione avvio**, initially a draft,
with `prerelease=true` and `make_latest=false`. GitHub excludes prereleases
from its latest full-release API; CLI, Godot and the web latest-release
consumer also reject prereleases and non-semver desktop tags. This keeps
runtime and other operating systems on their truthful baseline identities.
The site later selects the Windows installer through its explicit artifact
entry, independently of the latest full-product release.

The draft must contain **exactly three regular downloaded files**:

- `job-hunter-team-windows-x64-setup-0.3.10.exe`: 295179599 bytes,
  SHA-256 `abd5a07362e09bd22c4c4995bb55147bf362e3b3252ca35ab2f987f8cd01146a`.
- `DESKTOP-RELEASE-PROVENANCE.json`: canonical `jht.desktop-release.v1`
  identity, source/base/fix, local Godot/NSIS build, desktop version, unchanged
  runtime identity and validation limits.
- `SHA256SUMS`: checksums of that installer and its desktop provenance.

`scripts/desktop_release_audit.py` pins the independent tester-approved
identity. It rejects missing/unknown files, links/directories, different
installer bytes and altered or self-consistently forged metadata. It never
derives approval from downloaded checksums. `release_artifacts.py` and the
original 0.3.9 audit are unchanged; neither desktop metadata nor binaries are
attached to that older release.

Execution gates, in order:

1. Obtain the written pre-push verdict on exact source `450945129…` and the
   separately reviewed audit/runbook commit. Review `8227b1cb…450945129` and
   native ACL/G3 evidence. Push only explicitly approved refs; verify the
   public tag resolves to the exact source and that source is inspectable.
   Do not let `gh release create` silently create a tag from default HEAD:
   use `--verify-tag`. Observe existing Game/ACL CI and resolve or report
   pertinent failures before publication.
2. Under scoped authorization create the draft, `--prerelease --latest=false`,
   with prepared notes, then upload only the three frozen files. No rebuild,
   `--clobber`, old-release edit, deletion, runtime publication or new platform
   artifact. Stop on a collision, partial upload or unexpected state.
3. Independently download **all** assets from the draft into a fresh directory;
   store the API response outside it. Run:

   ```bash
   python scripts/desktop_release_audit.py --directory "$AUDIT_DIR" \
     --release-api "$RELEASE_API_FILE"
   ```

   Verify public source/tag resolution separately. Check actual release ID,
   draft/prerelease state, all asset names, sizes and available API digests.
   The draft readback and independent review must pass before publication.
4. Only after the publication gate, publish with prerelease preserved and
   `--latest=false`. Repeat public full-byte readback and the same audit with
   `--published`; verify immutable URL, filename, GET/HEAD and delivery size.
   Read back `/releases/latest` and the original 0.3.9 metadata/inventory to
   confirm they are unchanged. No automatic recovery mutates published assets.
5. Activate only the complete `win-setup` entry on the production-derived web
   integration, using the real verified tag URL, filename, version, size,
   checksum and source. Other artifacts remain 0.3.9. Run relevant funnel,
   guide and installer contracts, cloud build and HTTP smoke through the shared
   turn. Obtain the exact web commit's written pre-push verdict and deployment
   gate. Withdrawal uses the existing null/503 contract, never an automatic
   fallback to the known failing 0.3.9 installer.

Only Windows native ACL causality and G3 installer **RESUME** passed for these
bytes. Clean installation, portable execution, runtime/team/G4, Internet
SmartScreen and other platforms are not covered. The new Mac candidate has
its own unresolved crash investigation and is excluded.

Primary references: [GitHub release CLI flags](https://cli.github.com/manual/gh_release_create),
[latest release API semantics](https://docs.github.com/en/rest/releases/releases#get-the-latest-release),
and [push tag/path filters](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#onpushpull_requestpull_request_targetpathspaths-ignore).

## 📚 Related

- 📋 [`CHANGELOG.md`](../../../CHANGELOG.md) — release-by-release history (and the source of the release notes)
- 🔒 [`MAINTAINERS.md`](MAINTAINERS.md) — Apple signing playbook, Vercel env vars, OAuth setup, contact
- 🚢 [BACKLOG · Docs & launch assets](../../../BACKLOG.md#-docs--launch-assets-maintainer) — what blocks the public 1.0 launch
- 🗄️ [`supabase/README.md`](../../../supabase/README.md) — the live-schema canary and the offline web coverage gate, if the release changes the cloud schema or the web query surface
