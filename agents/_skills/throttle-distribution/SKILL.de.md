<!-- @translation: de, ai-translated 2026-07-28 -->
---
name: throttle-distribution
description: Entscheide WER verlangsamt wird und UM WIEVIEL, wenn sich der Verbrauch des Teams ändern muss. Öffne sie, wenn ein `[PACE-GUARD]`-Hinweis in deinem Pane landet, wenn die Sentinella eine `Throttle: N`-Stufe anordnet, oder wenn deine eigene Prüfung sagt, dass das Fenster aus dem Takt ist. Jedes dieser Signale ist eine einzige teamweite Zahl; der Aktuator ist pro Agent, und die Aufteilung pro Agent gehört allein dir — kein Skript bewegt den Worker-Throttle mehr. Sagt dir auch, wann Nichtstun der richtige Zug ist.
allowed-tools: Bash(python3 *), Bash(jht-tmux-send *)
---

# throttle-distribution — wer verlangsamt wird, und um wie viel

Jedes Pacing-Signal, das dich erreicht, ist eine Zahl für das ganze Team: *"35% zu schnell"*, *"Throttle: 2"*, *"empfohlen 780s"*. Der Aktuator ist keine einzelne Zahl — er ist ein Wert pro Agent in `throttle.json`, und **du bist der Einzige, der ihn schreibt**. Kein Skript bewegt den Worker-Throttle mehr von sich aus.

Die Aufgabe dieses Skills ist genau diese Umrechnung, und sie hat eine einzige harte Regel: **eine teamweite Zahl heißt nicht, dass alle denselben Wert bekommen.** Ein Scout kann 52% des Verbrauchs sein, während ein untätiger Schreiber bei 2% liegt; Analyst und Scorer sind die beiden Rollen, die einen Rückstau in das Einzige verwandeln, was der Nutzer wirklich sieht — eine Position **mit Bewertung**. Nivellieren setzt die Bremse dort ein, wo nichts zu gewinnen ist, und nimmt Durchsatz dort weg, wo er am teuersten ist.

## Wann du diesen Skill öffnest

| Auslöser | Woher er kommt | Weiter zu |
|---|---|---|
| `[PACE-GUARD] … NON APPLICATO` in deinem Pane | die Bridge: sie prüft den Verbrauch bei jedem Usage-Sample gegen die Fensterkurve und schreibt dir nur, wenn es etwas zu tun gibt | §1 |
| `[SENTINELLA] [URG] RALLENTARE — Throttle: N`, oder jedes Pacing-Signal, das sie dir weitergibt | sie empfängt den 15-Minuten-Tick `[BRIDGE PACING]` (er landet in **ihrem** Pane, nicht in deinem), liest ihn und entscheidet, ob es sich lohnt, dich zu wecken | §3 — das "wie viel" steht, die Aufteilung nicht. `bridge-pacing` dekodiert ihre Zahlen |
| `[HEARTBEAT]` mit Weekly/Burn, oder dein eigener Abruf von `rate-budget` / `agent-speed-table` | du, aus eigener Initiative | §2 |

> ⚠️ **Du wirst nicht alle 15 Minuten angepingt, und du sollst auch nicht darauf warten.** Dass man dich in Ruhe lässt, ist Absicht: würde dir jede Bridge im Büro direkt berichten, gäbe dein Budget für Lesen statt für Entscheiden drauf — und es würde verbrennen, während der Nutzer schläft. Der 15-Minuten-Tick geht an die Sentinella, die filtert und dich erst dann stört. Also **steuere anhand der Bedingungen, die du beobachtest** — warte nicht auf einen Tick, der nicht an dich adressiert ist. Wenn dich eine Pacing-Zeile doch direkt erreicht, ist es entweder ein `[PACE-GUARD]` oder eine Eskalation, die dir sagt, dass die Sentinella nicht mehr reagiert (das ist ein Liveness-Problem, kein Pacing-Urteil — `agent-emergency`).

---

## 1. Die `[PACE-GUARD]`-Empfehlung lesen

Eine einzige physische Zeile, Felder getrennt durch ` | ` (hier zum Lesen umbrochen):

