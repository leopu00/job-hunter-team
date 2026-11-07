---
name: codex-dialog
description: Distingue um diálogo da CLI Codex gerida de um worker morto antes de o recuperar ou substituir.
---
<!-- @translation: pt, ai-translated 2026-11-07 -->

Usa esta competência apenas com agentes na **CLI de terminal Codex**, não no runtime API.
Uma notificação `[CODEX-DIALOG]` representa um estado distinto, não prova que o
worker morreu. O watchdog reconhece o lembrete de modelo visível, mantém o modelo
atual e informa se a recuperação resultou. Não substitui a sessão, não aceita
pedidos de confiança, não muda modelos, não atualiza a CLI nem concede acesso.

Lê a última observação registada sem enviar entrada:

```bash
python3 /app/shared/skills/codex_dialog.py status SCORER-1
```

`last_observation` e `at` descrevem a última verificação, sem garantir que o agente
continua ativo. `codex_dialog_recovered` significa que o mesmo painel voltou à
caixa de entrada ou ao trabalho; `codex_dialog_ready` regista uma observação saudável
posterior sem alegar recuperação automática. `pending`, `timeout`, `changed`,
`unrecognized` e `io_error` exigem inspeção. Os códigos completos começam por
`codex_dialog_`.

Informa o utilizador deste estado antes de decidir uma recuperação manual ou substituição.
Não clones, termines ou substituas o worker silenciosamente. Para um diálogo por
resolver, pede um diagnóstico ao Dottore e explica a ação proposta. Nunca envies
Enter às cegas nem escolhas um modelo sugerido. As mensagens normais continuam
a usar `tmux-send` e as suas verificações de disponibilidade. Uma quota realmente
esgotada, um início de sessão ou um pedido de confiança não são uma recuperação bem-sucedida.
