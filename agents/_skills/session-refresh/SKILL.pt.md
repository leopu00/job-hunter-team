---
name: session-refresh
description: "Apenas para o Doctor. Rodada de context-refresh: para cada sessão de agente leia a ocupação real do seu contexto (comando client-side do provider, zero tokens) e renove APENAS as sessões cuja janela de contexto esteja cheia acima de 50% — faça uma retrospectiva (captura + entrevista + analytics), anexe uma síntese densa ao journal diário em crescimento, depois MATE + recrie + retome a sessão com contexto de continuação, para que sua janela de contexto seja limpa sem perder onde ela estava. Roda 2× por janela de trabalho (em +30min e no meio). Pula sessões recentes, de baixo contexto (≤50%) e as que o Capitano parqueou — EXCETO além do TTL de 12h da sessão (JHT_AGENT_MAX_SESSION_AGE_H), que prevalece sobre qualquer salto: só a idade decide, sem exceções."
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
- **Ordem**: sessões worker PRIMEIRO (`SCOUT-N · ANALISTA-N · SCORER-N · SCRITTORE-N · CRITICO-S*`), os coordenadores POR ÚLTIMO e com cuidado (`ASSISTENTE · MENTOR · SENTINELLA · CAPITANO`). "Com cuidado" significa **capturar bem o estado deles e compactá-los — NÃO pulá-los** (são os top consumidores; veja Regras). Nunca renove `DOTTORE` / `DOCTOR-WATCHDOG` (você mesmo / o scheduler).
- **FRESH skip** (pré-filtro barato antes da verificação de contexto): `age = now - session_created`. Se `age < 40 min` → PULE inteiramente (ainda não há nada para resumir, e renovar descartaria uma sessão que acabou de começar). Registre `action=skipped_fresh`. Tudo o que passar por este pré-filtro segue para o **Step 1.4 (TTL)** e depois para o **Step 1.5 (verificação de contexto)** — é aquela medição `>50%`, não a idade, que decide a renovação *ordinária*.

## Step 1.4 — TTL: **toda sessão de agente vive no máximo 12 horas**
```bash
TTL_H="${JHT_AGENT_MAX_SESSION_AGE_H:-12}"
AGE_H=$(( ( $(date -u +%s) - $(tmux display-message -p -t "$S" '#{session_created}') ) / 3600 ))
[ "$AGE_H" -ge "$TTL_H" ] && echo "TTL EXPIRADO ($AGE_H h) → renovação OBRIGATÓRIA"
```
**Se `AGE_H ≥ TTL_H` a sessão é renovada. Ponto.** O TTL é verificado **antes** de tudo o mais e **anula todos os saltos previstos nesta skill** — sem exceção, sem derrogação, sem «mas»:

| salto normal | além do TTL |
|---|---|
| `skipped_fresh` (age < 40min) | impossível além das 12h, mas o TTL vence de qualquer forma |
| `skipped_lowctx` (contexto ≤ 50%) | **ignorado** — uma sessão a 4% após 30h é recriada na mesma |
| `skipped_parked` (PARKED, Step 4) | **ignorado** — parqueada ou não, o TTL aplica-se |
| «o agente está a trabalhar» | **ignorado** — captura o seu estado no seed e recria |
| fora da janela de trabalho | **ignorado** — o TTL nunca é suspenso (ver Regras) |

Registe `action=recreated` com `reason=ttl` e o `session_age_h` medido. Depois vá direto aos Steps 2 → 7 (captura, analytics, síntese, recriar + retomar): **salte por completo o Step 1.5 e o Step 4**, só podem produzir um salto e aqui o salto não está disponível.

Porquê só a idade, sem heurísticas de saúde por cima: no incidente de 2026-07-28/29 as sessões tinham **38,5 · 29,5 · 27,0 · 14,5 · 14,2 horas**, todas as heurísticas diziam «saudável» e a equipa estava paralisada há onze horas. Os contextos estavam abaixo dos 50%, portanto nenhuma regra lhes tocou. Um TTL não tem heurísticas para errar.

