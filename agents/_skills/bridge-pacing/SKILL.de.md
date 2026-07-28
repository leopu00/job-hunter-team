<!-- @translation: de, ai-translated 2026-06-06 -->
---
name: bridge-pacing
description: Lies einen 15-Minuten-Kalibrierungs-Tick `[BRIDGE PACING]` — die Messung der Bridge zur tatsächlichen Rate des Teams, mit einem Urteil (SFORO / MARGINE / ALLINEATO) plus Anteil und Kadenz pro Agent. Der Tick ist an die SENTINELLA adressiert, nicht an dich: öffne diesen Skill, wenn sie dir diese Zahlen weitergibt, oder wenn du aus eigener Initiative einen Tick nachliest. Warte nicht darauf, dass einer in deinem Pane landet — das passiert nicht. Das Urteil in Throttle-Werte pro Agent zu übersetzen, ist `throttle-distribution`.
allowed-tools: Bash(python3 /app/shared/skills/throttle-config.py *), Bash(jht-tmux-send *)
---

# bridge-pacing — den 15-Minuten-Kalibrierungs-Tick lesen

Die Bridge führt alle 15 Min. ein Messfenster aus (ausgerichtet auf :00/:15/:30/:45 UTC). Bei jedem Fensterschluss schreibt sie eine Zeile mit der tatsächlichen Rate des Teams — **in das Pane der Sentinella, nicht in deins** (push→pull, 25.06.2026). Du wirst bewusst nicht jede Viertelstunde angepingt: sie liest den Tick und weckt dich nur, wenn es einen Zug von dir wert ist. Dieses Format benutzt du also, wenn **sie dir die Zahlen weitergibt**, oder wenn du aus eigener Initiative einen Tick nachschaust — nie als etwas, worauf man wartet.

## Nachrichtenformat

```
[BRIDGE PACING] HH:MM UTC window=15m (effettivi Xm) samples=N |
  usage=U% reset_in=Rh reset_at=THH:MM UTC (proj=P% — INFO, secondario non-driver) |
  vel_team=V%/h | vel_target=T%/h (per chiudere a TGT% al reset) [schedule+ratio phase=ON] |
  ratio=K kT/% (team Σ kT / Δusage) |
  agenti: name=p%/h [kT/Xm → kT/h ÷ K = p%/h, share s%, cadenza c/min (n chk in Xm)] ; ... |
  VERDETTO: SFORO|MARGINE|ALLINEATO ...
```

`TGT` ist das **dynamische Ziel**, das von der Bridge gewählt wird:
- 24/7-Konfiguration oder kein Zeitplan → `TGT=92` (Bandmitte, historischer Standard)
- Arbeitszeiten-Konfiguration + Provider mit wöchentlichem Limit (Codex/Claude) → `TGT` ist der % der beim Reset benötigt wird, damit das Wochenbudget genau über die aktiven Stunden des Nutzers verteilt wird. Beispiel: Bürozeiten 9-18 auf Codex Pro → `TGT≈76`.
- Arbeitszeiten-Konfiguration + Kimi (kein wöchentliches Limit) → `TGT=92` (Bandmitte-Fallback).

Der `[schedule+ratio phase=ON]`-Tag in Klammern ist die **Quelle** des Ziels — `band_center` (keine Arbeitszeiten), `schedule+ratio` (voll arbeitszeiten-bewusst), `schedule+band` (Arbeitszeiten + Kimi-Fallback). Verwende ihn zum Debuggen unerwarteter Ziele.

## Felder, die du tatsächlich verwendest

| Feld              | Was es dir sagt                                                                                        |
|-------------------|------------------------------------------------------------------------------------------------------------|
| **`vel_team`**    | Gemessene Team-Rate, in Budget-Prozentpunkten pro Stunde                                                  |
| **`vel_target`**  | Rate, die bei `TGT%` beim Reset landen würde (Mitte des ±10-Punkte-Bandes um `TGT`)                      |
| **`share s%`**    | Gewicht pro Agent an der Gesamtrate (Σ shares ≈ 100%) — sagt dir **WER** verlangsamt werden muss          |
| **`cadenza c/min`** | `jht-throttle`-Aufrufe pro Minute pro Agent im Fenster — sagt dir **WIEVIEL** zur Konfiguration hinzuzufügen ist |
| **`VERDETTO`**    | Handlungsfähige Zusammenfassung; direkt auf die Tabelle unten abbilden                                    |

