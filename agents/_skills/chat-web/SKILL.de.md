<!-- @translation: de, ai-translated 2026-06-06 -->
---
name: chat-web
description: Dem Nutzer antworten, wenn er dir vom JHT-Web-Chat aus schreibt. Der Nutzer erreicht dich mit dem Präfix `[@utente -> @capitano] [CHAT] <body>`; antworte NUR mit `jht-send` — schreibe niemals von Hand in `chat.jsonl` (Shell-Quoting bricht die JSON-Zeile und das Frontend verwirft die Nachricht stillschweigend, der Nutzer sieht nichts während du denkst, du hast geantwortet). Verwende diesen Skill bei jeder `[CHAT]`-Nachricht; verwende ihn NICHT für Inter-Agenten-Verkehr (das ist `tmux-send`).
allowed-tools: Bash(jht-send *)
---

# chat-web — Nutzer ↔ Captain Protokoll

Der Nutzer sitzt **nicht** in einer tmux-Sitzung. Er schreibt von der Web-UI aus. Das Frontend markiert die Nachricht und legt sie in dein tmux-Panel. Um zu antworten, schreibst du eine einzelne JSON-Zeile in `$JHT_AGENT_DIR/chat.jsonl`; das Frontend tailt diese Datei und rendert Blasen im Chat-Panel.

Du schreibst das JSON nicht. Der Wrapper `jht-send` macht das für dich, mit Zeitstempel + `done`-Flag + Post-Write-Validierung. Verwende ihn. Immer.

## Wie man einen eingehenden `[CHAT]` erkennt

```
[@utente -> @capitano] [CHAT] <was auch immer der Nutzer getippt hat>
```

- Der Umschlag ist identisch mit Inter-Agenten-Nachrichten (gleiche `[@from -> @to]`-Form), aber der `[CHAT]`-Typ und der `@utente`-Absender machen es eindeutig.
- Der Nutzer ist **ein Mensch, der Profil-Eigentümer** — kein Agent. Es gibt kein `tmux send-keys`, das du zum Antworten verwenden könntest: Seine Sitzung existiert nicht.
- Antworte auf **den Body**, nicht auf den Umschlag. Der Nutzer hat das Präfix nicht getippt; das Frontend hat es hinzugefügt.

> ⚠️ Häufiger Fehlermodus beim ersten Mal: du liest das Präfix und denkst "lass mich via `jht-tmux-send` an den Nutzer antworten". `jht-tmux-send UTENTE ...` gibt `exit 2` zurück (keine solche Sitzung). Fang nicht an zu debuggen — merke dir einfach, dass `[CHAT]` ⇒ `jht-send`. Immer.

## Antwort-Befehle

```bash
jht-send 'Endgültige Antwort, die die Runde abschließt.'
jht-send --partial 'Arbeite daran…'   # Checkpoint mitten in der Runde, hält die Runde offen
```

Regeln:
- **Ein `[CHAT]` ⇒ mindestens ein `jht-send`. Keine Ausnahmen.** Nichts zu schreiben lässt den Nutzer auf einen eingefroren wirkenden Chat starren.
- **Die Abschlussnachricht der Runde hat KEIN `--partial`.** Wenn du es vergisst, zeigt das Frontend die Tipp-Punkte für immer an (bis ein Fallback-Timeout ~10 Min. später greift).
- **Anführungszeichen**: Übergib den Body als einzelnes positionelles Argument. Einfache Anführungszeichen bewahren `$`, `"`, Emoji, Akzente wörtlich. Für einen Body, der ein wörtliches `'` enthält, verwende doppelte Anführungszeichen (`jht-send "non c'è problema"`) — aber innerhalb von `"..."` expandiert die Shell `$var`, also sei vorsichtig.
- **Mehrzeilig**: Bash `$'Zeile1\nZeile2'`, oder verwende `\n` innerhalb des Strings und lass Python es bewahren.

## Wann `--partial` verwenden

Verwende es, wann immer eine nutzerseitige Operation länger als ~3 Sekunden dauert und du die Antwort noch nicht hast. Ohne `--partial` zwischen Nutzernachricht und finaler Antwort versteckt das Frontend die Tipp-Punkte und der Chat wirkt tot.

