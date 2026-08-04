<!-- @translation: de, ai-translated 2026-08-03 -->
---
name: first-run-burst
description: "Die erste halbe Stunde, in der ein brandneuer Nutzer dem Team überhaupt bei der Arbeit zusieht. Öffne diese Skill, wenn du `[PROFILO-PRONTO]` vom Assistente bekommst, oder beim Aufwachen, wenn `first_run.py status` die Phase `awaiting_profile` / `burst` meldet. Sie setzt die schrittweise Kalibrierung (C-02) nur für das erste Fenster außer Kraft und definiert Erfolg als BEWERTETE Positionen auf dem Bildschirm — nicht als gefundene Positionen."
allowed-tools: Bash(python3 /app/shared/skills/first_run.py *), Bash(python3 /app/shared/skills/plan_registry.py *), Bash(python3 /app/shared/skills/db_query.py *), Bash(/app/.launcher/start-agent.sh *), Bash(python3 /app/shared/skills/throttle-config.py *), Bash(jht-tmux-send *), Bash(jht-send *)
---

# first-run-burst — die Demo, an der hängt, ob der Nutzer bleibt

Ein neuer Nutzer schließt das Setup ab, schaltet das Team ein und schaut zu. Zehn Minuten später hat
er **eine** rohe Position auftauchen sehen. Nichts erlaubt ihm, ein Team, das sich dosiert, von einer
kaputten Anwendung zu unterscheiden — also schließt er, dass sie kaputt ist, und damit liegt er
nicht falsch.

Deine normale Kalibrierung (C-02: ein Worker, 30 Minuten beobachten, eine Stufe höher) ist die
richtige Regel **im Dauerbetrieb**, wo ein Fehlgriff ein Budgetfenster kostet. Beim allerersten Lauf
kostet er den Nutzer. Diese Skill ist die dokumentierte Ausnahme, und sie gilt **nur für das erste
Fenster**.

## Trigger

- `[@assistente -> @capitano] [PROFILO-PRONTO]` — das Profil ist gerade nutzbar geworden
- beim Aufwachen, wenn `python3 /app/shared/skills/first_run.py status`
  `phase: awaiting_profile` oder `phase: burst` meldet

## Was Erfolg hier bedeutet

**Positionen mit einem Score auf dem Bildschirm.** Nicht gefundene Positionen. Ein Lauf, der 50
Angebote einsammelt und davon 3 bewertet (gemessen, 2026-07-26), hat fast nichts hervorgebracht, was
der Nutzer sehen kann: Die Shortlist ist das Produkt, das Scraping ist Installationstechnik. Alles
Weitere folgt aus diesem einen Satz.

## Die Prozedur

**1. Öffne den Burst und lies den Roster.**

```bash
python3 /app/shared/skills/first_run.py begin-burst
```

Er liefert dir den `roster` zurück (wie viele Scout / Analista / Scorer), den
`scout_cap_first_pass` und das `target_scored`, alle abgeleitet aus dem Abonnement, das der Nutzer
beim Setup angegeben hat. Antwortet er `piano non dichiarato` (Plan nicht deklariert), ist der
Setup-Schritt unvollständig: Sag es dem Nutzer im Chat und halte an — rate **nicht** einen Roster,
eine Überschätzung verbrennt ihm sein Fenster am ersten Tag.

**2. Spawne den gesamten Roster, um ~60 Sekunden versetzt.**

Nicht ein Worker alle zehn Minuten: die ganze Aufstellung, direkt nacheinander, wie immer über
`start-agent.sh` (C-03). Das ist die bewusste Ausnahme von C-02.

**3. Warte nicht auf volle Warteschlangen, um den Downstream zu starten.**

Spawne den Analista, sobald **eine** Position existiert, den Scorer, sobald **eine** Position checked
ist. Die Gewohnheit "erst sammeln, dann bewerten" ist genau das, was den Nutzer vor einem Haufen
unbewerteter Zeilen sitzen lässt.

**4. Deckle den ersten Sourcing-Durchlauf.**

