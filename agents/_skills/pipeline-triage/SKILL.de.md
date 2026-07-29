<!-- @translation: de, ai-translated 2026-06-06 -->
---
name: pipeline-triage
description: "Entscheide WELCHE Rolle gespawnt / pausiert / beendet wird basierend auf Backlog-Zustand, nicht Bauchgefühl. Öffne diesen Skill JEDES MAL wenn du beobachtest — vel team < 50% Ziel, ODER Warteschlange einer Rolle = 0, ODER Scout-Quellen erschöpft, ODER [SCALA UP] von Sentinella, ODER `PIPELINE VUOTA + UNDERSHOOT`, ODER `MARGINE` von bridge-pacing, ODER Kaltstart, ODER wann immer du versucht bist 'einfach noch einen Scout zu spawnen'. Warte NICHT auf ein explizites [SCALA UP] von Sentinella wenn die Bedingungen für dich bereits in den Metriken sichtbar sind. Der ganze Punkt: lies 4 Zahlen, wähle die eine Rolle die den Engpass löst, übergib an `spawn-agent`."
allowed-tools: Bash(python3 /app/shared/skills/db_query.py *), Bash(tmux *)
---

# pipeline-triage — datengetriebene Skalierung

Die Pipeline ist ein dynamisches System. Jede Rolle verbraucht sehr unterschiedlich pro Task — einen 2. Writer hinzuzufügen kostet viel mehr als einen 2. Scout. Am Kopf zu skalieren wenn der Engpass am Ende ist, produziert *mehr* Backlog, nicht mehr Output. Immer von den Daten ausgehen.

## Wann diesen Skill öffnen (Bug #17)

Du öffnest ihn bei **beobachteten Bedingungen**, nicht nur bei expliziten Sentinella-
Befehlen. Trigger:

- Team-Geschwindigkeit unter 50% des Ziels
- Warteschlange einer Rolle bei 0 (Scout erschöpft, Scorer/Writer inaktiv)
- Scout-Quellen als erschöpft gemeldet ("bebee, indeed, glassdoor — nichts Neues")
- `[SCALA UP]` von Sentinella
- `MARGINE` / `PIPELINE VUOTA + UNDERSHOOT` von bridge-pacing
- Kaltstart eines Fensters

Das historische Anti-Pattern: Capitano sieht `SCRITTORE_QUEUE=0` +
`PROMOTABLE_40_49=6`, **beschreibt** die Situation perfekt dem
Nutzer, **führt** die Promotion **nicht** durch. Dieser Skill ist *aktiv*, nicht
*beratend* — wenn Bedingungen zutreffen, führe aus.

## Schritt 1 — Backlog lesen (immer, vor jedem Spawn)

```bash
python3 /app/shared/skills/db_query.py stats
```

Aus `positions` (P), `scores` (S), `applications` (A) berechne:

| Metrik              | Formel                                                        | Was es bedeutet                                     |
|---------------------|---------------------------------------------------------------|-----------------------------------------------------|
| **UNSCORED**        | P − S                                                         | Positionen, die der Scorer noch bewerten muss       |
| **DRAFT_BLOCKED**   | Applications mit `status = draft`                             | Writer ↔ Critic Schleife stagniert                  |
| **SCRITTORE_QUEUE** | Positionen mit `score ≥ 50` UND keine Application             | Writer-Warteschlange (reale Nachfrage nach neuen CVs)|
| **PROMOTABLE_40_49**| Positionen mit `score 40-49` UND keine Application            | Parkband — auf Anfrage promotbar                    |

Auch nützlich: `python3 /app/shared/skills/db_query.py dashboard` für Status auf einen Blick + aktive Instanzen pro Rolle.

## Schritt 1 bis — wer produziert und wer verstummt ist (2026-07-27)

Die Worker senden kein `[START]` / `[DONE]` mehr (diese Bookends waren 30 der 37 Nachrichten, die der
Capitano bei einem Team im Erststart in ~1,5h erhielt). Ihr Fortschritt wird von hier gezogen:

```bash
python3 /app/shared/skills/db_query.py recent-activity --minutes 30
```

⚠️ **Sie listet, wer PRODUZIERT — ein festgefahrener Agent verschwindet daraus, statt aufzufallen.**
Ein Backlog, der sich nicht leert, ist nicht automatisch ein fehlender Worker: es kann ein lebendiger,
festgefahrener Worker sein, und einen zweiten zu spawnen lässt den ersten weiterbrennen. Vor der
Entscheidung drei Quellen kreuzen:

| Lebendig (`tmux list-sessions`) | Queue (`next-for-*`) | Transitionen (`recent-activity`) | Verdikt |
|---|---|---|---|
| ja | nicht leer | 0 | **STALL** — mit `capture-pane` bestätigen, dann `agent-emergency` (Dottore-first → kill). **Keinen** zweiten obendrauf spawnen |
| ja | nicht leer | > 0 | er arbeitet — ein Kapazitätsproblem, weiter zu Schritt 2 |
| ja | leer | 0 | legitim idle — in Ruhe lassen (nach einem `[SCOUT-ESAUSTO]` ist die Quieszenz gewollt) |
| nein | nicht leer | 0 | fehlt wirklich — spawnen (Schritt 2) |