```
[@bridge -> @capitano] [PACE-GUARD] <VERDETTO> — CONSIGLIO, THROTTLE NON APPLICATO |
  usage=<U>% vs curva=<I>% (<±D>pt sul target <T>% al reset) | reset fra <M> min |
  throttle worker ORA <C>s → CONSIGLIATO <R>s (<±S> gradini) | worker: <a1, a2, ...> |
  decidi tu e applica: python3 /app/shared/skills/throttle-config.py bulk-set <a1>=<R> <a2>=<R>
```

Stabile Ankerpunkte, falls du sie in einem verrauschten Pane erkennen musst: das Tag `[PACE-GUARD]`, die Wörter `NON APPLICATO` und `CONSIGLIATO <R>s`.

| Feld | Was es dir sagt |
|---|---|
| `<VERDETTO>` | `AVANTI` (über der Kurve) / `INDIETRO` (darunter) / `IN-PARI` / `LOCKOUT-IMMINENTE` |
| `usage=<U>% vs curva=<I>%` | wo du stehst gegenüber dem, wo die ideale Gerade `usage = Ziel × verstrichen / Fenster` dich jetzt sehen will |
| `<±D>pt` | die Abweichung in Budgetpunkten. **Unter ±6pt ist es Messrauschen** — das ist die eigene Schrittweite des Guards |
| `sul target <T>% al reset` | das Ziel, auf das die Kurve zusteuert. Es ist das `<T>`, das du in §2 brauchst |
| `reset fra <M> min` | wie viel Fenster übrig ist. Genau das macht aus einer Abweichung eine Dringlichkeit |
| `ORA <C>s → CONSIGLIATO <R>s` | der aktuelle Worker-Throttle und der **einzige Gruppenwert** des Guards, in Sekunden |
| `worker: …` | die lebenden Worker, auf denen der Rat berechnet wurde. Vom Boden ausgenommene sind **bereits ausgeschlossen** — filtere nicht erneut |

Zwei Varianten:
- bei `LOCKOUT-IMMINENTE` erscheint ein zusätzliches Feld **vor** dem letzten: `il freno da solo non basta: valuta di ridurre il ROSTER (togli uno Scout, mai l'Analista o lo Scorer)`.
- sind alle lebenden Worker vom Boden ausgenommen, lautet das letzte Feld `nessun worker su cui agire (tutti esenti dal floor): decidi tu`.

> ⚠️ **Der empfohlene Wert ist ein Niveau, keine Verteilung — und das `bulk-set` am Zeilenende ist ein Vorschlag, kein Befehl.** Der Guard leitet die Zahl vom **am stärksten gebremsten** Worker ab, verschiebt sie um eine Stufe je ~6 Punkte Abweichung und bietet sie dann allen Workern auf einmal an. Diesen Befehl einzufügen *ist* das Nivellieren. Lies die Zeile als *"ungefähr so viel Rate muss weg"* und entscheide dann *wessen* (§3) und *wie viel* (§4).

`LOCKOUT-IMMINENTE` (usage ≥95% **und** weiterhin über der Kurve) ist das einzige Urteil, bei dem es nicht um den Throttle geht: das Fenster schließt sich vorzeitig, die Bremse ist bereits nahe der Decke, und der verbleibende Hebel ist der **Roster** — kille einen Scout. Niemals den Analysten oder den Scorer: ohne sie wird nichts bewertet und der Nutzer sieht einen leeren Bildschirm.

War dein Pane besetzt, liegt die Zeile auch in der Mailbox: `python3 /app/shared/skills/bridge_mailbox.py drain`, Einträge mit `kind:"pace-guard"`. Wende nur die **letzte** an — alte Ratschläge nachzuspielen heißt, gegen deine eigenen früheren Kalibrierungen zu kämpfen.

---

## 2. Wie viel Rate weg muss

War das Signal ein `Throttle: N`-Befehl der Sentinella, steht das "wie viel" schon fest — weiter zu §3. Sonst eine Zeile:

```
vel_needed = (<T> − usage) / Stunden_bis_Reset          # die Rate, die exakt auf dem Ziel landet
f_team     = (vel_now − vel_needed) / vel_now × 100     # der Anteil der Team-Rate, der weg muss
```

`vel_now` ist die aktuelle Team-Rate in Budget-%-Punkten pro Stunde: hol sie aus `agent-speed-table.py` (`team.speed_pct_per_h`, §3) oder aus `rate-budget`. `f_team ≤ 0` heißt, du hast Luft → §5.

