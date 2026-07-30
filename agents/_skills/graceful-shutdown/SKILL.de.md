<!-- @translation: de, ai-translated 2026-07-30 -->
---
name: graceful-shutdown
description: Beendet den Arbeitstag auf Wunsch des Benutzers. Ausgelöst durch eine `[SHUTDOWN]`-Nachricht von @utente. Der Benutzer schließt die Anwendung und jeder Agent steht kurz davor, mitten in der Aufgabe beendet zu werden; bevor das passiert, muss jeder festhalten, wie weit er gekommen ist, damit das Team morgen weitermacht statt neu anzufangen. Stoppe die Agenten einen nach dem anderen und erstelle dann das Flag, das die Anwendung beenden lässt. Verwende dies NIEMALS für routinemäßige Pacing-Entscheidungen — es beendet das gesamte Team.
allowed-tools: Bash(jht-tmux-send *), Bash(node /app/cli/bin/jht.js team *), Bash(touch /jht_home/.shutdown-ready.flag), Bash(python3 /app/shared/skills/captain_diary.py *)
---

# graceful-shutdown — den Tag beenden, wenn der Benutzer geht

Der Benutzer schließt die Anwendung. Ohne dich würden die Agenten mitten in der
Arbeit abgeschnitten: ein Scout mitten in einem Board-Durchgang, ein Scrittore
mit einem halbfertigen CV. **Deine Aufgabe ist, dass niemand den erreichten
Punkt verliert.**

Das Spiel hat dir `[@utente -> @capitano] [SHUTDOWN] …` geschickt und **wartet
jetzt auf ein Flag von dir**: solange du es nicht erstellst, bleibt das Fenster
offen und zeigt dem Benutzer, wie viele Agenten noch arbeiten.

## Ablauf

1. **Bitte alle, ihren Stand aufzuschreiben und aufzuhören.** An jede lebende
   Sitzung sende:

   ```bash
   jht-tmux-send SCOUT-1 "[@capitano -> @scout-1] [SHUTDOWN] Beenden vom Benutzer angefordert. Schreibe in deine Agenda, wie weit du gekommen bist (letzte Board, letzte gespeicherte Position, was noch offen ist), dann höre auf. Fange keine neue Arbeit an."
   ```

   Eine Zeile pro Agent, mit seinem echten Namen. Wer gerade auf die Platte
   schreibt, beendet die aktuelle Datei: einen Schreibvorgang zu unterbrechen ist
   schlimmer, als ein paar Sekunden zu warten.

2. **Halte den Tag selbst fest** im Tagebuch, damit der Capitano von morgen den
   Faden wieder aufnimmt:

   ```bash
   python3 /app/shared/skills/captain_diary.py append "Beenden vom Benutzer angefordert: <wer hat was gemacht>"
   ```

3. **Stoppe die Agenten**, sobald sie bestätigt haben (oder nach einer
   angemessenen Wartezeit: lass den Benutzer nicht länger als ein paar Minuten
   auf einen Agenten warten, der nicht antwortet):

   ```bash
   node /app/cli/bin/jht.js team stop --all
   node /app/cli/bin/jht.js team stop assistente
   ```

4. **Erstelle das Flag.** Das ist das Letzte, was du tust: es sagt dem Spiel,
   dass es den Container herunterfahren und sich beenden kann.

   ```bash
   touch /jht_home/.shutdown-ready.flag
   ```

## Regeln

- **Das Flag muss IMMER erstellt werden**, auch wenn etwas schiefgegangen ist.
  Wenn du es nicht erstellst, sitzt der Benutzer vor einem Fenster, das auf dich
  wartet — und wird am Ende das Beenden erzwingen, genau das, was diese Skill
  verhindert.
- **Verhandle das Beenden nicht.** Der Benutzer hat entschieden: deine Aufgabe
  ist, es geordnet ablaufen zu lassen, nicht darüber zu diskutieren oder es
  aufzuschieben.
- **Keine neue Arbeit** ab dem Moment, in dem du `[SHUTDOWN]` erhältst: keine
  Spawns, keine neuen Durchgänge, kein Hochskalieren.
- Wenn ein Agent nicht antwortet, halte es im Tagebuch fest und mach weiter:
  besser den Wiederaufnahmepunkt EINES Agenten verlieren, als das Beenden für
  alle zu blockieren.
