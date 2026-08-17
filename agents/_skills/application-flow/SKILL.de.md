<!-- @translation: de, ai-translated 2026-06-06 -->
---
name: application-flow
description: DB- + Dateisystem-Vertrag, dem jeder Scrittore folgt, wenn er eine Position von `scored` (≥50) nach `ready`/`excluded` bringt. Drei Gates VOR dem Schreiben einer einzigen CV-Zeile (Anti-Rewriting, Anti-Kollision, Link-Verifizierung), ein kanonischer Pfad für Ergebnisse, ein finales Gate nach der 3. Critic-Runde. Das Überspringen eines dieser Gates erzeugt doppelte Arbeit, überschreibt die Beanspruchung eines anderen Writers oder — schlimmstenfalls — pusht einen CV mit `excluded`-Qualität als `ready` an den Nutzer. Zuständig: Scrittore.
allowed-tools: Bash(python3 *), Bash(mkdir -p *), Bash(find *), Bash(test *)
---

# application-flow — beanspruchen, schreiben, Gate

Der Writer berührt nur zwei Bereiche der DB:
- `positions.status` (writing → ready | excluded)
- `applications` (INSERT + UPDATE via UPSERT)

Alles andere ist tabu: niemals `scores`, `companies`, `position_highlights`, `positions.notes` (Analyst-Territorium), `positions.applied` (nur Capitano/Nutzer). T09 + Scrittore-Rollengrenze.

## Schritt 1 — Nächste Position abrufen

```bash
python3 /app/shared/skills/db_query.py next-for-scrittore
```

Priorität: `score ≥ 70` zuerst, dann `50-69` absteigend. Das Skript sortiert bereits.

## Schritt 2 — Anti-Rewriting-Gate (MUSS vor der Beanspruchung laufen)

Eine Position, deren Critic-Urteil bereits gesetzt ist, ist ENDGÜLTIG — niemals erneut prüfen.

```bash
if python3 /app/shared/skills/db_query.py application "$ID" >/dev/null; then
  : # exit 0 → application fehlt, ODER application ohne Urteil → weiter
else
  : # exit 1 → critic_verdict bereits gesetzt → ABSOLUT ÜBERSPRINGEN
  continue
fi
```

Exit-Codes:
- `0` → noch keine Application, oder Application ohne Urteil → weiter zu Schritt 3.
- `1` → `critic_verdict` bereits gesetzt → **ABSOLUT ÜBERSPRINGEN**, das Urteil des Critic ist endgültig.

> ⚠️ `sqlite3` CLI ist NICHT im Container installiert. Immer `db_query.py` verwenden. Niemals `python3 -c "import sqlite3 ..."` Workarounds — sie umgehen die Invarianten des Skripts.

## Schritt 3 — Anti-Kollisions-Beanspruchung

Überprüfe, dass die Position nicht bereits von einem anderen Writer beansprucht wurde, dann beanspruche sie atomar durch Umschalten des Status.

```bash
# Aktuellen Status prüfen
python3 /app/shared/skills/db_query.py position "$ID"

# Wenn Status bereits `writing` → ein anderer Writer hat sie, ÜBERSPRINGEN
# Andernfalls beanspruchen:
python3 /app/shared/skills/db_update.py position "$ID" --status writing
```

Optional aber empfohlen: die Beanspruchung den Peers via tmux ankündigen, damit sie nicht einmal die Gate-Sequenz für dieselbe ID starten.

```bash
for s in $(tmux list-sessions -F '#{session_name}' | grep -E '^SCRITTORE-[0-9]+$' | grep -v "^${MY_SESSION}$"); do
  jht-tmux-send "$s" "[@$MY_ID -> @${s,,}] [INFO] Sto prendendo position #$ID"
done
```

Details zum Anti-Kollisions-Vertrag: `agents/_manual/anti-collision.md`.

## Schritt 4 — Link-Verifizierung

Eine JD, die zwischen Phase 2 (Analyst) und jetzt gestorben ist, sollte KEIN Critic-Budget verbrauchen. Zweistufige Prüfung:

```bash
# Stufe 1 — geprueftes Fetch mit Browser-UA
python3 /app/shared/skills/safe_fetch.py "<JD-URL>" \
  | grep -i 'no longer accepting\|closed-job\|position has been filled\|expired\|job not found'
```

Bei Treffer → als excluded markieren und beenden:
```bash
python3 /app/shared/skills/db_update.py position "$ID" --status excluded \
  --notes "ESCLUSA: [LINK_MORTO] verificato dallo Scrittore prima di scrivere"
```

Stufe 2 (nur wenn Stufe 1 nicht eindeutig) — fetch MCP, nach "No longer accepting" / "applications closed" im gerenderten DOM suchen.

## Schritt 5 — Application-Zeile EINFÜGEN + CV schreiben

Nachdem der Link gültig ist, Application-Zeile erstellen. **Immer via `db_update.py application` (UPSERT)** — niemals rohes `python3 -c "import sqlite3 ... INSERT INTO applications ..."`.