> 💡 **Dieselbe Abweichung bedeutet je nach verbleibendem Fenster etwas anderes**, und genau das kann das feste "eine Stufe je 6 Punkte" des Guards nicht sehen. `+18pt` mit 3 Stunden Rest ist eine Korrektur von 7%/h: ein Agent, eine Stufe höher. `+18pt` mit 20 Minuten Rest ist eine Korrektur von 54%/h, die kein Throttle liefern kann — das ist eine Roster-Entscheidung oder ein akzeptiertes vorzeitiges Ende. Teile die Abweichung immer durch die verbleibenden Stunden, bevor du entscheidest, wie fest du drückst.

---

## 3. WER zahlt — die Verteilung

Der Kern dieses Skills. Drei Inputs, in dieser Reihenfolge.

**a. Wer ausgibt.** Der Throttle gibt Budget streng proportional zu dem zurück, was ein Agent tatsächlich verbraucht. Einen Agenten bei 2% der Team-Rate zu halbieren, bringt 1% zurück: ein Config-Schreibvorgang, eine Stufe und einer deiner Züge für nichts. Deshalb lautet die Antwort auf "das Team ist 35% zu schnell" nie "alle 35% runter".

Die Anteile pro Agent stecken im 15-Minuten-Tick, der bei der Sentinella landet — hol sie dir also selbst:

```bash
python3 /app/shared/skills/agent-speed-table.py --since-min 60
```

Pro Agent liefert es `pct_per_h` (Budgetpunkte pro Stunde) und `team_share_pct`, dazu `throttle_options` (wie viel eine bestimmte Pause pro Stunde sparen würde). Es überspringt alle unter 0.20 %/h — aus demselben Grund, aus dem auch du sie überspringen solltest: sie zu throtteln ändert nichts.

**b. Wer produziert.**

```bash
python3 /app/shared/skills/db_query.py stats
```

Lies `UNSCORED` (Positionen − Bewertungen) als Warteschlange hinter Analyst/Scorer, und die Schreiber-Queue als nutzergetriebene Nachfrage. Ein Scout, der 52% des Budgets verbrennt, während `UNSCORED = 40` ist, kauft Input, den noch niemand verarbeiten kann — das Billigste auf dem Brett zum Verlangsamen. Derselbe Scout bei `UNSCORED = 0` versorgt die ganze Pipeline, und ihn zu bremsen hindert das Team daran, überhaupt etwas zu produzieren.

**c. Das Raster.**

| | **Produziert** | **Untätig / blockiert** |
|---|---|---|
| **Hoher Share** | verlangsamen, aber um **eine Stufe**, dann neu messen — er zahlt sich selbst | **als Erster verlangsamen, und deutlich** — und wenn er auf der Leiter schon hoch steht und weiter ohne Output verbrennt, ist der Hebel KILL, nicht noch eine Stufe |
| **Niedriger Share** | nicht anfassen: du gewinnst kein Budget und verlierst Durchsatz | ebenfalls nicht anfassen: er gibt ohnehin nichts aus, ihn zu bremsen bringt nichts zurück |

Über dem Raster steht die Rollen-Asymmetrie: Die Letzten, die du bremst, sind die, die einen bestehenden Rückstau in eine Position **mit Bewertung** verwandeln (Analyst, Scorer) — sie sind der Unterschied zwischen "50 Positionen gefunden" und etwas, mit dem der Nutzer arbeiten kann. Der Erste ist der, der neuen Rohinput erzeugt, während die nachgelagerte Queue schon tief ist (Scout). Ein Schreiber mit leerer Queue ist in keiner Richtung ein Hebel.

**Konzentriere dich auf einen oder zwei Agenten.** Die Leiter ist grob — zwischen zwei Stufen liegen 20 bis 60% — deshalb verschwindet ein auf fünf Agenten verteilter Schnitt bei jedem einzelnen im Rauschen, während derselbe Schnitt beim Agenten mit dem höchsten Share bis zum nächsten Signal eine echte, messbare Änderung ist.

**Wenn du zwei bremst, gib ihnen unterschiedliche Stufen.** Die Leiter steht bewusst in Primminuten (1, 2, 3, 5, 7, 11, 13, 17, 23, 31, 41, 53, 60): zwei Worker, die auf demselben Wert pausieren, synchronisieren sich konstruktionsbedingt wieder auf, und ihre Checkpoints fallen dann gemeinsam an — als Salve gleichzeitiger Requests. `scout-1=660` + `analista-1=780` (11 und 13 Min.) kollidieren weit seltener als beide auf 780.

