<!-- @translation: de, ai-translated 2026-06-06 -->
# 🧭 Job Hunter — Team-Architektur

---

## 🧠 Wie die Agenten in Stufen eingeteilt sind

JHT ordnet jede Rolle einer von **vier Stufen** zu, aufgelistet von der hoechsten zur niedrigsten. Die Stufe gibt das Modell + den Reasoning-Aufwand an, den der Launcher an die CLI des aktiven Providers uebergibt.

| Stufe | Agenten | Claude | Codex | Kimi | Was sie bewirkt |
|---|---|---|---|---|---|
| 🥇 **very smart** | 👨‍✈️ Captain | `opus-4-7` · effort `high` | `gpt-5.5` · reasoning `high` | `k2.6` · `standard` | Kritische, irreversible Entscheidungen — volle Reasoning-Tiefe |
| 🥈 **expert** | 👨‍🏫 Writer · 👨‍⚖️ Critic · 🧙‍♂️ Mentor | `opus-4-7` · effort `medium` | `gpt-5.5` · reasoning `high` | `k2.6` · `standard` | Pattern-Matching gegen bekannte Vorlagen (CV, Blind Review, Gap-Analyse) |
| 🥉 **smart** | 🕵️ Scout · 👨‍🔬 Analyst · 👨‍💻 Scorer · 👩‍💼 Assistant | `sonnet-4-6` · effort `high` | `gpt-5.5` · reasoning `medium` | `k2.6` · `standard` | Recherche, Scraping, Scoring, User-Chat |
| 🎖️ **medium** | 💂 Sentinel | `sonnet-4-6` · effort `medium` | `gpt-5.5` · reasoning `medium` | `k2.6` · `standard` | Leichter Watchdog — If-then-Regeln, kein tiefes Denken |

**Verfuegbare Effort-Stufen (zur Referenz):**

- **Claude** — `low · medium · high · xhigh · max` (Opus 4.7, Apr 2026). `xhigh`/`max` derzeit ungenutzt — Kosten-Nutzen-Abwaegung.
- **Codex** — `minimal · low · medium · high · xhigh` (GPT-5.5). Default `medium`.
- **Kimi** — die CLI bietet noch keine Effort-Stufen, daher laufen alle Stufen auf einen einzelnen Aufruf zusammen.

---

## 🗺️ Pipeline auf einen Blick

```
   👤 User
     │
     ▼
   👨‍✈️ Captain ──► Phase 1 ──► Phase 2 ──► Phase 3 ──► Phase 4 ──────► Phase 5 ──► 👤 User
                  🕵️ Discover  👨‍🔬 Verify  👨‍💻 Score   👨‍🏫 👨‍⚖️ Write+Review   📲 Notify
```

Jede Phase unten entspricht einer spezialisierten Agentenrolle. Der Captain entscheidet **wie viele Instanzen** pro Rolle zu einem bestimmten Zeitpunkt gestartet werden — die Agentenanzahl ist dynamisch, nicht fest in der Architektur verankert.

---

## 1️⃣ Phase 1 — Discovery 🔍 🕵️

```
        👤 candidate_profile.yml ──┐
                                    │ circles, filters, work_mode
                                    ▼
        ┌──────────────────────────────────────┐
        │ 🕵️ Scout pool                       │
        │ N instances · Captain-managed         │
        │ peer-coordinated (no overlap on       │
        │ circles / sources / URLs)             │
        └────────────────────┬─────────────────┘
                             │ INSERT positions  (status = new)
                             ▼
                       ┌──────────────┐
                       │ 📦 jobs.db   │ ──► Phase 2
                       └──────────────┘
                             ▲
                             │ [FEEDBACK]
                             │ (rejection patterns:
                             │  SENIORITY · STACK · GEO · LINGUA)
                             └── from 👨‍🔬 Analyst / 👨‍💻 Scorer
```

