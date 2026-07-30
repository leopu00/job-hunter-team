<!-- @translation: pt, ai-translated 2026-07-28 -->
---
name: throttle-distribution
description: Decida QUEM abranda e EM QUANTO quando o consumo da equipa tem de mudar. Abra-a quando um aviso `[PACE-GUARD]` chegar ao seu painel, quando a Sentinella ordenar um nível `Throttle: N`, ou quando uma verificação sua disser que a janela está fora de ritmo. Cada um desses sinais é um único número ao nível da equipa; o atuador é por agente, e escolher a repartição por agente é só seu — nenhum script mexe já no throttle dos workers. Também lhe diz quando o certo é não tocar em nada.
allowed-tools: Bash(python3 *), Bash(jht-tmux-send *)
---

# throttle-distribution — quem abranda, e em quanto

Cada sinal de pacing que lhe chega é um único número para toda a equipa: *"35% demasiado rápido"*, *"Throttle: 2"*, *"aconselhado 780s"*. O atuador não é um único número — é um valor por agente em `throttle.json`, e **é o único a escrevê-lo**. Nenhum script mexe já no throttle dos workers por conta própria.

O trabalho desta skill é essa conversão, e tem uma só regra dura: **um número ao nível da equipa não significa que todos recebem o mesmo valor.** Um Scout pode ser 52% do consumo enquanto um Escritor parado é 2%; o Analista e o Scorer são os dois papéis que transformam um atraso na única coisa que o utilizador vê de facto — uma posição **com pontuação**. Nivelar gasta o travão onde não há nada a ganhar e tira débito onde ele custa mais caro.

## Quando abrir esta skill

| Gatilho | De onde vem | Vá a |
|---|---|---|
| `[PACE-GUARD] … NON APPLICATO` no seu painel | a bridge: compara o consumo com a curva da janela em cada sample de usage, e só lhe escreve quando há algo sobre o qual agir | §1 |
| `[SENTINELLA] [URG] RALLENTARE — Throttle: N`, ou qualquer sinal de pacing que ela lhe reencaminhe | ela recebe o tick `[BRIDGE PACING]` de 15 min (chega ao painel **dela**, não ao seu), lê-o, e decide se vale a pena acordá-lo | §3 — o "quanto" está decidido, a repartição não. `bridge-pacing` descodifica os números dela |
| `[HEARTBEAT]` que mencione weekly/consumo, ou uma consulta sua a `rate-budget` / `agent-speed-table` | você, por iniciativa própria | §2 |

> ⚠️ **Não lhe fazem ping de 15 em 15 minutos, e não deve ficar à espera disso.** Mantê-lo sossegado é deliberado: se todas as bridges do escritório lhe reportassem diretamente, gastaria o orçamento a ler em vez de decidir, e ele arderia enquanto o utilizador dorme. O tick de 15 min vai para a Sentinella, que filtra e só então o incomoda. Portanto **conduza pelas condições que observa** — não fique parado à espera de um tick que não lhe é dirigido. Se uma linha de pacing lhe chegar mesmo diretamente, ou é um `[PACE-GUARD]` ou é uma escalada a avisar que a Sentinella deixou de responder (isso é um problema de liveness, não um veredito de pacing — `agent-emergency`).

---

## 1. Ler o aviso `[PACE-GUARD]`

Uma única linha física, campos separados por ` | ` (aqui partida para leitura):

```
[@bridge -> @capitano] [PACE-GUARD] <VERDETTO> — CONSIGLIO, THROTTLE NON APPLICATO |
  usage=<U>% vs curva=<I>% (<±D>pt sul target <T>% al reset) | reset fra <M> min |
  throttle worker ORA <C>s → CONSIGLIATO <R>s (<±S> gradini) | worker: <a1, a2, ...> |
  decidi tu e applica: python3 /app/shared/skills/throttle-config.py bulk-set <a1>=<R> <a2>=<R>
```

Âncoras estáveis caso tenha de a reconhecer num painel ruidoso: a etiqueta `[PACE-GUARD]`, as palavras `NON APPLICATO` e `CONSIGLIATO <R>s`.

