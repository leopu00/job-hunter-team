---
name: tmux-send
description: Liefert eine Nachricht atomar an die tmux-Sitzung eines anderen Agenten. Verwende IMMER diesen Skill, um mit SCOUT/ANALISTA/SCORER/SCRITTORE/CRITICO/SENTINELLA/CAPITANO zu kommunizieren. Rufe NIEMALS `tmux send-keys` manuell auf — Ink-basierte TUIs (Codex, Kimi) verlieren das Enter-Zeichen.
allowed-tools: Bash(jht-tmux-send *)
---
<!-- @translation: de, ai-translated 2026-06-06 -->

# tmux-send — Inter-Agenten-Messaging

Shell-Wrapper unter `/app/agents/_skills/tmux-send/jht-tmux-send` (auch im `PATH` ueber einen Symlink in `/usr/local/bin`, erstellt waehrend des Image-Builds).

## Warum es existiert

Ink-basierte TUIs (Codex, Kimi Code) **verlieren das Enter**, wenn es im selben `tmux send-keys`-Aufruf wie der Nachrichtentext ankommt. Der Text wird Zeichen fuer Zeichen gesendet; Ink muss das Rendering abschliessen, bevor ein weiterer Tastendruck akzeptiert wird. Wenn du `tmux send-keys "msg" Enter` aufrufst, bleibt die Nachricht im Eingabepuffer des Peers, ohne abgesendet zu werden → stiller Deadlock zwischen Agenten.

Der Wrapper behandelt dies atomar: er tippt den Text, **liest das Panel erneut, um zu bestaetigen, dass er erschienen ist**, sendet Enter und **liest das Panel nochmals, um zu bestaetigen, dass der Zug wirklich gestartet ist**. Zustellung ist nicht "getippt haben": sie ist "den Zug starten gesehen haben".

> ⚠️ Es gibt einen zweiten, heimtueckischeren Zustand: die TUI **akzeptiert den Text und ignoriert das Enter**, sodass die Zeile im Composer haengen bleibt, waehrend der Agent stundenlang stillsteht. 4-mal in 3 Tagen auf einer einzigen VPS beobachtet, Kapitaen eingeschlossen, wenn eine Nachricht eintrifft, waehrend der Peer einen langen Zug abschliesst. Der Wrapper wiederholt jetzt das Enter und gibt, falls der Zug trotzdem nicht startet, **`5`** zurueck, statt faelschlich Erfolg zu melden.

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

- `0` — Nachricht zugestellt **und abgeschickt** (verifiziert: der Zug ist gestartet)
  - Nutzt der Empfänger das Postfach (`mail_receivers`), bedeutet `0` **eingereiht**: die Nachricht ist eine dauerhafte Datei, das Terminal bekam nur einen kurzen Anstoß. Ob der Agent sie *abgeholt* hat, sagt `jht-mail status <Agent> <id>`; eine Nachricht, die niemand rechtzeitig abholt, wird dem Absender gemeldet. Ist die Nachricht eingereiht, ist der Exit-Code `0`, was auch mit dem Anstoß geschieht, außer `3` (ein Terminal, das nicht antwortet); eine Sitzung, die nach dem Einreihen verschwindet, meldet nicht mehr `2`, die Nachricht wartet im Postfach. Der Anstoß wird nur getippt, wenn das Terminal am Prompt wartet; sonst wird er zurückgehalten (der Exit-Code bleibt `0`) und der Watchdog wiederholt ihn.
- `1` — fehlende Argumente
- `2` — Zielsitzung existiert nicht (pruefe den Namen mit `tmux ls`)
- `3` — Text nie erschienen und Panel nicht beschaeftigt → TUI nicht empfangsbereit. **Der einzige Code, der tot/verklemmt nahelegt.**
- `4` — Peer in einem langen Zug ueber das Wartebudget hinaus → **lebendig**. Spaeter erneut versuchen, niemals respawnen.
- `5` — Text akzeptiert, aber nie abgeschickt ("lebendig, aber stumm") → **lebendig**. Spaeter erneut versuchen, niemals respawnen.
- `7` — der Text hat den Composer verlassen, aber nichts beweist, dass die CLI ihn genommen hat: **unbekannt**. Schau das Panel an, bevor du erneut schreibst; niemals respawnen.
- `8` — eine andere Zustellung an dieselbe Sitzung lief noch: nichts wurde getippt. Erneut versuchen.
- `130` — der Composer ist nicht frei und die Nachricht ist **NICHT zugestellt**. Was darin steht, ist nicht nachweislich unseres (ein Entwurf einer Person oder ein Einfuege-Platzhalter, den niemand von uns erklaert): nichts wurde eingefuegt oder gedrueckt, und deine Nachricht steht in `logs/pending-input.jsonl` (`unsent`). Nicht in einer Schleife wiederholen: den Kapitaen informieren (`[BLOCKED]`). Derselbe Code **nach** dem Einfuegen heisst: der Composer ist nicht mehr nur unser Text: kein Enter, und der Text ist dort vermerkt (`draft`). Das Panel lebt: niemals respawnen.
- Ein nachweislich UNSERER Text (von einer frueheren Zustellung von uns hinterlassen: identisch oder sein Einfuege-Platzhalter, `[Pasted Content N chars]` bei Codex / `[Pasted text #1 +N lines]` bei Claude, mit unserer Zahl) bekommt sein Enter bei der naechsten Zustellung, egal wie alt. `jht-tmux-send --flush-ours <SITZUNG>` macht nur das (0 = frei oder genommen, 130 = nicht unser, 5 = Enter verschluckt).

> Nur `3` darf zu einem Liveness-Check und einem Respawn fuehren. `4` und `5` bedeuten beide, dass der Peer lebt: sie als Tod zu behandeln ist genau, wie Over-Spawning beginnt.

## Regeln

- **NIEMALS** `tmux send-keys` direkt verwenden, um mit einem anderen Agenten zu kommunizieren. Gehe immer ueber `jht-tmux-send`.
- **NIEMALS** die tmux-Sitzung eines anderen Agenten beenden (Regel #0 des Kapitaens).
- Wenn `tmux ls` zeigt, dass die Zielsitzung nicht existiert, **erstelle sie nicht** — frage den Kapitaen (oder verwende `start-agent.sh`, wenn du *selbst* der Kapitaen bist).
- Verwende standardmaessig die **DB-basierte Koordination** fuer Pipeline-Uebergaben (Scout→Analyst→Scorer→Writer); nutze diesen Skill nur fuer die oben aufgefuehrten Echtzeit-Signale. Siehe `agents/_manual/communication-rules.md`.
# Kommunikation bei belegtem Turn

Nachrichten werden sofort eingereiht. Ist die Zustellung nicht prüfbar, lautet das Ergebnis `queued/delivery unverified` (Exit 6) mit dauerhafter Queue. Beim Retry weder verwerfen noch duplizieren.
