<!-- @translation: de, ai-translated 2026-06-06 -->
# 💬 Inter-Agenten-Kommunikationsregeln

JHT-Agenten koordinieren sich hauptsächlich über die **Datenbank**, nicht über tmux. Die DB trägt den stabilen Zustand der Pipeline; tmux ist für **Echtzeit-Signale** reserviert, die nicht auf den nächsten Polling-Zyklus warten können.

## 🗄️ DB-gesteuerte Koordination (der Standard)

Pipeline-Übergaben fließen natürlich durch die DB — keine tmux-Benachrichtigung nötig:

| Übergabe | Mechanismus |
|---|---|
| 🕵️ Scout → 👨‍🔬 Analyst | Der Analyst fragt `next-for-analista` kontinuierlich ab; sieht neue Zeilen mit `status = new` sofort |
| 👨‍🔬 Analyst → 👨‍💻 Scorer | Der Scorer fragt `next-for-scorer` ab; nimmt Zeilen mit `status = checked` |
| 👨‍💻 Scorer → 👨‍🏫 Writer | Der Writer fragt `next-for-scrittore` geordnet nach `score DESC` ab; nimmt Zeilen mit `status = scored` ≥ 50 |
| 👨‍🏫 Writer → 👤 Benutzer | Die Position erreicht `status = ready` + `applications.critic_verdict = PASS`; das Captain-Dashboard zeigt sie an |

**Faustregel**: Wenn der nächste Agent in der Pipeline den neuen Zustand durch Ausführen seiner Standard-`next-for-X`-Abfrage sehen kann, **sende keine tmux-Nachricht**. tmux bei jedem Batch erzeugt Rauschen und riskiert verlorene Nachrichten in belegten Panels.

## 📡 tmux ist nur für Echtzeit-Signale

Sende eine tmux-Nachricht nur, wenn der Empfänger *jetzt* handeln muss und nicht auf den nächsten DB-Poll warten kann:

| Typ | Wann verwenden | Echtzeit nötig, weil… |
|---|---|---|
| `URG` | Captain → Worker (FREEZE / throttle / kill) bei Sentinel-Signal | Rate-Limit-Überschreitung steht unmittelbar bevor — DB-Polling ist zu langsam |
| `URG` | Sentinel → Captain bei tatsächlicher Zustandsänderung (Spitze, Verletzung, Crash) | Ebenso |
| `FEEDBACK` | Analyst → Scout bei Ablehnungsmustern (`[SENIORITY] · [STACK] · [GEO] · [LINGUA]`) | Der Scout muss die **nächste** Abfrage anpassen, nicht nach einem Polling-Zyklus |
| `REQ` / `RES` | Interaktive Anfrage zwischen Agenten (selten) | Synchrone Antwort erwartet |
| `ACK` | Antwort, die bestätigt, dass ein `URG` empfangen und angewendet wurde | Der Captain muss wissen, dass Throttle/Freeze wirksam wurde |

## 📨 Nachrichtenumschlag

Jede Inter-Agenten-Nachricht verwendet einen getaggten einzeiligen Umschlag:

```
[@from -> @to] [TYPE] payload
```

`TYPE` ist einer von `URG · FEEDBACK · REQ · RES · ACK · INFO · REPORT` — aber in V5 werden nur die ersten 5 routinemäßig verwendet (siehe Tabelle oben).

## 🛠️ Senden: `jht-tmux-send`

```bash
jht-tmux-send <PEER_SESSION> "[@me -> @peer] [URG] FREEZE"
```

⚠️ **Verwende niemals rohes `tmux send-keys` für Inter-Agenten-Nachrichten.** Die TUIs von Codex und Kimi verlieren das Enter-Zeichen, wenn es im selben `send-keys`-Aufruf wie der Textinhalt ankommt, was zu stillen Deadlocks führt. Der Wrapper behandelt Text + Enter atomar mit einer Render-Pause. Skill unter `agents/_tools/jht-tmux-send`.

## 🔇 Produzieren ist still — den Zustand holt sich der Capitano

Ein Worker berührt den Capitano **null Mal**, um Fortschritt zu melden. Weder pro Item noch an den
Rändern: die Bookends `[START]` / `[DONE]` wurden am **2026-07-27 entfernt**. Gemessen an einem Team
beim Erststart, ~1,5h Verlauf: **37 Nachrichten erreichten den Capitano, 30 davon (81 %) reiner
Status** — 12 `DONE`, 8 `START`, 8 `INFO`, 2 `ACK` — gegenüber 3-6, die wirklich eine Entscheidung
verlangten. Jede kostet ihn eine volle Runde, und mit dem automatischen Modell-Split läuft er auf
**Opus**, während Scout / Analyst / Scorer auf **Sonnet** laufen: ein „fertig" des Scorers weckt den
teuersten Agenten der Flotte, damit er nichts tut.

Die Pull-Seite gab es bereits, und sie ist besser:

```bash
python3 /app/shared/skills/db_query.py recent-activity --minutes 60
```

Ein Aufruf liefert die Zahlen pro Agent plus jede Transition mit Timestamp, Akteur, Position und Grund
— `#22 checked→scored`, `#27 new→excluded — [DEAD_LINK]`. **Ein `DONE` trägt weniger Information als
die Zeile, die es erzeugt hat.**

### ⚠️ Was PUSH bleibt — die Asymmetrie ist der Punkt