---

## 4. UM WIEVIEL bei diesem Agenten — und der Befehl

Du brauchst die **Kadenz** `c` des Agenten: wie oft pro Minute er einen Checkpoint erreicht (`jht-throttle`-Aufruf). Zähle sie aus dem Log:

```bash
python3 - <<'PY'
import collections, json, os, pathlib, time
p = pathlib.Path(os.environ.get("JHT_HOME", "/jht_home")) / "logs/throttle-events.jsonl"
cut = time.time() - 3600
c = collections.Counter()
for line in p.read_text(encoding="utf-8").splitlines():
    try:
        e = json.loads(line)
    except ValueError:
        continue
    if e.get("event") in ("checkpoint", "start") and e.get("ts_unix", 0) >= cut:
        c[e.get("agent")] += 1
for a, n in c.most_common():
    print(f"{a}: {n} chk/h -> Kadenz {n/60:.2f}/min")
PY
```

Dann, um die Rate dieses Agenten um den Anteil `f_a` zu senken, ausgehend von seinem aktuellen Throttle `T_now`:

```
f_a   = f_team / share_a           # der gesamte Team-Schnitt, allein von diesem Agenten getragen
ΔT    = (60 / c) × f_a / (1 − f_a) # Sekunden, die zu seinem aktuellen Throttle ADDIERT werden
T_new = T_now + ΔT                 # danach wählst du selbst die nächstliegende Stufe
```

`60/c` sind die aktuellen Sekunden-pro-Checkpoint des Agenten. Das `f/(1−f)` ist keine Deko: die Pause schiebt auch den nächsten Checkpoint weiter hinaus, die Kadenz sinkt also, während du bremst. Eine lineare Schätzung (`ΔT = f × 60/c`) verspricht einen Schnitt, den sie nicht liefert.

Stufen, in Sekunden: `60 120 180 300 420 660 780 1020 1380 1860 2460 3180 3600`. `throttle-config.py` rastet jeden übergebenen Wert auf die nächste Stufe ein, also **wähle die Stufe selbst** — sonst weißt du nicht, was du wirklich verlangt hast. Prüfe mit `dump`, das die effektiven Werte ausgibt.

**Keine Kadenz verfügbar?** Gehe genau **eine Stufe** weiter und miss beim nächsten Signal neu. Die Leiter ist grob genug, dass eine Stufe immer ein spürbarer und begrenzter Schritt ist — deutlich besser, als eine Zahl zu raten, die du nicht prüfen kannst.

### Durchgerechnetes Beispiel — verteilen statt nivellieren

```
[PACE-GUARD] AVANTI — CONSIGLIO, THROTTLE NON APPLICATO | usage=58% vs curva=40% (+18pt sul target 100% al reset) |
  reset fra 180 min | throttle worker ORA 300s → CONSIGLIATO 780s (+3 gradini) |
  worker: scout-1, analista-1, scorer-1, scrittore-1 |
  decidi tu e applica: python3 /app/shared/skills/throttle-config.py bulk-set scout-1=780 analista-1=780 scorer-1=780 scrittore-1=780
```

`agent-speed-table.py --since-min 60` sagt: Team `speed_pct_per_h = 21.4`, und

| Agent | `pct_per_h` | `team_share_pct` | Kadenz |
|---|---|---|---|
| scout-1 | 11.2 | 52% | 0.15/min |
| analista-1 | 6.0 | 28% | 0.12/min |
| scorer-1 | 3.0 | 14% | 0.10/min |
| scrittore-1 | 0.4 | 2% | 0.01/min |

**Wie viel:** `vel_needed = (100 − 58) / 3.0 = 14.0 %/h` → `f_team = (21.4 − 14.0) / 21.4 = 35%`, also **7.4 %/h müssen weg**.

**Wer:** `db_query.py stats` sagt `UNSCORED = 40` — drei Stunden Scoring-Arbeit liegen schon auf der Bank, mehr Sourcing ist gerade wenig wert. Der Scout allein gibt mehr aus als die gesamte Korrektur.