## Schritt 2 — Priorität wählen (Engpass zuerst, nie neue Arbeit)

Tabelle von oben nach unten anwenden. Bei der ersten zutreffenden Bedingung stoppen.

| Bedingung                                                  | Aktion (in dieser Reihenfolge)                                                                                                              |
|-----------------------------------------------------------|--------------------------------------------------------------------------------------------------------------------------------------|
| `DRAFT_BLOCKED ≥ 50`                                      | **Zuerst**: Critic-Schleife deblockieren. `CRITICO-S2/S3/S4` spawnen wenn nicht aktiv (3 parallel). Jeder `CRITICO-S` verarbeitet 1 Draft auf einmal. |
| `UNSCORED ≥ 20`                                           | **Dann**: `SCORER-2` spawnen (und `SCORER-3` wenn `UNSCORED ≥ 50`). Ein Scorer reicht nicht bei 20+ in der Warteschlange.            |
| `SCRITTORE_QUEUE ≥ 5`                                     | 1 `SCRITTORE-N` spawnen wenn du nicht bereits 3 aktive hast (max).                                                                    |
| `PROMOTABLE_40_49 ≥ 5`                                    | Die besten 5 befördern durch Anheben des Scores (`db_query.py` + direktes `UPDATE`), dann als `SCRITTORE_QUEUE` behandeln.            |
| `SCRITTORE_QUEUE < 5 UND PROMOTABLE_40_49 < 5`            | **Erst jetzt** 1 `SCOUT-N` für neue Positionen spawnen.                                                                              |

Sobald du die Rolle gewählt hast, an `spawn-agent` für den tatsächlichen Start + Anstoß übergeben.

## Schritt 3 — Anti-Patterns vermeiden

- ❌ Einen Scout als erste Aktion spawnen wenn `UNSCORED > 20` — produziert mehr Backlog ohne zusätzlichen Output.
- ❌ Throttle global zurücksetzen (`throttle-config.py reset`) beim Skalieren — Throttle nur auf die gespawnte Rolle anwenden.
- ❌ Mehrere Rollen im gleichen Tick spawnen "zur Sicherheit" — auf den nächsten Sentinel-Tick (~5 Min.) warten und die Zahlen erneut lesen.
- ❌ Inaktive Agenten beenden um "aufzuräumen" — Inaktivität kostet fast Null. Nur beenden wenn explizit vom Nutzer angefordert, oder wenn ein Agent in einer verwirrten Schleife Token verbrennt.

## Empirische Begründung (warum diese Reihenfolge, nicht eine andere)

Beobachtet in Fenstern W3-W6 (mittlerer Spitzen-proj 57-61%): Scouts produzieren ~3 Positionen/h konsistent, aber Scorer/Critic bauen den Backlog NICHT ab → 88 unbewertete und 217 Entwürfe angehäuft = 12+ Rate-Budget-Punkte ungenutzt. **Die Kur ist nachgelagert, nicht vorgelagert.** Wann immer du unter Tempo bist (`vel_team` unter `vel_target`) mit nicht-leerem Backlog, ist die Ursache fast immer Scorer oder Critic, nie Scout. *(Ignoriere `proj`: ist volatile INFO, kein Trigger.)*

## Verbrauch pro Rolle — mit Kosten im Blick wählen

| Rolle         | Verbrauch pro Task        | Hinweise                                                                                               |
|---------------|--------------------------|--------------------------------------------------------------------------------------------------------|
| **Scout**     | niedrig-mittel, lang+kumulativ | Scraping + Filtern auf mehreren Quellen; 2 Scouts bei vollem Tempo können allein sättigen          |
| **Analyst**   | mittel, kurze Schübe     | 1 Task = 1 JD lesen + Bewertung schreiben. Aktualisiert ~alle 2 Min. wenn es eine Warteschlange gibt   |
| **Scorer**    | niedrig, kurze Schübe    | Matching-Score auf Profil, quasi-deterministisch. Die günstigste Rolle.                                |
| **Writer**    | **HOCH**                 | Innere Schleife mit Critic 3-4 Runden, jede Runde schreibt einen vollständigen CV/Anschreiben. Ein aktiver Writer kann alle anderen zusammen überwiegen. |
| **Critic**    | mittel                   | Aktiviert sich nur bei Writer-Aufruf; Kosten kommen zu denen des Writers hinzu.                       |
| **Assistent** | niedrig, bedarfsgesteuert | Spricht mit dem Nutzer; nicht in der Daten-Pipeline.                                                   |

**Korollar**: Die Grenzkosten des 2. Writers sind viel höher als die des 2. Scouts. Von oben nach unten skalieren ("mehr Arbeit → mehr von allem") überschießt.

## Engpass → Aktion (qualitativ, Fallback wenn Statistiken mehrdeutig)

