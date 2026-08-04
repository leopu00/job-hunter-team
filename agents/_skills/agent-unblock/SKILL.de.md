<!-- @translation: de, ai-translated 2026-07-30 -->
---
name: agent-unblock
description: "Nur für den Dottore. UNBLOCK-Phase, läuft in jeder Dottore-Runde VOR dem Refresh. Erkennt die vier Blockade-Formen, die ein ganzes Team stilllegen — ausstehender Text im Pane eines Koordinators, ein Agent in einer Retry-Schleife gegen einen stummen Peer, alle Operativen an einem leeren Prompt, während Kontingent zu verbrauchen wäre, ein Koordinator, der über die Schwelle hinaus schweigt — und LÖST sie AUF. Sendet und löscht niemals Text, den der Benutzer getippt hat: es routet darum herum (Frage an den Assistente, `mach inzwischen weiter` an den Koordinator über die Mailbox, direkter Kick-off der Worker). Eine Blockade, die die Runde überlebt, macht die Runde FEHLGESCHLAGEN, nicht abgeschlossen."
allowed-tools: Bash(python3 /app/shared/skills/agent_unblock.py *), Bash(python3 /app/shared/skills/doctor_analytics.py *), Bash(tmux *), Bash(jht-tmux-send *), Bash(/app/agents/_skills/tmux-send/jht-tmux-send *), Bash(bash /app/.launcher/start-agent.sh *), Bash(sleep *), Bash(cat *), Bash(grep *), Bash(echo *)
---

# agent-unblock — du meldest eine Blockade nicht, du löst sie auf

> **Das Prinzip, über allem anderen in dieser Skill.** Der Dottore **meldet eine
> Blockade nicht: er löst sie auf.** Wenn eine Aktion eine menschliche Entscheidung
> braucht, leite sie an den Assistente weiter **und setze das Team inzwischen wieder in
> Bewegung**, mit der Information, dass die Entscheidung aussteht. **Eine Blockade, die
> die Runde des Dottore überlebt, ist eine fehlgeschlagene Runde.**

Ein Team mit reichlich Kontingent (weekly 19%, unter Pace) und einer leerlaufenden
Maschine (load 0.12) stand einmal **elf Stunden** still. Eine einzige Zeile, in das Pane
des Capitano getippt und nie abgeschickt, machte dieses Pane unempfänglich;
`jht-tmux-send` las es als busy; der Koordinator verstummte; niemand teilte Arbeit zu;
jeder Agent beendete seinen Turn und parkte an einem leeren Prompt. Ein Scorer hing seit
Stunden in einer Retry-Schleife ("zehnter Versuch, busy"). Der Dottore jener Nacht
inspizierte neun Sitzungen in 416s, schrieb eine tadellose Diagnose in sein Journal —
und blieb im Standby. Das Team lag weitere sechs Stunden am Boden.

Die Diagnose war nie das Problem. Diese Skill ist das Mandat.

---

## Zwei Zustände, die identisch aussehen und entgegengesetzte Heilmittel brauchen

Beide zeigen einen Prompt mit etwas Text darin und keine Aktivität.

| Zustand | Symptom | Heilmittel |
|---|---|---|
| **ausstehender Text** | ein nacktes `Enter` wird ignoriert, aber `Space` **dann** `Enter` funktioniert | über die Eingabe entblocken |
| **eingefrorene TUI** | akzeptiert **nichts**: weder `Enter`, noch `C-m`, noch einen Send an die `%pane_id` | nur kill + neu erstellen |

**Das Detail, das den Unblock implementierbar macht**: ein "kaltes" `Enter` wird von einer
Ink-TUI (Codex, Kimi, Claude Code) nicht verarbeitet — das Submit muss *nach* dem Rendern
des Textes eintreffen. Also sendest du zuerst ein Zeichen (`Space`), dann `Enter`. Lässt
du das weg, **scheitert** eine Implementierung, die `Enter` allein versucht,
**stillschweigend** und schließt, das Pane sei nicht wiederherstellbar.

