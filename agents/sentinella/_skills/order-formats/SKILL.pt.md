<!-- @translation: pt, ai-translated 2026-06-06 -->
---
name: order-formats
description: Modelos para as ordens que a Sentinela envia ao Capitão. Usa esta skill sempre que decidires notificar o Capitão — escolhe o modelo correspondente, preenche os marcadores, envia via `jht-tmux-send`.
allowed-tools: Bash(jht-tmux-send *), Bash(/app/agents/_skills/tmux-send/jht-tmux-send *)
---

# Skill — Formatos de ORDEM ao Capitão

Todas as ordens são enviadas via:
```bash
/app/agents/_skills/tmux-send/jht-tmux-send CAPITANO "<messaggio>"
```

Path **absoluto** obrigatório (o PATH do CLI pode não incluí-lo).

---

## ACCELERARE (primeira ordem, abaixo do alvo)

```
[SENTINELLA] ORDINE: ACCELERARE. usage=X% vel=Y%/h (ideale Z%/h) proj=P% (sotto target 90-95). Spawn più agenti / throttle 0 sugli attivi.
```

## SCALA UP (subutilização grave prolongada)

```
[SENTINELLA] ORDINE: SCALA UP. usage=X% vel=Y%/h (ideale Z%/h) proj=P% in SOTTOUTILIZZO da N tick. C'è budget per +1 agente. Spawna agente sul collo di bottiglia (consulta DB per coda più alta) e aspetta il prossimo tick.
```

## PUSH G-SPOT (perto do alvo mas estagnados)

```
[SENTINELLA] ORDINE: PUSH G-SPOT. usage=X% vel=Y%/h (ideale Z%/h) proj=P% (vicini al G-spot da N tick, manca poco). Aggiungi UN agente leggero (consulta DB per coda più alta) per spingere proj sopra 90%. Throttle: 0.
```

## MANTIENI (G-spot atingido, 3 tick STEADY)

```
[SENTINELLA] ORDINE: MANTIENI. usage=X% vel=Y%/h (ideale Z%/h) proj=P% (zona G-spot 90-95). Throttle: 0. NON scalare, NON rallentare, lascia che il team lavori.
```

## RALLENTARE (ATENÇÃO leve 95-100%)

```
[SENTINELLA] ORDINE: rallentare leggermente. usage=X% vel=Y%/h (ideale Z%/h) proj=P% reset=R. Throttle: N (sleep Xs).
```

## RALLENTARE URG (CRÍTICO > 100%)

```
[SENTINELLA] [URG] ORDINE: RALLENTARE. usage=X% vel=Y%/h (ideale Z%/h) proj=P% reset=R. Throttle: N (sleep Xs tra operazioni). Esegui SUBITO. Rispondi con azioni prese.
```

## ATTENZIONE WEEKLY (restrição vinculante mudou, primária ainda ok)

Emitido quando S-06 deteta que `proj_weekly` ultrapassa `proj_primary` como restrição vinculante (ver sentinella.md regra S-06). O Capitão aplica C-09.

```
[SENTINELLA] ATTENZIONE WEEKLY. weekly_usage=W% vel_weekly=V%/h proj_weekly=PW% reset_weekly=RW. primary_proj=PP% (still MARGINE). Binding: WEEKLY. Throttle: N (sleep Xs). Causa: burn rate sostenuto sopra 0.14%/h.
```

## EMERGENZA WEEKLY (proj_weekly > 100% com > 24h até o reset)

Variante de EMERGENZA quando o driver é weekly. Sai da equipa `.weekly-halt.flag` (ver `freeze_team.py` / `realtime-listen`).

```
[SENTINELLA] [EMERGENZA WEEKLY] FREEZE WEEKLY. weekly_usage=W% proj_weekly=PW% reset_weekly=RW (>24h). Throttle: freeze. Causa: sat weekly anticipata. Decidi se aspettare reset o cambiare provider.
```

## RIENTRO (estado volta a OK / STEADY)

```
[SENTINELLA] RIENTRO. usage=X% vel=Y%/h proj=P%. Situazione sotto controllo. Throttle suggerito: N.
```

## RESET SESSIONE (queda de usage > 30 pontos)

```
[SENTINELLA] RESET SESSIONE. Budget: 100% disponibile. Prossimo reset: HH:MM. Throttle suggerito: 0. Rispondi con piano.
```

## EMERGENZA (com freeze já executado)

```
[SENTINELLA] [EMERGENZA] FREEZATO IL TEAM. usage=X% vel=Y%/h (ideale Z%/h) proj=P% reset=R. Throttle: 4 (sleep 10min). Tutti gli agenti operativi hanno ricevuto Esc. Decidi se ripartire o aspettare reset.
```

## RECOVERY TRACKING (info a cada 3 tick durante emergência)

```
[SENTINELLA] [RECOVERY TRACKING] proj=P% (Δ-X/tick negli ultimi 3 tick). ETA sotto 100%: ~N tick. Trend: {SCENDE_OK | LENTO | STAGNANTE}. Continua throttle attuale.
```

## STAGNAZIONE CRITICA (recuperação demasiado lenta)

```
[SENTINELLA] [URG] STAGNAZIONE CRITICA. proj=P% stabile a 150%+ da N tick (max-min: M punti). Il throttle non sta riducendo. Killa altri agenti operativi (anche Sonnet) o esegui freeze_team.py per fermare tutto. Aspetta reset finestra.
```

## PEGGIORAMENTO POST-FREEZE (proj volta a subir depois de ter descido)

```
[SENTINELLA] [URG] PEGGIORAMENTO POST-FREEZE. proj risalita da P_min% a P_now% (+Δ punti). Il freeze non basta. Esegui freeze_team.py SUBITO + kill anche i Sonnet rimasti. Niente più operativi fino a reset finestra.
```

## PAUSA TEAM (FATAL L4-SOFT, primeira falha total do bridge)

```
[SENTINELLA] [PAUSA TEAM] Sistema di monitoraggio usage in failure totale: fetch HTTP (L1) + skill multi-provider (L2) + worker TUI manuale (L3) tutti falliti. NON ho dati freschi sul consumo. AZIONE PRESA: ho mandato [PAUSA] a tutti gli operativi via soft_pause_team.py. NON spawnare nuovi agenti, NON inviare nuovi ordini operativi. Aspetto BRIDGE TICK valido o INFO. Se persiste 2 cicli consecutivi escalo a HARD freeze.
```

## HARD FREEZE (FATAL L5, segunda falha consecutiva)

```
[SENTINELLA] [HARD FREEZE] secondo FATAL consecutivo, ho mandato Esc x2 a tutti gli operativi via freeze_team.py. Resta in attesa, aspetterò il prossimo [BRIDGE TICK] valido per sbloccare.
```

## RIPRENDI (fonte volta a estar ativa depois de FATAL)

```
[SENTINELLA] [RIPRENDI] sorgente usage tornata viva. usage=X% proj=Y% status=Z reset=R. Throttle suggerito: N. Ridistribuisci '[RIPRENDI]' a tutti gli agenti operativi via jht-tmux-send.
```
