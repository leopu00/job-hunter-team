<!-- @translation: de, ai-translated 2026-06-06 -->
---
name: scout-coord
description: Koordinationsprotokoll beim Start zwischen mehreren Scouts. Ohne diese Fähigkeit durchsuchen zwei Scouts denselben Kreis (Remote EU) auf derselben Ebene (LinkedIn) und erzeugen 100 % Duplikate, die das Dedup-Gate dann verwerfen muss — verschwendetes Budget und langsameres Team. Verwende sie als ERSTE Aktion in deiner Schleife, vor allem anderen. Gehört zur Scout-Rolle; SCOUT-1 ist normalerweise der Schiedsrichter, wenn mehrere Scouts gleichzeitig starten.
allowed-tools: Bash(python3 /app/shared/skills/scout_coord.py *), Bash(tmux *), Bash(jht-tmux-send *)
---

# scout-coord — Territorium aufteilen

Mehrere Scouts laufen parallel (maximal 2 Instanzen laut Team-Richtlinie). Das Team funktioniert nur, wenn sie sich auf eine **überlappungsfreie Aufteilung** einigen:
- welche **Kreise** jeder besitzt (1 = primäre Präferenz, 2 = Geo-Nachbarn, 3 = Umzug, 4 = Satellit, 5 = Grenzgebiet)
- welche **Quellenebenen** jeder besitzt (LinkedIn / ATS-Aggregatoren / Nische / WebSearch)

Der Zustand liegt in der **gemeinsamen SQLite-Datenbank**, die von `scout_coord.py` verwaltet wird; die Scouts verhandeln beim Start über tmux und speichern die Vereinbarung dort.

**Eine Datenbank, oder gar keine Koordination.** Alle Scouts müssen auf derselben Datenbank arbeiten — der `jobs.db` des Teams, demselben `JHT_DB` wie jede andere Skill (der Launcher exportiert es bereits in dein Pane). Es gibt keine separate Koordinationsdatei mehr, die aufgelöst werden müsste; eine alte `scout_coordination.db`, falls vorhanden, wird einmal beim Bootstrap importiert und bleibt liegen, von da an schreibgeschützt. Beendet es sich mit **3**, ist die Datenbank unbrauchbar: melde die ausgegebene Meldung und HALTE AN. Lege nie eine eigene Datenbank an und richte das Werkzeug nie auf einen anderen Pfad.

```bash
# Auf welcher Datenbank arbeite ich wirklich?
python3 /app/shared/skills/scout_coord.py doctor
```

## Schritt 1 — Peers entdecken

```bash
tmux list-sessions 2>/dev/null | awk -F: '{print $1}' | grep -E '^SCOUT-[0-9]+$'
```

Wenn du der einzige gelistete Scout bist → keine Verhandlung nötig, beanspruche alles, was du bewältigen kannst. Springe zu Schritt 4.

Wenn andere gelistet sind → du musst verhandeln (Schritte 2-3), bevor du irgendetwas scrapst.

## Schritt 2 — Veralteten Zustand zurücksetzen

Wenn das vorherige Scout-Team mitten in der Schleife abgestürzt ist, kann `scout_coord.py` veraltete Zuweisungen enthalten, die auf tote Sitzungen verweisen. Lösche sie:

```bash
python3 /app/shared/skills/scout_coord.py reset
```

Dies ist ein koordinierter Schritt: der **niedrigst nummerierte aktive SCOUT** (normalerweise `SCOUT-1`) führt den Reset durch, die anderen warten. Kündige es auf tmux an:

```bash
jht-tmux-send SCOUT-2 "[@$MY_ID -> @scout-2] [INFO] resetto scout_coord, attendi 5s prima di assign"
```

## Schritt 3 — Über tmux verhandeln

Eröffne ein kurzes Gespräch (maximal 3-5 Nachrichten) mit jedem Peer. Schlage eine Aufteilung vor:

```
[@scout-1 -> @scout-2] [REQ] proposta: io prendo cerchi 1+2 + tier 1-2 (LinkedIn, ATS).
Tu cerchi 3+4 + tier 3-4 (niche board + WebSearch). OK?
```

Der Peer antwortet mit `[ACK]` (akzeptiert) oder `[COUNTER]` (Gegenvorschlag). Halte es kurz — wenn ihr euch nicht in 3 Durchgängen einigen könnt, eskaliere zum Capitano.

**Heuristiken für eine gute Aufteilung**:

| Situation                                       | Empfohlene Aufteilung                                              |
|-------------------------------------------------|--------------------------------------------------------------------|
| 2 Scouts, Profil `work_mode = remote`          | S1: cerchi 1-2 + LinkedIn/ATS · S2: cerchi 1 + Nische-Remote-Board (RemoteOK, WeWorkRemotely) — beide in cerchio 1, komplementäre Quellen |
| 2 Scouts, Profil `work_mode = on-site`         | S1: Basisstadt + cerchio 2 regional · S2: Umzug (cerchio 3) |
| 2 Scouts, gemischt `work_mode = flessibile`    | S1: cerchi 1-2 (Vollmodus) · S2: cerchi 3-5 (Umzug + Satellit + Grenzgebiet) |

Unabhängig von der gewählten Aufteilung gilt die Regel: **keine zwei Scouts auf derselben (Kreis, Ebenen-Set) Kombination zur gleichen Zeit.**