**Was Scouts tun.** Sie extrahieren Stellenangebote von Job Boards und ATSs, deduplizieren gegen `jobs.db` und schreiben neue Positionen mit `status = new`. Sie stoppen, wenn der Captain es anordnet.

### 🤝 Multi-Scout-Koordination

Mehrere Scouts laufen parallel, ohne jemals dasselbe Stellenangebot doppelt abzurufen:

- 🗺️ **Partitionierung beim Boot** — Peers entdecken einander ueber `tmux list-sessions`, dann verhandeln sie ihr Territorium ueber `scout_coord.py` (welche **Circles** und **Sources** jeder besitzt).
- 🎯 **Circles** — konzentrische Bereiche, von innen nach aussen abgearbeitet: ① primaere Praeferenz → ② geografische Nachbarn → ③ gezielte Verlagerung → ④ Satellit → ⑤ Grenzbereich (angrenzende Rollen).
- 📚 **Source Tiers** — in Reihenfolge abgearbeitet: LinkedIn → ATS-Aggregatoren (Greenhouse/Lever/Indeed/Wellfound) → Nischen-Boards (PyJobs, RemoteOK, regionale) → WebSearch + Karriereseiten.
- ⚖️ **Anti-Bias** — wenn mehr als 30 % der Positionen eines Batches vom selben Arbeitgeber stammen, wechselt der Scout Source/Query fuer den naechsten Batch. Ohne dies wuerde ein Scaleup, das 12 Rollen auf einem einzigen Board veroeffentlicht, den Pool ueberfluten und die Vielfalt verdraengen.
- 🛡️ **Anti-Collision** — Deduplizierungspruefung auf `positions.url` vor jedem `INSERT` ([`anti-collision.md`](../_manual/anti-collision.md)).

### 🔁 Feedback-Empfang

Scouts nehmen `[FEEDBACK]`-Nachrichten von Analysts (und indirekt von Scorern ueber den Captain) mit den Tags `[SENIORITY] · [STACK] · [GEO] · [LINGUA]` auf und passen Queries/Sources fuer den naechsten Batch an. Systemische Verzerrungen werden an den Captain eskaliert.

### 🛠️ Skills

Verfuegbar unter `/app/shared/skills/`:

- **`scout_coord.py`** — Territoriumspartitionierung beim Boot (welcher Scout welche Circle/Source besitzt); wird verwendet, um Eigentumsrechte zu verhandeln und die Zuweisung zu verifizieren.
- **`db_query.py check-url`** — Deduplizierungs-Gate. Wird vor jedem Insert ausgefuehrt; gibt `TROVATA` (ueberspringen) oder `NON TROVATA` (fortfahren) zurueck.
- **`db_insert.py position`** — schreibt ein verifiziertes Stellenangebot in `positions`. Pflichtfelder: title, company, URL, location, JD-Text, Anforderungen.
- **`db_update.py position`** — wird verwendet, um bereits eingefuegte Datensaetze als `excluded` zu markieren, wenn ein Duplikat durchrutscht. Niemals DELETE.
- **`linkedin_check.py`** — authentifizierte LinkedIn-Anreicherung (Job-IDs → vollstaendige Angebots-Metadaten) ohne den Robots-Block von `fetch` MCP auszuloesen.

### 🌐 MCP tools

- **`jobspy`** — Multi-Source-Scraper fuer Job Boards (LinkedIn, Indeed, ZipRecruiter, Glassdoor) als MCP verpackt. Schnelle Massenerkennung, normalisierte Ausgabe.
- **`linkedin`** — dediziertes LinkedIn-MCP fuer Suche + Angebotsabruf.
- **`fetch`** — generischer HTTP-Fetch fuer ATS-Aggregator-Seiten (Greenhouse, Lever, Wellfound). ⚠️ Durch LinkedIn robots.txt blockiert — Scouts greifen dort auf `curl` mit Browser-User-Agent zurueck.
- **`playwright`** — Headless-Browser fuer JS-lastige Karriereseiten, bei denen einfaches `fetch` das DOM nicht rendert.
- **`WebSearch`** *(built-in)* — Fallback der Stufe 4, wenn ATS-/Nischen-Boards erschoepft sind.