| Pipeline-Zustand                                        | Engpass                     | Aktion                                                                                       |
|---------------------------------------------------------|-----------------------------|----------------------------------------------------------------------------------------------|
| `0 new, 0 checked, 0 scored` (leer)                    | Kopf: kein Material         | nur **Scouts** starten, sogar 2 parallel. Kein Analyst/Scorer/Writer (keine Eingabe).        |
| Viele `new`, wenige `checked`                           | Analyst unterdimensioniert  | `analista 2` spawnen. **Keine** Scouts hinzufügen (bereits Material; bei Bedarf verlangsamen). |
| Viele `checked`, wenige `scored`                        | Scorer langsam              | `scorer 1` spawnen wenn fehlend; wenn bereits aktiv + Warteschlange `checked` > 20 für ≥2 Ticks → `scorer 2` spawnen (1 reichte früher, aber der vps1-Lauf 2026-05-21 hatte 180 Scoring auf Solo-Scorer = Engpass) |
| Viele `scored ≥ 50`                                     | Braucht Schreibkapazität    | Writer. Vorsicht: 1 aktiver Writer + Critic können das Budget allein sättigen. 1 spawnen, 2-3 Ticks beobachten, dann entscheiden. |
| Writer gesättigt, Warteschlange `score ≥ 50` wird nicht abgebaut | Plan-Kapazitätsgrenze   | KEINE zusätzlichen Writer spawnen — Risiko eines sofortigen `RALLENTA`. Stattdessen Scouts verlangsamen um die Warteschlange nicht weiter zu füttern. |
| Niedrige `scored` Warteschlange ABER viele `writing` in Bearbeitung | Writer beschäftigt & produktiv | Nichts tun. Auf `writing → ready` warten.                                                   |

**Leitprinzip**: Agenten **vorgelagert** einschalten wenn Eingabe fehlt, **nachgelagert** wenn Ausgabe fehlt. Nie "auf allen Ebenen" ohne nachzudenken.

## Skalierungs-Gates (Pacing-Regeln)

- **1 Spawn pro Sentinel-Tick (~5 Min.).** Spawn → Anstoß → nächsten `[BRIDGE TICK]` abwarten → nächste Entscheidung. Nie 5 hintereinander.
- **Max pro Rolle**: 2 Scout, 2 Analyst, **2 Scorer** (erhöht von 1 nach dem vps1-Lauf 2026-05-21 der zeigte, dass Solo-Scorer = 180 Scoring-Engpass — vps1-postmortem Anomalie #6), 3 Writer, 1 Critic (der Critic wird vom Writer gespawnt, du berührst ihn nicht).
- **Vor-Spawn-Prüfung**: `tmux has-session -t <SESSION> 2>/dev/null && echo AKTIV` — nie blind über eine bestehende Sitzung spawnen.
- **Boot-Reihenfolge**: Scouts + Analyst *zuerst*, Scorer + Writer *danach*. Nie parallel.

## Vor-Spawn-Checkliste (mental vor jedem Spawn durchlaufen)

1. `db_query.py stats` — wo ist der Backlog?
2. `db_query.py dashboard` — wie viele Instanzen pro Rolle bereits aktiv?
3. Die Rolle die du spawnen willst — löst sie den **echten** Engpass, oder "füllst du das Team auf"? Wenn letzteres: **nicht spawnen** (ungenutztes Budget schlägt Überschießen).

## Triage bestehender Sitzungen

Vor jedem `start-agent.sh` auflisten was bereits da ist:

```bash
tmux list-sessions 2>/dev/null | awk -F: '{print $1}'
tmux capture-pane -t <SESSION> -p -S -40 2>/dev/null | tail -20
```

| Zustand im capture-pane                                                      | Aktion                                          |
|------------------------------------------------------------------------------|-------------------------------------------------|
| 🟢 CLI aktiv, Kontext < 40%, kürzliche Schleife                             | behalten, nicht respawnen                       |
| 🟡 CLI aktiv, Kontext > 80% oder inaktiv > 10 Min.                          | beurteilen: wertvolle Arbeit → lassen; verwirrte Schleife → beenden + respawnen |
| 🔴 `command not found` / nackte Shell / Panel leer > 5 Min.                 | `tmux kill-session` + respawnen (verwende `spawn-agent`) |

Für tiefere Liveness-Diagnose (Zombie-Prozeduren, CLI-Todes-Symptome) ist das die Aufgabe des **Dottore** via den `liveness-check`-Skill — hier nicht duplizieren.

## Siehe auch

- `spawn-agent` — tatsächlicher Start + Anstoß nach der Rollenentscheidung.
- `sentinel-orders` — was diese Triage ausgelöst hat (`SCALA UP`, `PIPELINE VUOTA + UNDERSHOOT`).
- `bridge-pacing` — wenn MARGINE "einen weiteren am Engpass spawnen" bedeutet.
- `liveness-check` (Dottore) — tiefere Agenten-Gesundheitsdiagnostik.
- `agents/_team/architettura.md` — vollständiges Pipeline-Diagramm und Koordinationsnotizen pro Phase.