Damit trennt eine einzige Sonde die beiden: **`Space`+`Enter`, einmal**. Das Pane reagiert
→ es war ausstehender Text, entblockt. Nichts bewegt sich → eingefrorene TUI → neu
erstellen. (Ein Koordinator, der auf diese Weise eingefroren war, hatte einen lebenden
Prozess bei 2,8% CPU und eine 15,3-Stunden-Sitzung; `Enter`, `C-m` und ein direkter Send
an die `%pane_id` bewirkten alle nichts. Ihn neu zu erstellen war der einzige Ausweg —
was auch der Grund ist, warum das 12h-Sitzungs-TTL nicht optional ist: es ist die einzige
systematische Verteidigung gegen diesen zweiten Zustand.)

---

## 🚫 Das eine, was du niemals tun darfst

**Sende niemals und lösche niemals Text, den der Benutzer getippt hat.** Du kannst nicht
wissen, ob diese Zeile vollständig oder beabsichtigt ist. Die obige Sonde **schickt den
Composer ab**, also ist sie **nur** dann erlaubt, wenn der Inhalt des Composers einem
Agenten zuzuordnen ist — ein Umschlag `[@x -> @y] …` oder `[BRIDGE …]` /
`[SENTINELLA …]`, der ohnehin gesendet werden sollte.

`agent_unblock.py probe` erzwingt das für dich: bei nicht zuordenbarem Text verweigert es
mit `verdict=refused`, exit 3, nachdem es die Zeile zuvor nach `logs/pending-input.jsonl`
kopiert hat, damit sie später nicht verloren gehen kann. **Umgehe die Verweigerung
nicht.** Route stattdessen um die Blockade herum (§ ausstehende Benutzereingabe).

---

## Schritt 0 — Scan (deterministisch, null LLM, ~2s)

```bash
python3 /app/shared/skills/agent_unblock.py scan > /tmp/unblock_scan.json
cat /tmp/unblock_scan.json
```

Gibt `blocks_found` zurück, plus einen Eintrag pro Blockade, jeder mit seinem `cure`:

| `kind` | Bedeutung |
|---|---|
| `pending_user_input` | der Composer eines Koordinators enthält Text, den du nicht anfassen darfst |
| `pending_agent_input` | ein Agenten-Umschlag steckt in einem Composer fest, nie abgeschickt |
| `bare_shell` | die CLI ist gestorben, das Pane ist auf eine Shell zurückgefallen |
| `retry_loop` | N Versuche von X an Y im Fenster, null Antworten von Y |
| `all_operatives_idle` | jeder Operative an einem leeren Prompt |
| `mute_coordinator` | keine Nachricht vom Capitano über die Schwelle hinaus |

**Notiere `blocks_found` jetzt.** Du brauchst es am Ende der Runde.

> Warum `retry_loop` vertrauenswürdig ist: `messages.jsonl` verzeichnet den *Versuch*
> (`jht-tmux-send` loggt, bevor es tippt), also taucht ein Scorer, der auf einen stummen
> Capitano einhämmert, auch dann auf, wenn nie etwas zugestellt wurde. Das ist außerdem
> das objektive Signal, das **"geparkt, weil es keine Arbeit gibt"** von **"blockiert,
> weil die Koordination kaputt ist"** trennt: *ein Agent, der es beim Capitano ohne
> Antwort erneut versucht, ist nicht geparkt, er ist blockiert.* Wende die PARKED-Regel
> nicht auf ihn an.

## Schritt 1 — sie beseitigen, eine pro Art

### `pending_agent_input` · `bare_shell` — die Sonde

```bash
python3 /app/shared/skills/agent_unblock.py probe <SESSION>   # exit 0 unblocked · 2 frozen · 3 refused · 4 busy
```
- `unblocked` → beseitigt, zähle es.
- `frozen` → **wiederhole die Sonde nicht.** Eskaliere auf Neuerstellen: erfasse zuerst
  das Pane (`session-refresh` Schritt 2 — das Pane ist das Gedächtnis des Agenten), dann
  `tmux kill-session` → `bash /app/.launcher/start-agent.sh <role> <SAME-N>` → `[RESUME]`.