**Volumen vs. kuratierte Aufteilung — empirisch aus dem VPS1-Lauf 2026-05-21 (vps1-run-postmortem #14):**

> Scout-1 fand 130 Positionen mit einem Durchschnittsscore von 63,1 (40 % High-Score)
> Scout-2 fand 76 Positionen mit einem Durchschnittsscore von 68,4 (54 % High-Score)
>
> → Scout-2 war 1,4× qualitativer als Scout-1 beim selben Kandidaten.

Empfohlenes Muster, wenn man die Freiheit hat, die Ebene für die 2 Scouts zu wählen:

| Scout    | Zugewiesene Ebene                                       | Begründung                                     |
|----------|---------------------------------------------------------|------------------------------------------------|
| SCOUT-1  | LinkedIn (hohes Volumen, verrauscht)                    | Erfasst den Fluss, akzeptiert niedrigeren Score|
| SCOUT-2  | Ashby / Greenhouse / Lever / company-careers (kuratiert)| Wenige, aber passende, höherer Durchschnittsscore |

Das `next-for-analista` erhält dann einen ausgewogenen Mix aus Volumen + Qualität, und der Hard-Requirements-Filter des Analysten (RULE-06) konzentriert sich auf den Scout-1-Stream (wo mehr Rauschen ist). Dies ist keine starre Regel — an den `work_mode` anpassen wie in der Tabelle oben.

## Schritt 4 — Zuweisung festschreiben

Sobald du und deine Peers einig seid, speichere die Aufteilung:

```bash
python3 /app/shared/skills/scout_coord.py assign $MY_ID \
    --cerchi "<dir zugewiesene Kreise, z.B. 1,2>" \
    --fonti "<Slugs der zugewiesenen Quellen, kommagetrennt, z.B. linkedin,greenhouse,lever>"
```

Jeder Scout schreibt seine eigene Zeile. Das Skript erzwingt Überlappungsfreiheit bei den Quellen-Slugs, sodass der zweite fehlschlägt, wenn zwei Scouts gleichzeitig `linkedin` beanspruchen — der Verlierer muss neu verhandeln.

## Schritt 5 — Verifizieren

```bash
python3 /app/shared/skills/scout_coord.py show
```

Erwartete Ausgabe: eine Zeile pro aktivem Scout mit seinen `cerchi` und `fonti`. Wenn deine Zeile fehlt, ist dein `assign` stillschweigend fehlgeschlagen — wiederhole Schritt 4.

Gegenprüfung: die Vereinigung aller `fonti` sollte die Ebenen abdecken, die das Team heute tatsächlich scrapen will. Wenn eine Ebene null Scouts hat (z.B. niemand auf `niche-remote`), benachrichtige den Capitano:

```bash
jht-tmux-send CAPITANO "[@$MY_ID -> @capitano] [INFO] scout-coord: tier 'niche-remote' senza scout, considera spawn aggiuntivo o riassegnamento."
```

## Anti-Patterns

- ❌ Schritt 1 überspringen ("es gibt nur mich") ohne zu prüfen — ein Peer könnte gerade vom Dottore neu gestartet worden sein.
- ❌ Reset von jedem Scout parallel durchgeführt — Race Condition, die Datenbank wird korrumpiert. Nur der niedrigst nummerierte Scout.
- ❌ Verhandeln und dann Schritt 4 vergessen — die Datenbank ist leer, Peers können deinen Anspruch nicht sehen, zwei Scouts treffen auf dieselbe Quelle.
- ❌ Sowohl `linkedin` ALS AUCH `greenhouse` ALS AUCH `lever` ALS AUCH `remoteok` ALS AUCH `weworkremotely` ALS AUCH `webresearch` beanspruchen "um sicher zu gehen" — nichts zum Teilen mit dem Peer, dieser hat nichts zu tun.
- ❌ Mitte der Schleife ohne Auslöser neu verhandeln — die Aufteilung erfolgt beim Start. Wenn ein Peer stirbt, startet der Dottore ihn mit derselben Rolle neu; nur der SCOUT selbst liest seine `cerchi`/`fonti` beim Start erneut.

## Wann neu verhandeln

Nur bei diesen Auslösern:
- Ein neuer SCOUT ist gerade gestartet (du siehst `SCOUT-N+1` in `tmux list-sessions`, der bei deinem Start nicht da war)
- Ein SCOUT ist gestorben und wurde NICHT neu gestartet (Kapazität gesunken, seine Ebene umverteilen)
- Capitano ordnet ausdrücklich eine Neuaufteilung an (selten, z.B. nach einem `[FEEDBACK]` vom Analysten, dass eine Ebene durchgängig tote Links produziert)

In allen drei Fällen: kurzer tmux-Austausch, dann erneut `assign` mit neuen Parametern. Kein `reset` nötig, es sei denn, das JSON ist sichtbar korrumpiert.

## Siehe auch

- `circles-and-sources` — die eigentliche Definition der 5 cerchi + 4 Ebenen der fonti (diese Fähigkeit beschreibt WIE aufgeteilt wird; jene beschreibt WAS aufgeteilt wird).
- `position-insert` — was jeder Scout tut, sobald er seine Zuweisung hat.
- `agents/_manual/anti-collision.md` — der breitere Anti-Kollisions-Vertrag, den diese Fähigkeit für die Scout-Rolle implementiert.
- `tmux-send` — Nachrichtenformat für die Verhandlung.
