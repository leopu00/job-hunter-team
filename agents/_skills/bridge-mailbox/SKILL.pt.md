<!-- @translation: pt, ai-translated 2026-06-06 -->
---
name: bridge-mailbox
description: Drenar vereditos pendentes da bridge no INÍCIO de cada turno do Capitano — ação OBRIGATÓRIA antes de fazer qualquer outra coisa. Durante um turno longo, `jht-tmux-send` da bridge pode falhar com rc=3 (texto nunca apareceu no painel) e um veredito `[BRIDGE PACING]` ou `PIPELINE STALLED` é silenciosamente perdido. A bridge anexa CADA veredito a uma caixa de correio JSONL para que possa recuperá-los. Pular esta drenagem significa agir com medições desatualizadas enquanto um veredito mais recente está por ler.
allowed-tools: Bash(python3 /app/shared/skills/bridge_mailbox.py *)
---

# bridge-mailbox — recuperar vereditos perdidos

A bridge comunica consigo via tmux, mas a entrega via tmux pode falhar silenciosamente durante um turno longo (problemas de renderização do TUI Codex / Kimi, estava dentro de uma chamada de ferramenta longa, etc.). Para garantir que nenhum veredito é perdido, a bridge **também** anexa cada tick a uma caixa de correio JSONL em `$JHT_HOME/logs/bridge-mailbox.jsonl`. Você drena-a no topo de cada turno.

## A primeira ação obrigatória

Antes de *qualquer outra coisa* — antes de ler mensagens, antes de decidir ações, antes de abrir outra skill — execute:

```bash
python3 /app/shared/skills/bridge_mailbox.py drain
```

Saídas possíveis:
- `no pending verdicts` → caixa de correio vazia, prossiga com o turno normalmente.
- uma ou mais linhas formatadas como ticks tmux ao vivo (`[BRIDGE PACING] ...`, `PIPELINE STALLED ...`, `[BRIDGE ALERT] ...`).

`drain` consome as entradas (são marcadas como lidas em caso de sucesso) — re-executá-lo retorna `no pending verdicts` até a bridge anexar novos.

## Como aplicar vereditos drenados

Processar TODAS as linhas, mas **agir apenas na última**. As anteriores já estão desatualizadas — as métricas mudaram desde então. Duas exceções onde uma linha anterior ainda importa:

1. **`PIPELINE STALLED` recente (< 30 min) e ainda pertinente** (proj ainda baixo, team_kt ainda baixo agora). Agir no playbook (reativar o pipeline upstream) mesmo se um `[BRIDGE PACING]` válido posterior chegou depois. Stalls são estado, não eventos — precisam de ser limpos, não apenas medidos.
2. **Um `[PAUSA TEAM]` / `[HARD FREEZE]` que perdeu**. Se um está na fila e ainda não enviou `[RIPRENDI]`, a equipa ainda está congelada — trate com `sentinel-orders` *antes* do último pacing.

Para o caso rotineiro (uma ou mais linhas `[BRIDGE PACING]`):
- leia cada linha para manter o contexto temporal (pode ver como a tendência evoluiu enquanto estava ocupado)
- abra a skill `bridge-pacing` uma vez e aplique apenas a calibração do **último** veredito

## Outros comandos (debug / inspeção)

```bash
python3 /app/shared/skills/bridge_mailbox.py status   # quantos pendentes vs total
python3 /app/shared/skills/bridge_mailbox.py peek     # ler sem consumir
```

Use `peek` quando suspeitar de algo estranho e quiser olhar sem comprometer — NÃO marca entradas como lidas.

## Anti-padrões

- ❌ Pular a drenagem "porque o turno parece curto" — as falhas rc=3 acontecem imprevisivelmente; um tick perdido durante um turno longo é o caso típico.
- ❌ Agir em cada linha drenada em sequência — você reproduziria alterações de throttle desatualizadas, lutaria contra as suas próprias calibrações passadas e faria a equipa oscilar.
- ❌ Executar `drain` no meio do turno apenas para "ver o que chegou" — drain consome; se não está pronto para agir nas linhas, use `peek` em vez disso.
- ❌ Tratar a saída de `peek` como autoritativa — `peek` mostra entradas pendentes, mas o painel tmux ao vivo pode já conter mais recentes que o JSONL ainda não alcançou. A drenagem no início do turno é o que lhe dá a imagem consistente.

## Ver também

- `sentinel-orders` — encaminha `[PAUSA TEAM]` / `[HARD FREEZE]` / `[RIPRENDI]` uma vez drenados.
- `bridge-pacing` — fórmula a aplicar na última linha `[BRIDGE PACING]`.
- `pipeline-triage` — playbook para `PIPELINE STALLED` (reativar pipeline upstream).
