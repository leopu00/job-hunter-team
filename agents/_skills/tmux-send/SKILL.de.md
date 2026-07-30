<!-- @translation: de, ai-translated 2026-06-06 -->
---
name: tmux-send
description: Liefert eine Nachricht atomar an die tmux-Sitzung eines anderen Agenten. Verwende IMMER diesen Skill, um mit SCOUT/ANALISTA/SCORER/SCRITTORE/CRITICO/SENTINELLA/CAPITANO zu kommunizieren. Rufe NIEMALS `tmux send-keys` manuell auf — Ink-basierte TUIs (Codex, Kimi) verlieren das Enter-Zeichen.
allowed-tools: Bash(jht-tmux-send *)
---

# tmux-send — Inter-Agenten-Messaging

Shell-Wrapper unter `/app/agents/_skills/tmux-send/jht-tmux-send` (auch im `PATH` ueber einen Symlink in `/usr/local/bin`, erstellt waehrend des Image-Builds).

## Warum es existiert

Ink-basierte TUIs (Codex, Kimi Code) **verlieren das Enter**, wenn es im selben `tmux send-keys`-Aufruf wie der Nachrichtentext ankommt. Der Text wird Zeichen fuer Zeichen gesendet; Ink muss das Rendering abschliessen, bevor ein weiterer Tastendruck akzeptiert wird. Wenn du `tmux send-keys "msg" Enter` aufrufst, bleibt die Nachricht im Eingabepuffer des Peers, ohne abgesendet zu werden → stiller Deadlock zwischen Agenten.

Der Wrapper behandelt dies atomar: `text → sleep 0.3 → Enter → sleep 0.5 → Enter` (das zweite Enter ist zur Robustheit idempotent).

## Verwendung

```bash
jht-tmux-send <SESSION> "<message>"
```

## Beispiele (V5)

```bash
# Captain → Scout (INFO, allgemeine operative Nachricht)
jht-tmux-send SCOUT-1 "[@capitano -> @scout-1] [INFO] Start the main loop. Begin from CIRCLE 1 (Remote EU); ping after each batch of 3-5 positions."

# Captain → Writer (URG, Echtzeit-Anweisung)
jht-tmux-send SCRITTORE-1 "[@capitano -> @scrittore-1] [URG] FREEZE — finish the current Critic round, then sleep until throttle returns to T0/T1."

# Analyst → Scout (FEEDBACK, Coaching zu Ablehnungsmustern)
jht-tmux-send SCOUT-2 "[@analista-1 -> @scout-2] [FEEDBACK] [SENIORITY] 4 of last 5 inserts from greenhouse.io require senior+ — switch source or query for the next batch."

# Sentinel → Captain (URG, Statusaenderung)
jht-tmux-send CAPITANO "[@sentinella -> @capitano] [URG] Usage 94%, projection 102% — recommend throttle T2 + freeze Writers."

# Writer → Captain (REPORT, Endergebnis)
jht-tmux-send CAPITANO "[@scrittore-1 -> @capitano] [REPORT] Position 42 — verdict PASS, score 7.5/10. PDF: /jht_user/.../CV.pdf"

# Worker → Captain (ACK, Bestaetigung eines URG)
jht-tmux-send CAPITANO "[@scrittore-1 -> @capitano] [ACK] freeze applied, sleeping."
```

## Nachrichtenumschlag

Behalte immer das strukturierte Praefix bei:

```
[@<from> -> @<to>] [<TYPE>] <text>
```

Standardtypen (siehe `agents/_manual/communication-rules.md` fuer die vollstaendige Taxonomie und rollenspezifische Erwartungen):

- `BLOCKED` — Worker → Capitano: du hast **AUFGEHÖRT zu produzieren**, und es hinterlässt keine Spur in der DB (Tool kaputt, `403`/`LOCKED`, trockene Quellen, ein Element, das du weder bearbeiten noch überspringen kannst). Seit 2026-07-27 ist das das EINZIGE, was einen Stall von stiller Arbeit unterscheidet
- `URG` — Echtzeit-Anweisung, die sofortiges Handeln erfordert (FREEZE, throttle, kill)
- `FEEDBACK` — Coaching an den vorgelagerten Agenten mit einem Ablehnungs-Tag (`[SENIORITY] · [STACK] · [GEO] · [LINGUA]`)
- `REQ` / `RES` — synchrone Anfrage/Antwort zwischen Agenten
- `ACK` — Empfangsbestaetigung fuer ein `URG` oder `REQ`, das du noch nicht bearbeiten kannst
- ~~`INFO` / `REPORT`~~ — **für Peer-Traffic zurückgezogen** (2026-07-27): sie waren 8 der 30 reinen Status-Nachrichten, die den Capitano in ~1,5h weckten. Fortschritt wird aus `db_query.py recent-activity` gezogen, nicht erzählt

> 💬 `[CHAT]` ist reserviert fuer **Benutzer → Agent**-Nachrichten ueber die Web-UI (siehe das Protokoll im Prompt des Kapitaens). Verwende es nicht fuer Inter-Agenten-Verkehr.

## Exit-Codes

- `0` — Nachricht zugestellt
- `1` — fehlende Argumente
- `2` — Zielsitzung existiert nicht (pruefe den Namen mit `tmux ls`)

## Regeln

- **NIEMALS** `tmux send-keys` direkt verwenden, um mit einem anderen Agenten zu kommunizieren. Gehe immer ueber `jht-tmux-send`.
- **NIEMALS** die tmux-Sitzung eines anderen Agenten beenden (Regel #0 des Kapitaens).
- Wenn `tmux ls` zeigt, dass die Zielsitzung nicht existiert, **erstelle sie nicht** — frage den Kapitaen (oder verwende `start-agent.sh`, wenn du *selbst* der Kapitaen bist).
- Verwende standardmaessig die **DB-basierte Koordination** fuer Pipeline-Uebergaben (Scout→Analyst→Scorer→Writer); nutze diesen Skill nur fuer die oben aufgefuehrten Echtzeit-Signale. Siehe `agents/_manual/communication-rules.md`.
