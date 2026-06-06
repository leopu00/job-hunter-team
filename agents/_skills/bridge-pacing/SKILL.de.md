<!-- @translation: de, ai-translated 2026-06-06 -->
---
name: bridge-pacing
description: Übersetze einen `[BRIDGE PACING]` 15-Minuten-Kalibrierungs-Tick in Throttle-Anpassungen pro Agent. Die Bridge misst die tatsächliche Verbrauchsrate des Teams und gibt dir ein Urteil (SFORO / MARGINE / ALLINEATO) plus den Anteil pro Agent + Kadenz, um zu entscheiden WER verlangsamt wird und UM WIEVIEL. Öffne diesen Skill NUR wenn eine `[BRIDGE PACING]`-Zeile eintrifft; die routinemäßigen `[SENTINELLA]`-Befehle nutzen einen anderen Ablauf (`sentinel-orders`).
allowed-tools: Bash(python3 /app/shared/skills/throttle-config.py *), Bash(jht-tmux-send *)
---

# bridge-pacing — datengetriebene Throttle-Kalibrierung

Die Bridge führt alle 15 Min. ein Messfenster aus (ausgerichtet auf :00/:15/:30/:45 UTC). Bei jedem Fensterschluss schreibt sie eine Zeile in das Panel des Captain, die die tatsächliche Rate des Teams zusammenfasst und dir sagt, in welche Richtung du den Throttle verschieben sollst. Dies ist **kein** Sentinel-Befehl — es ist ein Kalibrierungssignal, auf das du mit `throttle-config.py` reagierst.

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

## Kalibrierungsformel (das einzig Neue hier)

Um eine `f%` Ratenreduktion bei einem Agenten mit Kadenz `c` Checkpoint/Min zu erzielen, ist die Dauer für `throttle-config`:

```
durata_sec = (f / 100) × 60 / c
```

Die Intuition: Jeder `jht-throttle`-Aufruf fügt `durata_sec` Pause hinzu. Über 60s ruft der Agent es `c` mal auf → fügt `c · durata` Sekunden Pause pro Minute hinzu → anteilige Ratenkürzung `= c · durata / 60`. Nach `durata` auflösen.

### Ausgearbeitetes Beispiel — die Kürzung auf einen Agenten konzentrieren

```
Tick: SFORO +4.35%/h → riduci 19%
analista-1: share 47%, cadenza 0.6/min
```

Fast die gesamte Kürzung auf `analista-1` schieben:
- Anteil auf analista-1 ≈ 19% / 47% ≈ 40%
- `durata_sec = 0.40 × 60 / 0.6 = 40s`
- → `throttle-config.py set analista-1 40`

### Ausgearbeitetes Beispiel — die Kürzung auf zwei Agenten verteilen

```
Tick: SFORO +4.35%/h → riduci 19%
analista-1: share 47%, cadenza 0.6/min
scout-1:    share 26%, cadenza c_scout
```

Kombiniertes Gewicht 47 + 26 = 73%. 19% proportional verteilen:
- Anteil pro Agent ≈ 19% / 73% ≈ 26%
- analista-1: `0.26 × 60 / 0.6 = 26s`
- scout-1:    `0.26 × 60 / c_scout`
- → ein `bulk-set` schreibt atomar:

```bash
python3 /app/shared/skills/throttle-config.py bulk-set \
    analista-1=26 scout-1=<abgeleitet von c_scout>
```

## Beim Lösen des Throttle (MARGINE)

Wenn das Urteil `MARGINE −X%/h → puoi salire Y%` lautet:
1. Wähle die Rolle, die du beschleunigen willst (Priorität: der aktuelle Engpass — `pipeline-triage` wenn unsicher).
2. Reduziere ihren aktuellen Throttle um ungefähr `Y%` (oder auf Null, wenn es ein kleiner Wert war).
3. Setze **nicht** alle auf einmal auf Null — du würdest beim nächsten Tick in ein SFORO oszillieren.

## Kadenz nach einer Konfigurationsänderung

- Warte nach jeder Änderung **2-3 Ticks** (≈30-45 Min.) bevor du erneut eingreifst.
- Das Pacing ist bereits deine Synthese — füge **keine** zusätzlichen `rate_budget live`-Aufrufe dazwischen ein (sie blähen die `velocity_smooth` des Sentinel auf).
- Wenn nach 3 Ticks das Urteil immer noch SFORO ist, verdopple die Dauern bei denselben Agenten (linear → geometrisch); wenn immer noch MARGINE, halbiere.

## Anti-Patterns

- ❌ Nur `VERDETTO` lesen und `share` / `cadenza` ignorieren: du kürzt blind über alle Agenten und triffst die günstigen Rollen (Scorer, Analyst) vor den teuren (Writer, Critic).
- ❌ Einen einzelnen SFORO-Tick als permanenten Zustand behandeln: 1 Tick ist Rauschen, 2 aufeinanderfolgende Ticks sind Signal.
- ❌ Diesen Ablauf mit `sentinel-orders` mischen: ein `[BRIDGE PACING]` und ein `[URG] RALLENTARE` können innerhalb von Minuten nacheinander eintreffen. Der `[URG]` gewinnt immer — wende ihn zuerst an, das nächste Pacing misst neu.
- ❌ Pacing-abgeleitete Zahlen via tmux an Agenten pushen (`[INFO] sleep 40s`). Gehe immer über `throttle-config.py` — Agenten lesen die Datei, sie parsen nicht deinen tmux-Body.

## Siehe auch

- `sentinel-orders` — Routine-Ticks, Throttle-Stufen 0-4, Notfälle.
- `bridge-mailbox` — Pacing-Urteile abrufen, die du während einer langen Runde verpasst hast (die Bridge hängt an ein JSONL an, auch wenn der Live-tmux-Send fehlgeschlagen ist).
- `throttle` — die `throttle-config.py` CLI-Referenz und die Zustandsdatei pro Agent.
- `pipeline-triage` — wenn MARGINE "einen weiteren am Engpass spawnen" bedeutet statt nur den Throttle auf Null zu setzen.
