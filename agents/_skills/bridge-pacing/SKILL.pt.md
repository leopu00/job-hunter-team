<!-- @translation: pt, ai-translated 2026-06-06 -->
---
name: bridge-pacing
description: Leia um tick de calibração `[BRIDGE PACING]` de 15 min — a medição da bridge sobre a taxa real da equipa, com um veredito (SFORO / MARGINE / ALLINEATO) mais a quota e a cadência por agente. O tick é dirigido à SENTINELLA, não a si: abra esta skill quando for ela a reencaminhar-lhe esses números, ou quando for ler um tick por iniciativa própria. Não fique à espera de que chegue um ao seu painel — não chega. Converter o veredito em valores de throttle por agente é `throttle-distribution`.
allowed-tools: Bash(python3 /app/shared/skills/throttle-config.py *), Bash(jht-tmux-send *)
---

# bridge-pacing — ler o tick de calibração de 15 min

A bridge executa uma janela de medição a cada 15 min (alinhada a :00/:15/:30/:45 UTC). Ao fechar cada janela, escreve uma linha que resume a taxa real da equipa — **no painel da Sentinella, não no seu** (push→pull, 25/06/2026). Não lhe fazem ping de quarto em quarto de hora, e é de propósito: ela lê o tick e só o acorda quando vale um turno seu. Portanto usa este formato quando **é ela a reencaminhar-lhe os números**, ou quando vai ver um tick por iniciativa própria — nunca como algo por que esperar.

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

## O que fazer com ele

O veredito diz-lhe **se** mexer e, grosso modo, **quanto**. Convertê-lo em valores no `throttle.json` — que agente abranda, quantos degraus, e quando o certo é não fazer nada — cabe à **`throttle-distribution`**. Abra essa para agir: é ela que detém a aritmética, a escada e as regras de segurança.

Duas coisas a levar consigo:

- **`share` responde a QUEM.** O throttle só devolve orçamento na proporção do que um agente está realmente a gastar, portanto um "corta 19%" ao nível da equipa nunca é "todos a descer 19%".
- **`cadenza` responde a QUANTO.** É a entrada da fórmula da duração: o mesmo valor na config corta de forma muito diferente num agente que chega a um checkpoint duas vezes por hora e num que lá chega dez.

## Anti-padrões

- ❌ Ler apenas `VERDETTO` e ignorar `share` / `cadenza`: corta cegamente todos os agentes e atinge os papéis baratos (Scorer, Analista) antes dos caros (Scrittore, Critico).
- ❌ Tratar um único tick SFORO como estado permanente: 1 tick é ruído, 2 ticks consecutivos é sinal.
- ❌ Misturar este fluxo com os de `sentinel-orders`: um `[BRIDGE PACING]` e um `[URG] RALLENTARE` podem chegar com minutos de diferença. O `[URG]` ganha sempre — aplique-o primeiro, o próximo pacing vai re-medir.
- ❌ Empurrar números derivados do pacing via tmux para agentes (`[INFO] sleep 40s`). Passe sempre por `throttle-config.py` — os agentes leem o ficheiro, não interpretam o corpo da sua mensagem tmux.

## Ver também

- `throttle-distribution` — a atuação: quem abranda, em quanto, e quando não fazer nada.
- `sentinel-orders` — ticks rotineiros, níveis de throttle 0-4, emergências.
- `bridge-mailbox` — drenar vereditos de pacing que perdeu durante um turno longo (a bridge anexa ao JSONL mesmo se o envio tmux ao vivo falhou).
- `throttle` — referência CLI do `throttle-config.py` e o ficheiro de estado por agente.
- `pipeline-triage` — quando MARGINE significa "spawnar mais um no bottleneck" em vez de apenas zerar throttle.