---

## 2️⃣ Phase 2 — Verification ✅ 👨‍🔬

```
                       📦 jobs.db
                       (status = new)
                              │
                              ▼
        ┌──────────────────────────────────────┐
        │ 👨‍🔬 Analyst pool                      │
        │ N instances · Captain-managed         │
        │ peer-coordinated (last_checked        │
        │ timestamp prevents double-work)       │
        └────────────────────┬─────────────────┘
                             │ UPDATE positions
                             │   status = checked   → Phase 3
                             │   status = excluded  → 🗄️ archive
                             ▼
                       ┌──────────────┐
                       │ 📦 jobs.db   │
                       └──────────────┘
                             │
                             │ [FEEDBACK]
                             │ (rejection patterns:
                             │  SENIORITY · STACK · GEO · LINGUA …)
                             ▼
                        🕵️ Scout pool
```

**Was Analysts tun.** Sie holen Positionen mit `status = new`, rufen die aktuelle JD ab, validieren den Link, parsen 5 strukturierte Felder (`ESPERIENZA_RICHIESTA · ESPERIENZA_TIPO · LAUREA · LINGUA_RICHIESTA · SENIORITY_JD`) und stufen sie entweder auf `checked` hoch oder markieren sie als `excluded`. Die tatsaechlichen Jahre werden aus datierten Eintraegen im Profil berechnet, nicht aus dem gerundeten Feld `experience_years`. Der Kandidat wird als **anpassungsfaehig** behandelt — angrenzende Stacks werden nicht ausgeschlossen, der Scorer wendet nachgelagert eine proportionale Gap-Strafe an.

### 🚫 Ausschluss-Tags

Ausschlussnotizen beginnen mit `ESCLUSA: [TAG]` — `[LINK_MORTO]` · `[SCAM]` · `[GEO]` · `[LINGUA]` · `[SENIORITY]` (`req > real+3` oder Senior/Lead-JD) · `[STACK]` (ausserhalb des Fachgebiets). Bei Unsicherheit → `checked`: Falsch-Negative kosten mehr als Falsch-Positive.

### 🤝 Multi-Analyst-Koordination

- 🕒 **`last_checked`-Watermark** — Analysts ueberspringen Datensaetze, die kuerzlich von einem Peer aktualisiert wurden.
- 🛡️ **Anti-Collision-Vertrag** — [`agents/_manual/anti-collision.md`](../_manual/anti-collision.md).

### 🔁 Feedback an Scouts

Wenn 3 aufeinanderfolgende Ausschluesse dieselbe Source mit demselben Tag treffen, oder der Batch eines Scouts eine Ablehnungsrate von 60 % ueberschreitet, sendet der Analyst ein `[FEEDBACK]` an diesen Scout — spezifisch (Source + Tag + IDs), umsetzbar (vorgeschlagene Alternative), idempotent (eines pro Muster).

### 🛠️ Skills

- **`db_query.py next-for-analista`** — holt die naechste Position `status=new` unter Beachtung des `last_checked`-Watermarks.
- **`db_query.py position <ID>`** — ruft vollstaendige JD + Metadaten fuer die Analyse ab.
- **`db_update.py position <ID>`** — schreibt den neuen Status (`checked` oder `excluded`) + strukturierte Notizen.
- **`linkedin_check.py`** — authentifizierte LinkedIn-Pruefung (aktiv / abgelaufen / Unternehmensinfo).

### 🌐 MCP tools

- **`fetch`** — GET der aktuellen JD mit `-L` + Browser-UA; erkennt "expired / closed-job"-Marker.
- **`playwright`** — Fallback fuer JS-lastige ATS-Seiten, die `fetch` nicht rendern kann (Workable/Lever/Ashby).
- **`linkedin`** — umgangen: LinkedIn-Pruefungen laufen ueber `linkedin_check.py` (authentifiziert).

