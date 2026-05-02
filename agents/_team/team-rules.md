# 📋 Team-Wide Rules — JHT Agents

These rules apply to every agent in the JHT team. Each rule applies
verbatim **unless an explicit rule in the agent's own prompt overrides
it**.

Each individual prompt should reference this file at the top of its
RULES section (template at the bottom).

---

## 🚫 RULE-T01 — Never kill tmux

Never kill the tmux server. Never kill another agent's session.

---

## 🛠️ RULE-T02 — Never modify code, config, or git state

Do not edit source files, configuration, or lock files. Do not run any
`git` command. Your write surface is limited to the artifacts your
role produces and your own scratch files inside `$JHT_HOME`.

---

## 📡 RULE-T03 — Inter-agent messaging via `jht-tmux-send`

All messages to other agents go through `jht-tmux-send`
(`/app/agents/_tools/jht-tmux-send`). Never raw `tmux send-keys`. The
skill bundles the atomic *text + Enter + render-pause* the Codex/Kimi
TUIs require; raw `send-keys` deadlocks them.

---

## 🧠 RULE-T04 — No hallucinations

Never invent numbers, file paths, URLs, candidate facts, JD
requirements, scores, dates, or any datum you have not read from a
verified source. When a value is missing, say so and stop.

---

## 🛤️ RULE-T05 — Stay in your lane

Do only the job your role defines. If a task that is not yours lands
in your inbox, acknowledge it, point to the right agent, and drop it.
Role matrix: [`agents/_team/architettura.md`](architettura.md).

---

## 🇬🇧 RULE-T06 — Write in English

Prompts, logs, internal reasoning, and free-form messages are in
English. Exception: protocol tokens other agents parse verbatim — the
Sentinel order vocabulary (`STEADY`, `ATTENZIONE`, `EMERGENZA`,
`MANTIENI`, `SCALA UP`, `RALLENTARE`, `ACCELERARE`,
`RECOVERY TRACKING`, `PUSH G-SPOT`, `RIENTRO`, `RESET SESSIONE`,
`PAUSA TEAM`, `HARD FREEZE`, `RIPRENDI`).

---

## 🧊 RULE-T07 — Honor Sentinel orders

On a freeze, soft-pause, or `[ESC]` from the Sentinel, stop what you
are doing — mid-tool-call if needed — and wait for `[RIPRENDI]` from
the Captain. Do not retry the interrupted action.

---

## 🔄 RULE-T08 — No infinite loops, never die silently

Your main loop terminates exactly one of three ways: a clean stop on
a defined exit condition, a logged error that names the cause, or a
hand-off message to your parent. Never sleep forever, never
`while true` without a break, never exit without an outbound message.

---

## 🗄️ RULE-T09 — DB-first coordination

Persistent state lives in the SQLite DB at `$JHT_HOME/jobs.db`. Tmux
messages carry only notifications (`[RES]`, `[REQ]`, `[ACK]`, `[ESC]`,
…), never the data itself. If the DB write fails, the notification is
not sent. Schema: [`agents/_manual/db-schema.md`](../_manual/db-schema.md).

---

## 🔐 RULE-T10 — Candidate data is read-only and verbatim

The candidate profile (`$JHT_HOME/profile/candidate_profile.yml` and
related files) is read-only. Quote names, skills, experience, and
contacts verbatim. If a field your role needs is missing, escalate —
do not invent.

---

## 📤 RULE-T11 — Deliverables go to the user-visible zone

Final artifacts the user is expected to read or attach to an
application MUST be written under `$JHT_USER_DIR` (exported in every
agent session by `start-agent.sh`, defaults to `~/Documents/Job Hunter
Team/` on the host, `/jht_user/` in the container). Canonical layout:

| Artifact | Path |
|---|---|
| CV (Markdown + PDF) | `$JHT_USER_DIR/cv/` |
| Critic reviews | `$JHT_USER_DIR/critiche/` |
| Cover letters & extra attachments | `$JHT_USER_DIR/allegati/` |
| Final per-position packets | `$JHT_USER_DIR/output/` |

`$JHT_AGENT_DIR` (= `$JHT_HOME/agents/<role>[-N]/`, also the tmux
cwd) is **scratch space only**: drafts, intermediate notes, chat
state. Never leave a deliverable there — the user does not look in
`$JHT_HOME` and writers/critics that did so in the past produced 7
parallel paths and an empty `$JHT_USER_DIR/cv/`.

When you record a path in the DB (`applications.cv_path`,
`applications.cv_pdf_path`, …), record the `$JHT_USER_DIR/...` path,
not a scratch path under `$JHT_AGENT_DIR`.

---

## 🧰 RULE-T12 — Workspace layout and periodic housekeeping

Your `$JHT_AGENT_DIR` (= `$JHT_HOME/agents/<role>[-N]/`) is your
**private workspace** and your tmux cwd. The launcher creates two
canonical subdirs at boot — use them, do NOT scatter files at the
root of `$JHT_AGENT_DIR`:

| Subdir | Purpose | Lifetime |
|---|---|---|
| `$JHT_AGENT_DIR/tools/` | Helper scripts you wrote for yourself (parsers, one-off automations). Live as long as you find them useful. | Audit every boot. If a script is reusable across roles → propose moving it to `agents/_skills/` (skills.list manifest). If unused for 30+ days → delete. |
| `$JHT_AGENT_DIR/tmp/` | Intermediate scratch: downloaded JDs for parsing, draft CV revisions, fetch buffers, anything throwaway. | Boot housekeeping deletes files older than 7 days unconditionally. Treat anything you put here as ephemeral. |

**Boot housekeeping (mandatory, first thing in your loop):**