> ⚠️ **`proj` ist nur INFO — handle NICHT danach.** Es ist eine volatile Extrapolation
> der Kurzfenster-Geschwindigkeit (z.B. es druckte `proj=-8.66%` während das Team nur knapp
> unter dem Ziel war). Die Regelschleife ist **`vel_team` vs `vel_target`** (beide
> wochenbewusst) + `weekly_remaining`. Ignoriere `proj` für Throttle/Spawn-Entscheidungen.

## Urteil → Aktion

| Urteil                           | Bedeutung                                                     | Aktion                                                                                |
|----------------------------------|---------------------------------------------------------------|---------------------------------------------------------------------------------------|
| `SFORO +X%/h → riduci Y%`        | `vel_team` überschreitet Ziel um X Punkte/h. Y% der Rate kürzen. | **Erhöhe** `throttle-config` für die Agenten mit **hohem Anteil** (Top 1-2)           |
| `MARGINE −X%/h → puoi salire Y%` | `vel_team` unter Ziel. Du hast Spielraum.                     | **Auf Null setzen oder reduzieren** den Throttle bei gedrosselten Agenten (Priorität: Engpass-Rolle) |
| `ALLINEATO Δ ±0.2%/h`            | Innerhalb der Toleranz.                                       | Nichts tun, auf den nächsten Tick warten                                               |

> 💡 `X%/h` vs `Y%` sind dasselbe in zwei Einheiten. `Y = X / vel_team × 100`.

## Was du damit machst

Das Urteil sagt dir, **ob** du eingreifst und grob **wie viel**. Das in Werte in `throttle.json` zu übersetzen — welcher Agent verlangsamt wird, um wie viele Stufen, und wann Nichtstun das Richtige ist — gehört zu **`throttle-distribution`**. Öffne jenen Skill zum Handeln: er besitzt die Arithmetik, die Leiter und die Sicherheitsregeln.

Zwei Dinge, die du mitnimmst:

- **`share` beantwortet WER.** Der Throttle gibt Budget nur proportional zu dem zurück, was ein Agent tatsächlich ausgibt — ein teamweites "kürze 19%" ist also nie "alle 19% runter".
- **`cadenza` beantwortet WIE VIEL.** Sie ist der Input für die Dauer-Formel: derselbe Wert in der Config kürzt bei einem Agenten, der zweimal pro Stunde einen Checkpoint erreicht, völlig anders als bei einem, der zehnmal hinkommt.

## Anti-Patterns

- ❌ Nur `VERDETTO` lesen und `share` / `cadenza` ignorieren: du kürzt blind über alle Agenten und triffst die günstigen Rollen (Scorer, Analyst) vor den teuren (Writer, Critic).
- ❌ Einen einzelnen SFORO-Tick als permanenten Zustand behandeln: 1 Tick ist Rauschen, 2 aufeinanderfolgende Ticks sind Signal.
- ❌ Diesen Ablauf mit `sentinel-orders` mischen: ein `[BRIDGE PACING]` und ein `[URG] RALLENTARE` können innerhalb von Minuten nacheinander eintreffen. Der `[URG]` gewinnt immer — wende ihn zuerst an, das nächste Pacing misst neu.
- ❌ Pacing-abgeleitete Zahlen via tmux an Agenten pushen (`[INFO] sleep 40s`). Gehe immer über `throttle-config.py` — Agenten lesen die Datei, sie parsen nicht deinen tmux-Body.

## Siehe auch

- `throttle-distribution` — die Umsetzung: wer verlangsamt wird, um wie viel, und wann man nichts tut.
- `sentinel-orders` — Routine-Ticks, Throttle-Stufen 0-4, Notfälle.
- `bridge-mailbox` — Pacing-Urteile abrufen, die du während einer langen Runde verpasst hast (die Bridge hängt an ein JSONL an, auch wenn der Live-tmux-Send fehlgeschlagen ist).
- `throttle` — die `throttle-config.py` CLI-Referenz und die Zustandsdatei pro Agent.
- `pipeline-triage` — wenn MARGINE "einen weiteren am Engpass spawnen" bedeutet statt nur den Throttle auf Null zu setzen.