```bash
python3 /app/shared/skills/db_insert.py application \
  --position-id "$ID" \
  --cv-path "$JHT_USER_DIR/cv/CV_<Candidato>_<Company>.md" \
  --cv-pdf-path "$JHT_USER_DIR/cv/CV_<Candidato>_<Company>.pdf" \
  --written-by "$MY_ID" --written-at now
```

> ⚠️ Niemals den Literal-String `'now'` als Zeitstempel an handgeschriebenes SQL übergeben — er wird als String `"now"` statt als ISO-Zeitstempel gespeichert. Der Wrapper behandelt `--written-at now` korrekt; der Wrapper ist der einzig sichere Weg.

Dann CV schreiben (Skill `cv-structure`) → PDF generieren → `critic-loop` ausführen.

## Schritt 6 — Pfad-Disziplin (T11) + eindeutige Benennung (Bug #25)

Finale Ergebnisse MÜSSEN unter `$JHT_USER_DIR` liegen, NIEMALS unter `$JHT_AGENT_DIR`. **Dateiname muss `position_id` enthalten**, damit 2+ Stellenangebote bei derselben Firma sich nicht gegenseitig überschreiben:

| Artefakt                       | Pfad                                                                                |
|--------------------------------|--------------------------------------------------------------------------------------|
| CV Markdown                    | `$JHT_USER_DIR/cv/CV_<Candidato>_<position_id>_<CompanySlug>_<TitleSlug>.md`         |
| CV PDF                         | `$JHT_USER_DIR/cv/CV_<Candidato>_<position_id>_<CompanySlug>_<TitleSlug>.pdf`        |
| Anschreiben (nur wenn gefragt) | `$JHT_USER_DIR/allegati/CoverLetter_<Candidato>_<position_id>_<CompanySlug>.{md,pdf}` |

- `<Candidato>` = `Nome_Cognome` aus dem Profil.
- `<position_id>` = `positions.id` (Integer, monoton, eindeutig).
- `<CompanySlug>` = Firma kleingeschrieben, nicht-alphanumerisch → `-`. Bsp. `canonical`, `bending-spoons`.
- `<TitleSlug>` = Titel kleingeschrieben + auf ~30 Zeichen gekürzt. Bsp. `observability`, `junior-ubuntu`.