Muster:
```
[CHAT] trifft ein
   ↓
jht-send --partial 'Schaue nach — einen Moment…'
   ↓
(Arbeit erledigen: db_query, capture-pane, Analyse, …)
   ↓
jht-send 'Hier ist, was ich gefunden habe: …'   ← kein --partial = schließt die Runde
```

Wenn eine einzelne Operation ~30-45s ohne Signal vergeht, sende einen weiteren `--partial`-Checkpoint. Der Nutzer sollte nie länger als das still sitzen.

## Beispiele (Captain ↔ Nutzer)

```bash
# Frage zum Pipeline-Status beantworten — schnell, einzelner Schuss
jht-send 'Pipeline bei 132 Positionen: 18 neu, 47 geprüft, 31 bewertet, 28 fertig. Zwei Writer aktiv.'

# Langwierige Analyse — Checkpoint, dann abschließen
jht-send --partial 'Hole Statistiken und die letzten 50 Reviews — einen Moment…'
# (db_query.py stats ausführen, db_query.py applications --critic-score-max 5)
jht-send $'Hier ist das Bild:\n\n• Pipeline gesund auf der Discovery-Seite.\n• Writer stecken bei 4 Positionen fest mit durchschnittlich Score 3.2 → ich pausiere sie und eröffne Triage neu.'

# Runde abschließen nach Anwendung einer Nutzeranfrage
jht-send 'Erledigt. Zusätzlichen Analysten gespawnt, Throttle-Config ins Log geschrieben.'
```

## Anti-Patterns (was NICHT zu tun ist)

- ❌ `echo '{"text":"...","ts":'$(date +%s.%N)'}' >> $JHT_AGENT_DIR/chat.jsonl` — explodiert bei Anführungszeichen/`$`/Emoji, erzeugt ungültiges JSON, Frontend verwirft die Zeile stillschweigend.
- ❌ `cat << 'EOF' >> chat.jsonl ... EOF` — deaktiviert `$`-Interpolation, Zeitstempel landet als wörtlicher String.
- ❌ `python3 -c "import json; ..."` ad-hoc — gleiche Fragilität wie der Shell-Heredoc.
- ❌ Via `jht-tmux-send UTENTE ...` antworten — es gibt keine `UTENTE`-Sitzung. Der Nutzer lebt im Web-Frontend.
- ❌ Eine finale Antwort mit `--partial` senden — Tipp-Punkte bleiben auf dem Bildschirm des Nutzers stehen.
- ❌ Mehrere `jht-send`-Aufrufe (ohne `--partial`) für etwas, das eine Nachricht sein sollte — jeder Non-Partial-Aufruf erscheint als separate Blase.

## An einen nicht-standardmäßigen Kanal senden (selten)

```bash
jht-send --agent capitano 'System-Notiz, die über meinen Kanal geleitet wird'
```

Nützlich wenn du eine Systemnachricht in deinen eigenen Chat-Kanal loggen willst (z.B. eine Automatisierung, die notiert, dass sie im Namen des Nutzers gehandelt hat). Für alltägliche Antworten brauchst du dieses Flag nie.

## Warum `jht-send` und nicht rohe Shell

Geschichte (nicht wiederholen): Agenten versuchten `echo`-in-jsonl und `cat <<EOF` Heredocs. Beide endeten in fragilen Modi — der erste explodiert bei Anführungszeichen/`$`, der zweite friert den Zeitstempel als wörtlichen String ein. Ergebnis: ungültiges JSON, das das Frontend überspringt. Der Nutzer sieht nichts; du denkst, du hast geantwortet. `jht-send` eliminiert den Fehlermodus vollständig — der Body durchläuft nie erneut einen Shell-Parser nach der ersten Quoting-Ebene.

## Siehe auch

- `tmux-send` — für Nachrichten an **andere Agenten** (anderes Protokoll, anderer Kanal).
- `agents/assistente/assistente.md` — der Assistente hat die tiefste Version dieses Protokolls (mehrstufiger Onboarding-Ablauf mit verpflichtenden Checkpoints); nur lesen, wenn du jemals Assistenten-Aufgaben übernimmst.
