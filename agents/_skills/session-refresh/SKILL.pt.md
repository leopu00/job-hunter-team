---
name: session-refresh
description: "Apenas para o Doctor. Rodada de context-refresh: para cada sessão de agente faça uma retrospectiva (idade + captura ampla + entrevista + analytics), anexe uma síntese densa ao journal diário em crescimento, depois MATE + recrie + retome a sessão com contexto de continuação — para que a janela de contexto do agente seja limpa sem perder onde ele estava. Roda 2× por janela de trabalho (em +30min e no meio). Pula sessões recentes e nunca reinicia uma sessão que o Capitano parqueou deliberadamente."
allowed-tools: Bash(tmux *), Bash(python3 *), Bash(bash /app/.launcher/start-agent.sh *), Bash(jht-tmux-send *), Bash(/app/agents/_skills/tmux-send/jht-tmux-send *), Bash(sleep *), Bash(cat *), Bash(grep *), Bash(echo *)
---

# session-refresh — limpar o contexto do agente, manter a continuidade

Você (o Dottore) é instanciado em um slot agendado (`+30min` a partir do início da janela de trabalho, ou no `mid` da janela). Sua tarefa nesta rodada **não** é fazer liveness-ping — é **renovar o contexto** das sessões de agente ativas: cada sessão de longa duração acumula uma janela de contexto inchada; você resume o que ela fez, persiste isso, depois recria a sessão do zero e devolve a continuação.

> Por que isso existe: o antigo Dottore queimava ~51% do orçamento do team fazendo ping `[HEALTH]` a cada 2h com zero verificações úteis. Esta rodada é rara (2×/janela) e produz um journal durável e denso do trabalho do team.

## Step 0 — início da janela (a janela de analytics)
```bash
WIN_START=$(python3 -c "import sys; sys.path.insert(0,'/app'); from shared.skills.working_hours import current_window_bounds as b; w=b(); print(w[0].isoformat() if w else '')")
# 24/7 (no window): fall back to the last 6h
[ -z "$WIN_START" ] && WIN_START=$(python3 -c "import datetime; print((datetime.datetime.now(datetime.timezone.utc)-datetime.timedelta(hours=6)).isoformat())")
ROUND_ID=$(date -u +%Y%m%dT%H%M%SZ)
DAY=$(date -u +%F)
JOURNAL=/jht_home/logs/doctor-retrospective.jsonl
```

## Step 1 — liste as sessões + idade, decida a ordem
```bash
tmux list-sessions -F '#{session_name}|#{session_created}'
```
- **Ordem**: sessões worker PRIMEIRO (`SCOUT-N · ANALISTA-N · SCORER-N · SCRITTORE-N · CRITICO-S*`), as voltadas ao usuário POR ÚLTIMO e com cuidado (`ASSISTENTE · MENTOR · SENTINELLA · CAPITANO`). Nunca renove `DOTTORE` / `DOCTOR-WATCHDOG` (você mesmo / o scheduler).
- **FRESH skip**: `age = now - session_created`. Se `age < 40 min` → PULE inteiramente (ainda não há nada para resumir, e renovar descartaria uma sessão que acabou de começar). Registre `action=skipped_fresh`.

## Step 2 — por sessão: capture (ampla + saliente)
Capture o scrollback INTEIRO uma vez, depois as linhas salientes — NÃO carregue milhares de linhas no seu próprio contexto, faça grep dos destaques:
```bash
tmux capture-pane -p -S - -t "$S" > /tmp/cap_$S.txt          # full scrollback to file
tail -n 60 /tmp/cap_$S.txt                                    # recent state
grep -nE '\[ERROR\]|Traceback|throttle|EXCLUDED|inserted|\[FEEDBACK\]|\[RETRO\]|spawn|Killed' /tmp/cap_$S.txt | tail -40   # salient moments
```

## Step 3 — analytics (números objetivos, não apenas a versão do agente)
```bash
python3 /app/shared/skills/doctor_analytics.py "$S" "$WIN_START"
```
Retorna JSON: `produced{found,analyzed,scored,written,reviewed}`, `communications{sent,received,top_peers}`, `throttles{events,max_sleep_s}`, `last_captain_msg`, `session_age_h`, `role`, `instance`.

