<!-- @translation: de, ai-translated 2026-06-06 -->
---
name: order-formats
description: Vorlagen für die Befehle, die der Wächter an den Kapitän sendet. Verwende diese Skill jedes Mal, wenn du den Kapitän benachrichtigen willst — wähle die passende Vorlage, fülle die Platzhalter aus, sende via `jht-tmux-send`.
allowed-tools: Bash(jht-tmux-send *), Bash(/app/agents/_skills/tmux-send/jht-tmux-send *)
---

# Skill — BEFEHLS-Formate an den Kapitän

Alle Befehle werden gesendet via:
```bash
/app/agents/_skills/tmux-send/jht-tmux-send CAPITANO "<messaggio>"
```

**Absoluter** Path obligatorisch (der CLI-PATH enthält ihn möglicherweise nicht).

---

## ACCELERARE (erster Befehl, unter Zielwert)

```
[SENTINELLA] ORDINE: ACCELERARE. usage=X% vel=Y%/h (ideale Z%/h) proj=P% (sotto target 90-95). Spawn più agenti / throttle 0 sugli attivi.
```

## SCALA UP (schwere anhaltende Unterauslastung)

```
[SENTINELLA] ORDINE: SCALA UP. usage=X% vel=Y%/h (ideale Z%/h) proj=P% in SOTTOUTILIZZO da N tick. C'è budget per +1 agente. Spawna agente sul collo di bottiglia (consulta DB per coda più alta) e aspetta il prossimo tick.
```

## PUSH G-SPOT (nahe am Zielwert, aber stagnierend)

```
[SENTINELLA] ORDINE: PUSH G-SPOT. usage=X% vel=Y%/h (ideale Z%/h) proj=P% (vicini al G-spot da N tick, manca poco). Aggiungi UN agente leggero (consulta DB per coda più alta) per spingere proj sopra 90%. Throttle: 0.
```

## MANTIENI (G-spot erreicht, 3 Tick STEADY)

```
[SENTINELLA] ORDINE: MANTIENI. usage=X% vel=Y%/h (ideale Z%/h) proj=P% (zona G-spot 90-95). Throttle: 0. NON scalare, NON rallentare, lascia che il team lavori.
```

## RALLENTARE (leichte WARNUNG 95-100%)

```
[SENTINELLA] ORDINE: rallentare leggermente. usage=X% vel=Y%/h (ideale Z%/h) proj=P% reset=R. Throttle: N (sleep Xs).
```

## RALLENTARE URG (KRITISCH > 100%)

```
[SENTINELLA] [URG] ORDINE: RALLENTARE. usage=X% vel=Y%/h (ideale Z%/h) proj=P% reset=R. Throttle: N (sleep Xs tra operazioni). Esegui SUBITO. Rispondi con azioni prese.
```

## ATTENZIONE WEEKLY (bindende Einschränkung verschoben, primäre noch ok)

Ausgelöst wenn S-06 erkennt, dass `proj_weekly` `proj_primary` als bindende Einschränkung übertrifft (siehe sentinella.md Regel S-06). Der Kapitän wendet C-09 an.

```
[SENTINELLA] ATTENZIONE WEEKLY. weekly_usage=W% vel_weekly=V%/h proj_weekly=PW% reset_weekly=RW. primary_proj=PP% (still MARGINE). Binding: WEEKLY. Throttle: N (sleep Xs). Causa: burn rate sostenuto sopra 0.14%/h.
```

## EMERGENZA WEEKLY (proj_weekly > 100% mit > 24h bis zum Reset)

Variante von EMERGENZA wenn der Treiber weekly ist. Verlässt das Team `.weekly-halt.flag` (siehe `freeze_team.py` / `realtime-listen`).

```
[SENTINELLA] [EMERGENZA WEEKLY] FREEZE WEEKLY. weekly_usage=W% proj_weekly=PW% reset_weekly=RW (>24h). Throttle: freeze. Causa: sat weekly anticipata. Decidi se aspettare reset o cambiare provider.
```

## RIENTRO (Status kehrt zu OK / STEADY zurück)

```
[SENTINELLA] RIENTRO. usage=X% vel=Y%/h proj=P%. Situazione sotto controllo. Throttle suggerito: N.
```

## RESET SESSIONE (Usage-Abfall > 30 Punkte)

```
[SENTINELLA] RESET SESSIONE. Budget: 100% disponibile. Prossimo reset: HH:MM. Throttle suggerito: 0. Rispondi con piano.
```

## EMERGENZA (mit bereits ausgeführtem Freeze)

```
[SENTINELLA] [EMERGENZA] FREEZATO IL TEAM. usage=X% vel=Y%/h (ideale Z%/h) proj=P% reset=R. Throttle: 4 (sleep 10min). Tutti gli agenti operativi hanno ricevuto Esc. Decidi se ripartire o aspettare reset.
```

## RECOVERY TRACKING (Info alle 3 Tick während einer Notlage)

```
[SENTINELLA] [RECOVERY TRACKING] proj=P% (Δ-X/tick negli ultimi 3 tick). ETA sotto 100%: ~N tick. Trend: {SCENDE_OK | LENTO | STAGNANTE}. Continua throttle attuale.
```

## STAGNAZIONE CRITICA (Erholung zu langsam)

```
[SENTINELLA] [URG] STAGNAZIONE CRITICA. proj=P% stabile a 150%+ da N tick (max-min: M punti). Il throttle non sta riducendo. Killa altri agenti operativi (anche Sonnet) o esegui freeze_team.py per fermare tutto. Aspetta reset finestra.
```

## PEGGIORAMENTO POST-FREEZE (proj steigt wieder, nachdem sie gesunken war)

```
[SENTINELLA] [URG] PEGGIORAMENTO POST-FREEZE. proj risalita da P_min% a P_now% (+Δ punti). Il freeze non basta. Esegui freeze_team.py SUBITO + kill anche i Sonnet rimasti. Niente più operativi fino a reset finestra.
```

## PAUSA TEAM (FATAL L4-SOFT, erster totaler Bridge-Ausfall)

```
[SENTINELLA] [PAUSA TEAM] Sistema di monitoraggio usage in failure totale: fetch HTTP (L1) + skill multi-provider (L2) + worker TUI manuale (L3) tutti falliti. NON ho dati freschi sul consumo. AZIONE PRESA: ho mandato [PAUSA] a tutti gli operativi via soft_pause_team.py. NON spawnare nuovi agenti, NON inviare nuovi ordini operativi. Aspetto BRIDGE TICK valido o INFO. Se persiste 2 cicli consecutivi escalo a HARD freeze.
```

## HARD FREEZE (FATAL L5, zweiter aufeinanderfolgender Ausfall)

```
[SENTINELLA] [HARD FREEZE] secondo FATAL consecutivo, ho mandato Esc x2 a tutti gli operativi via freeze_team.py. Resta in attesa, aspetterò il prossimo [BRIDGE TICK] valido per sbloccare.
```

## RIPRENDI (Quelle wieder aktiv nach FATAL)

```
[SENTINELLA] [RIPRENDI] sorgente usage tornata viva. usage=X% proj=Y% status=Z reset=R. Throttle suggerito: N. Ridistribuisci '[RIPRENDI]' a tutti gli agenti operativi via jht-tmux-send.
```