---

## 3️⃣ Phase 3 — Scoring 🎯 👨‍💻

```
                       📦 jobs.db
                       (status = checked)
                              │
                              ▼
        ┌──────────────────────────────────────┐
        │ 👨‍💻 Scorer pool                       │
        │ N instances · Captain-managed         │
        │ peer-coordinated (last_checked < 5min │
        │ = peer claimed → skip)                │
        └────────────────────┬─────────────────┘
                             │ INSERT scores · UPDATE positions
                             │   score ≥ 50  → status = scored   → Phase 4
                             │   score 40-49 → status = scored   (parking)
                             │   score < 40  → status = excluded → 🗄️ archive
                             ▼
                       ┌──────────────┐
                       │ 📦 jobs.db   │
                       └──────────────┘
                             │
                             │ score distribution
                             │ (high-score zones → Scout queries)
                             ▼
                        🕵️ Scout pool  (via 👨‍✈️ Captain)
```

**Was Scorer tun.** Sie fuehren einen **Pre-Check** durch (Erfahrungsjahre, Standort, Pflichtabschluss ohne "oder gleichwertig"), um nicht bewertbare Positionen herauszufiltern, und vergeben dann einen Score von 0-100 gegen das Kandidatenprofil. `< 40` → `excluded`. `40-49` → `scored` (Parking, Captain entscheidet spaeter). `≥ 50` → `scored` + Benachrichtigung an Writer.

### 🧮 Scoring-Formel (0-100)

| Komponente | Gewicht | DB-Spalte | Was sie misst |
|---|---|---|---|
| Stack match | 35 | `stack_match` | Geforderte Skills vs. Stack des Kandidaten |
| Seniority fit | 25 | `experience_fit` | Geforderte Jahre vs. tatsaechliche Jahre des Kandidaten |
| Remote / location | 20 | `remote_fit` | Kompatibilitaet mit den Standort-Praeferenzen des Profils |
| Salary fit | 10 | `salary_fit` | Angebotene Spanne vs. Zielgehalt |
| Stack bonus | 10 | `strategic_fit` | Tech-Bonus (AI · Cybersec · Fintech, falls Staerken des Kandidaten) |

Zusaetzlich angewandte Strafen: `−10` Pflichtabschluss ohne "oder gleichwertig" · `−15` Pflichtsprache nicht gesprochen · `−5` vage JD ohne konkrete Anforderungen.

### 🤝 Multi-Scorer-Koordination

- 🕒 **`last_checked`-Claim** — der Scorer setzt den Zeitstempel vor der Bewertung; Peers ueberspringen Datensaetze, die in den letzten 5 Minuten beansprucht wurden.
- 🛡️ **DB-Schreibgrenze** — der Scorer schreibt `scores` (INSERT) und nur `positions.status`. Beruehrt niemals `applications`, `companies` oder `positions.notes` (Territorium des Analyst).
- 🛡️ **Anti-Collision-Vertrag** — [`agents/_manual/anti-collision.md`](../_manual/anti-collision.md).

### 🔁 Feedback an Scouts (ueber Captain)

Die Live-Score-Verteilung des Scorers (nach Source / Rolle / Geo / Stack) wird vom Captain gelesen und an die Scouts zurueckgegeben, damit die naechsten Batches sich auf die Hochscore-Zonen des Kandidaten konzentrieren.

### 🛠️ Skills

- **`db_query.py next-for-scorer`** — holt die naechste Position `status=checked` unter Beachtung von `last_checked`.
- **`db_query.py position <ID>`** — vollstaendiger Datensatz + strukturierte Notizen des Analyst (die Eingaben der Formel).
- **`db_insert.py score`** — schreibt die Aufschluesselung (5 Komponenten + Gesamtscore).
- **`db_update.py position <ID>`** — setzt `status = scored | excluded`.

