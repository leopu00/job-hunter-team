<!-- @translation: de, ai-translated 2026-08-03 -->
---
name: team-modes
description: "Das Handbuch der Team-Modi — eine Karte pro Modus (search / harvest / care / calibration / saving). Öffne es immer dann, wenn das stündliche [MODALITÀ CORRENTE]-Banner einen Modus nennt und du dich nicht erinnerst, was er operativ bedeutet, beim Aufwachen nach einem Context-Refresh, oder wenn der Nutzer den Modus aus dem Spiel heraus wechselt. Der Modus ist IMMER die Wahl des Nutzers - diese Skill sagt dir, wie du den aktuellen FÜHRST, nie wie du ihn änderst."
allowed-tools: Bash(python3 /app/shared/skills/mode_banner.py *), Bash(python3 /app/shared/skills/db_query.py *), Bash(python3 /app/shared/skills/feedback_query.py *), Bash(python3 /app/shared/skills/team_directives.py *)
---

# team-modes — was der aktuelle Modus bedeutet, in dreißig Sekunden

Das Team hat immer genau einen persistenten Modus. Er lebt in
`$JHT_HOME/profile/capitano-maintenance.json` (historischer Dateiname — erwarte
KEINE umbenannte Datei) unter dem Schlüssel `"mode"`, einem **geschlossenen
Enum aus fünf Werten**. Das stündliche `[MODALITÀ CORRENTE]`-Banner trägt die
kompakte Spezifikation; diese Skill ist die vollständige Karte. Wenn Banner und
dein Context sich widersprechen, **gewinnt die Datei auf der Platte** — dein
Context kann von einem Refresh gelöscht worden sein.

| Wert | Bedeutung |
|---|---|
| `search` | Default: akkumulieren (Scout → Analyse → Score) |
| `harvest` | Sourcing stoppen, die besten bereits gefundenen Positionen in CVs verwandeln |
| `care` | das gefundene Portfolio frisch halten: getakteter Recheck, Aussortieren der abgelaufenen (C-18) |
| `calibration` | das Feedback des Nutzers lesen und die **Priorität** der Suche neu ausrichten |
| `saving` | nacktes Überlebensminimum, kein autonomes Enrichment |

- **Keine Datei → `search`.** Legacy-Werte: `"normal"` → search,
  `"maintenance"` → care (live laufende Installationen tragen sie noch —
  befolge sie, derselbe Modus).
- **Datei vorhanden, aber nicht lesbar → Modus `sconosciuto`**: behandle das
  als AKTIVE Order (das Sourcing bleibt aus), öffne die Datei selbst, bevor du
  irgendetwas entscheidest.
- Ein Wert außerhalb des Enums ist trotzdem eine Order des Nutzers: melde ihn,
  normalisiere ihn nicht weg.

Jeder Modus erklärt **vier Dinge** — dieselben vier, die das Banner komprimiert:
**(1)** welche Queues aktiv sind, **(2)** was ausgesetzt ist, **(3)** wohin das
Budget geht, **(4)** wann seine Arbeit FERTIG ist. Punkt 4 ist der, der
historisch fehlte: kein Modus endete von selbst, und ein Team saß einmal 18 Tage
in der Wartung, ohne dass es jemand bemerkte. Wenn das Banner sagt, die Arbeit
des Modus sei erschöpft, **sag es dem Nutzer** — wechsle nie eigenmächtig den
Modus, aber Schweigen ist ebenso wenig erlaubt.

Das `orders`-Vokabular (`stop_search`, `discard_expired_rotating`,
`cv_min_score`, `pre_check_liveness_for_cv`, dazu handgeschriebene Schlüssel)
komponiert mit JEDEM Modus: ein expliziter Schlüssel in `orders` überstimmt
immer den Default des Modus. Ein live laufender Produktions-VPS fährt heute
`care` mit genau diesen Orders.

---

## `search` — ricerca (Suche; Default: akkumulieren)

1. **Aktive Queues**: die volle Pipeline — die Scouts sourcen,
   `next-for-analista`, `next-for-scorer`; Scrittore/Critico bleiben on-demand
   (C-10).
2. **Ausgesetzt**: nichts. C-05/C-05c (Anti-Idle-Sourcing) sind in Kraft.
3. **Budget-Priorität**: zuerst das Sourcing, dann Analyse/Score; balanciere
   den Zulauf hin zu BEWERTETEN Positionen (die Shortlist ist das Produkt).
4. **Ausstiegsbedingung**: keine — kontinuierlicher Modus. Er endet nicht; der
   Nutzer holt dich heraus (typischerweise nach `harvest` oder `care`, wenn das
   bewertete Backlog seine Lesezeit übersteigt).

**Was du tust**: Normalbetrieb — C-02 gestufte Kalibrierung, C-07-Throttle-Leiter,
C-09 Weekly-Bewusstsein. **Mit C-25**: `[SCOUT-ESAUSTO]` +
nachgelagerte Queues leer + Spielraum → die nützliche Default-Arbeit von C-25
ist bereits die Arbeit dieses Modus; halte die Pace am Ziel, nie untätig bei
vorhandenem Spielraum. **Tu NICHT**: „keine Datei" als „keine Regeln" behandeln
— das Board (`team_directives`) gilt weiterhin.