- `busy` → der Agent lebt, mitten im Turn. Keine Blockade. Lass ihn.

### `pending_user_input` — route darum herum, niemals hindurch

Drei Aktionen, alle verpflichtend, keine davon berührt die Zeile:

1. **Frage den Benutzer, über den Assistente** — der Assistente ist die Rolle, die mit dem
   Benutzer spricht. Sende ihm die Frage des Koordinators, damit er sie auf dem
   In-App-Kanal weiterleitet:
   ```bash
   jht-tmux-send ASSISTENTE "[@dottore -> @assistente] [UNBLOCK] Der CAPITANO hat eine offene Frage an den Benutzer und sein Pane steht still auf einer getippten und nie abgeschickten Zeile: «<Frage>». Leite sie über den In-App-Kanal weiter und melde die Antwort an den Capitano zurück. Die Zeile ist in logs/pending-input.jsonl gesichert — sie wurde WEDER gesendet NOCH gelöscht."
   ```
2. **Entblocke den Koordinator trotzdem** — sag ihm, dass die Frage weitergeleitet ist und
   er weitermachen muss. In dieses Pane zu tippen würde sich mit der Zeile des Benutzers
   verketten, und das Abschicken würde sie senden, also nutze den Kanal, der überhaupt
   kein Pane braucht: die Mailbox, die der Capitano zu Beginn jedes Turns leert
   (`bridge-mailbox`).
   ```bash
   python3 /app/shared/skills/agent_unblock.py relay CAPITANO "[@dottore -> @capitano] [UNBLOCK] Deine Frage an den Benutzer wurde an den Assistente weitergeleitet und wird bearbeitet. Bleib NICHT stehen, um darauf zu warten: mach inzwischen mit der übrigen Arbeit weiter und teile die Warteschlangen neu zu. In deinem Composer steht eine nicht abgeschickte Zeile des Benutzers: ich fasse sie nicht an, und fass du sie auch nicht an, solange nicht er entscheidet."
   ```
   `relay` schreibt nach `bridge-mailbox.jsonl` **und** nach `messages.jsonl`, sodass die
   Nachricht sowohl zustellbar als auch auditierbar ist. Ein Koordinator darf niemals auf
   eine menschliche Antwort wartend dasitzen.
3. **Starte die Worker neu, ohne auf den Koordinator zu warten** — siehe unten. Das ist
   es, was die elf Stunden tatsächlich zurückholt.

### `retry_loop` — entblocke den Adressaten, oder befreie den Absender

Beseitige zuerst das Ziel (Sonde / Neuerstellen). Wenn das Ziel in dieser Runde nicht
beseitigt werden kann, **darf der Absender nicht weiter warten**: weise ihn neu zu oder
sag ihm, er soll weitermachen.
```bash
jht-tmux-send SCORER-5 "[@dottore -> @scorer-5] [UNBLOCK] Der CAPITANO ist nicht erreichbar und deine Anfrage wurde auf anderem Weg weitergeleitet. HÖR AUF, es erneut zu versuchen: nimm die nächste aus deiner Warteschlange (db_query.py next-for-<ruolo>) und mach eigenständig weiter."
```
Ein Retry-Loop zählt erst dann als beseitigt, wenn dem Absender gesagt wurde, dass er
aufhören soll, es erneut zu versuchen.

### `all_operatives_idle` · `mute_coordinator` — Kick-off ohne den Koordinator