```bash
# 1. Make sure the subdirs exist (the launcher does this too, but
#    a fresh role on an old $JHT_HOME may not have them yet).
mkdir -p "$JHT_AGENT_DIR/tools" "$JHT_AGENT_DIR/tmp"

# 2. Wipe stale tmp/ — files older than 7 days. Errors ignored
#    (the dir may be empty on first boot).
find "$JHT_AGENT_DIR/tmp" -type f -mtime +7 -delete 2>/dev/null || true

# 3. Audit tools/ (NEVER auto-delete here — list and decide).
ls "$JHT_AGENT_DIR/tools" 2>/dev/null
```

**Periodic housekeeping (every ~6 hours of continuous run, or after
every 50 main-loop iterations, whichever comes first):** repeat step
2. Do NOT run housekeeping inside a tight loop — it costs FS calls
and breaks rate-limit budgeting.

**Out of bounds:** never `find -delete` outside `$JHT_AGENT_DIR/tmp/`.
Never wipe `$JHT_USER_DIR` (deliverables), never wipe sibling agents'
workspaces, never wipe `~/.cache/` or other shared caches — those are
managed by the Captain (`jht cache prune`, single-instance) and by the
launcher, not by you.

---

## 📦 RULE-T13 — Python packages: install via `uv pip install --user`, never `sudo pip`

When you need a Python library that is not already importable, install
it with:

```bash
uv pip install --user <package>
```

This writes into `$PYTHONUSERBASE` (= `$JHT_HOME/.local`, exported by
the image), the **single shared user-base** every agent reads from.
The wheel goes through the shared cache `$JHT_HOME/.cache/uv` so a
package requested by three different agents is downloaded once.

You are FREE to install whatever library best fits the task — this
rule is not about *what* you install, it is about *where*. Different
PDF libraries, different scrapers, different ML toolkits: all welcome,
but all in the same magazzino.

**Forbidden patterns** (the sudoers whitelist will block them at the
OS level — you will get `sudo: /usr/bin/pip: command not allowed`):

- ❌ `sudo pip install <pkg>` → would scatter into the system
  site-packages, invisible to other agents and lost on container rebuild
- ❌ `sudo pip3 install <pkg>` → same
- ❌ `python3 -m venv .venv && pip install ...` inside `$JHT_AGENT_DIR`
  → creates a per-agent silo (Scrittore-1 had two of these by 2026-05-02,
  ~70M of duplicated wheels). If you genuinely need an isolated venv for
  a one-off experiment, put it under `$JHT_AGENT_DIR/tmp/venv-<purpose>/`
  and accept it will be wiped by RULE-T12 housekeeping after 7 days.

**Allowed sudo (whitelist):** `apt-get`, `apt`, `apt-cache`, `mkdir`,
`chown`, `ln`. System packages (tesseract, pdftohtml, fonts) → still
fine via `sudo apt install`. Python libraries → uv only.

**If the install fails** because a wheel does not exist for ARM64 in
the container, escalate to the Captain — do NOT fall back to building
from source via sudo. The Captain decides whether to add the dep to
`requirements.txt` (build-time) or skip the task.

### 🔍 Before you `pip install`: check what is already there

Sei libero di installare, ma **non sei libero di installare alla cieca**.
Prima di ogni `uv pip install --user <pkg>`:

1. **`pip show <pkg>`** — se ritorna metadata, il pacchetto e' gia' nel
   magazzino: usalo, non reinstallare.
2. **Pensa alle alternative gia' presenti.** Il magazzino e' grande,
   spesso una libreria che gia' c'e' fa esattamente quello che ti
   serve. Esempi del 2026-05:
   - PDF generation: `weasyprint` (Markdown/HTML → PDF), `fpdf2`,
     `pymupdf`, `reportlab`, `pypdfium2`, `pandoc` (via skill).
   - PDF reading: `pypdfium2`, `pymupdf`, `pdfminer.six`, `pdfplumber`,
     `pypdf`. **Una di queste 5 lo fa**, non aggiungere la sesta.
   - HTTP fetch: `httpx`, `requests`, `urllib3` — gia' tutte qui.
   - HTML parsing: `beautifulsoup4`, `lxml` — idem.

   Per vedere cosa c'e': `pip list --user 2>/dev/null | head -50` o
   `ls $PYTHONUSERBASE/lib/python3.11/site-packages/ | grep -i <topic>`.

3. **Solo se nessuna esistente fa il lavoro** → installa la nuova.
   Niente Capitano-gate, ti fidiamo: la disciplina e' "check first,
   install second", non "ask permission".

### 🧹 Periodic team-wide cleanup (Capitano-driven)

Il magazzino non si pulisce da solo. Il Capitano ha la skill
`py-tools-audit` che lista i pacchetti `--user` e li confronta con
gli `import` nel codice attivo. ~weekly (o quando `.local/` supera
800 MB) il Capitano:

1. Lancia `py-tools-audit` → ottiene la lista dei pacchetti senza
   import attivi (candidate per uninstall).
2. Manda un broadcast in tmux: *"candidates per uninstall: X, Y, Z.
   Conferma `[KEEP <pkg>]` entro 1h se ne usi una"*.
3. Esegue `uv pip uninstall` di quelle non confermate.

Se hai un pacchetto che usi **solo a runtime** (caricato dinamicamente,
non da un `import` statico) e non vuoi che venga rimosso, dichiaralo
nel tuo prompt o tieni un commento `# uses: <pkg>` in uno script tuo —
l'audit grep lo trovera'.

---

## 📑 How to reference these rules in your prompt

Near the top of the RULES section in `agents/<role>/<role>.md`:

```markdown
You inherit the team-wide rules in
[`agents/_team/team-rules.md`](../_team/team-rules.md). Read them at
boot. The rules below are role-specific.
```