### 🌐 MCP tools

- **`fetch`** — re-validiert den Link vor dem Scoring (Angebote sterben schnell — Phase 2 kann eine Weile her sein).

---

## 4️⃣ Phase 4 — Writing + Review ✍️ 👨‍🏫 👨‍⚖️

```
                       📦 jobs.db
                       (status = scored, score ≥ 50)
                              │  selection: ≥70 first, then 50-69 desc
                              ▼
        ┌──────────────────────────────────────┐
        │ 👨‍🏫 Writer pool                       │
        │ N instances · Captain-managed         │
        │ peer-coordinated (status=writing      │
        │ claim prevents double-work)           │
        └────────────────────┬─────────────────┘
                             │ for each position:
                             │   3× rounds with a fresh Critic
                             ▼
        ┌──────────────────────────────────────┐
        │ 👨‍⚖️ Critic (CRITICO-S<N>)            │
        │ spawned fresh per round, killed after │
        │ blind review — no profile access      │
        └────────────────────┬─────────────────┘
                             │ critic_score 1-10
                             │ after round 3:
                             │   score ≥ 5 → status = ready    → Phase 5
                             │   score < 5 → status = excluded → 🗄️ archive
                             ▼
                       ┌──────────────┐
                       │ 📦 jobs.db   │
                       └──────────────┘
```

**Was Writer tun.** Sie holen Positionen mit `status = scored` in absteigender Score-Reihenfolge (zuerst ≥70, dann 50-69), beanspruchen sie durch Setzen von `status = writing`, generieren einen massgeschneiderten CV (Cover Letter nur wenn die JD einen verlangt), und fuehren dann **3 Pflicht-Runden** mit dem Critic durch. Zwischen den Runden korrigiert der Writer den CV und regeneriert das PDF. Finales Gate: `critic_score ≥ 5` → `ready`, sonst `excluded`. **Zero invenzioni** — jede Aussage im CV muss auf `candidate_profile.yml` zurueckfuehrbar sein.

**Was der Critic tut.** Fuer jede Runde frisch erstellt (`CRITICO-S<N>`), erhaelt den PDF-Pfad + JD-URL, fuehrt ein **Blind Review** durch (kein Profilzugriff — nur die Seite vor ihm), gibt ein strukturiertes Urteil zurueck: Note X/10 + Struktur/Relevanz/Impact-Analyse + Anforderungen-vs-CV-Tabelle + priorisierte Massnahmen. Nach jeder Review geloescht — nie wiederverwendet. Nutzt die volle Skala 1-10; keine Gefaelligkeitsnoten.

Die Writer-↔-Critic-Schleife ist die token-intensivste Phase. Beide sitzen auf der **expert**-Stufe (Top-Modell + mittlerer Effort) — die Aufgabe ist klar definiert, kein exploratives Denken erforderlich.

### 🤝 Multi-Writer-Koordination

- 🛡️ **`status = writing`-Claim** — Writer aendern den Status vor dem Schreiben; Peers ueberspringen bereits beanspruchte Datensaetze.
- 🚫 **Anti-Rewriting** — wenn `critic_verdict` bereits gesetzt ist, **absoluter Skip** (das Urteil ist endgueltig, kein Re-Review).
- 📡 **DB-Schreibgrenze** — der Writer beruehrt nur `positions.status` und `applications`; niemals `scores`, `companies`, `positions.notes`.

### 🛑 Captain Freeze

Wenn der Sentinel Rate-Limit-Saettigung meldet, sendet der Captain `[URG] FREEZE` an die Writer. Sie schliessen die aktuelle Runde ab, wenn sie mitten in der Schleife sind (verlassen nie einen Critic mitten im Review), und schlafen dann bis der Throttle auf T0/T1 zurueckkehrt.

### 🛠️ Skills