| Campo | O que lhe diz |
|---|---|
| `<VERDETTO>` | `AVANTI` (acima da curva) / `INDIETRO` (abaixo) / `IN-PARI` / `LOCKOUT-IMMINENTE` |
| `usage=<U>% vs curva=<I>%` | onde está face a onde a reta ideal `usage = alvo × decorrido / janela` diz que deveria estar agora |
| `<±D>pt` | o desvio em pontos de orçamento. **Abaixo de ±6pt é ruído de medição** — é o próprio degrau do guard |
| `sul target <T>% al reset` | o alvo para o qual a curva aponta. É o `<T>` de que precisa no §2 |
| `reset fra <M> min` | quanta janela resta. É isto que transforma um desvio numa urgência |
| `ORA <C>s → CONSIGLIATO <R>s` | o throttle atual dos workers e o **único valor de grupo** do guard, em segundos |
| `worker: …` | os workers vivos sobre os quais o conselho foi calculado. Os isentos do piso já estão **excluídos** — não volte a filtrar |

Duas variantes:
- em `LOCKOUT-IMMINENTE` aparece um campo extra **antes** do último: `il freno da solo non basta: valuta di ridurre il ROSTER (togli uno Scout, mai l'Analista o lo Scorer)`.
- se todos os workers vivos estiverem isentos do piso, o último campo passa a ser `nessun worker su cui agire (tutti esenti dal floor): decidi tu`.

> ⚠️ **O valor aconselhado é um nível, não uma repartição — e o `bulk-set` no fim da linha é uma sugestão, não uma ordem.** O guard deriva esse número do worker **mais travado** e move-o um degrau por cada ~6 pontos de desvio, e depois oferece-o a todos os workers de uma vez. Colar esse comando *é* o nivelamento. Leia a linha como *"mais ou menos esta taxa tem de desaparecer"*, e depois decida *de quem* (§3) e *quanto* (§4).

`LOCKOUT-IMMINENTE` (usage ≥95% **e** ainda acima da curva) é o único veredito que não é sobre o throttle: a janela está a fechar mais cedo, o travão já está perto do teto e a alavanca que resta é o **roster** — mate um Scout. Nunca o Analista nem o Scorer: sem eles nada é pontuado e o utilizador vê um ecrã vazio.

Se o seu painel estava ocupado, a linha também está na caixa de correio: `python3 /app/shared/skills/bridge_mailbox.py drain`, entradas com `kind:"pace-guard"`. Aplique só a **última** — repetir conselhos velhos é lutar contra as suas próprias calibrações passadas.

---

## 2. Quanta taxa tem de desaparecer

Se o sinal foi uma ordem `Throttle: N` da Sentinella, o "quanto" já está decidido — salte para o §3. Caso contrário, uma linha:

```
vel_needed = (<T> − usage) / horas_até_ao_reset         # a taxa que aterra exatamente no alvo
f_team     = (vel_now − vel_needed) / vel_now × 100     # a parte da taxa da equipa a retirar
```

`vel_now` é a taxa atual da equipa em pontos % de orçamento por hora: tire-a de `agent-speed-table.py` (`team.speed_pct_per_h`, §3) ou de `rate-budget`. `f_team ≤ 0` significa que tem margem → §5.

> 💡 **O mesmo desvio significa coisas diferentes consoante a janela que resta**, e é exatamente isso que o fixo "um degrau por cada 6 pontos" do guard não consegue ver. `+18pt` com 3 horas pela frente é uma correção de 7%/h: um agente, um degrau acima. `+18pt` com 20 minutos pela frente é uma correção de 54%/h, que nenhum throttle consegue entregar — aí é uma decisão de roster, ou um fecho antecipado aceite. Divida sempre o desvio pelas horas restantes antes de decidir quanto carregar.

---

## 3. QUEM paga — a repartição

O cerne desta skill. Três entradas, por esta ordem.

**a. Quem está a gastar.** O throttle devolve orçamento em proporção estrita ao que um agente está de facto a consumir. Reduzir a metade um agente que é 2% da taxa da equipa devolve 1%: uma escrita de config, um degrau e um turno seu gastos para nada. É por isso que a resposta a "a equipa está 35% demasiado rápida" nunca é "todos a descer 35%".

As quotas por agente vivem no tick de 15 min, que chega à Sentinella — por isso vá buscá-las você mesmo:

```bash
python3 /app/shared/skills/agent-speed-table.py --since-min 60
```

Por agente devolve `pct_per_h` (pontos de orçamento por hora) e `team_share_pct`, mais `throttle_options` (quanto pouparia uma dada pausa por hora). Salta quem estiver abaixo de 0.20 %/h pela mesma razão pela qual você deveria saltá-lo: aplicar-lhe throttle não muda nada.