## Step 4 — verificação PARKED (orientada por dados, NÃO adivinhe)
Uma sessão está **PARKED** (o Capitano deliberadamente a deixou ligada mas não a está usando — ex.: um Scout que sobrou da janela anterior e que o Capitano não atribuiu hoje) quando **todas** as condições valem:
- age ≥ 40min (não fresh), E
- `produced` é tudo-zero na janela, E
- `last_captain_msg` é null ou mais antigo que o início da janela.

Se PARKED → **NÃO recrie para reiniciá-la**. Escreva a síntese (Step 6) com `action=skipped_parked` e siga adiante. (Recriá-la transformaria um park deliberado em trabalho que o Capitano não queria.) Se você de fato a recriar por higiene, a mensagem de resume DEVE dizer que ela estava ociosa: `[RESUME] you were in STANDBY — stay idle until the Capitano assigns you a queue.`

## Step 5 — entreviste o agente
```bash
/app/agents/_skills/tmux-send/jht-tmux-send "$S" "[@dottore -> @${s_lower}] [RETRO] Inizio-giornata: 1) intoppi in questa sessione? 2) imparato qualcosa di utile? 3) cosa stavi facendo proprio ora (per il resume)? Rispondi denso, 3-4 righe."
sleep 45
tmux capture-pane -p -S -40 -t "$S" | tail -25   # read the reply
```
(Pule a entrevista para sessões PARKED/fresh — não há nada em andamento sobre o que perguntar.)

## Step 6 — anexe a síntese DENSA (somente-append, cresce diariamente)
Uma entrada JSONL por agente por rodada. Combine analytics + entrevista em um resumo conciso. NUNCA sobrescreva — múltiplos Doctors ao longo do dia todos fazem append.
```bash
python3 - "$S" "$ROUND_ID" "$DAY" "$JOURNAL" <<'PY'
import json, sys, datetime
session, round_id, day, journal = sys.argv[1:5]
entry = {
  "ts": datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00","Z"),
  "round_id": round_id, "day": day,
  "timing": "start+30",          # or "mid"  — set to the slot you were spawned for
  "session": session, "role": "<role>", "session_age_h": 0.0,
  "analytics": { },              # paste the doctor_analytics.py JSON here
  "interview": {"intoppi": "...", "imparato": "...", "summary_denso": "..."},
  "action": "recreated",         # recreated | skipped_parked | skipped_fresh
  "resume_msg_sent": False,
}
with open(journal, "a") as f:
    f.write(json.dumps(entry, ensure_ascii=False) + "\n")
print("appended", session)
PY
```

## Step 7 — recriar + retomar (apenas se NÃO fresh e NÃO parked)
Refresh atômico — você já capturou o contexto no Step 2, então matar é seguro:
```bash
ROLE=<role>; N=<instance>      # from analytics; recreate the SAME number (no dice — the die is for NEW spawns only)
tmux kill-session -t "$S"
bash /app/.launcher/start-agent.sh "$ROLE" "$N"
sleep 8
/app/agents/_skills/tmux-send/jht-tmux-send "$S" "[@dottore -> @${s_lower}] [RESUME] Contesto pre-refresh: stavi facendo <X>; avevi completato <Y> (analytics: produced=<...>); il prossimo passo era <Z>. Riprendi da li'. Coda: <next-for-role>."
```
Defina `resume_msg_sent=True` na entrada do journal. Depois passe para a próxima sessão (ritmo ~15-20s entre agentes).

## Regras
- **Um único Doctor faz todas as sessões nesta rodada** (ordem do usuário: um único Doctor por enquanto). Use a captura baseada em arquivo + grep para nunca estourar sua própria janela de contexto.
- **Nunca** recrie `CAPITANO`/`SENTINELLA` levianamente — eles são a orquestração/heartbeat; só os renove se o contexto deles estiver claramente inchado e após um aviso prévio, por último na ordem.
- **Nunca** faça `tmux new-session` à mão — sempre `start-agent.sh` (veja `spawn-agent`).
- Registre cada ação no journal (`recreated`/`skipped_parked`/`skipped_fresh`) — o journal é a trilha de auditoria e cresce todo dia.