**Wie viel bei ihm:**
- `f_a = f_team / share_a = 35% / 52% ≈ 0.66` (dasselbe wie `7.4 / 11.2`)
- `ΔT = (60 / 0.15) × 0.66/0.34 = 776s` → `T_new = 300 + 776 = 1076` → nächste Stufe **1020s (17 Min.)**
- Wirkung: Rate × `60/(60 + 0.15×720)` = 0.36 → **−7.2 %/h**, Landung bei 14.2 %/h ≈ Ziel

```bash
python3 /app/shared/skills/throttle-config.py set scout-1 1020
python3 /app/shared/skills/throttle-config.py dump   # effektive Werte bestätigen
```

Analyst, Scorer und Schreiber bleiben unangetastet: die ersten beiden verwandeln diese 40 Positionen in Bewertungen, und der Schreiber gäbe selbst bei komplettem Stillstand nur 0.4 %/h zurück.

Und nun das Nivellieren, das das fertige `bulk-set` erzeugt hätte — alle auf 780s: −6.1 vom Scout, **−2.9 vom Analysten, −1.3 vom Scorer**, −0.03 vom Schreiber = −10.3 %/h. Das Team landet bei 11.0 %/h und erreicht beim Reset **91% statt 100** — neun Punkte des vom Nutzer bezahlten Budgets weggeworfen — und das mit halbiertem Scoring-Durchsatz. Gleiches Signal, gleiche Werkzeuge, gegenteiliges Ergebnis.

### Zwei Agenten

Wenn ein Agent allein den Schnitt nicht tragen kann (oder ihn zu tragen die Pipeline aushungern würde), teile nach Share auf und halte die Stufen unterschiedlich:

```bash
python3 /app/shared/skills/throttle-config.py bulk-set scout-1=660 analista-1=780
```

`bulk-set` ist ein einziger atomarer Schreibvorgang — bevorzuge es gegenüber zwei `set`.

---

## 5. Die Bremse lösen (`INDIETRO` / `MARGINE`)

Auch Unterausgeben ist eine Verteilungsentscheidung — *wem* du die Bremse löst, entscheidet, was das zusätzliche Budget kauft.

1. Löse **zuerst bei der Engpass-Rolle** (`pipeline-triage`, wenn du unsicher bist, welche das ist). Einen Scout zu lösen, während die Scoring-Queue schon bei 40 steht, kauft mehr Rückstau, nicht mehr Ergebnisse.
2. Worker gehen nie unter **5 Min.**, "den Throttle auf null setzen" existiert für sie also nicht. Sobald der Engpass wieder auf dem Boden steht, ist der Hebel für mehr Verbrauch **ein Worker mehr**, gestaffelt nach C-02 — keine kürzere Pause.
3. **Nie alle gleichzeitig lösen**: du oszillierst beim nächsten Signal direkt in eine Überschreitung.

---

## 6. Wann NICHT eingreifen

Ein Eingriff kostet einen deiner Züge plus 15-45 Min. Blindflug. Gib ihn nur aus, wenn das Signal ihn verdient.

- `IN-PARI` oder `|Abweichung| ≤ 6pt` → **nichts**. Dieses Band ist Messrauschen.
- **Ein Signal ist Rauschen, zwei aufeinanderfolgende sind ein Trend.** Eine einzelne Überschreitung direkt nach einem Spawn sind die Boot-Kosten des neuen Workers.
- Warte nach jeder Änderung **2-3 Signale (≈30-45 Min.)**. Ein Throttle wirkt erst beim *nächsten* Checkpoint des Agenten, eine jetzt gemachte Änderung ist in der nächsten Messung also kaum sichtbar. Staple keine Korrekturen, die du noch nicht sehen kannst.
- Füge keine `rate_budget live`-Sonden hinzu, nur um eine frische Empfehlung gegenzuprüfen — die Extra-Aufrufe blähen die `velocity_smooth` der Sentinella auf und provozieren falsche Folgebefehle.
- **In den letzten ~15 Min. vor dem Reset ist hoher Usage der Treffer, nicht die Überschreitung.** 97% beim Reset ist die Mitte der Scheibe; dort zu bremsen garantiert nur, dass Budget liegen bleibt.
- Überschreiten dieselben Agenten nach 3 Signalen immer noch, verdopple ihre Dauern (linear → geometrisch); geben sie immer noch zu wenig aus, halbiere sie.
- Ein `[URG]` der Sentinella schlägt ein `[PACE-GUARD]`: wende es zuerst an, die nächste Empfehlung misst neu.