**b. Quem está a produzir.**

```bash
python3 /app/shared/skills/db_query.py stats
```

Leia `UNSCORED` (posições − pontuações) como a fila atrás do Analista/Scorer, e a fila do Escritor como procura conduzida pelo utilizador. Um Scout que queima 52% do orçamento com `UNSCORED = 40` está a comprar entrada que ninguém consegue consumir ainda — a coisa mais barata do tabuleiro para abrandar. O mesmo Scout com `UNSCORED = 0` alimenta toda a pipeline, e abrandá-lo impede a equipa de produzir seja o que for.

**c. A grelha.**

| | **A produzir** | **Parado / bloqueado** |
|---|---|---|
| **Quota alta** | abrande-o, mas **um degrau**, e volte a medir — está a pagar-se a si próprio | **o primeiro a abrandar, e com força** — e se já está alto na escada e continua a queimar sem produzir, a alavanca é o KILL, não mais um degrau |
| **Quota baixa** | não lhe toque: não ganha orçamento e perde débito | também não lhe toque: já não está a gastar nada, travá-lo não devolve nada |

Por cima da grelha, a assimetria dos papéis: os últimos que abranda são os que convertem um atraso existente numa posição **com pontuação** (Analista, Scorer) — são a diferença entre "50 posições encontradas" e algo sobre o qual o utilizador pode agir. O primeiro é o que gera nova entrada em bruto quando a fila a jusante já está funda (Scout). Um Escritor com a fila vazia não é alavanca em nenhum dos sentidos.

**Concentre-se num ou dois agentes.** A escada é grosseira — entre degraus vão de 20 a 60% — por isso um corte espalhado por cinco agentes cai dentro do ruído para cada um, ao passo que o mesmo corte no agente de maior quota é uma mudança real e mensurável no sinal seguinte.

**Quando travar dois, dê-lhes degraus diferentes.** A escada está em minutos primos (1, 2, 3, 5, 7, 11, 13, 17, 23, 31, 41, 53, 60) de propósito: dois workers em pausa no mesmo valor voltam a sincronizar-se por construção, e os seus checkpoints caem juntos numa rajada de pedidos simultâneos. `scout-1=660` + `analista-1=780` (11 e 13 min) colidem muito menos do que ambos a 780.

---

## 4. QUANTO nesse agente — e o comando

Precisa da **cadência** `c` do agente: quantas vezes por minuto chega a um checkpoint (chamada `jht-throttle`). Conte-a a partir do log:

```bash
python3 - <<'PY'
import collections, json, os, pathlib, time
p = pathlib.Path(os.environ.get("JHT_HOME", "/jht_home")) / "logs/throttle-events.jsonl"
cut = time.time() - 3600
c = collections.Counter()
for line in p.read_text(encoding="utf-8").splitlines():
    try:
        e = json.loads(line)
    except ValueError:
        continue
    if e.get("event") in ("checkpoint", "start") and e.get("ts_unix", 0) >= cut:
        c[e.get("agent")] += 1
for a, n in c.most_common():
    print(f"{a}: {n} chk/h -> cadência {n/60:.2f}/min")
PY
```

Depois, para cortar a taxa desse agente numa fração `f_a`, a partir do seu throttle atual `T_now`:

```
f_a   = f_team / share_a           # todo o corte da equipa, suportado só por este agente
ΔT    = (60 / c) × f_a / (1 − f_a) # segundos a ACRESCENTAR ao seu throttle atual
T_new = T_now + ΔT                 # depois escolhe você o degrau mais próximo
```

`60/c` são os segundos-por-checkpoint atuais do agente. O `f/(1−f)` não é enfeite: a pausa também empurra o checkpoint seguinte para mais longe, logo a cadência desce à medida que trava. Uma estimativa linear (`ΔT = f × 60/c`) promete um corte que não entrega.

Degraus, em segundos: `60 120 180 300 420 660 780 1020 1380 1860 2460 3180 3600`. O `throttle-config.py` encaixa no mais próximo qualquer valor que lhe passe, portanto **escolha você o degrau** — caso contrário não saberá o que pediu de facto. Verifique com `dump`, que imprime os valores efetivos.

**Sem cadência disponível?** Avance exatamente **um degrau** e volte a medir no sinal seguinte. A escada é suficientemente grosseira para que um degrau seja sempre um passo significativo e limitado, e isso é claramente melhor do que adivinhar um número que não pode verificar.