## Step 1.5 — VERIFICAÇÃO DE CONTEXTO (o trigger da renovação *ordinária*: **>50%**)
Apenas para as sessões que **não** dispararam o TTL no Step 1.4.
**Renove APENAS as sessões cuja janela de contexto esteja cheia acima de 50%.** Leia a ocupação real com o comando de contexto **client-side** do provider — custa **zero tokens** (renderizado localmente, sem chamada ao LLM) e é instantâneo. A idade NÃO é mais o trigger: uma sessão velha-mas-vazia (ex.: um Mentor ocioso a 2%) deve ser PULADA, uma sessão inchada deve ser renovada.

Dois requisitos taxativos — ignorá-los faz *queimar* orçamento em vez de economizá-lo:
- A sessão DEVE estar **ociosa** (sem turno ativo). Se um spinner / `esc to interrupt` estiver aparecendo, está trabalhando → PULE esta rodada (o próximo Doctor a pega). Nunca envie teclas no meio de um turno.
- **Esvazie primeiro a linha de entrada.** Caso contrário o comando se concatena com o texto residual e é submetido como prompt ao LLM (queima tokens). Envie `Escape` e depois `C-u` antes de digitar.

```bash
S=<session>
# provider → command:  claude → /context   ·   codex → /status   ·   kimi → (verify on its TUI)
tmux send-keys -t "$S" Escape; sleep 1
tmux send-keys -t "$S" C-u;    sleep 1          # clear the input line (mandatory)
tmux send-keys -t "$S" "/context"; sleep 1
tmux send-keys -t "$S" Enter;  sleep 3
PCT=$(tmux capture-pane -p -t "$S" | grep -aoE '[0-9.]+k?/[0-9.]+[km] tokens \([0-9]+%\)' | tail -1 | grep -aoE '\([0-9]+%\)' | tr -dc '0-9')
tmux send-keys -t "$S" Escape                   # dismiss the panel
echo "context=$PCT%"
```
Decida a partir de `$PCT` (extraído de uma linha como `24.9k/1m tokens (2%)`):
- **`PCT` ≤ 50** → PULAR **a menos que o TTL tenha disparado no Step 1.4**. NÃO recrie uma sessão abaixo do TTL, mesmo que seja velha. Registre `action=skipped_lowctx` com a `%` medida. Passe para a próxima sessão.
- **`PCT` > 50** → prossiga para a renovação (Steps 2–7).
- **o comando não renderizou / o parse falhou** → recaia na heurística de idade (`age ≥ 40min` → renovar) e registre `ctx=unparsed`.

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

**Duas exceções taxativas ao PARKED — esta regra descrevia o incidente à letra e manteve as mãos do Doctor atadas exatamente quando a equipa mais precisava:**
1. **Além do TTL (Step 1.4) o PARKED não se aplica.** Parqueada ou não, uma sessão de 12h+ é recriada.
2. **Um agente bloqueado não é um agente parqueado.** «não fresca + produced == 0 + nenhuma mensagem recente do Capitano» é também a impressão digital exata de uma equipa com a coordenação partida. O sinal objetivo que os separa: **um agente que insiste com outro agente sem obter resposta não está parqueado, está bloqueado** (as entradas `retry_loop` do scan de `agent-unblock`, e no pane veem-se as tentativas). O mesmo para «todos os operacionais parados com quota disponível». Nesses casos NÃO registe `skipped_parked` — desfaça o bloqueio (`agent-unblock`) e depois continue a rodada.

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
  "action": "recreated",         # recreated | skipped_lowctx | skipped_parked | skipped_fresh
  "context_pct": 0,              # ocupação de contexto medida no Step 1.5 (o gate >50%)
  "resume_msg_sent": False,
}
with open(journal, "a") as f:
    f.write(json.dumps(entry, ensure_ascii=False) + "\n")
