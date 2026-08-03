# 📚 Documentation — Job Hunter Team

Top-level index of the documentation. Folders are ordered from the most
user-facing to the most internal.

---

## 🎮 [`game/docs/`](../game/docs/) — the native desktop application
The Godot office is the only desktop client, and its docs stay colocated with the
code in [`game/docs/`](../game/docs/) — this index points at them, it does not host them.
Three entry points:
- 🏛️ [`GDD.md`](../game/docs/GDD.md) — current product design: what the office is, the rooms, what each agent does on screen
- 👋 [`FIRST-RUN.md`](../game/docs/FIRST-RUN.md) — first-run contract: the token-free showroom conversation, and where the provider boundary sits
- 🔌 [`DATA-ADAPTER.md`](../game/docs/DATA-ADAPTER.md) — the contract between the game and the team's data (`TeamData` autoload, no Supabase in the scenes)

Also there: `ROADMAP` · `ASSETS` · `SPRITES` · `ANALISI-GIOCHI` · `RESEARCH-DOSSIER`.

## 🎯 [`about/`](about/) — what JHT is and whether it works
Public docs for anyone evaluating JHT, in two clusters (see the [index](about/README.md)):
- 📖 **Narrative:** `VISION` · `STORY` · `ROADMAP`
- 🔬 **Evidence & economics:** `PROVIDERS` · `MONITORING` · `RESULTS`

## 📘 [`guides/`](guides/) — operational guides
Setup, usage and operations (see the [index](guides/README.md)). All in English, `UPPERCASE-KEBAB` naming.
- 🚀 **Start:** `QUICKSTART` · `CLI-INSTALL` · `CLI-REFERENCE` · `AI-AGENT-INTEGRATION`
- 📦 **Evidence:** `M4-EVIDENCE-BUNDLES` · `ADDING-A-PROVIDER` · `LOCAL-SCORER`
- ☁️ **VPS:** `VPS-SETUP-WIZARD` · `VPS-SETUP`
- 🧪 **Beta:** `BETA` · `FEEDBACK-TICKETING` · `EMAIL-FORWARDING`

## 🏛️ [`adr/`](adr/) — architecture decision records
The binding choices and their rationale.
`0001` Colima · `0002` 3 agent CLIs · `0003` single-writer · `0004` no-API-keys · `0005` provider-risk · `0006` user-choice container runtime *(supersedes 0001)*

## 🔒 [`security/`](security/) — security
Pre-launch review, threat model, checklist, comparisons.
`01`→`06` + `README`

## 🚀 [`launch/`](launch/) — launch materials
`demo-storyboard` (drafts of public posts — Show HN etc. — live outside the repo)

## 📊 [`sessions/`](sessions/) — real-run logs
One folder per agent run (Codex/Kimi/long-session) with a README + data dumps.

## 🔧 [`internal/`](internal/) — internal working notes
Living architecture notes, postmortems, experiments, roadmap, ops. See
[`internal/README.md`](internal/README.md) for the per-category index:
`architecture/` · `postmortems/` · `experiments/` · `roadmap/` · `ops/` · `prototypes/` · `_archive/`

---

> 📄 Meta documents in the repo root: `README.md` · `CHANGELOG.md` ·
> `BACKLOG.md` · `SECURITY.md` · `CODE_OF_CONDUCT.md`.