- **`db_query.py next-for-scrittore`** — holt die naechste Position in absteigender Score-Reihenfolge.
- **`db_update.py position`** — wechselt `status = writing | ready | excluded`.
- **`db_insert.py application`** — registriert die Bewerbung + CV/PDF-Pfade.
- **`db_update.py application`** — speichert `critic_score · critic_verdict · critic_round · critic_notes` pro Runde.
- **`pandoc`** — konvertiert den CV-Markdown in PDF ueber die Typst-Engine.

### 🌐 MCP tools

- **`fetch`** — re-validiert den JD-Link vor dem Schreiben; der Critic nutzt dasselbe MCP zum Lesen der Live-JD.
- **`WebFetch`** / **`WebSearch`** — Fallback wenn `fetch` die JD nicht erreichen kann (LinkedIn- / robots.txt-Blockaden).

---

## 5️⃣ Phase 5 — Notify 📲

```
                       📦 jobs.db
                       (status = ready)
                              │
                              ▼
                    👨‍✈️ Captain receives [RES]
                    from Writer (PDF + verdict)
                              │
                              ▼
                       📲 Telegram bot
                    (position · CV PDF · job link)
                              │
                              ▼
                         👤 User
                          ① reads the CV
                          ② sends feedback to 👨‍✈️ Captain
                          ③ applies manually using the link
                              │
                              ▼
                       📦 jobs.db
                       (status = applied — set by user)
```

**Was passiert.** Wenn ein Writer Phase 4 mit `verdict = PASS` und `status = ready` abschliesst, erhaelt der Captain eine `[RES]`-Nachricht mit dem PDF und dem Urteil. Eine Telegram-Nachricht geht an den Benutzer mit dem Positionstitel, dem Unternehmen, dem generierten CV-PDF und dem Link zum Stellenangebot.

**Warum der Bewerbungsschritt vollstaendig manuell ist.** Der Benutzer liest den CV, beurteilt die Passung selbst, sendet Feedback an den Captain (`Ton passt nicht` · `diese Erfahrung fehlt` · `gut — ich bewerbe mich` · ...) und **entscheidet erst dann, ob er sich bewirbt** — ueber den Link, den er bereits hat. Dieser menschliche Checkpoint ist beabsichtigt: Er haelt JHT als Coach fuer den Arbeitnehmer, nicht als Kanone, die halbherzige Bewerbungen auf Recruiter feuert. Volumen auf Recruiter-Seite ist nur dann sinnvoll, wenn der Arbeitnehmer es gewaehlt hat.

**Status-Update.** Wenn der Benutzer sich bewirbt, wird die Position manuell als `status = applied` markiert (Telegram-Antwort oder "Ich habe mich beworben"-Button im Web-Dashboard), mit `applied_via = telegram | web | manual`. Der optionale `response`-Lebenszyklus (`interview` · `rejected` · `ghosted`) wird ebenfalls vom Benutzer nachverfolgt.

### 🛠️ Skills / tools

- **`.launcher/tg-bridge.py`** — Telegram-Bridge (Python): ausgehende Benachrichtigungen und eingehende Benutzer-Feedbacks / Status-Updates, ein Bot pro user-facing Rolle.
- **`positions.applied`** — DB-Flag, das vom Benutzer geaendert wird (nie automatisch vom Team).

---

## 🎮 Pipeline-Orchestrierung

Die Pipeline ist keine statische N-Instanzen-pro-Rolle-Konfiguration: Sie ist eine **feedback-gesteuerte Schleife**, die der Captain dynamisch basierend auf Durchflussrate, Warteschlangentiefe und dem Budget des Benutzers betreibt. Die Zahlen unten sind illustrativ, nicht normativ.

### 🥾 Cold Start — den Trichter fuellen

Wenn die Pipeline bei null startet, ist die Prioritaet, die nachgelagerten Warteschlangen schnell zu fuellen:

```
   T=0       →  3× 🕵️ Scout                                    (flood the funnel)
   T+ a bit  →  2× 🕵️ Scout · 1× 👨‍🔬 Analyst                    (first offers to verify)
   T+ more   →  2× 🕵️ Scout · 1× 👨‍🔬 Analyst · 1× 👨‍💻 Scorer    (first verified ready to score)
```