Beispiel für 2 Canonical-Stellen (Bug #25 Fall):
```
CV_MarioRossi_28_canonical_observability.pdf
CV_MarioRossi_62_canonical_junior-ubuntu.pdf
```

Vor dem Bug-#25-Fix wurden beide als `CV_MarioRossi_Canonical.pdf` gespeichert → die zweite überschrieb die erste → DB hatte 2 Application-Zeilen, die auf dieselbe Datei zeigten → stille Datenkorruption, die nur sichtbar war, wenn der Nutzer das PDF öffnete und Inhalte der *anderen* Bewerbung las.

Beim Speichern des Pfads in der DB (`--cv-path`, `--cv-pdf-path`) den `$JHT_USER_DIR/...`-Pfad eintragen. Niemals einen Pfad unter `$JHT_AGENT_DIR` (das ist Scratch — siehe Workspace unten).

## Schritt 7 — Finales Gate (nach `critic-loop` erreicht Runde 3)

Der `critic-loop`-Skill zeichnet den Score jeder Runde auf; hier speicherst du das Urteil, schaltest den Application-Status um und gleicht den Position-Status ab.

> ⚠️ **Einzelschreiber-Regel (Bug #21).** `applications.status='ready'` wird **nur hier, von dir, nach Critic PASS** gesetzt. Der Critic schreibt niemals `applications.status` direkt — sein einziger Output ist `critic_verdict` + `critic_score`. Du besitzt den finalen Übergang.

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
# Finales UPSERT auf die Application — Urteil + Score + ready/draft-Promotion
# `--reviewed-by` muss auf die Sitzungs-ID des LETZTEN von dir gespawnten Critic gesetzt werden
# (z.B. CRITICO-S3 wenn Runde 3 die letzte war). Ohne bleibt `reviewed_by`
# NULL — beobachtet bei 95% null vor 2026-05-22 (vps1-run-postmortem #1).
LAST_CRITIC="${LAST_CRITIC:-CRITICO-S3}"   # gesetzt von critic-loop beim Runden-Spawn

if [[ <final_verdict> == "PASS" ]]; then
  python3 /app/shared/skills/db_update.py application "$ID" \
    --critic-verdict PASS \
    --critic-score <X.X> \
    --critic-round 3 \
    --critic-notes "$CRITIC_NOTES" \
    --reviewed-by "$LAST_CRITIC" \
    --status ready
else
  python3 /app/shared/skills/db_update.py application "$ID" \
    --critic-verdict <NEEDS_WORK|REJECT> \
    --critic-score <X.X> \
    --critic-round 3 \
    --critic-notes "$CRITIC_NOTES" \
    --reviewed-by "$LAST_CRITIC"
  # Status bleibt 'draft' — die Application ist nicht bereit für den Nutzer.
fi

# Position-Status — automatisch aus dem finalen Score
if [[ <final_score>_int >= 5 ]]; then
  python3 /app/shared/skills/db_update.py position "$ID" --status ready
else
  python3 /app/shared/skills/db_update.py position "$ID" --status excluded
fi
```

Die `applications.status='ready'`-Promotion ist das, was den CV auf dem `/ready`-Dashboard des Nutzers sichtbar macht. Das Überspringen lässt die Zeile für immer in `'draft'` — der Capitano meldet eine Ready-Anzahl, mit der DB und Dashboard nicht übereinstimmen.

Dann den Capitano mit einem `[REPORT]` benachrichtigen (Skill `tmux-send`).

## Workspace — `tools/` + `tmp/`, Housekeeping beim Boot (T12)

Dein `$JHT_AGENT_DIR` hat 2 kanonische Unterverzeichnisse, die vom Launcher erstellt werden:

| Unterverz.                   | Was                                                               | Lebensdauer                             |
|------------------------------|-------------------------------------------------------------------|------------------------------------------|
| `$JHT_AGENT_DIR/tools/`      | Hilfsskripte, die du für dich geschrieben hast (einmalige JD-Parser etc.)  | solange nützlich; bei jedem Boot prüfen  |
| `$JHT_AGENT_DIR/tmp/`        | Scratch: heruntergeladene JDs, CV-Entwürfe zwischen Runden         | beim Boot gelöscht wenn älter als 7 Tage |

**Boot-Housekeeping (ERSTER Schritt in deiner Schleife, vor Schritt 1):**

```bash
mkdir -p "$JHT_AGENT_DIR/tools" "$JHT_AGENT_DIR/tmp"
find "$JHT_AGENT_DIR/tmp" -type f -mtime +7 -delete 2>/dev/null || true
```

Alle ~6h kontinuierlicher Laufzeit oder alle ~50 Hauptschleifen-Iterationen wiederholen. NICHT in einer engen Schleife — kostet FS-Aufrufe.

> 🚫 **Tabu:** niemals `find -delete` außerhalb von `$JHT_AGENT_DIR/tmp/`. Niemals `$JHT_USER_DIR` löschen (Ergebnisse), niemals Workspaces benachbarter Agenten löschen. T12.

## Strenge Regeln

- **Anti-Rewriting vor Beanspruchung, immer.** Das Überspringen von Schritt 2 bedeutet, den Critic auf eine finalisierte Application erneut laufen zu lassen = verschwendete Opus-Token und möglicherweise Überschreiben eines finalen Urteils.
- **Beanspruchung vor Schreiben.** Ein ohne Beanspruchung geschriebener CV riskiert, dass zwei Writer parallele CVs für dieselbe Position erstellen.
- **Pfad unter `$JHT_USER_DIR/cv/`, niemals `$JHT_AGENT_DIR/`.** Der Nutzer schaut unter `$JHT_USER_DIR`; CVs, die in Agent-Workspaces verstreut sind, sind für ihn unsichtbar. T11.
- **Kein rohes SQL.** Immer `db_query.py` / `db_update.py` / `db_insert.py`. Die Wrapper erzwingen Invarianten, auf die das Team angewiesen ist.
- **Kein Git.** Kein `git add`, kein `git commit`, kein `git push` (T02).

## Anti-Patterns

- ❌ Überspringen von Schritt 2 (Anti-Rewriting) "weil die Position frisch aussieht" — exit 1 bedeutet, der Critic hat bereits abgestimmt, niemals unsichtbar.
- ❌ Eine Position beanspruchen und dann den CV unter `$JHT_AGENT_DIR/cv/` schreiben — der Nutzer kann ihn nicht sehen; der Pfad in der DB ist falsch; T11-Verletzung.
- ❌ `python3 -c "import sqlite3; INSERT INTO applications ..."` — umgeht die UPSERT-Logik, Datenmüll in der DB.
- ❌ `'now'` als Literal-String übergeben, wenn nicht der Wrapper verwendet wird — wird als String statt als ISO-Zeitstempel gespeichert.
- ❌ `positions.notes` berühren (Spalte des Analysts) — Rollengrenz-Verletzung, bricht die strukturierten Felder des Analysts.
- ❌ `positions.applied` von hier setzen — nur Capitano oder Nutzer können dieses Flag umschalten.

## Siehe auch

- `cv-structure` — was zwischen Schritt 5 und `critic-loop` zu schreiben ist.
- `critic-loop` — die 3-Runden-Prüfung, die den finalen Score für Schritt 7 erzeugt.
- `agents/_manual/anti-collision.md` — vollständiger Multi-Writer-Koordinationsvertrag.
- `agents/_manual/db-schema.md` — `applications`-Spalten + Rollengrenzen.
- `agents/_team/team-rules.md` T11 (Ergebnis-Pfad) + T12 (Workspace-Housekeeping).