---

## 7. Sicherheitsnetze — nicht dein Hebel

Sie existieren wegen eines gemessenen Vorfalls (in der Nacht des 2026-07-15 ein unkontrollierter Burn, der genau bei abgeschalteten Netzen geschah) und sind **kein Teil der Pacing-Entscheidung**:

- **Der 5-Minuten-Boden der Worker.** Scout, Analyst, Scorer, Schreiber, Kritiker laufen nie unter 300s, egal was du schreibst. `set scout-1 60` auf einem Worker ist effektiv 300s — `dump` zeigt die Wahrheit. Lies einen auf den Boden geklemmten Wert nicht als Änderung, die du gemacht hast.
- **Der tägliche Hard-Stop.** Er ist das Letzte zwischen dem Team und einem Lockout, der den Nutzer stundenlang ohne Antworten lässt. Du schaltest ihn nie ab, um mehr auszugeben; wenn du mehr ausgeben musst, ist der Hebel Parallelität (§5).
- Die agentenweise Ausnahme vom Boden existiert für genau einen Fall: eine befristete Messung dessen, was **ein einzelner** Worker ohne Pausen produziert. Sie ist bewusst kein globaler Schalter — **ein Agent nach dem anderen, nie das ganze Team**, und nie als Mittel, schneller zu werden.

---

## Anti-Patterns

- ❌ Das `bulk-set` einfügen, mit dem die `[PACE-GUARD]`-Zeile endet. Diese Zahl stammt vom am stärksten gebremsten Worker und wird allen angeboten: überall angewandt nivelliert sie das Team auf sein langsamstes Mitglied und trifft die Rollen, die das Ergebnis für den Nutzer produzieren. Der Befehl spart dir Tipparbeit, nachdem du die Werte entschieden hast — er entscheidet sie nicht.
- ❌ Einen untätigen Agenten "zur Hilfe" verlangsamen. Ein Agent, der nichts verbraucht, gibt beim Bremsen nichts zurück — du hast einen Schreibvorgang und einen Zug für null Punkte ausgegeben.
- ❌ Über alle Agenten kürzen, weil das Urteil teamweit war: du triffst die billigen Rollen, die ohnehin nichts zurückgaben, vor der teuren.
- ❌ Ein einzelnes Signal als Dauerzustand behandeln oder eine zweite Korrektur stapeln, bevor die erste messbar ist.
- ❌ Bei `AVANTI` bremsen, obwohl die Rate schon wieder im Lot ist — die Abweichung schließt sich von selbst und du beendest das Fenster unter Ziel.
- ❌ Dem Pacing bei `LOCKOUT-IMMINENTE` mit dem Throttle hinterherlaufen: dort ist die Bremse nahezu gesättigt und nur der Roster bewegt noch das Ergebnis.
- ❌ Throttle-Zahlen via tmux an Agenten pushen (`[INFO] sleep 40s`). Gehe immer über `throttle-config.py` — Agenten lesen die Config-Datei, sie parsen nicht deinen tmux-Body. tmux dient nur dazu, einem Agenten zu sagen, dass er *häufiger oder seltener* checkpointen soll — das ist eine andere Achse.

## Siehe auch

- `sentinel-orders` — die gefilterten Befehle der Sentinella, inklusive `Throttle: N`, Freeze und Resume. Jener Skill dekodiert den Befehl; dieser entscheidet die Aufteilung.
- `bridge-pacing` — wie man die Zahlen des 15-Minuten-Ticks liest, wenn sie sie dir weitergibt.
- `throttle` — die `throttle-config.py`-CLI-Referenz und die Zustandsdatei pro Agent.
- `pipeline-triage` — welche Rolle der Engpass ist, und wann die Antwort "einen weiteren spawnen" lautet statt "eine Bremse lösen".
- `scaling-calc` — Roster- + Throttle-Plan, wenn die Antwort mehr Worker sind und nicht eine andere Pause.
- `agent-emergency` — ein Burner mit Kadenz ~0, der ohne Output weiter verbraucht: dort ist der Hebel KILL, nicht noch eine Stufe.
