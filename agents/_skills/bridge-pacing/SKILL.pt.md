<!-- @translation: pt, ai-translated 2026-06-06 -->
---
name: bridge-pacing
description: Traduzir um tick de calibração `[BRIDGE PACING]` de 15 min em ajustes de throttle por agente. A bridge mede a taxa real de consumo da equipa e dá-lhe um veredito (SFORO / MARGINE / ALLINEATO) mais a quota por agente + cadência necessárias para escolher QUEM abrandar e EM QUANTO. Abrir esta skill APENAS quando uma linha `[BRIDGE PACING]` chegar; os `[SENTINELLA]` rotineiros usam um fluxo diferente (`sentinel-orders`).
allowed-tools: Bash(python3 /app/shared/skills/throttle-config.py *), Bash(jht-tmux-send *)
---

# bridge-pacing — calibração de throttle baseada em dados

A bridge executa uma janela de medição a cada 15 min (alinhada a :00/:15/:30/:45 UTC). Ao fechar cada janela, escreve uma linha no painel do Capitano que resume a taxa real da equipa e indica em que direção calibrar o throttle. Isto **não** é uma ordem da Sentinella — é um sinal de calibração sobre o qual age com `throttle-config.py`.

## Formato da mensagem

```
[BRIDGE PACING] HH:MM UTC window=15m (effettivi Xm) samples=N |
  usage=U% reset_in=Rh reset_at=THH:MM UTC (proj=P% — INFO, secondario non-driver) |
  vel_team=V%/h | vel_target=T%/h (per chiudere a TGT% al reset) [schedule+ratio phase=ON] |
  ratio=K kT/% (team Σ kT / Δusage) |
  agenti: name=p%/h [kT/Xm → kT/h ÷ K = p%/h, share s%, cadenza c/min (n chk in Xm)] ; ... |
  VERDETTO: SFORO|MARGINE|ALLINEATO ...
```

`TGT` é o **alvo dinâmico** escolhido pela bridge:
- Config 24/7 ou sem schedule → `TGT=92` (centro da banda, padrão histórico)
- Config work-hours + provider com limite semanal (Codex/Claude) → `TGT` é a % necessária no reset para que o orçamento semanal seja distribuído exatamente pelas horas ativas do utilizador. Exemplo: horário de escritório 9-18 em Codex Pro → `TGT≈76`.
- Config work-hours + Kimi (sem limite semanal) → `TGT=92` (fallback centro da banda).

A tag `[schedule+ratio phase=ON]` entre parênteses é a **fonte** do alvo — `band_center` (sem work-hours), `schedule+ratio` (work-hours completo), `schedule+band` (work-hours + fallback Kimi). Use-a para depurar alvos inesperados.

## Campos que realmente usa

| Campo             | O que lhe diz                                                                                      |
|-------------------|------------------------------------------------------------------------------------------------------------|
| **`vel_team`**    | taxa medida da equipa, em pontos percentuais de orçamento por hora                                        |
| **`vel_target`**  | taxa que aterraria em `TGT%` no reset (centro da banda ±10pt em torno de `TGT`)                            |
| **`share s%`**    | peso por agente na taxa total (Σ shares ≈ 100%) — diz-lhe **QUEM** abrandar                               |
| **`cadenza c/min`** | chamadas `jht-throttle` por agente por minuto na janela — diz-lhe **QUANTO** adicionar ao config         |
| **`VERDETTO`**    | resumo acionável; mapear diretamente para a tabela abaixo                                                  |

> ⚠️ **`proj` é apenas INFO — NÃO agir com base nele.** É uma extrapolação volátil
> da velocidade da janela curta (ex. imprimiu `proj=-8.66%` enquanto a equipa estava apenas
> ligeiramente abaixo do alvo). O loop de controlo é **`vel_team` vs `vel_target`** (ambos
> cientes da semana) + `weekly_remaining`. Ignorar `proj` para decisões de throttle/spawn.

## Veredito → ação

| Veredito                          | Significado                                                   | Ação                                                                                |
|----------------------------------|---------------------------------------------------------------|---------------------------------------------------------------------------------------|
| `SFORO +X%/h → riduci Y%`        | `vel_team` excede o alvo por X pontos/h. Cortar Y% da taxa.  | **Aumentar** `throttle-config` para os agentes com **quota alta** (top 1-2)           |
| `MARGINE −X%/h → puoi salire Y%` | `vel_team` abaixo do alvo. Tem margem.                        | **Zerar ou reduzir** o throttle nos agentes com throttle (prioridade: papel de bottleneck) |
| `ALLINEATO Δ ±0.2%/h`            | dentro da tolerância.                                         | não fazer nada, esperar pelo próximo tick                                              |