`recent-activity` zeigt, **wer produziert** — ein Agent, der stehen geblieben ist, **verschwindet aus
der Liste**, statt aufzufallen: von der Seite des Capitano sehen dein Schweigen und deine Arbeit gleich
aus. Diese drei müssen daher weiterhin **sofort** gesendet werden, weil sie **keine Spur in der DB**
hinterlassen:

| Signal | Wann |
|---|---|
| **BLOCKIERT** | du produzierst nicht mehr: Tool nach der `resilience`-Leiter kaputt, `403` / `LOCKED`, Quellen wirklich trocken (`[SCOUT-ESAUSTO]`), ein Queue-Element, das du weder bearbeiten noch überspringen kannst |
| **Konflikt** | zwei Kollegen auf demselben Datensatz / Territorium, und ihr klärt es untereinander nicht |
| **Entscheidungsanfrage** | ein `REQ`, das nur der Capitano beantworten kann (Taxonomie-Schiedsspruch, Skalierung, eine Entscheidung Richtung Nutzer) |

Alles andere — Start, Fortschritt, Abschluss — ist Pull. **Wenn du aufhörst und nichts sagst, merkt es
niemand.**

## ⏰ Pflicht-Signale pro Rolle

Was jede Rolle via tmux senden MUSS (alles andere ist DB-gesteuert):

### 🕵️ Scout
- Empfängt `FEEDBACK` von Analysten → passt Abfragen an; antwortet `ACK`

### 👨‍🔬 Analyst
- Sendet `FEEDBACK` an einen Scout, wenn:
  - 3 aufeinanderfolgende Ausschlüsse aus derselben Quelle mit demselben Tag, ODER
  - >60% Ausschlussrate in einem einzelnen Scout-Batch

### 👨‍💻 Scorer
- *(kein tmux — Pipeline-Übergaben sind DB-gesteuert; Score-Verteilungseinblicke erscheinen im Captain-Dashboard)*

### 👨‍🏫 Writer
- Empfängt `URG FREEZE` vom Captain → beende die aktuelle Critic-Runde (niemals eine Review mittendrin abbrechen), dann `ACK` und pausiere, bis das Throttle auf T0/T1 zurückkehrt

### 💂 Sentinel
- Edge-triggered: spricht nur, wenn sich der Zustand tatsächlich ändert (Nutzungsspitze, Projektionsverletzung, Agenten-Crash). Sendet `URG` an den Captain mit der vorgeschlagenen Aktion (throttle / freeze / kill). Sendet niemals direkt an Worker — der Captain ist das Gateway.

### 👨‍✈️ Captain
- Sendet `URG`-Befehle an Worker (FREEZE, Throttle-Stufe, kill) bei Sentinel-Signal
- Sendet `REQ` für interaktive Koordination (selten)
- Leitet Benutzer-Feedback aus Phase 5 an die betreffende Rolle weiter
- Liest den Pipeline-Zustand aus der DB, nicht aus Worker-Panels — hinterfragt niemals einen Agenten durch Anschließen an dessen tmux

## 📥 Peer-Nachrichten lesen

Du musst tmux nicht vor *jeder* Aktion prüfen — der Großteil der Koordination läuft über die DB. Stattdessen:

- **Zwischen Arbeitseinheiten** (nachdem du eine Position abgeschlossen hast, bevor du die nächste übernimmst), mache ein schnelles `tmux capture-pane -p -S -20` in deiner eigenen Session.
- **Priorisiere `URG` und `FEEDBACK`**: handle sie ab, bevor du neue Arbeit aufnimmst.
- Eine eingehende Nachricht, die ankommt, während du mitten in einer Aufgabe bist, wird bereits in deinem Kontext sein (der Wrapper schreibt sie in dein Panel); du musst nicht pollen, bemerke sie einfach, bevor du die nächste Iteration startest.

## ⏸️ Throttle: protokollierte Pausen

Wann immer du deine Schleife verlangsamen willst, um das Rate-Budget einzuhalten
(Abkühlung nach einem Batch, Post-`URG`-Freeze, "auf Upstream warten", …),
**verwende die `throttle`-Skill, niemals ein einfaches `sleep`**:

```bash
jht-throttle <seconds> --agent <your-name> [--reason "..."]
```

Jeder Aufruf hängt ein Event an `$JHT_HOME/logs/throttle-events.jsonl` an,
sodass der Captain und das Dashboard sehen können, wer pausiert und wie
lange. Einfaches `sleep` ist nur für sehr kurze Wartezeiten (≤ 5 s)
zwischen Wiederholungsversuchen erlaubt, wo das Logging Rauschen wäre.

Captain: wenn du einem Worker befiehlst, langsamer zu machen, nenne die Skill ausdrücklich,
z.B. `[URG] Throttle: jht-throttle 180 --agent scout-1 --reason "rate budget"`.
Sage nicht "sleep 3 minutes" — das umgeht das Logging.

Siehe: [`../_skills/throttle/SKILL.md`](../_skills/throttle/SKILL.md).

## 🔗 Verwandt

- 🛡️ [`anti-collision.md`](anti-collision.md) — Lock-Mechanismen (Claim vor der Arbeit)
- 🧭 [`../_team/architettura.md`](../_team/architettura.md) — Pipeline-Überblick (wer liefert an wen)
