# 🐚 scripts — setup, install & dev tooling

Bash/PowerShell scripts for installing, developing, releasing, and simulating
Job Hunter Team.

## What's here

| Area | Scripts |
|---|---|
| 📦 **Install** | `install.sh` · `install.ps1` · `host-setup.sh` · `sync-public-installers.sh` |
| 📜 **Legacy onboarding** | `setup.sh` · `setup.ps1` — from-source onboarding in an already-cloned repo (deprecated in favor of the one-liner installer, see [`docs/guides/CLI-INSTALL.md`](../docs/guides/CLI-INSTALL.md)) |
| 🐳 **Dev (container)** | `dev-up.sh` · `dev-down.sh` · `dev-up-additional.sh` · `dev-down-additional.sh` |
| 🔒 **Repository policy** | `github_protection_gate.py` — read-only GitHub protection, ruleset, and signature audit |
| 🏷️ **Release** | `build-release.sh` · `build-windows-installer.ps1` · `jht-windows-install-preflight.ps1` (guard owner/ACL/link incorporato nel setup) · `check-release-version.sh` |
| 🧪 **Simulation** | `sim/` — `sim-up.sh` / `sim-down.sh` / `sim-reset.sh`, Supabase seed import/export |
| 📊 **Analysis** | `analysis/m4_kimi_windows.py` (Kimi window variance/headroom) · `analysis/m4_cost_compare.py` (explicit-unit PAYG/subscription scenarios) · `analysis/m5_score_quality.py` (distribution-only and paired Local Scorer comparisons) |
| 🧰 **Wrappers / misc** | `jht-wrapper.sh` · `jht-wrapper.ps1` · `migrate-deliverables-to-user-dir.sh` · `review-log.py` · `pre-commit` |
| ✅ **Test** | `test-fullflow-wsl.sh` · `test-providers.sh` |

## Important

> 🛑 Never run a bare `next dev` from `web/`. Use **`scripts/dev-up.sh`** — it
> exports `JHT_SHELL_VIA=docker:jht` and wires the dashboard to the team
> container. A bare `next dev` can corrupt `.next` and destabilize the dev loop.

## GitHub protection bootstrap

`github_protection_gate.py` is an observer, not a repair command. Live mode uses
only GitHub API `GET` requests and emits a fixed pass line or finite policy/error
codes; it never prints API payloads, command stderr, credentials, or paths.

```bash
python scripts/github_protection_gate.py --snapshot tests/fixtures/github-protection/target-pass.json
python scripts/github_protection_gate.py --snapshot tests/fixtures/github-protection/current-fail.json
python scripts/github_protection_gate.py --live
```

Before applying the target policy in GitHub settings, prepare both prerequisites:

1. Add and verify a second, distinct GitHub identity that can review as a
   CODEOWNER and recover repository administration. Confirm its access before
   removing the admin `always` bypass.
2. Open a temporary canary branch and PR. From every integration PC, push a
   signed canary commit, obtain the independent CODEOWNER approval, wait for all
   six exact required checks, merge, and verify the merged commit signature.

Apply one live setting at a time, rerun `--live`, then repeat the positive canary
and these negative checks: direct admin push is rejected; an unapproved or
unsigned update is rejected; a new push dismisses the approval; and a stale
branch cannot merge before updating. Keep force-push and branch deletion off.

The gate does not create branches or PRs, edit CODEOWNERS, change GitHub settings,
create tags, or repair the release workflow.

## See also

- Release process: [`docs/internal/ops/release.md`](../docs/internal/ops/release.md)
- VPS / infra: [`docs/internal/ops/vps.md`](../docs/internal/ops/vps.md) · [`docs/internal/ops/INFRA.md`](../docs/internal/ops/INFRA.md)