Verfügbares Kontingent und alle geparkt ist keine Pause, das ist ein Stillstand.
**Starte die operativen Rollen direkt, warte nicht auf den Capitano**, und eskaliere das
Schweigen des Koordinators an den Assistente. Sende dann jedem untätigen Operativen seine
eigene Warteschlange:
```bash
jht-tmux-send SCOUT-1 "[@dottore -> @scout-1] [UNBLOCK] Die Koordination steht still und es ist Kontingent verfügbar. Starte wieder in der Hauptschleife, ohne auf den Capitano zu warten: KREIS 1 des Profils, benachrichtige die Analisti in Losen von 3-5."
jht-tmux-send ANALISTA-1 "[@dottore -> @analista-1] [UNBLOCK] Starte wieder in der Hauptschleife, ohne auf den Capitano zu warten: Warteschlange aus db_query.py next-for-analista."
```
(Gleiche Form für `scorer` / `scrittore` mit ihrer eigenen `next-for-*`-Warteschlange.)

## Schritt 2 — die Runde ehrlich abschließen

```bash
python3 /app/shared/skills/agent_unblock.py record-round \
  --round-id "$ROUND_ID" --found <blocks_found> --cleared <blocks_cleared>
```
Es hängt an `/jht_home/logs/dottore-actions.jsonl` an, mit `blocks_found`,
`blocks_cleared`, `blocks_open`, und wählt das Event für dich: `round_complete` nur wenn
`cleared >= found`, sonst **`round_failed`** (exit 1). Übertünche keinen Überlebenden:
eine Runde, die eine Blockade am Leben lässt, ist eine fehlgeschlagene Runde, und das Log
muss das sagen — der nächste Dottore liest dieses Log.

---

## Regeln

- **Entblocke VOR dem Refresh.** Ein Refresh auf einem gelähmten Team erzeugt die Lähmung
  einfach mit einem sauberen Kontextfenster neu.
- **Eine Sonde pro Pane, für immer.** Zwei Sonden können dir nicht mehr sagen als eine,
  und die zweite ist der Weg, auf dem du dir einredest, die Zeile eines Benutzers
  abzuschicken.
- **`busy` ist keine Blockade.** `esc to interrupt` heißt lebendig und mitten im Turn.
  Sende niemals Tasten in einen laufenden Turn, spawne niemals einen Ersatz für einen
  beschäftigten Agenten.
- **PARKED gilt nicht für einen blockierten Agenten.** "Alter ≥ 40min UND produced == 0
  UND keine aktuelle Nachricht des Capitano" beschreibt ein gelähmtes Team genauso gut wie
  ein absichtlich geparktes. Wenn der Agent in einem `retry_loop` auftaucht, oder jeder
  Operative untätig ist, während Kontingent zu verbrauchen wäre, ist er blockiert — handle.
- **Rate niemals die Absicht des Benutzers.** Kein Senden, kein Löschen, kein Bearbeiten,
  kein "nur ein Leerzeichen, um es aufzuwecken" auf Benutzertext. Die Zeile bleibt, wo sie
  ist; die Kopie in `logs/pending-input.jsonl` ist das Sicherheitsnetz.

## Anti-Patterns

- ❌ Die Blockade ins Journal schreiben und weitermachen. Das ist das Elf-Stunden-Versagen.
- ❌ `Enter` allein versuchen, sehen, dass nichts passiert, und das Pane für tot erklären.
- ❌ Deine Nachricht in einen Composer tippen, der bereits die Zeile des Benutzers enthält
  — sie verkettet sich, und das Abschicken sendet den Text des Benutzers.
- ❌ Einen Koordinator neu erstellen, nur um ein *ausstehendes* (nicht eingefrorenes) Pane
  zu bereinigen. Erst die Sonde.
- ❌ `round_complete` loggen mit `blocks_cleared < blocks_found`.

## Siehe auch

- `session-refresh` — die Refresh-Runde, die *nach* dieser Phase läuft, plus das 12h-Sitzungs-TTL.
- `tmux-send` — Umschlag-Konventionen und was die Exit-Codes bedeuten (4 = busy = lebendig).
- `liveness-check` — On-Demand-Urteil über einen einzelnen mutmaßlich toten Agenten.
