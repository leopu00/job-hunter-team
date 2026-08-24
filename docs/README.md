# 📚 Documentation — Job Hunter Team

Top-level index of the documentation. Folders are ordered from the most
user-facing to the most internal.

---

## 🖥️ Desktop applications

The supported Godot office remains in [`game/`](../game/) while the new Tauri 2
and React shell is developed incrementally in [`desktop/`](../desktop/). The
migration plan is
[`2026-08-24-desktop-tauri-migration.md`](internal/roadmap/2026-08-24-desktop-tauri-migration.md)
and the setup matrix is
[`2026-08-24-desktop-setup-modes.md`](internal/architecture/2026-08-24-desktop-setup-modes.md).

Godot product docs stay colocated in [`game/docs/`](../game/docs/). Three entry
points:
- 🏛️ [`GDD.md`](../game/docs/GDD.md) — current product design: what the office is, the rooms, what each agent does on screen
- 👋 [`FIRST-RUN.md`](../game/docs/FIRST-RUN.md) — first-run contract: the token-free showroom conversation, and where the provider boundary sits
- 🔌 [`DATA-ADAPTER.md`](../game/docs/DATA-ADAPTER.md) — the contract between the game and the team's data (`TeamData` autoload, no Supabase in the scenes)

Also there: `ROADMAP` · `ASSETS` · `SPRITES` · `ANALISI-GIOCHI` · `RESEARCH-DOSSIER`.

## 🎯 [`about/`](about/) — what JHT is and whether it works
Public docs for anyone evaluating JHT, in two clusters (see the [index](about/README.md)):
- ❓ **Start here:** [`FAQ`](about/FAQ.md) — what it is and is not, Docker, cost, data, VPS
- 📖 **Narrative:** `VISION` · `STORY` · `ROADMAP`
- 🔬 **Evidence & economics:** `PROVIDERS` · `MONITORING` · `RESULTS`

## 📘 [`guides/`](guides/) — operational guides
Setup, usage and operations (see the [index](guides/README.md)). All in English, `UPPERCASE-KEBAB` naming.
- 🚀 **Start:** `CHOOSE-WHERE-TO-RUN` · `QUICKSTART` · `CLI-INSTALL` · `CLI-REFERENCE` · `AI-AGENT-INTEGRATION`
- 📦 **Evidence:** `M4-EVIDENCE-BUNDLES` · `ADDING-A-PROVIDER` · `LOCAL-SCORER`
- ☁️ **VPS:** `VPS-SETUP-WIZARD` · `VPS-SETUP`
- 🧪 **Testing & feedback:** `BETA` · `FEEDBACK-TICKETING` · `EMAIL-FORWARDING`

## 📄 [`examples/`](examples/) — annotated profile templates
`candidate_profile.yml.example` and its HR variant: the commented schema the
agent skills point at. They document the *structure* — never a source of values
for a real profile.

## 🏛️ [`adr/`](adr/) — architecture decision records
The binding choices and their rationale.
`0001` Colima · `0002` 3 agent CLIs · `0003` single-writer · `0004` no-API-keys · `0005` provider-risk · `0006` user-choice container runtime *(supersedes 0001)* · `0007` provider selection is configuration

## 🔒 [`security/`](security/) — security
Historical security audit, current threat model, checklist and comparisons.
`01`→`07` + `README`

## 📊 [`sessions/`](sessions/) — real-run logs
One folder per agent run (Codex/Kimi/long-session) with a README + data dumps.

## 🔧 [`internal/`](internal/) — internal working notes
Living architecture notes, postmortems, experiments, roadmap, ops. See
[`internal/README.md`](internal/README.md) for the per-category index:
`architecture/` · `postmortems/` · `experiments/` · `roadmap/` · `ops/` · `prototypes/` · `_archive/`

## 🗄️ [`archive/`](archive/) — retired material
Historical onboarding, feature and release-planning documents. These are not
current instructions and are retained only for traceability. [`launch/`](launch/)
holds the same kind of material for launch assets: today a single retired demo
storyboard that points back at its archived original.

---

> 📄 Meta documents in the repo root: `README.md` · `CHANGELOG.md` ·
> `BACKLOG.md` · `SECURITY.md` · `CODE_OF_CONDUCT.md`.