Wenn der Analyst hinter den Scouts zurueckfaellt, balanciert der Captain im laufenden Betrieb um: `+1 Analyst · −1 Scout`. Dieselbe Logik fliesst nachgelagert weiter.

### 🔁 Feedback-Schleife — selbstoptimierende Suche

Der erste Batch, den jede nachgelagerte Rolle verarbeitet, ist **Gold wert** — es sind die Daten, die der nachgelagerte Agent nutzt, um den vorgelagerten zu coachen:

- **👨‍🔬 Analyst → 🕵️ Scout** — nach einem aussagekraeftigen ersten Batch kennzeichnet der Analyst Ablehnungsmuster (Unternehmen, die Angebote schnell schliessen, Betrugs-Boards, JD-Formen, die immer bei der Verifizierung durchfallen). Scouts ueberspringen diese vorgelagert.
- **👨‍💻 Scorer → 🕵️ Scout** — sobald der Scorer ein Sample gesehen hat, weiss er, welche Rollen/Stacks/Geografien hohe Scores erzielen. Er gibt die Verteilung zurueck, damit Scouts naeher an den Hochscore-Zonen suchen.

Ergebnis: Mit jedem Zyklus finden Scouts bessere Angebote, Analysts lehnen weniger gute Angebote ab, Scorer sehen hoehere Score-Verteilungen. Das Team wird zu einem **selbstoptimierenden System**.

### 🎯 Writer-Aktivierungs-Gate

Writer-+-Critic-Schleifen sind der teuerste Teil der Pipeline (Top-Tier-Modell, iteratives Review). Sie **wechseln sich ab** — der Writer wartet, waehrend der Critic reviewt und umgekehrt — daher kostet ein Writer-+-Critic-Paar etwa **einen kontinuierlichen Agenten**, nicht zwei.

Um zu vermeiden, diese Tokens fuer mittelmassige Angebote auszugeben, koppelt der Captain die Writer-Aktivierung an die Warteschlangentiefe bei hohem Score:

1. Positionen in der Warteschlange nach Score absteigend sortieren.
2. Warten, bis sich genuegend hoch bewertete Angebote angesammelt haben (z.B. **10+ Angebote mit Score ≥ 75**).
3. Writer starten — sie beginnen immer mit der am hoechsten bewerteten Position in der Warteschlange.

### 💰 Budget-bewusstes Throttling

