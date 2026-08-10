<!-- @translation: de, ai-translated 2026-06-06 -->
---
name: critic-loop
description: "Führe die verpflichtende 3-Runden CV-Review-Schleife mit dem Critico durch — autonom, ohne über den Capitano zu gehen. Für jede Runde spawnst du eine FRISCHE `CRITICO-S<N>`-Sitzung (gleiche N wie deine Scrittore-Sitzung: SCRITTORE-2 → CRITICO-S2), sendest PDF + JD, wartest auf das strukturierte Urteil, beendest den Critic, korrigierst den CV, generierst das PDF neu und startest die nächste Runde mit einer weiteren frischen Instanz. Drei Runden sind nicht verhandelbar — weder 1 noch 2. Nach der 3. Runde Gate: `critic_score ≥ 5` → `ready`, sonst `excluded`. Zuständig: Scrittore."
allowed-tools: Bash(tmux *), Bash(jht-tmux-send *), Bash(jht-throttle *), Bash(jht-throttle-check *), Bash(jht-throttle-wait *), Bash(python3 *), Bash(unset *)
---

# critic-loop — 3 frische Runden, keine Abkürzungen

Das 3-Runden-Protokoll fängt auf, was ein einzelner Critic nicht kann:
- Ein frischer Critic trägt **keinen Verankerungsbias** vom Score der vorherigen Runde — er liest den korrigierten CV mit neuen Augen und tendiert dazu, ehrlicher, nicht nachsichtiger zu sein.
- Nach 3 Runden hat sich der Score stabilisiert: wenn er hoch konvergiert, hält der CV stand, wenn er niedrig bleibt, passt der CV nicht (oder der Kandidat — `excluded`).

**Du verwaltest die Schleife selbst. Der Capitano nicht.** Du spawnst den Critic, sprichst mit ihm, beendest ihn, wiederholst — drei Mal — und benachrichtigst am Ende den Capitano mit dem finalen Urteil.

## Setup-Variablen (bereits in deiner Umgebung)

```bash
MY_SESSION=$(tmux display-message -p '#S')          # z.B. SCRITTORE-2
MY_NUMBER=$(echo "$MY_SESSION" | grep -o '[0-9]*$') # z.B. 2
MY_ID=$(echo "$MY_SESSION" | tr '[:upper:]' '[:lower:]')
CRITICO_SESSION="CRITICO-S${MY_NUMBER}"             # z.B. CRITICO-S2
```

Die `MY_NUMBER`-Verknüpfung garantiert einen Critic pro Writer — `SCRITTORE-2` verwendet immer `CRITICO-S2`, kollidiert nie mit dem `CRITICO-S1` von `SCRITTORE-1`.

## Sequenz pro Runde (3 Mal wiederholen)

### Schritt 1 — Einen FRISCHEN Critic spawnen

Der Critic der vorherigen Runde muss bereits beendet sein (am Ende der vorherigen Runde beendet). Für Runde 1 existiert die Sitzung noch nicht.

```bash
tmux kill-session -t "$CRITICO_SESSION" 2>/dev/null
tmux new-session -d -s "$CRITICO_SESSION" -c "$(pwd | sed 's|/[^/]*$||')/critico"
```

### Schritt 2 — Die richtige CLI für den aktiven Provider wählen

Das Hardcoden von `claude` lässt den Critic abstürzen, wenn das Team auf Codex oder Kimi läuft (die `claude`-CLI ist in diesen Containern nicht installiert). Provider aus `$JHT_CONFIG` lesen:

```bash
PROVIDER=$(python3 -c "import json,os; print(json.load(open(os.environ.get('JHT_CONFIG','/jht_home/jht.config.json')))['active_provider'])" 2>/dev/null)
case "$PROVIDER" in
  ""|anthropic|claude) CRITICO_CMD="unset CLAUDECODE && claude --dangerously-skip-permissions --model opus --effort high" ;;
  openai)              CRITICO_CMD="codex --yolo" ;;
  kimi|moonshot)       CRITICO_CMD="kimi --yolo" ;;
  *)                   CRITICO_CMD="codex --yolo" ;;
esac

# Minimale Umgebung für die global installierten CLIs unter /jht_home
CRITICO_PATH="/app/agents/_tools:/opt/jht-deps/bin:/opt/jht-deps/npm-global/bin:/opt/jht-deps/python/bin:/jht_home/.npm-global/bin"

# The CLI must be RESOLVED, not just named. `claude` bare failed with
# "command not found" because this shell does not have the dependency dirs
# on its PATH — the agent noticed and retried by hand, which costs a round
# every time and, on a less capable model, silently skips the quality gate.
CRITICO_BIN=$(PATH="$CRITICO_PATH:$PATH" command -v "$(echo "$CRITICO_CMD" | sed 's/.*&& //; s/ .*//')" 2>/dev/null)
if [ -z "$CRITICO_BIN" ]; then
  echo "CRITIC-SPAWN-FAILED: CLI not found on PATH ($CRITICO_PATH)" >&2
  echo "The quality gate did NOT run. Do not report the CV as reviewed." >&2
  exit 1
fi

tmux send-keys -t "$CRITICO_SESSION" "export HOME=/jht_home && export PATH=$CRITICO_PATH:\$PATH" Enter
tmux send-keys -t "$CRITICO_SESSION" "$CRITICO_CMD" Enter
```