### Exemplo resolvido — distribuir em vez de nivelar

```
[PACE-GUARD] AVANTI — CONSIGLIO, THROTTLE NON APPLICATO | usage=58% vs curva=40% (+18pt sul target 100% al reset) |
  reset fra 180 min | throttle worker ORA 300s → CONSIGLIATO 780s (+3 gradini) |
  worker: scout-1, analista-1, scorer-1, scrittore-1 |
  decidi tu e applica: python3 /app/shared/skills/throttle-config.py bulk-set scout-1=780 analista-1=780 scorer-1=780 scrittore-1=780
```

O `agent-speed-table.py --since-min 60` diz: equipa `speed_pct_per_h = 21.4`, e

| agente | `pct_per_h` | `team_share_pct` | cadência |
|---|---|---|---|
| scout-1 | 11.2 | 52% | 0.15/min |
| analista-1 | 6.0 | 28% | 0.12/min |
| scorer-1 | 3.0 | 14% | 0.10/min |
| scrittore-1 | 0.4 | 2% | 0.01/min |

**Quanto:** `vel_needed = (100 − 58) / 3.0 = 14.0 %/h` → `f_team = (21.4 − 14.0) / 21.4 = 35%`, ou seja **têm de desaparecer 7.4 %/h**.

**Quem:** o `db_query.py stats` diz `UNSCORED = 40` — três horas de trabalho de scoring já no banco, portanto mais sourcing vale pouco agora. O Scout sozinho gasta mais do que toda a correção.

**Quanto nele:**
- `f_a = f_team / share_a = 35% / 52% ≈ 0.66` (o mesmo que `7.4 / 11.2`)
- `ΔT = (60 / 0.15) × 0.66/0.34 = 776s` → `T_new = 300 + 776 = 1076` → degrau mais próximo **1020s (17 min)**
- efeito: taxa × `60/(60 + 0.15×720)` = 0.36 → **−7.2 %/h**, a aterrar em 14.2 %/h ≈ alvo

```bash
python3 /app/shared/skills/throttle-config.py set scout-1 1020
python3 /app/shared/skills/throttle-config.py dump   # confirmar os valores efetivos
```

O Analista, o Scorer e o Escritor ficam onde estão: os dois primeiros são quem transforma essas 40 posições em pontuações, e o Escritor devolveria 0.4 %/h mesmo parado por completo.

Agora o nivelamento que o `bulk-set` já pronto teria produzido — todos a 780s: −6.1 do Scout, **−2.9 do Analista, −1.3 do Scorer**, −0.03 do Escritor = −10.3 %/h. A equipa aterra em 11.0 %/h e chega a **91% no reset em vez de 100** — nove pontos do orçamento pago pelo utilizador deitados fora — e chega lá com o débito de scoring a metade. Mesmo sinal, mesmas ferramentas, resultado oposto.

### Dois agentes

Quando um agente sozinho não consegue suportar todo o corte (ou suportá-lo deixaria a pipeline à fome), reparta por quota e mantenha os degraus diferentes:

```bash
python3 /app/shared/skills/throttle-config.py bulk-set scout-1=660 analista-1=780
```

`bulk-set` é uma única escrita atómica — prefira-a a dois `set`.

---

## 5. Aliviar o travão (`INDIETRO` / `MARGINE`)

Gastar a menos também é uma decisão de repartição — *a quem* alivia o travão decide o que o orçamento extra compra.

1. Alivie **primeiro o papel que é o gargalo** (`pipeline-triage` se não souber qual é). Aliviar um Scout quando a fila de scoring já vai em 40 compra mais atraso, não mais resultados.
2. Os workers nunca descem abaixo de **5 min**, portanto "pôr o throttle a zero" não existe para eles. Assim que o gargalo voltar ao piso, a alavanca para gastar mais é **mais um worker**, por etapas segundo C-02 — não uma pausa mais curta.
3. **Nunca alivie todos ao mesmo tempo**: oscila diretamente para um excesso no sinal seguinte.

---

## 6. Quando NÃO agir

Uma intervenção custa um turno seu mais 15-45 min às cegas. Gaste-o só quando o sinal o merece.

