# 🐚 scripts — setup, install & dev tooling

Bash/PowerShell scripts for installing, developing, releasing, and simulating
Job Hunter Team.

## What's here

| Area | Scripts |
|---|---|
| 📦 **Install** | `install.sh` · `install.ps1` · `host-setup.sh` · `sync-public-installers.sh` |
| 📜 **Legacy onboarding** | `setup.sh` · `setup.ps1` — from-source onboarding in an already-cloned repo (deprecated in favor of the one-liner installer, see [`docs/guides/CLI-INSTALL.md`](../docs/guides/CLI-INSTALL.md)) |
| 🐳 **Dev (container)** | `dev-up.sh` · `dev-down.sh` · `dev-up-additional.sh` · `dev-down-additional.sh` |
| 🏷️ **Release** | `build-release.sh` · `check-release-version.sh` |
| 🧪 **Simulation** | `sim/` — `sim-up.sh` / `sim-down.sh` / `sim-reset.sh`, Supabase seed import/export |
| 📊 **Analysis** | `analysis/m4_kimi_windows.py` (Kimi window variance/headroom) · `analysis/m4_cost_compare.py` (explicit-unit PAYG/subscription scenarios) · `analysis/m5_score_quality.py` (distribution-only and paired Local Scorer comparisons) |
| 🧰 **Wrappers / misc** | `jht-wrapper.sh` · `jht-wrapper.ps1` · `migrate-deliverables-to-user-dir.sh` · `review-log.py` · `pre-commit` |
| ✅ **Test** | `test-fullflow-wsl.sh` · `test-providers.sh` |

## Important

> 🛑 Never run a bare `next dev` from `web/`. Use **`scripts/dev-up.sh`** — it
> exports `JHT_SHELL_VIA=docker:jht` and wires the dashboard to the team
> container. A bare `next dev` can corrupt `.next` and destabilize the dev loop.

## See also

- Release process: [`docs/internal/ops/release.md`](../docs/internal/ops/release.md)
- VPS / infra: [`docs/internal/ops/vps.md`](../docs/internal/ops/vps.md) · [`docs/internal/ops/INFRA.md`](../docs/internal/ops/INFRA.md)
