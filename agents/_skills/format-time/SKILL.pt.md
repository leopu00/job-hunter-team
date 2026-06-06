<!-- @translation: pt, ai-translated 2026-06-06 -->
---
name: format-time
description: Converter timestamps UTC para o fuso horário do utilizador antes de mostrá-los em chat, gráficos, Telegram ou qualquer output visível ao utilizador. Use este helper sempre que de outra forma escrevesse um `strftime("%H:%M")` direto de um datetime UTC em algo que o utilizador lê.
allowed-tools: Bash(python3 *)
---

# format-time — UTC → fuso do utilizador em output visível ao utilizador

Bug #15: o container corre em UTC, o utilizador vive em CEST/CET. Sem
conversão cada "reset às 03:11" em chat ou gráficos força o utilizador a
fazer `+2` na cabeça — e às vezes o utilizador diz *"aqui são
3:21"* e o Capitano tem de se apressar para converter.

## Quando usar

Aplicar sempre que produzir um timestamp que o **utilizador** vai ler:

- Mensagens Telegram de qualquer agente (Capitano, Assistente, Mentor)
- Subtítulos de gráficos Matplotlib, labels do eixo x, legendas
- Widgets de dashboard que mostram hora
- Linhas de log ou resumos devolvidos ao utilizador

**Pular** quando:
- Escrever ficheiros de log internos (`messages.jsonl`, `sentinel-data.jsonl`,
  `dottore-actions.jsonl`) — mantêm UTC ISO para parsing cross-agente.
- Escrever colunas do DB — manter UTC ISO para que o dashboard possa formatar
  na renderização.
- Calcular intervalos / deltas — trabalhar em UTC, formatar apenas nas bordas.

## Como usar

```python
from shared.skills.format_time import fmt_user, fmt_user_with_utc
from datetime import datetime, timezone

now = datetime.now(timezone.utc)
print(fmt_user(now))            # "03:21 CEST"
print(fmt_user_with_utc(now))   # "03:21 CEST (01:21 UTC)"
```

Ou, do bash:

```bash
python3 /app/shared/skills/format_time.py --now
python3 /app/shared/skills/format_time.py --iso 2026-05-17T01:14:00Z --with-utc
```

## Quando mostrar ambos hora-utilizador e UTC

Em **gráficos operacionais** que um engenheiro de oncall (ou você, a depurar)
possa ler junto com os logs UTC da equipa, preferir `fmt_user_with_utc`
para que ambos sejam visíveis:

> *"Agora 03:21 CEST (01:21 UTC) — usage 63% — proj 92.2%"*

Em **chat Telegram simples** para o utilizador, `fmt_user` sozinho é geralmente
suficiente:

> *"📅 Reset da janela em 5h às 05:11 CEST (~1h 50m)."*

## De onde vem o fuso do utilizador

`candidate_profile.yml::timezone` (nome IANA, ex. `Europe/Rome`).
Padrão `Europe/Rome` se ausente — cobre ~95% dos utilizadores beta. Para
sobrescrever por sessão: variável env `JHT_USER_TZ` (lida pelo helper).

## Anti-padrões

- ❌ `datetime.now().strftime("%H:%M")` numa string visível ao utilizador —
  produz a hora do **container** (UTC) sem sufixo → confusão do utilizador.
- ❌ Cálculo `+2` feito à mão em qualquer lugar. Use o helper; o DST muda
  Europe/Rome para CET (+1) no final de outubro e vai esquecer-se.
- ❌ Hardcodar `"CEST"` como sufixo — errado para metade do ano e
  errado para utilizadores não-italianos.

## Ver também

- `shared/skills/format_time.py` — implementação.
- `candidate_profile.yml.example` — documentação do campo `timezone:`.
- `docs/internal/_archive/2026-05-17-team-strategy-bugs.md` §15 — referência
  do incidente.