- `IN-PARI`, ou `|desvio| ≤ 6pt` → **nada**. Essa banda é ruído de medição.
- **Um sinal é ruído, dois consecutivos são uma tendência.** Um excesso isolado logo após um spawn é o custo de arranque do worker novo.
- Depois de qualquer alteração, **espere 2-3 sinais (≈30-45 min)**. Um throttle só produz efeito no checkpoint *seguinte* do agente, por isso uma alteração feita agora quase não se vê na medição a seguir. Não empilhe correções que ainda não consegue ver.
- Não acrescente sondas `rate_budget live` só para reconfirmar um aviso acabado de chegar — as chamadas extra inflacionam a `velocity_smooth` da Sentinella e induzem-lhe ordens erradas.
- **Nos últimos ~15 min antes do reset, um usage alto é o alvo acertado, não um excesso.** 97% no reset é no centro; travar aí só garante deixar orçamento por gastar.
- Se ao fim de 3 sinais os mesmos agentes continuarem em excesso, duplique as suas durações (linear → geométrico); se continuarem a gastar a menos, reduza-as a metade.
- Um `[URG]` da Sentinella ganha a um `[PACE-GUARD]`: aplique-o primeiro, o aviso seguinte volta a medir.

---

## 7. Redes de segurança — não são a sua alavanca

Existem por causa de um incidente medido (na noite de 2026-07-15, uma queima descontrolada ocorrida precisamente com ambas desligadas) e **não fazem parte da decisão de pacing**:

- **O piso de 5 min dos workers.** Scout, Analista, Scorer, Escritor, Crítico nunca correm abaixo de 300s, escreva o que escrever. `set scout-1 60` num worker é efetivamente 300s — o `dump` mostra a verdade. Não leia um valor encostado ao piso como uma alteração que fez.
- **O hard-stop diário.** É a última coisa entre a equipa e um lockout que deixa o utilizador sem respostas durante horas. Nunca o desliga para gastar mais; se precisa de gastar mais, a alavanca é o paralelismo (§5).
- A isenção do piso por agente existe para um único caso: uma medição com prazo do que **um único** worker produz sem pausas. Deliberadamente não é um interruptor global — **um agente de cada vez, nunca a equipa toda**, e nunca como forma de ir mais depressa.

---

## Anti-padrões

- ❌ Colar o `bulk-set` com que a linha `[PACE-GUARD]` termina. Esse número vem do worker mais travado e é oferecido a todos: aplicado em todo o lado nivela a equipa pelo seu membro mais lento e atinge os papéis que produzem o resultado do utilizador. O comando poupa-lhe a escrita depois de ter decidido os valores — não os decide.
- ❌ Abrandar um agente parado para "ajudar". Um agente que não consome não devolve nada quando o trava — gastou uma escrita e um turno por zero pontos.
- ❌ Cortar em todos os agentes porque o veredito era ao nível da equipa: atinge os papéis baratos, que de qualquer forma não devolviam nada, antes do caro.
- ❌ Tratar um sinal isolado como estado permanente, ou empilhar uma segunda correção antes de a primeira ser mensurável.
- ❌ Travar em `AVANTI` quando a taxa já voltou ao normal — o desvio está a fechar-se sozinho e você fecha a janela abaixo do alvo.
- ❌ Perseguir o pacing com o throttle em `LOCKOUT-IMMINENTE`: aí o travão está quase saturado e só o roster muda o desfecho.
- ❌ Empurrar números de throttle para os agentes via tmux (`[INFO] sleep 40s`). Passe sempre pelo `throttle-config.py` — os agentes leem o ficheiro de config, não fazem parsing do corpo do seu tmux. O tmux serve apenas para dizer a um agente que faça checkpoint *mais ou menos vezes*, o que é outro eixo.

## Ver também

- `sentinel-orders` — as ordens filtradas da Sentinella, incluindo `Throttle: N`, freeze e retoma. Essa skill descodifica a ordem; esta decide a repartição.
- `bridge-pacing` — como ler os números do tick de 15 min quando é ela a reencaminhá-los.
- `throttle` — a referência CLI do `throttle-config.py` e o ficheiro de estado por agente.
- `pipeline-triage` — qual o papel que é o gargalo, e quando a resposta é "spawna mais um" em vez de "alivia um travão".
- `scaling-calc` — plano de roster + throttle quando a resposta é mais workers, não uma pausa diferente.
- `agent-emergency` — um queimador com cadência ~0 que continua a consumir sem produzir: aí a alavanca é o KILL, não mais um degrau.
