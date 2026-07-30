<!-- @translation: de, ai-translated 2026-07-30 -->
# 💬 Inter-Agenten-Kommunikationsregeln — lean, Pull als Standard

JHT-Agenten koordinieren sich **pull-first**. Der Standard ist, den benötigten Zustand zu *entdecken*,
nicht danach zu *fragen*. Eine tmux-Nachricht ist die **Ausnahme**, reserviert für Dinge, die ein
Kollege wirklich nicht selbst finden kann.

> **Warum lean.** Ein Push-lastiges Protokoll (Status-Broadcasts, Routine-ACKs, „lebst du noch?"-Pings)
> verbrennt Tokens auf beiden Seiten — der Sender schreibt eine Runde, der Empfänger weckt eine Runde
> zum Antworten — und lenkt Agenten von echter Arbeit ab. Fast dieser gesamte Verkehr trägt keine
> Aktion. Schneide ihn weg.

## 🪜 Die Koordinations-Hierarchie — DB → capture-pane → Nachricht

Greife immer zum **billigsten Tier, das deine Frage beantwortet**. Steige erst dann eine Stufe höher,
wenn die darunter es wirklich nicht kann.

| Tier | Werkzeug | Wofür | Kosten |
|---|---|---|---|
| **1. DB** | `db_query.py` (`next-for-*`, status, `last_checked`, Flags) | **geteilter Zustand** — was in der Queue liegt, was beansprucht ist, was fertig ist, Scores, Lebenszyklus | am billigsten, deterministisch, ohne Races |
| **2. capture-pane** | `tmux capture-pane -p -S -N` auf der Session des Kollegen | **„was macht X gerade jetzt?"** — arbeitet er, hängt er an einem Fetch, idle, festgefahren | billig (keine Runde beim Kollegen), aber ein **racy Snapshot** — nie als dauerhaften Zustand vertrauen |
| **3. tmux-Nachricht** | `jht-tmux-send` | **Aktion, die der Kollege nicht entdecken kann** + **Sicherheits-Events** (siehe Latte unten) | teuer — eine Runde auf beiden Seiten; die Ausnahme |

**Faustregel:** Wenn die Antwort in der DB steht, frage die DB. Wenn du wissen musst, was ein Kollege
*in diesem Moment* tut, schau auf sein Pane — **schreib ihm nicht, um zu fragen**. Schreibe nur, wenn
keines von beiden funktioniert.

## 🚧 Die Latte für eine tmux-Nachricht (Push)

Sende eine Nachricht **nur**, wenn eines davon zutrifft:

1. **Echte Übergabe** — der Kollege muss etwas *tun*, das er weder aus seiner eigenen
   `next-for-X`-Schleife noch aus der DB entdecken kann. Beispiele: Writer → Critico, um die
   CV-Review-Schleife zu starten; Capitano → Worker für Spawn / Throttle / Kill; Analyst → Scout
   `FEEDBACK`, das die *nächste* Query formen muss.
2. **Sicherheits-Event** — `LOCKED` / `403`, Halt, Kill, Crash, eine unmittelbar bevorstehende
   Rate-Verletzung, für die DB-Polling zu langsam ist. Nur Sentinel → Capitano.
3. **Richtung Nutzer** — eine Anfrage vom Menschen oder eine Antwort an den Menschen (eigener Kanal;
   siehe die Rollen-Handbücher).

### ✂️ Was GESTRICHEN ist (nicht senden)

- **Leere ACKs** — „erhalten, Kontext aktualisiert", „ok, warte ab". Wenn die Nachricht keine Aktion
  erforderte und der Sender die Bestätigung nicht *braucht*, um weiterzumachen, **sag nichts**. (Siehe
  `ACK` unten für den seltenen Fall.)
- **Status-Broadcasts** — „@all Check 10:14, Queues leer, alle im Standby". Das ist alles beobachtbar:
  die Queues stehen in der DB, die Aktivität in den Panes. Erzähl es nicht allen. (Für
  menschenlesbare Observability schreibe ins strukturierte Event-Log, nicht in die Panes der Kollegen.)
- **„Lebst du? / wo stehst du?"** — nutze capture-pane (Tier 2). Verbrenne nie die Runde eines Kollegen,
  um nach einem Status zu fragen, den er erst anhalten und schreiben müsste.
- **Rückbestätigungen / wiederholte Befehle** — wenn du einen Befehl schon gesendet hast, sende ihn
  nicht bei jedem Tick erneut. Bridge / Mailbox liefert genau einmal.

## 🔇 Produzieren ist still — den Zustand holt sich der Capitano

Ein Worker berührt den Capitano **null Mal**, um Fortschritt zu melden. Weder pro Item noch an den
Rändern: die Bookends `[START]` / `[DONE]` wurden am **2026-07-27 entfernt**. Gemessen an einem Team
beim Erststart, ~1,5h Verlauf: **37 Nachrichten erreichten den Capitano, 30 davon (81 %) reiner
Status** — 12 `DONE`, 8 `START`, 8 `INFO`, 2 `ACK` — gegenüber 3-6, die wirklich eine Entscheidung
verlangten. Jede kostet ihn eine volle Runde, und mit dem automatischen Modell-Split läuft er auf
**Opus**, während Scout / Analyst / Scorer auf **Sonnet** laufen: ein „fertig" des Scorers weckt den
teuersten Agenten der Flotte, damit er nichts tut.

Die Pull-Seite gab es bereits, und sie ist deutlich besser:

```bash
python3 /app/shared/skills/db_query.py recent-activity --minutes 60
```

Ein Aufruf liefert die Zahlen pro Agent plus jede Transition mit Timestamp, Akteur, Position und Grund
— `#22 checked→scored`, `#27 new→excluded — [DEAD_LINK]`. **Ein `DONE` trägt weniger Information als
die Zeile, die es erzeugt hat.** (Dasselbe Protokoll hatte die Item-Flut schon erledigt: ein Analyst
weckte den Capitano **25 Mal in einer Nacht**, einen Ping pro Position. Jetzt sind auch die beiden
„höflichen" Bookends weg.)

### ⚠️ Was PUSH bleibt — die Asymmetrie ist der Punkt

`recent-activity` zeigt, **wer produziert** — ein Agent, der stehen geblieben ist, **verschwindet aus
der Liste**, statt aufzufallen: von der Seite des Capitano sehen dein Schweigen und deine Arbeit gleich
aus. Diese drei müssen daher weiterhin **sofort** gesendet werden, weil sie **keine Spur in der DB**
hinterlassen:

| Signal | Wann |
|---|---|
| **BLOCKED** | du produzierst nicht mehr: Tool nach der `resilience`-Leiter kaputt, `403` / `LOCKED`, Quellen wirklich trocken (`[SCOUT-ESAUSTO]`), ein Queue-Element, das du weder bearbeiten noch überspringen kannst |
| **Konflikt** | zwei Kollegen auf demselben Datensatz / Territorium, und ihr klärt es untereinander nicht |
| **Entscheidungsanfrage** | ein `REQ`, das nur der Capitano beantworten kann (Taxonomie-Schiedsspruch, Skalierung, eine Entscheidung Richtung Nutzer) |

Alles andere — Start, Fortschritt, Abschluss — ist Pull. Sie bleiben erlaubt wie bisher, weil sie
*Entscheidungen* sind und keine Erzählung: ein `FEEDBACK` an einen Scout, ein `URG`-Sicherheits-Event.
**Wenn du aufhörst und nichts sagst, merkt es niemand.**

## 🗄️ Tier 1 — DB-gesteuerte Koordination (der Standard)

Pipeline-Übergaben laufen durch die DB — **kein tmux nötig**:

| Übergabe | Mechanismus |
|---|---|
| 🕵️ Scout → 👨‍🔬 Analyst | Der Analyst pollt `next-for-analista`; sieht frische Zeilen mit `status = new` |
| 👨‍🔬 Analyst → 👨‍💻 Scorer | Der Scorer pollt `next-for-scorer`; nimmt Zeilen mit `status = checked` |
| 👨‍💻 Scorer → 👨‍🏫 Writer | Der Writer pollt `next-for-scrittore` (`score DESC`); nimmt Zeilen mit `status = scored` ≥ 50 |
| 👨‍🏫 Writer → 👤 Benutzer | Die Position erreicht `status = ready` + `applications.critic_verdict = PASS`; sie erscheint im Dashboard |

**Einen Datensatz beanspruchen ohne Nachricht** — Kollegen vermeiden dieselbe Zeile über die Locks in
[`anti-collision.md`](anti-collision.md): Pre-INSERT-Dedup + circles/sources-Partition beim Scout;
`last_checked`-Watermark bei Analyst/Scorer; Flip auf `status = writing` beim Writer. **Der erste
Schreibvorgang gewinnt.** Du kündigst nicht an „ich nehme ID 42" — der Claim *ist* das Lock; der
Kollege liest ihn aus der DB.

## 👀 Tier 2 — capture-pane (beobachten, nicht fragen)

Um zu verstehen, was ein Kollege tut, **ohne ihn zu stören**:

```bash
tmux capture-pane -t <PEER_SESSION> -p -S -40
```

Achte auf: den Spinner / `esc to interrupt` (lebendig, mitten in der Runde), einen nackten
Shell-Prompt (idle / möglicherweise festgefahren), einen blockierten Fetch. Das ersetzt „lebst du? /
wie ist dein Status?"-Nachrichten vollständig.

⚠️ **Es ist ein Snapshot, kein Zustand.** Du kannst eine Runde mitten im Rendern erwischen. Nutze es für
*Liveness / Aktivität*, **niemals** als Wahrheitsquelle für geteilten Zustand — das ist immer die DB
(Tier 1). Das Urteil über einen *möglicherweise toten* Kollegen gehört dem Dottore (`liveness-check`),
nicht einem Reflex-Blick.

## 📨 Tier 3 — Nachrichtenumschlag und Typen

Getaggter einzeiliger Umschlag:

```
[@from -> @to] [TYPE] payload
```

Reduzierter Typensatz (nimm den engsten, der passt):

| Typ | Wann |
|---|---|
| `URG` | Sicherheit / jetzt handeln: Capitano → Worker (throttle / freeze / kill); Sentinel → Capitano (Verletzung, Crash, LOCKED) |
| `FEEDBACK` | Analyst → Scout, Ablehnungsmuster (`[SENIORITY] · [STACK] · [GEO] · [LINGUA]`), die die nächste Query formen müssen |
| `REQ` / `RES` | Eine echte synchrone Anfrage, die eine Antwort erwartet (selten) — eine echte Übergabe, keine Statusfrage |
| `BLOCKED` | Worker → Capitano: du hast **aufgehört zu produzieren** und es hinterlässt keine Spur in der DB (kaputtes Tool, `403`/`LOCKED`, trockene Quellen, ein Element, das du weder bearbeiten noch überspringen kannst). Seit 2026-07-27 ist es das einzige Signal, das einen Stillstand von stiller Arbeit trennt — `recent-activity` kann es nicht zeigen, weil ein gestoppter Agent aus dieser Liste verschwindet |

`ACK` — **nur**, wenn der Sender wirklich wissen muss, dass die Aktion gewirkt hat, um sicher
weiterzumachen (z. B. der Capitano muss bestätigen, dass ein `FREEZE` angewendet wurde, bevor er
skaliert). Es ist **keine** Routine-Antwort. Wenn ein Befehl keine Bestätigung braucht, um sicher zu
sein, wendet der Empfänger ihn still an. `INFO` / `REPORT` sind für Peer-Verkehr deprecated: schicke
Erzählung ins Event-Log, nicht in die Panes.

## 🛠️ Senden: `jht-tmux-send`

```bash
jht-tmux-send <PEER_SESSION> "[@me -> @peer] [URG] FREEZE"
```

⚠️ **Niemals rohes `tmux send-keys` für Inter-Agenten-Nachrichten.** Die Codex/Kimi-TUIs verlieren das
Enter-Zeichen, wenn es zusammen mit dem Textkörper ankommt, was stille Deadlocks verursacht. Der Wrapper
behandelt Text + Enter atomar. Er ist **busy-aware**: er wartet, bis die Runde des Kollegen fertig ist,
und liefert dann (`exit 0`); `exit 4` = Kollege lebt, ist aber über das Budget hinaus beschäftigt →
**später erneut versuchen, nicht spawnen / nicht neu nachdenken**; `exit 3` = möglicherweise tot →
Urteil des Dottore, kein Reflex. Skill: `agents/_skills/tmux-send/jht-tmux-send`.

**Bei einem fehlgeschlagenen / belegten Send:** stelle ihn in die Queue (die `bridge_mailbox`, die der
Capitano leert), öffne **keine** neue Denkrunde, um über das Scheitern „nachzudenken". Der Retry ist
mechanisch, nicht kognitiv.

## ⏰ Pflicht-Signale pro Rolle (alles andere ist Pull)

### 🕵️ Scout
- **Melde dich nie** beim Capitano — kein `[START]`, kein `[DONE]`, nichts pro Ergebnis. Die INSERTs
  sind der Bericht; er liest sie aus `recent-activity`. Push nur, wenn du **BLOCKED bist und nicht mehr
  produzierst** (inkl. `[SCOUT-ESAUSTO]`) oder im Konflikt mit einem anderen Scout stehst.
- Empfängt `FEEDBACK` von Analysten → passe die nächste Query an. **Kein ACK**, außer der Analyst hat
  ein `REQ` gestellt.

### 👨‍🔬 Analyst
- **Melde dich nie** beim Capitano — kein `[START]`, kein `[DONE]`, nichts pro Position. Der Flip auf
  `checked` ist der Bericht. Push nur, wenn du **BLOCKED bist und nicht mehr produzierst**, oder für
  ein `REQ` zur Taxonomie-Schlichtung.
- Sende `FEEDBACK` an einen Scout nur bei einem echten Muster: 3 aufeinanderfolgende Ausschlüsse mit
  demselben Tag aus derselben Quelle ODER > 60 % Ausschlussrate in einem Batch eines Scouts. Sonst
  Schweigen (die Übergabe trägt die DB).

### 👨‍💻 Scorer
- **Melde dich nie** beim Capitano — kein `[START]`, kein `[DONE]`, nichts pro Score. Jeder Score ist
  eine DB-Zeile, die er sich aus `recent-activity` holt. Push nur, wenn du **BLOCKED bist und nicht
  mehr produzierst**. Die Pipeline-Übergabe läuft über die DB; Insights erscheinen im Dashboard /
  Event-Log.

### 👨‍🏫 Writer
- **Melde dich nie** beim Capitano — kein `[START]`, wenn du einen CV-Job übernimmst, kein `[DONE]`,
  wenn er auf `ready` landet: die Transition `writing → ready` steht in der DB. Push nur, wenn du
  **BLOCKED bist und nicht mehr produzierst** (Critico-Schleife hängt, Profildaten fehlen).
- Bei `URG FREEZE` vom Capitano: beende die laufende Critic-Runde (niemals eine Review mittendrin
  abbrechen), dann drossle. Nur hier gehört das `ACK` hin — der seltene Fall des
  Bestätigen-um-fortzufahren.

### 💂 Sentinel
- Edge-triggered, **nur innerhalb der Arbeitszeit**. Spricht **nur** bei einer echten Zustandsänderung
  (Spitze, Verletzung, Crash, `LOCKED`). Eine Nachricht pro Edge — niemals erneut senden. Broadcastet
  nie an Worker (der Capitano ist das Gateway). Stationärer Zustand → Schweigen.

### 👨‍✈️ Capitano
- `URG` an Worker (throttle / freeze / kill / spawn) auf Sentinel-Signal oder bei beobachtetem
  Pipeline-Bedarf.
- Liest den Pipeline-Zustand aus der **DB**, die Agenten-Aktivität aus **capture-pane** — erzählt nie
  Status an Kollegen, sendet nie stehende Befehle erneut.

## 📥 Peer-Nachrichten lesen

Du scannst tmux nicht vor jeder Aktion — der Großteil der Koordination liegt in der DB.
- **Zwischen Arbeitseinheiten** (nach einer Position, bevor du die nächste beanspruchst): ein schnelles
  `tmux capture-pane -p -S -20` auf **deiner eigenen** Session, um ein eingehendes `URG` / `FEEDBACK` zu
  bemerken.
- Priorisiere `URG` / `FEEDBACK`; handle, bevor du neue Arbeit aufnimmst.
- Eine Nachricht, die mitten in einer Aufgabe ankommt, ist bereits in deinem Kontext (der Wrapper hat
  sie in dein Pane geschrieben) — bemerke sie einfach vor der nächsten Iteration.

## ⏸️ Throttle: protokollierte Pausen

Um deine Schleife zu verlangsamen (Cooldown, Post-`URG`, Warten auf Upstream), nutze die
`throttle`-Skill, **niemals ein nacktes `sleep`**:

```bash
jht-throttle <seconds> --agent <your-name> [--reason "..."]
```

Jeder Aufruf protokolliert nach `$JHT_HOME/logs/throttle-events.jsonl`, damit Capitano und Dashboard
sehen, wer pausiert und wie lange. Nacktes `sleep` nur für Retry-Lücken ≤ 5 s. Capitano: nenne die Skill
ausdrücklich im Befehl (`[URG] jht-throttle 180 --agent scout-1 --reason "rate budget"`), nie „sleep 3
Minuten".

Siehe: [`../_skills/throttle/SKILL.md`](../_skills/throttle/SKILL.md).

## 🔗 Verwandt

- 🛡️ [`anti-collision.md`](anti-collision.md) — Claim-before-work-Locks (wie man sich über die DB koordiniert)
- 🧭 [`../_team/architettura.md`](../_team/architettura.md) — Pipeline-Überblick (wer liefert an wen)
