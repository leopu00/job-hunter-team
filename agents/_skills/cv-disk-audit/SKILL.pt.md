<!-- @translation: pt, ai-translated 2026-06-06 -->
---
name: cv-disk-audit
description: Healthcheck periódico (Dottore) para reconciliar CVs em disco e cv_pdf_path no DB. Identifica órfãos (ficheiro em disco sem linha DB) e ghost (linha DB com cv_pdf_path apontando para ficheiro inexistente). Notifica o Capitano sobre os desajustes para que o utilizador não perca top PASS invisíveis e não veja "CV por escrever" para CVs já escritos.
allowed-tools: Bash(python3 *), Bash(find *), Bash(stat *), Bash(jht-tmux-send *)
---

# cv-disk-audit — reconciliação disco↔DB nos CVs

O bug #26 mostrou o padrão: o Scrittore gera o PDF, é eliminado
(EMERGÊNCIA freeze 2026-05-17 04:43) antes do UPDATE no DB. O
ficheiro fica em `/jht_user/cv/`, mas `applications.cv_pdf_path` permanece NULL.
Sisal 7.5/10 (top PASS da janela) tinha-se tornado *"CV por escrever"*
no dashboard do utilizador — invisível.

A correção preventiva (escrita atómica na skill `cv-structure`) impede
novos órfãos. Esta auditoria recose os já existentes e captura qualquer
nova divergência que surja (ex. utilizador move um PDF à mão, watchdog
elimina o Scrittore durante o rename).

## Quando executá-la

Trigger do Dottore (final da ronda, fora de orçamento crítico):
- Sempre na primeira ronda após uma EMERGÊNCIA / kill de um Scrittore.
- Caso contrário ~a cada 4 rondas do Dottore (≈2h, dado a ronda de 30 min).

O Dottore executa esta skill DEPOIS de `liveness-check` e ANTES de
`cache-prune` — a auditoria é informativa, não destrutiva.

## Procedimento

```bash
# 1. Snapshot do disco
DISK_PDFS=$(find /jht_user/cv -maxdepth 1 -type f -name '*.pdf' 2>/dev/null | sort)

# 2. Snapshot do DB (cv_pdf_path != NULL)
DB_PDFS=$(python3 /app/shared/skills/db_query.py cv-pdf-paths 2>/dev/null | sort)

# 3. Diff
ORFANI=$(comm -23 <(echo "$DISK_PDFS") <(echo "$DB_PDFS"))     # disco mas não DB
GHOST=$(comm -13 <(echo "$DISK_PDFS") <(echo "$DB_PDFS"))      # DB mas não disco

# 4. Report ao Capitano (determinístico, sem LLM)
if [ -n "$ORFANI$GHOST" ]; then
  msg="[@dottore -> @capitano] [REPORT] CV audit mismatch — "
  msg="${msg}orfani=$(echo "$ORFANI" | grep -c .) "
  msg="${msg}ghost=$(echo "$GHOST" | grep -c .)"
  jht-tmux-send CAPITANO "$msg"
  # Log detalhes
  ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  echo "{\"ts\":\"$ts\",\"orfani\":$(echo "$ORFANI" | jq -R . | jq -s .),\"ghost\":$(echo "$GHOST" | jq -R . | jq -s .)}" \
    >> /jht_home/logs/cv-disk-audit.jsonl
fi
```

`db_query.py cv-pdf-paths` (a implementar): escreve 1 caminho por linha de
todas as applications com `cv_pdf_path IS NOT NULL`. Uma linha
amigável para script para o `comm`.

## O que o Capitano faz com o report

Recebe `[REPORT] CV audit mismatch — orfani=2 ghost=0`. Abre
`/jht_home/logs/cv-disk-audit.jsonl`, lê os órfãos, e para cada um
tenta o match heurístico:

1. `CV_<Candidato>_<position_id>_<...>.pdf` — naming novo bug #25 →
   extrai `position_id`, faz `db_update.py application <pid> --cv-pdf-path <path>`.
2. `CV_<Candidato>_<Company>.pdf` — naming antigo → procura application
   draft daquela empresa sem cv_pdf_path. Se encontrar uma só →
   reconecta. Se encontrar mais de uma → sinaliza ao utilizador (Sisal vs
   Leadtech vs Canonical: caso ambíguo de 2026-05-17).

O Capitano NÃO apaga ficheiros (nunca). Move para `/jht_user/cv/_orphan/`
se quiser arquivar sem perder.

## Anti-padrões

- ❌ Auto-reconectar um órfão com `cv_pdf_path` quando há múltiplas
  applications draft para a mesma empresa — ambiguidade, deixar o utilizador decidir.
- ❌ Apagar um órfão: os CVs são despesa cognitiva alta, arquivar
  sempre em vez de `rm`.
- ❌ Executar a auditoria durante EMERGÊNCIA: o Dottore deve executar apenas
  no final da ronda em regime normal.

## Ver também

- `cv-structure` § Geração de PDF (W-03 escrita atómica, bug #26)
- `application-flow` Passo 6 (naming com position_id, bug #25)
- `db-update` § Porta de escritor único (bug #21)
- `liveness-check` (executada antes na mesma ronda do Dottore)
