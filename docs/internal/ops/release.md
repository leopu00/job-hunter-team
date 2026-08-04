# 🚢 Release

Cutting a release means pushing a `vX.Y.Z` tag that points at the **`production` HEAD**. CI then runs [`.github/workflows/release.yml`](../../../.github/workflows/release.yml): it verifies the tag against every version field, builds the **native Godot desktop application** on three runners, signs and notarizes the macOS build, builds the web app as a regression gate, and publishes a GitHub Release with the three artifacts attached.

> 🖥️ **The desktop application is the Godot office in [`game/`](../../../game/).** The Electron launcher (`desktop/`) was removed with the native migration on 2026-07-19 — nothing in the release pipeline uses electron-builder any more. If a doc still mentions `desktop/package.json`, it predates that change.

---

## 🔢 Release version fields

`scripts/check-release-version.sh` is the first CI job. It compares the tag
against the application metadata below, every distributed package manifest and
lockfile, the NSIS fallback, the embedded payload displays, and every
production container reference. All of them must be bumped together:

| Where | Field | Format for tag `v0.2.1` |
|---|---|---|
| `package.json` (repo root) | `version` | `0.2.1` |
| `game/project.godot` | `config/version` | `0.2.1` |
| `game/export_presets.cfg` (macOS preset) | `application/short_version`, `application/version` | `0.2.1` |
| `game/export_presets.cfg` (Windows preset) | `application/file_version`, `application/product_version` | `0.2.1.0` — **numeric, four components** |

The Windows fields take the tag version with `.0` appended (`X.Y.Z` → `X.Y.Z.0`); a prerelease suffix is stripped first (`v0.3.0-rc1` → `0.3.0.0`).

Reproduce the check locally before tagging anything:

```bash
scripts/check-release-version.sh v0.2.1
# [check-release-version] OK — all versions aligned with tag v0.2.1
```

Exit codes: `1` no tag resolvable · `2` malformed tag · `3` version mismatch.

### The other `package.json` files and lockfiles

`web/`, `cli/`, `cli/wizard/`, `shared/`, `shared/cron/`, `e2e/` and the
packages under `desktop/app-payload/` follow the root release version. Some are
private packages. The `desktop/app-payload/` tree is a retained legacy/internal
payload and is not built by `release.yml`; keeping its metadata aligned avoids
shipping or inspecting a tree that falsely identifies itself as another
release.

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
`latest` development image; every installer, production compose and runtime
fallback is pinned to `ghcr.io/leopu00/jht:X.Y.Z`.

---

## ✅ Pre-release checklist

- [ ] **Bump every checked version field and regenerate every lockfile** for the new `X.Y.Z`.
- [ ] **Update `CHANGELOG.md`** — rename the `[Unreleased]` heading to `[X.Y.Z] — YYYY-MM-DD` and open a fresh empty `[Unreleased]` block above it. The release job extracts the body of `## [X.Y.Z]` as the GitHub Release notes; if that block is missing it silently falls back to a `git log` dump, which is how a release ends up with unreadable notes.
- [ ] Run `scripts/check-release-version.sh vX.Y.Z` locally — it must print `OK`.
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

- imports the project headless, then runs the Godot self-tests: `nav_grid_selftest`, `speech_bubble_selftest`, `pipeline_queue_selftest`, `embedded_terminal_selftest`, plus four scripted scenarios that must print their PASS marker (`VPS-CONTRACT-TEST`, `PIPELINE-FORCE-TEST`, `BACKEND-SWITCH-TEST`, `SIMULATION-DOCTOR-TEST`);
- exports the release preset;
- **macOS only**: signs with the Developer ID identity, submits to `notarytool --wait`, staples the ticket and asserts `spctl --assess`. The five Apple secrets are **mandatory** — the job fails fast with an explicit error when they are missing (see the playbook in [`MAINTAINERS.md`](MAINTAINERS.md#-macos-code-signing--notarization));
- smoke-tests the exported binary (`--headless --quit-after 3` with `JHT_NOVPS=1`), so a build that cannot even boot never reaches a release;
- uploads the artifact.

**3 · `release`** — re-checks that the tag is `origin/production` HEAD, builds the web app (`npm ci` in `web/` **and** `shared/`, because the web build imports `shared/config/schema.ts` which needs `zod`), extracts the release notes from `CHANGELOG.md`, downloads the three artifacts and publishes the GitHub Release. A tag containing `-` (e.g. `v0.3.0-rc1`) is published as a **prerelease**.

### Artifacts

| Platform | Preset | Asset |
|---|---|---|
| Windows x64 | `Windows Desktop` | `job-hunter-team.exe` (bare Godot executable) |
| macOS Universal 2 | `macOS` | `job-hunter-team.zip` (signed, notarized, stapled) |
| Linux x64 | `Linux` | `job-hunter-team-linux-x64.tar.gz` |

Asset names do **not** carry the version — the GitHub Release tag is the version. There is no separate Windows ARM64 installer any more (the Electron pipeline produced one; the Godot export targets x64, which runs under Windows-on-ARM emulation).

`game/installer/windows.nsi` is a dormant/manual packaging fallback. Its
metadata is version-gated so a manual build cannot claim `0.0.0`, but the
release workflow does not invoke `makensis` and does not publish an NSIS setup
artifact.

> The public `/download` page does not resolve GitHub assets: it hands out the CLI one-liner (`curl -fsSL https://jobhunterteam.ai/install.sh | bash`) and points at `/run`. Release artifacts are for people who download from the GitHub Releases page.

---

## 🧪 Building locally before tagging

```bash
npm run app:test          # game/tools/run.sh test — import + self-tests
npm run app:dist          # scripts/build-release.sh auto — export for the host OS
```

`build-release.sh` only builds for the host platform (macOS builds need macOS, and so on); `all` is deliberately rejected — use the Release workflow for the three-runner matrix. The local export is **unsigned**: only CI has the Apple credentials.

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

**macOS credentials missing.** `macOS game releases require signing and notarization credentials` — configure the five secrets listed in [`MAINTAINERS.md`](MAINTAINERS.md#-macos-code-signing--notarization). There is no unsigned fallback: an unsigned build would be blocked by Gatekeeper on the user's machine.

---

## 📚 Related

- 📋 [`CHANGELOG.md`](../../../CHANGELOG.md) — release-by-release history (and the source of the release notes)
- 🔒 [`MAINTAINERS.md`](MAINTAINERS.md) — Apple signing playbook, Vercel env vars, OAuth setup, contact
- 🚢 [BACKLOG · Docs & launch assets](../../../BACKLOG.md#-docs--launch-assets-maintainer) — what blocks the public 1.0 launch