print("appended", session)
PY
```

## Step 7 — recriar + retomar (se o TTL disparou, OU contexto **>50%** e NÃO fresh, NÃO parked)
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
- **O TTL de 12h não tem brechas nem interruptor.** `JHT_AGENT_MAX_SESSION_AGE_H`, por omissão `12`. Nem PARKED, nem skip-fresh, nem o limiar de contexto, nem «está a trabalhar», nem o gate horário o podem anular. **Escalone-o**: as sessões nascem em vagas e expirariam juntas — renove no máximo UMA sessão além do TTL por passagem, ordenando por idade **decrescente**, assim a mais velha vai primeiro e a equipa nunca é recriada toda de uma vez.
- **Fora da janela de trabalho a rodada não corre — mas o TTL sim.** À noite a rodada é saltada porque entrevistar agentes queimaria orçamento para nada; uma sessão de 30 horas é recriada na mesma, porque um kick-off não custa nada face a um dia perdido. O `agent-watchdog.sh` impõe o mesmo teto de forma determinística (mesma env var) para quando o Doctor está parado, bloqueado ou nunca foi lançado — que é exatamente o que aconteceu a 2026-07-28/29. Ambos os caminhos devem existir: este é a renovação *rica* (retrospetiva + resume), aquele é a rede que garante o teto a qualquer custo.
- **`working_hours: null` (ou ausente, ou vazio) significa NENHUMA restrição horária** — a equipa é 24/7 e a rodada corre normalmente. Nunca significa «sempre fora de horas». No incidente `working_hours` era null precisamente porque a resposta do utilizador sobre o fuso horário era a linha pendurada no composer do Capitano.
- **Desbloqueie antes de renovar.** Execute primeiro a fase `agent-unblock`: renovar uma equipa paralisada recria a paralisia com uma janela de contexto limpa.
- **Um único Doctor faz todas as sessões nesta rodada** (ordem do usuário: um único Doctor por enquanto). Use a captura baseada em arquivo + grep para nunca estourar sua própria janela de contexto.
- **CAPITANO e SENTINELLA são os TOP consumidores de token** (o contexto deles está quase sempre inchado — a Sentinella faz tick a cada ~15min, o Capitano coordena continuamente). Ainda assim passam pelo **gate de contexto >50%** como todos os demais (Step 1.5) — mas na prática medem bem acima de 50%, então são renovados quase toda rodada. Faça-os por **último** (depois dos workers) e **compacte, não resete** — o refresh com síntese densa preserva a continuidade, um kill seco a perde. Se um medir ≤50% (raro), pule-o naquela rodada como qualquer outra sessão de baixo contexto.
- **CAPITANO**: é o coordenador com estado in-flight (atribuições de worker, throttle ativo, última ordem de pacing, decisões pendentes). Na entrevista (Step 5) capture explicitamente esse estado de coordenação e coloque-o no seed (Step 7) para que ele não perca o fio. **Se `$JHT_HOME/profile/capitano-maintenance.json` existir, leia-o e coloque também no seed as suas `orders` ativas (modo de manutenção + `stop_search` / `discard_expired_rotating` / weekly-recheck / geocoding)** — retirar essa ordem de manutenção do seed silenciou uma semana inteira de manutenção em 2026-07-12 (o Capitano depois relê o arquivo de qualquer forma pela sua própria regra C-18, mas leve-a adiante para que nunca dependa disso). Faça por ÚLTIMO; se estiver gerenciando uma EMERGENZA ao vivo (orquestração visível no pane neste momento), deixe que se estabilize primeiro, caso contrário compacte-o.
- **SENTINELLA**: é **near-stateless** — o seu estado operativo vive no bridge/config e em `sentinel-data.jsonl`, não na sua chat. Isso a torna a **mais segura e de maior valor para compactar**: renove-a a cada rodada, por último, com um seed mínimo: `[RESUME] sei la Sentinella; il tuo stato vive nel bridge + sentinel-data.jsonl — riprendi il monitoraggio del pacing dal prossimo tick.` O recreate por idade do `agent-watchdog` (além de `JHT_SENTINELLA_MAX_CTX_AGE_H`, default 24h) permanece apenas como **fallback** para quando o Dottore não estiver rodando; como agora você a compacta a cada rodada, ela não alcançará essa idade, portanto sem race.
- **Nunca** faça `tmux new-session` à mão — sempre `start-agent.sh` (veja `spawn-agent`).
- Registre cada ação no journal (`recreated`/`skipped_lowctx`/`skipped_parked`/`skipped_fresh`) com a `context_pct` medida — o journal é a trilha de auditoria e cresce todo dia.