## `harvest` — raccolto (Ernte: Sourcing stoppen, die besten umwandeln)

1. **Aktive Queues**: das bereits gefundene Portfolio, bester Score zuerst.
   CV-Fluss: `next-for-scrittore` (vom Nutzer geflaggt) plus die Positionen,
   die der Nutzer auswählt, wenn du ihm die Spitze der Shortlist vorlegst; der
   Critico prüft wie üblich.
2. **Ausgesetzt**: das Sourcing — **KEIN Scout** (`stop_search` ist per Default
   true: C-05/C-05c ausgesetzt, die leere `new`-Queue ist der GEWOLLTE
   Zustand).
3. **Budget-Priorität**: Scrittore/Critico zuerst; der Analista nur für den
   Liveness-Check vor dem CV (`pre_check_liveness_for_cv` — schreibe nie ein CV
   für ein totes Angebot).
4. **Ausstiegsbedingung**: keine lebende Position ≥ der CV-Schwelle
   (`orders.cv_min_score`, Default 75) bleibt ohne CV. Das Banner wertet das
   read-only gegen die DB aus; wenn es HARVEST DONE meldet, berichte es dem
   Nutzer und frage, wohin es als Nächstes gehen soll.

**Was du tust**: Scouts killen / nicht spawnen; den Scrittore on-demand gemäß
C-10 spawnen, während der Nutzer Positionen flaggt; die Queue der geflaggten in
Bewegung halten; dem Nutzer die besten noch nicht geschriebenen Positionen
vorlegen, damit er sie flaggen kann. **Mit C-25**: Ernte erschöpft +
Budget-Spielraum → der Überschuss geht zurück ins Sourcing (1 Scout, normales
Pacing), AUSSER der Nutzer hat das Sourcing explizit verboten (Board, C-26) —
dann bleibst du stehen und sagst dem Nutzer, dass Budget übrig ist. **Tu
NICHT**: CVs für Positionen unterhalb der Schwelle schreiben, „um das Budget zu
nutzen", oder Scouts spawnen, „um nicht untätig zu sein", solange noch
Kandidatinnen ohne CV übrig sind.

## `care` — cura (Pflege: das Portfolio frisch halten; volle Regel: C-18)

1. **Aktive Queues**: `next-for-recheck-due` (live, Score ≥ 70, >14 Tage, beste
   zuerst, via `recheck-batch`), `next-for-geocode-missing`,
   `next-for-logo-missing`, dazu das abgelaufene Set
   (`discard_expired_rotating`).
2. **Ausgesetzt**: das Sourcing mit `stop_search: true` (hier sein Default) —
   C-05/C-05c ausgesetzt.
3. **Budget-Priorität**: Portfolio-Pflege, über die aktiven Stunden verteilt
   (langsam, stetig — nie vorne konzentriert); CV nur auf Anfrage des Nutzers
   und ≥ `cv_min_score` (Default 90).
4. **Ausstiegsbedingung**: ALLE VIER Pflege-Queues leer. Die 14-Tage-Taktung
   lässt Positionen nachreifen, „fertig" heißt also fertig-für-jetzt — das
   Banner sagt es, und nach Punkt 4 von C-18 + C-25 geht der Überschuss zurück
   ins Sourcing, sofern nicht verboten.

**Was du tust**: die Analisti sind der Motor — eine eigene Queue pro Instanz
(C-13), im Kick-Off angesagt. Der Ausschluss einer Position ist IMMER das
Urteil des Analista, nie das eines Skripts. Die Enrichment-Queues beachten
`enrichment-policy.json` IM CODE: eine Queue, die mit einer Policy-Begründung
leer zurückkommt, ist ein gewollter Zustand, kein Bug. **Tu NICHT**: alle
Rechecks auf einen Schlag verbrennen, eine per Policy deaktivierte Queue erneut
versuchen, oder Scouts spawnen, solange die Pflege-Queues Arbeit haben.

## `calibration` — calibrazione (Kalibrierung: die Such-Priorität neu ausrichten)

1. **Aktive Queues**: das Feedback des Nutzers (`feedback_query.py recent` — es
   lebt in der Cloud), das Score-Profil, die `role_family`-Taxonomie.
2. **Ausgesetzt**: das Massen-Sourcing — solange die Priorität nicht
   aktualisiert ist, würden neue Positionen mit der ALTEN Zielrichtung gefunden
   (genau die Verschwendung, die dieser Modus verhindert). `stop_search` ist per
   Default true.
3. **Budget-Priorität**: Feedback lesen + neu ausrichten: Such-Prioritäten und
   -Kreise für die Scouts anpassen, die betroffenen Positionen in einem
   begrenzten Batch neu bewerten, falls sich die Kriterien verschoben haben.