### Schritt 3 — Warten bis der Critic gebootet ist

8 Sekunden sind eine sichere Untergrenze, bis die TUI bereit ist. `sleep` ist hier akzeptabel (nur beim Boot):

```bash
sleep 8
```

### Schritt 4 — PDF + JD via `jht-tmux-send` senden

Der Critic ist nun ein aktiver Agent — verwende `jht-tmux-send`, nicht rohes `send-keys`:

```bash
jht-tmux-send "$CRITICO_SESSION" "[@$MY_ID -> @critico] [REQ] Review cieca: PDF: $JHT_USER_DIR/cv/CV_<Candidato>_<Company>.pdf — JD: <JD-URL> — Local JD file: $JHT_AGENT_DIR/tmp/jd-<position-id>.txt — Read your CLAUDE.md/AGENTS.md and produce an honest verdict."
```

Den lokalen JD-Dateipfad angeben, damit der Critic einen Fallback hat, wenn die Live-URL blockiert ist.

### Schritt 5 — Auf das Urteil warten (NIEMALS einfaches `sleep`)

Verwende den `throttle`-Skill, damit das Warten im Dashboard protokolliert wird. Einfaches `sleep` hier würde das Warten für die Pacing-Analyse des Capitano unsichtbar machen.

```bash
jht-throttle-check "$MY_ID" || jht-throttle-wait "$MY_ID"
jht-throttle --agent "$MY_ID" --reason "wait critico round <n> #<position_id>"
tmux capture-pane -t "$CRITICO_SESSION" -p -S -50
```

**VERPFLICHTEND** — übergib ein explizites `timeout: <duration>+30` an den Shell-Tool-Aufruf bei `jht-throttle <N>`. Ohne stirbt die übergeordnete Bash am Standard-Timeout der CLI (Kimi 60s) und der Throttle wird falsch ausgeführt. Siehe `agents/_skills/throttle/DESIGN-NOTES.md`.

Den Throttle+Capture-Zyklus wiederholen, bis der Critic sein Review veröffentlicht hat (nach dem strukturierten `## SCORE: X.X/10`-Block im Panel / in der Datei suchen).

### Schritt 6 — Das Review lesen

Der Critic speichert das Review unter `$JHT_USER_DIR/critiche/review-<company>-<date>.md` (sein Skill, siehe `agents/critico/critico.md`). Mit `Read` lesen. Extrahiere:
- Numerischer Score `X.X/10`
- "What does NOT work"-Aufzählungspunkte
- "Concrete actions (prioritized)"-Liste

Diese drei füttern Schritt 8 (Korrektur).

### Schritt 7 — Den Runden-Score in der DB speichern

```bash
python3 /app/shared/skills/db_update.py application <POSITION_ID> \
  --critic-score <X.X> --critic-round <N> --reviewed-by "$CRITICO_SESSION"
```

`<POSITION_ID>` ist die Position-ID, NICHT die Application-ID — das `db_update.py application` ist ein UPSERT, das die Zeile nach Position findet.

