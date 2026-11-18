---
name: recheck-batch
description: Recheck cadenciado do MODO CUIDADO ao custo mínimo. O script faz o trabalho mecânico sobre um batch (verificação por níveis de cada URL, atualiza last_checked das OPEN verificadas); tu julgas SÓ os casos ambíguos. Medido 78-86kT por posição com a ronda manual — com o batch gastas um turno para 10 posições, não 10 turnos. A exclusão continua a ser SEMPRE uma decisão tua, nunca do script.
allowed-tools: Bash(python3 /app/shared/skills/recheck_batch.py *), Bash(python3 /app/shared/skills/db_update.py *), Bash(python3 /app/shared/skills/recheck_liveness.py *)
---

# recheck-batch — o recheck do modo cuidado, sem desperdiçar um turno por posição

## Porque existe
Voltar a verificar uma posição JÁ analisada é uma fração do check de uma
posição nova: nada de reanálise, nada de reler a JD, nada de metadados. A
ronda manual (fila → uma posição → recheck-liveness → db_update → repetir)
custava 78-86kT por posição porque cada passo era um turno LLM. Este batch
comprime toda a parte mecânica num ÚNICO comando.

## Como se usa (UM turno por batch)
```sh
python3 /app/shared/skills/recheck_batch.py            # batch di 10 dalla coda
python3 /app/shared/skills/recheck_batch.py --limit 5
```
Tira as posições da fila `next-for-recheck-due` (vivas, score ≥ policy, não
verificadas há > 14 dias, SCORE DESC: primeiro as melhores) e para cada uma
executa a verificação por níveis de `recheck_liveness.py` (curl → browser,
nunca um falso aberto).

O relatório tem três resultados:
- **OK abertas e atualizadas** — verificadas `OPEN`: `last_checked` já está
  atualizado, saem da fila durante 14 dias. **Não lhes toques, não as
  releias, zero trabalho teu.**
- **A JULGAR** — evidência de fecho (404/410, closed-marker, ou
  `expires_at` ultrapassada). Aqui entras TU.
- **NÃO VERIFICÁVEIS** — host JS/authwall e browser inconclusivo. Aqui
  entras TU (one-shot).

## O juízo é teu — o script NUNCA exclui (ordem do utilizador 2026-07-30)
Um script estático pode enganar-se e deitar fora uma posição ainda viva.
Para cada posição **A JULGAR**: olha para a evidência reportada; se for
preciso, UM só olhar direto à página. Se tiveres 100 % de certeza de que
está expirada/fechada:
```sh
python3 /app/shared/skills/db_update.py position <ID> --status excluded \
  --is-open false --last-open-check now --notes "[SCADUTO] <evidenza>"
```
Se, pelo contrário, ainda está viva (falso positivo do script):
```sh
python3 /app/shared/skills/db_update.py position <ID> --is-open true --last-checked now
```
Para cada **NÃO VERIFICÁVEL**: one-shot com o browser sobre o URL; depois
decide como acima. Se continuar não verificável → `--last-checked now` +
nota `[OPEN_UNVERIFIED]`, `is_open` inalterado (nunca a faças passar por
aberta).

## Disciplina de custo (o objetivo da skill)
- **Um batch = um turno.** Não faças uma ronda por posição, não reanalises,
  não releias JD nem empresa: o recheck só decide «ainda aberta?».
- Batch limitado (por omissão 10): NÃO aumentes o limite para «acabar a
  fila de uma vez» — a cadência distribui o trabalho, o Capitano dá o
  ritmo (C-09/C-18).
- Fila OFF por enrichment-policy = estado pretendido: para, não a contornes.