Teile jedem Scout seinen Anteil am `scout_cap_first_pass` mit und sag ihm, er soll sich melden, wenn
er ihn erreicht, statt zu sourcen, bis das Budget aufgebraucht ist. Positionen jenseits dieser
Obergrenze sind noch nichts wert: Sie reihen sich hinter denen ein, die niemand bewertet hat.

**5. Melde früh, nicht erst wenn alles fertig ist.**

Sobald die ersten ~3 Positionen einen Score tragen, schick dem Nutzer ein kurzes `jht-send` mit dem,
was sie sind — das ist der Moment, in dem die Anwendung aufhört, kaputt zu wirken. Danach arbeite
weiter bis `target_scored`.

**6. Schließe den Burst.**

```bash
python3 /app/shared/skills/first_run.py check
```

Führe es bei jedem `[HEARTBEAT]` aus. Wenn es auf `steady` umspringt, bist du zurück unter den
gewöhnlichen Regeln — die C-02-Kalibrierung eingeschlossen.

## Das Tempo liegt auch hier bei dir — der Bridge berät nur

`pace_guard` misst den Verbrauch bei jedem Bridge-Sample gegen die Fensterkurve und schreibt dir eine
`[PACE-GUARD]`-Zeile in dein Pane, mit dem Throttle, den es empfehlen würde. Es wendet ihn **nicht**
an: Niemand tut das, solange du nicht `throttle-config.py` ausführst. Also:

- **Niemals** `freeze_team.py` während des Bursts. Ein eingefrorenes Team ist genau die Stille, zu
  deren Verhinderung es diese Skill gibt.
- Lies eine `[PACE-GUARD]`-Zeile als zu treffende Entscheidung, nicht als Benachrichtigung. Sie
  bringt den Befehl für die laufenden Worker bereits ausformuliert mit — pass ihn daran an, wer
  gerade was tut, und führe ihn aus. Ignorierst du sie, ändert sich das Tempo nicht: Kein Skript
  wird an deiner Stelle den Throttle anfassen.
- Erreicht sie dich als `LOCKOUT-IMMINENTE`, liegt die empfohlene Bremse bereits an der
  1h-Obergrenze — Bremsen allein reicht dann nicht mehr, und der Hebel ist der **Roster**: Kill
  einen Scout (niemals den Analista oder den Scorer: ohne sie wird gar nichts bewertet).
- Das Fenster soll **beim Reset** 100% erreichen, nicht früher. Auf halbem Weg bei 100% zu stehen
  heißt, der Nutzer bekommt zwei Stunden lang ein stummes Team; beim Reset bei 40% zu stehen heißt,
  Budget liegen gelassen zu haben. Beides sind Fehlschläge, und der erste ist deutlich schlimmer.

## Anti-Patterns

- ❌ Nur Scouts spawnen, "erst das Material, die Bewertung später" — das gemessene Ergebnis ist 50
  gefunden / 3 bewertet, was beim Nutzer als kaputte App ankommt.
- ❌ Auf einen `[BRIDGE TICK]` warten, bevor du zum ersten Mal spawnst: Der Trigger **ist** das
  fertige Profil.
- ❌ Während des Bursts die C-02-Leiter hochsteigen — diese Regel gehört dem Dauerbetrieb, dieses
  Fenster ist die Ausnahme.
- ❌ Das Team einfrieren, um das Budget zu schützen. Langsam lässt sich aufholen, stumm nicht.
- ❌ Den Burst dem Nutzer in der Sprache der Infrastruktur ankündigen ("4 Worker gespawnt, Throttle
  300s"). Berichte Positionen, Unternehmen, Scores.

## Siehe auch

- `spawn-agent` — der eigentliche Start, unverändert.
- `pipeline-triage` — welche Rolle den Engpass löst, sobald man im Dauerbetrieb ist.
- `scaling-calc` / **C-02** — die schrittweise Kalibrierung, die diese Skill aussetzt.
- `chat-web` — wie du dem Nutzer die frühe Meldung formulierst.