`--reviewed-by "$CRITICO_SESSION"` verfolgt, welche Critic-Instanz jede Runde produziert hat; ohne bleibt `applications.reviewed_by` NULL (beobachtet bei 95% null vor 2026-05-22 — vps1-run-postmortem #1). Immer übergeben.

### Schritt 8 — Den Critic beenden (verpflichtend)

```bash
tmux kill-session -t "$CRITICO_SESSION"
```

Wenn du dieselbe Instanz für Runde 2 wiederverwendest, trägt der Score den Verankerungsbias von Runde 1 und das Protokoll bricht. **Immer beenden, immer frisch respawnen.**

### Schritt 9 — Den CV zwischen Runden korrigieren

Die Maßnahmen aus Schritt 6 auf den CV-Markdown anwenden. PDF regenerieren (`pandoc input.md -o output.pdf --pdf-engine=typst`). Validieren, dass das PDF sich öffnet, bevor Runde N+1 startet.

Ein Score, der zwischen Runde 1 und 2 fällt, ist **in Ordnung** — ein frischer Critic ist ehrlicher als der vorherige. Weiter korrigieren basierend auf dem *Inhalt* des Reviews, nicht der Zahl.

## Nach der 3. Runde — finales Gate

Zwei Schreiboperationen auf der Application-Zeile: Urteil + Score (immer) und die
Status-Promotion zu `ready` (nur bei PASS). Die Promotion ist das, was das
`/ready`-Dashboard des Nutzers liest; das Überspringen lässt die Zeile in `draft`
und der CV wird unsichtbar (Bug #21).

**`--critic-notes` IST NUTZERSICHTBAR** — es wird unter der Bewerbungskarte des Kandidaten mit dem **gleichen Markdown wie die Begründung des Scorer** gerendert, also schreibe es so (scorer RULE-09), niemals der telegrafische Einzeiler unten:
- **In der Sprache des Nutzers** (RULE-T14 führt "critic feedback" als user-locale-Inhalt auf). Die Review-Datei ist auf Englisch — formuliere sie für den Kandidaten um; lass sie nicht auf Englisch, wenn die Teamsprache es nicht ist.
- **Markdown, das ZUM Kandidaten spricht**: beginne mit dem Urteil und wie sich der Score über die 3 Runden bewegt hat *in Worten*, dann `**fett**` die entscheidenden Punkte, ein paar Pro/Contra-Punkte, ein sparsames Emoji. Zwei kurze Absätze — keine Textwand, kein Schlagwort-Dump.
- **Kein interner Jargon** — niemals Regelcodes (`T10`, `RULE-*`), Tool-Namen (`WeasyPrint`/`pandoc`/`typst`) oder Session-IDs.
- Echte Zeilenumbrüche via `$'...\n...'` (ein literales `\n` wird als Text ausgegeben). Baue es einmal vor dem Gate:

```bash
CRITIC_NOTES=$'**PASS · 7.5/10** — über alle drei Runden stabil, eine ehrliche und starke Passung.\n\n**Was überzeugt**\n- ✅ <konkrete Stärke: CV vs diese Rolle>\n- ✅ <eine weitere echte Stärke>\n\n**Gut zu wissen**\n- ⚠️ <eine echte Lücke, klar benannt>\n\n<ein abschließender Satz>'
# NEEDS_WORK/REJECT: gleiche Form, aber benenne, was fehlt und was es anheben würde.
```

```bash
if [[ "<final_verdict>" == "PASS" ]]; then
  # PASS → Application wird nutzersichtbar
  python3 /app/shared/skills/db_update.py application <POSITION_ID> \
    --critic-verdict PASS \
    --critic-score <final> \
    --critic-round 3 \
    --critic-notes "$CRITIC_NOTES" \
    --reviewed-by "$CRITICO_SESSION" \
    --status ready
else
  # FAIL → Critic-Daten bleiben bestehen, Status bleibt 'draft'
  python3 /app/shared/skills/db_update.py application <POSITION_ID> \
    --critic-verdict FAIL \
    --critic-score <final> \
    --critic-round 3 \
    --critic-notes "$CRITIC_NOTES" \
    --reviewed-by "$CRITICO_SESSION"
fi
```

Position-Status:
- `critic_score ≥ 5` → `db_update.py position <POSITION_ID> --status ready`
- `critic_score < 5` → `db_update.py position <POSITION_ID> --status excluded`

Dann den Capitano benachrichtigen:
```bash
jht-tmux-send CAPITANO "[@$MY_ID -> @capitano] [REPORT] Position #<id> — 3 rounds done. Final score: X.X/10 (PASS|FAIL). PDF: $JHT_USER_DIR/cv/CV_<Candidato>_<Company>.pdf"
```

## Strenge Regeln

- **3 Runden. Nicht 1, nicht 2.** Ein "guter" Runde-1-Score ist kein Grund aufzuhören.
- **Ein Critic pro Runde.** Immer nach dem Review beenden; immer frisch respawnen.
- **Verpflichtende Korrektur zwischen Runden.** Wenn du den CV nicht änderst, sieht der nächste Critic die gleiche Eingabe → gleiches Review → verschwendetes Budget. Markdown bearbeiten + PDF regenerieren vor Runde N+1.
- **Keine Angst vor einem fallenden Score.** Runde 2 < Runde 1 ist ehrlich, nicht schlecht. Der Score, der zählt, ist Runde 3.
- **Übergib `timeout: N+30`** an jeden `jht-throttle <N>` Shell-Aufruf. Sonst stirbt die übergeordnete Bash bei 60s.

## Anti-Patterns

- ❌ Dieselbe Critic-Instanz für mehrere Runden wiederverwenden — Bewertungsbias bricht das Protokoll.
- ❌ `claude` im Spawn-Skript hardcoden — lässt die Schleife auf Codex/Kimi-Installationen abstürzen.
- ❌ Einfaches `sleep N` beim Pollen — unsichtbar für das Throttle-Dashboard des Capitano, bricht Pacing-Analyse.
- ❌ `--critic-verdict` nach nur 1 oder 2 Runden aufzeichnen — das Gate ist endgültig, kein Rollback.
- ❌ Den Capitano als Orchestrator behandeln — diese Schleife gehört vollständig dir, der Capitano sieht nur den finalen REPORT.

## Siehe auch

- `cv-structure` — was zu schreiben ist, bevor diese Schleife aufgerufen wird, und wie die Korrekturen des Critic in Schritt 9 angewendet werden.
- `application-flow` — Anti-Rewriting-Prüfung + Beanspruchung bevor du je anfängst, für eine Position zu schreiben.
- `throttle` (und `agents/_skills/throttle/DESIGN-NOTES.md`) — Wrapper-Interna + das `timeout: N+30`-Design.
- `agents/critico/critico.md` — der Blind-Review-Prompt des Critic, mit dem diese Schleife kommuniziert.