> 💡 `X%/h` vs `Y%` são a mesma coisa em duas unidades. `Y = X / vel_team × 100`.

## Fórmula de calibração (a novidade aqui)

Para obter uma redução de taxa de `f%` num agente com cadência `c` checkpoint/min, a duração a colocar em `throttle-config` é:

```
durata_sec = (f / 100) × 60 / c
```

A intuição: cada chamada `jht-throttle` adiciona `durata_sec` de pausa. Ao longo de 60s o agente chama-o `c` vezes → adiciona `c · durata` segundos de pausa por minuto → corte fracional da taxa `= c · durata / 60`. Resolver para `durata`.

### Exemplo trabalhado — concentrar o corte num agente

```
Tick: SFORO +4.35%/h → riduci 19%
analista-1: share 47%, cadenza 0.6/min
```

Empurrar quase todo o corte para `analista-1`:
- fração no analista-1 ≈ 19% / 47% ≈ 40%
- `durata_sec = 0.40 × 60 / 0.6 = 40s`
- → `throttle-config.py set analista-1 40`

### Exemplo trabalhado — distribuir o corte por dois agentes

```
Tick: SFORO +4.35%/h → riduci 19%
analista-1: share 47%, cadenza 0.6/min
scout-1:    share 26%, cadenza c_scout
```

Peso combinado 47 + 26 = 73%. Distribuir os 19% proporcionalmente:
- fração por agente ≈ 19% / 73% ≈ 26%
- analista-1: `0.26 × 60 / 0.6 = 26s`
- scout-1:    `0.26 × 60 / c_scout`
- → uma escrita `bulk-set` atómica:

```bash
python3 /app/shared/skills/throttle-config.py bulk-set \
    analista-1=26 scout-1=<derivado de c_scout>
```

## Ao libertar throttle (MARGINE)

Se o veredito for `MARGINE −X%/h → puoi salire Y%`:
1. Escolher o papel que quer acelerar (prioridade: o bottleneck atual — `pipeline-triage` se não tiver certeza).
2. Reduzir o throttle atual desse papel aproximadamente `Y%` (ou zerá-lo se era um valor pequeno).
3. **Não** zerar todos de uma vez — oscilaria para um SFORO no próximo tick.

## Cadência após uma alteração de config

- Após qualquer alteração, esperar **2-3 ticks** (≈30-45 min) antes de intervir novamente.
- O pacing já é a sua síntese — **não** adicionar chamadas extras `rate_budget live` entre (inflam o `velocity_smooth` da Sentinella).
- Se após 3 ticks o veredito ainda for SFORO, duplicar as durações nos mesmos agentes (linear → geométrico); se ainda MARGINE, reduzir pela metade.

## Anti-padrões

- ❌ Ler apenas `VERDETTO` e ignorar `share` / `cadenza`: corta cegamente todos os agentes e atinge os papéis baratos (Scorer, Analista) antes dos caros (Scrittore, Critico).
- ❌ Tratar um único tick SFORO como estado permanente: 1 tick é ruído, 2 ticks consecutivos é sinal.
- ❌ Misturar este fluxo com os de `sentinel-orders`: um `[BRIDGE PACING]` e um `[URG] RALLENTARE` podem chegar com minutos de diferença. O `[URG]` ganha sempre — aplique-o primeiro, o próximo pacing vai re-medir.
- ❌ Empurrar números derivados do pacing via tmux para agentes (`[INFO] sleep 40s`). Passe sempre por `throttle-config.py` — os agentes leem o ficheiro, não interpretam o corpo da sua mensagem tmux.

## Ver também

- `sentinel-orders` — ticks rotineiros, níveis de throttle 0-4, emergências.
- `bridge-mailbox` — drenar vereditos de pacing que perdeu durante um turno longo (a bridge anexa ao JSONL mesmo se o envio tmux ao vivo falhou).
- `throttle` — referência CLI do `throttle-config.py` e o ficheiro de estado por agente.
- `pipeline-triage` — quando MARGINE significa "spawnar mais um no bottleneck" em vez de apenas zerar throttle.