Alle Instanzzaehler und Gate-Schwellenwerte passen sich an das Monatsbudget des Benutzers und das Live-Nutzungssignal vom [📡 Bridge → 💂 Sentinel](#-side-channel--usage-monitoring)-Seitenkanal an. Aggressives Bootstrapping bei knappem Budget wird gedrosselt, bevor das Qualitaetsschreiben beginnt — besser ein paar Angebote auslassen, als das Budget fuer Discovery zu verbrennen und nichts fuer Writing uebrig zu haben.

---

## 📡 Seitenkanal — Nutzungsueberwachung

Ausserhalb der Pipeline. Laeuft kontinuierlich parallel dazu.

```
   ┌────────────┐  every tick  ┌────────────┐  notify on edge  ┌────────────┐
   │ 📡 Bridge  │ ───────────► │ 💂 Sentinel│ ───────────────► │ 👨‍✈️ Captain│
   │ (process,  │ usage + proj │ tier:      │  only on real    │            │
   │  not Claude│              │  medium    │  state changes   │            │
   │  agent)    │              │ event-     │                  │            │
   └────────────┘              │ driven     │                  └────────────┘
                               └────────────┘
```

**Bridge.** Ein Nicht-KI-Prozess, der die CLI jedes Agenten nach aktueller Nutzung und prognostizierter Erschoepfung abfragt. Sendet einen Tick an den Sentinel.
**Sentinel.** Edge-triggered: nimmt jeden Tick auf, spricht aber mit dem Captain *nur*, wenn sich tatsaechlich etwas aendert (Nutzungsspitze, Projektionsverletzung, Agenten-Crash).
**Captain.** Reagiert — drosselt, friert das Team ein, beendet problematische Sitzungen — basierend auf dem Signal des Sentinel.

---

## 🤝 Seitenkanal — Benutzerorientierte Helfer

```
                        👤 User
                          │
            ┌─────────────┼─────────────┐
            ▼             ▼             ▼
       👩‍💼 Assistant  👨‍✈️ Captain   🧙‍♂️ Mentor
       platform      team commander  career coach
       copilot                       (always-on)
```

- **👩‍💼 Assistant** — `tier: smart`. Uebersetzt nicht-technische Benutzeranfragen in Befehle fuer den Captain. Verbirgt Implementierungsdetails vor dem benutzerseitigen Chat.
- **🧙‍♂️ Mentor** — `tier: expert`, **aktiv** (Grundlagen ausgeliefert, Optimierung laufend). Karriere-Coach: analysiert die Profil/Ergebnis-Luecke, erstellt einen Aktionsplan, strategische Check-ins. Benutzerorientiert always-on, beim Boot erzeugt. Ordner: `agents/mentor/`.

---

## 🩺 Seitenkanal — Gesundheit & Wartung

Ausserhalb der Pipeline. **Einmalig geplante** Agenten: Der Watchdog erzeugt jeden in seinem taeglichen Slot; sie fuehren einen Sweep durch, melden an den Captain und zerstoeren sich dann selbst.

```
   ┌────────────┐  daily slot  ┌──────────────┐  report  ┌────────────┐
   │ watchdog   │ ───────────► │ 🩺 Dottore   │ ───────► │ 👨‍✈️ Captain│
   │ (scheduler)│              │ 👷‍♂️ Mantenitore│  findings │            │
   └────────────┘              └──────────────┘          └────────────┘
                                  one-shot → self-destruct
```

- **🩺 Dottore** — **Agenten-Gesundheit**. Periodischer Context-Refresh + Retrospektive: erkennt haengende/Zombie-Agentensitzungen und startet sie mit frischem Kontext neu (langlebige Threads, die Kontext verbrennen, verursachen einen stillen Durchsatzkollaps). Ordner: `agents/dottore/`.
- **👷‍♂️ Mantenitore** — **Infra-Gesundheit**. Taeglicher Wartungs-Sweep auf dem Container/VPS: Smoke-Test der missionskritischen Tools (Browser-/Playwright-Canary), Abhaengigkeits-Standardisierung (`jht-install`), Disk-/RAM-Trend, Orphan-GC. Ein defektes kritisches Tool ist ein P1. Ordner: `agents/mantenitore/`.

---

## 💬 Kommunikation

```
   ┌──────────┐   tmux send-keys    ┌──────────┐
   │ Captain  │ ◄─────────────────► │ Agents   │
   │          │   [@from -> @to]     │ (one     │
   │          │   MSG / REQ / RES /  │  tmux    │
   │          │   URG                │  session │
   └────┬─────┘                      │  each)   │
        │                            └──────────┘
        │  Telegram bot
        ▼
    📲 User
```

Inter-Agenten-Nachrichten verwenden einen getaggten Umschlag (`[@scout-1 -> @capitano] [REQ] ...`). Vollstaendiges Protokoll: [`agents/_manual/communication-rules.md`](../_manual/communication-rules.md).

---

## 🔗 Verwandt

- 📋 [`agents/_manual/`](../_manual/) — operationale Referenzdokumente, die zur Laufzeit konsumiert werden (DB-Schema, Kommunikationsprotokoll, Anti-Collision-Vertrag)
- 📜 [`docs/adr/`](../../docs/adr/) — Architekturentscheidungen (unterstuetzte CLIs, Single-Writer, Subscription-only)
