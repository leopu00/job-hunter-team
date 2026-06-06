<!-- @translation: de, ai-translated 2026-06-06 -->
---
name: spawn-doctor
description: Startet einen frischen DOTTORE on-demand, wenn du (Capitano/Assistente/Sentinella/Mentor) einen sofortigen Health-Check-Durchlauf brauchst. Verwende diese Skill ANSTATT in die DOTTORE-Session zu schreiben, wenn der Benutzer "fai partire il dottore" / "dottora" / "controlla il team" verlangt, weil zwischen geplanten Runden die DOTTORE-Session residuales Bash ist (One-Shot-Lebenszyklus, ~10 min aktiv + ~110 min Schlaf bis zum naechsten Spawn im 2h-Zyklus).
allowed-tools: Bash(/app/.launcher/spawn-doctor.sh *), Bash(tmux *), Bash(jht-tmux-send *)
---

# spawn-doctor — Notfallruf an den Dottore

## Warum sie existiert

Der **doctor-watchdog** startet automatisch alle 2 Stunden einen DOTTORE
(Takt gewaehlt am 2026-05-18, um Token-Verschwendung zu reduzieren:
12 Spawns/Tag statt 48). Zwischen einem Spawn und dem naechsten existiert
die tmux-Session `DOTTORE` zwar, ist aber "residuales Bash" (der vorherige
Dottore hat sich am Ende seiner Runde selbst zerstoert). Ein `[URG]` oder
`[HEALTH]` an diese Session zu senden ist **nutzlos**: die Nachricht
landet im Bash und niemand liest sie.

Klassischer Fall (Post-Mortem `2026-05-18-capitano-zombie-night`):
der Assistente schickte 2 URG an den Dottore um 06:08/06:09, weil der
Benutzer es verlangt hatte, aber der vorherige Dottore hatte sich um
05:48 selbst zerstoert → 2 URG ins Leere verloren, der Capitano blieb
weitere ~20 min Zombie, bis der Assistente verstand, dass er direkt
handeln musste.

Diese Skill schliesst die Schleife: statt "mit einem toten Dottore zu
reden", **starte ich sofort einen neuen**.

## Wer sie verwenden darf

Die 4 langlebigen Koordinator-Agenten:
- 👨‍✈️ **Capitano** — wenn er Zombie-Worker erkennt und eine zweite
  Meinung will, bevor er selbst den Respawn durchfuehrt.
- 💬 **Assistente** — wenn der Benutzer "fai partire il dottore" oder
  "controlla il team" via Telegram/Chat anfordert.
- 🧙‍♂️ **Mentor** — wenn er in einem woechentlichen Digest anomale
  Muster erkennt und eine Infrastruktur-Gesundheitspruefung will.
- 💂 **Sentinella** — wenn ein Agent unerwartet aufhoert, Token zu
  verbrauchen, mitten im produktiven Zeitfenster.

Die anderen Agenten (Scout, Analista, Scorer, Scrittore, Critico) haben
diese Skill **NICHT**: wenn sie ein Problem sehen, melden sie es dem
Capitano via `[REPORT]` und ueberlassen ihm die Entscheidung.

## Wie man sie verwendet

```bash
# Spawn one-shot. Das Skript ist idempotent: es killt jeden existierenden
# DOTTORE*, bevor es einen neuen erstellt, du kannst es also ohne Angst
# vor Duplikaten aufrufen.
bash /app/.launcher/spawn-doctor.sh
```

Erwartete Ausgabe:
```
[spawn-doctor] killing old session: DOTTORE     (se presente)
[spawn-doctor] DOTTORE avviato — workdir=/jht_home/agents/dottore — round=YYYYMMDDTHHMMSSZ-spawn
```

Der neue DOTTORE LLM (Codex/Kimi/Claude je nach `active_provider`)
startet in ~6-10 Sekunden, liest `AGENTS.md` (= Prompt des Dottore) und
beginnt den Health-Check-Durchlauf. Selbstzerstoerung am Ende.

## Nach dem Spawn — interagiere durch den Dottore (nicht alleine)

```bash
# 1. Spawn
bash /app/.launcher/spawn-doctor.sh

# 2. Warte 8-12s, bis der LLM bereit ist zu empfangen
sleep 10

# 3. Sende ein gezieltes [REQ] (der Dottore wird seine Standardprozedur
#    ausfuehren, aber du kannst ihn lenken, wenn du einen konkreten
#    Verdacht hast).
jht-tmux-send DOTTORE \
  "[@$MY_ID -> @dottore] [REQ] Round mirato: il Capitano non risponde da
   ~30 min, capture-pane mostra solo bash. Verifica e respawn se zombie.
   Riporta a me con [RES] alla fine."

# 4. Warte auf [RES] des Dottore (~10 min Standard-Budget) — kein
#    aggressives Polling. Der Dottore selbst loggt Ereignisse in
#    /jht_home/logs/dottore-actions.jsonl wenn er handelt.
```

## Wann man sie NICHT verwenden sollte

- ❌ Zombie-Worker und du bist der **Capitano**: fuehre den Respawn direkt
  via Skill `spawn-agent` + Kick-off Resume durch. Den Dottore braucht
  man dafuer nicht. Der Dottore ist fuer Probleme, die ein High-Level-LLM
  erfordern (Token-Spike-Diagnose, subtiler Deadlock, Cache-Prune
  cross-system).
- ❌ Anfrageschleife: wenn du in den letzten 15 min bereits
  `spawn-doctor` ausgefuehrt hast, warte. Einen neuen Dottore zu starten,
  waehrend der vorherige noch arbeitet, killt ihn (das Skript ist
  idempotent mit `kill-session` vorab) — du wuerdest Zeit und Budget
  verschwenden.
- ❌ Ohne konkreten Grund: der Dottore kostet ~3-5% des Kimi-Budgets pro
  Runde. Starte ihn nicht "um zu pruefen, ob alles laeuft" — dafuer gibt
  es bereits den doctor-watchdog alle 2h. Starte ihn, wenn du ein
  konkretes Ereignis zu untersuchen hast.

## Anti-patterns

- ❌ `jht-tmux-send DOTTORE "[URG] ..."` ohne vorher zu spawnen — exit 0,
  aber Nachricht verloren im residualen Bash. Historischer Fehler
  beobachtet am 2026-05-18 06:08-06:09 UTC.
- ❌ Manuell spawnen mit `tmux new-session -d -s DOTTORE` — umgeht den
  Prompt-Sync `AGENTS.md` + JSONL-Log + Cleanup. Verwende IMMER
  `spawn-doctor.sh`.
- ❌ Erwarten, dass der Dottore einen Nicht-Health-Task loest (z.B.
  "scrivi un CV"). Der Dottore ist single-purpose: liveness +
  cache-prune + py-tools-audit + cv-disk-audit. Nichts anderes.

## Siehe auch

- `agents/dottore/dottore.md` — Prompt des Dottore, Lebenszyklus one-shot
- `agents/_skills/liveness-check/SKILL.md` — Diagnose, die der Dottore ausfuehrt
- `.launcher/spawn-doctor.sh` — idempotentes Skript (Rev. Legacy 2026-05-08)
- `.launcher/doctor-watchdog.sh` — Schleife Takt 2h (Post-Mortem 2026-05-18)
- `docs/sessions/2026-05-18-capitano-zombie-night/README.md` — Fall, der diese Skill hervorgebracht hat