4. **Ausstiegsbedingung**: der jüngste Feedback-Batch ist gelesen und die
   Priorität aktualisiert. NICHT maschinell von der Platte prüfbar (das
   Feedback lebt in der Cloud) — das Banner sagt bewusst „non valutabile"; DU
   erklärst dem Nutzer den Abschluss, mit dem, was sich geändert hat (z. B.
   „Berlin vor Ort depriorisiert, Fintech hochgezogen — 12 Positionen neu
   bewertet").

**Was du tust**: hol das Feedback, extrahiere das Muster (was ihm gefallen hat,
was er ausgeblendet, was er markiert hat), übersetze es in Prioritäten für die
Scouts und — wenn es sich lohnt — in einen begrenzten Re-Score. Dann berichte
und warte, bis der Nutzer den Modus wechselt. **Mit C-25**: Kalibrierung fertig
+ Spielraum → der Überschuss geht zurück ins Sourcing (jetzt mit der NEUEN
Priorität), sofern nicht verboten. **Tu NICHT**: die ganze DB neu bewerten,
Präferenzen erfinden, die das Feedback nicht zeigt, oder mit der alten
Zielrichtung weitersourcen.

## `saving` — risparmio (Sparen: Überlebensminimum)

1. **Aktive Queues**: keine autonomen. Nur das, was der Nutzer ausdrücklich
   verlangt: Chat-Antworten, Tickets (C-15), vom Nutzer ausgelöste Flags
   (angefragtes write/geocode/recheck — die laufen nie über eine Policy).
2. **Ausgesetzt**: das Sourcing UND jedes autonome Enrichment (Recheck,
   Geocode, Logo). Worker, die für offene Nutzeranfragen nicht gebraucht
   werden, werden gekillt oder gar nicht erst gespawnt.
3. **Budget-Priorität**: nahe null. Die einzige Ausgabe ist, dem Nutzer zu
   antworten.
4. **Ausstiegsbedingung**: `mode_until`, wenn der Nutzer eines gesetzt hat — an
   diesem Datum läuft der Modus **von selbst** ab, Orders inklusive, und das
   Team ist wieder in `search` (die Datei sagt weiter `saving`: die Frist
   gewinnt, und das Banner erklärt es). Ohne `mode_until` hält er an, bis der
   Nutzer ihn aufhebt — und das gehört ausgesprochen: das Wochenbudget ist ein
   **Fenster, kein Guthaben** — was beim Reset nicht ausgegeben ist, wird
   vernichtet, ein aus Trägheit stehengelassenes Sparen bewahrt den Zyklus also
   nicht, es verwirft ihn. Sag dem Nutzer, dass er ihm ein Ende geben kann — und wo: die Konsole hat
   das Feld «Bis wann» (Tage und Stunden, neben der Modus-Auswahl), und in der
   Shell ist es `jht coordinator set-mode saving --until <iso>`. Beide schreiben
   denselben Schlüssel in dieselbe Datei.

**Was du tust**: halte Capitano/Assistente/Mentor antwortbereit; sonst bewegt
sich nichts ohne direkte Anfrage des Nutzers. **Mit C-25**: Sparen IST ein
explizites Verbot des Nutzers gegen autonome Ausgaben — C-25 gibt das Sourcing
hier NICHT frei; wenn Budget verfällt, SAGST du es dem Nutzer (das ist die
andere Hälfte von C-25), du gibst es nicht aus. **Tu NICHT**: „Minimum" zu „ein
bisschen Sourcing schadet nicht" umdeuten.

---

## Modusübergreifende Regeln

- **C-25 (verschwende niemals das Budget)** komponiert mit jedem Modus: eigene
  Arbeit des Modus FERTIG + Spielraum → die nützliche Default-Arbeit ist
  Sourcing im Pace von 1 Scout — außer dort, wo der Modus oder der Nutzer die
  Ausgabe explizit verbieten (Sparen; ein explizites Verbot vom Board); dort
  ist der richtige Zug, das übrige Budget zu melden. C-25 überstimmt nie eine
  Bremse: Weekly-/Tages-Caps, `work_phase=OFF`, die Gates von C-23 und
  Nutzer-Throttles gewinnen alle.
- **Pacing-Gates sind modusunabhängig**: kein Modus autorisiert einen Burst
  oder das Ignorieren von `vel_target`; ein Modus ändert nur, WOHIN das dosierte
  Budget geht.
- **Ausstieg ≠ Wechsel.** Wenn ein Modus seine Arbeit als erschöpft meldet,
  benachrichtige den Nutzer und befolge den Modus weiter, bis ER ihn ändert.
  Die Datei wird im Auftrag des Nutzers geschrieben — von der Konsole des
  Spiels (Frist inklusive) oder mit `jht coordinator`, wenn er es verlangt — und
  nie aus eigener Initiative.

## Siehe auch

- `mode_banner.py` (`shared/skills/`) — setzt das stündliche Banner von der
  Platte zusammen; `python3 /app/shared/skills/mode_banner.py show` liest es
  auf Anfrage neu.
- **C-18** in deiner Identitätsdatei — die vollständige Regel des Pflege-Modus.
- `sentinel-orders`, `pipeline-triage`, `scaling-calc` — die Hebel, die jeder
  Modus auf unterschiedliche Queues richtet.
