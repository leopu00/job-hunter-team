# 🚢 Release

Cutting a new release means pushing a `vX.Y.Z` tag to the `master` branch. CI then runs `.github/workflows/release.yml`: it verifies the tag matches the `version` field in both `package.json` files, builds the desktop apps (`.dmg` on macOS, `.AppImage` + `.deb` on Linux, NSIS `.exe` for Windows x64 **and** ARM64), and publishes a GitHub Release with all the artifacts attached.

The downstream `/download` page resolves the "latest release" from the GitHub API and points each OS/arch at the matching asset — so mismatched versions or missing architectures surface as broken downloads.

> ⏸️ **macOS code signing & notarization is currently deferred (post-beta)** — see [`MAINTAINERS.md`](./MAINTAINERS.md#-macos-code-signing--notarization-deferred-post-beta) for the playbook to enable it later. Today's `.dmg` ships unsigned and triggers a Gatekeeper warning at first launch (the OSS-as-trust-signal positioning, see memory `project_open_source_as_trust_signal`).

---

## ✅ Pre-release checklist

Run through this checklist on the branch about to be tagged:

- [ ] **Bump `version` in the root `package.json`** to the new `X.Y.Z`. The dev convention is `X.Y.Z-dev`; strip the `-dev` suffix only at release time.
- [ ] **Bump `version` in `desktop/package.json`** to the *same* `X.Y.Z` (electron-builder uses this field for `artifactName`, so forgetting it produces assets still named after the previous release).
- [ ] **Update `CHANGELOG.md`** — convert the `[Unreleased]` section to `[X.Y.Z] — YYYY-MM-DD` and start a fresh empty `[Unreleased]` block on top. The release workflow extracts the version block as the GitHub Release notes.
- [ ] Commit the bump: `chore(release): prepare vX.Y.Z`
- [ ] Push the commit to `master`
- [ ] Tag the commit: `git tag vX.Y.Z`
- [ ] Push the tag: `git push origin vX.Y.Z`

The version-consistency check runs as the first CI job and fails the entire workflow if any of the three versions (tag / root / desktop) are out of sync. You can reproduce it locally:

```bash
scripts/check-release-version.sh vX.Y.Z
```

---

## 🔧 If CI fails on the version check

Don't force-push the tag. Delete it, fix the `package.json` files, commit, and create a fresh tag pointing at the new commit:

```bash
git push origin :refs/tags/vX.Y.Z     # remove the broken tag remote-side
git tag -d vX.Y.Z                     # remove it locally
# …fix versions, commit, then re-tag…
git tag vX.Y.Z
git push origin vX.Y.Z
```

---

## 🪟 Windows ARM64

From `v0.1.10` onwards the Windows build produces two NSIS installers, one per architecture:

- `job-hunter-team-<version>-windows-x64.exe`
- `job-hunter-team-<version>-windows-arm64.exe`

Both are uploaded to the same GitHub Release. The `/download` page detects ARM64 Windows via User-Agent (`Windows NT ... ARM64` or `aarch64`) and shows the matching installer as the primary CTA.

---

## 📚 Related

- 📋 [`CHANGELOG.md`](../CHANGELOG.md) — release-by-release history
- 🔒 [`docs/MAINTAINERS.md`](./MAINTAINERS.md) — macOS signing playbook (when we re-enable it), Vercel env vars, OAuth setup, contact
- 🚢 [BACKLOG · Phase 6 Pre-Launch](../BACKLOG.md#6️⃣-phase-6--🚢-pre-launch-public-oss-new) — what blocks the public 1.0 launch
