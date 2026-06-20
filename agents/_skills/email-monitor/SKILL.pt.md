<!-- @translation: pt, ai-translated 2026-06-20 -->
---
name: email-monitor
description: "Sourcing no inicio do dia a partir da caixa de email DEDICADA da equipe (o usuario encaminha para ela os proprios job alerts). Fonte de mais alta precisao: o alerta ja vem pre-filtrado pela intencao do usuario. Poll IMAP de QUALQUER plataforma (LinkedIn/Glassdoor/Indeed + boards nacionais/de cidade/de nicho), cria posicoes com a tag source, idempotente por Message-ID. O VOLUME e balanceado pelo Capitao (C-16): no inicio do dia le-se o email ANTES do scraping web; em caso de flood ingerem-se apenas as salientes, para que o funil chegue ao SCORE."
allowed-tools: Bash(python3 /app/shared/skills/email_monitor.py *), Bash(python3 /app/shared/skills/scout_dedup.py *), Bash(python3 /app/shared/skills/db_insert.py *), Bash(python3 /app/shared/skills/db_query.py *)
---

# email-monitor — ler os job alerts encaminhados, no inicio do dia

O usuario cria um email **dedicado** (ex. `nome.jht@gmail.com`) e configura no
proprio cliente **regras de encaminhamento** que nos enviam os job alerts (LinkedIn,
Glassdoor, Indeed **e qualquer outra plataforma** que notifique por email). Voce
le aquela caixa e transforma os alertas em posicoes. E a fonte mais
**precisa** (o alerta ja vem filtrado pelo usuario segundo o alvo) e a mais
**economica em tokens** (sem scraping as cegas).

> 📍 **Opcional mas recomendada.** Se nao estiver configurada, a equipe trabalha como
> antes (web sourcing). Sem bloqueio.

## Quando

- **No inicio da janela de trabalho** (day-start): le o email **ANTES** do
  scraping web. Os alertas noturnos ja estao la.
- Depois, no maximo a cada ~30 min (o IMAP server-side faz rate-limit alem disso, e novos
  alertas nao chegam com mais frequencia). Nao fazer poll com mais frequencia.
- Claim da fonte no STEP 0 (`scout-coord`): `scout_workspace.py claim
  <agent> email:<box>` — um unico Scout por caixa, sem colisoes.

## Procedimento

### 1. Esta configurada?
```bash
python3 /app/shared/skills/email_monitor.py status
```
`configured=false` → a caixa nao existe: pula, faz web sourcing normal.
`any_platform=true` significa que processamos **toda** a inbox dedicada (nenhum
`from_filters` restrito) → cada remetente que o usuario encaminha e lido.

### 2. Estime o VOLUME (economico, sem body fetch)
```bash
python3 /app/shared/skills/email_monitor.py count
```
Retorna `new_total` + `by_sender`. Serve a **voce e ao Capitao** para entender se e
um volume gerenciavel ou um **flood**. Em caso de flood, **o Capitao (C-16) te diz
quantas / quais** ingerir: o objetivo e que as posicoes cheguem a um
**score**, nao acumular 200 nunca avaliadas.

### 3. Poll → leads
```bash
python3 /app/shared/skills/email_monitor.py poll --since-days 1
```
Cada linha JSONL e um lead: `{"url","source","subject","sender","received_at"}`.
- `source` = `linkedin-email` / `glassdoor-email` / `indeed-email` para os providers
  conhecidos, `email:<domain>` para qualquer outra plataforma (extracao generica).
- A idempotencia (Message-ID em `state/email_monitor_seen.json`) garante que um
  re-run **nao** reprocesse os mesmos alertas.

### 4. Para cada lead → os 5 gates de `position-insert`
Trate cada `url` **exatamente como um hit web**: dedup (`scout_dedup.py`) →
verifica link ativo → fetch JD → 4 filtros Scout → INSERT em `positions`
(`status=new`). **Mantenha a tag `--source`** do lead (`linkedin-email`,
`email:<domain>`): e o que torna **mensuravel a precisao por fonte** na
dashboard. JD obrigatoria (SC-02): se nao conseguir recupera-la, nao a invente.

## Balanceamento (julgamento do Capitao, C-16)

Ler e gratis (`poll`/`count`), **processar** ate o score custa. O
decisor e o Capitao, nao uma formula:
- Volume razoavel → processa todas (mais sinal e melhor).
- Flood → leva adiante apenas as **salientes**, com dois criterios so a partir dos metadados
  (gratis): **(1) match com o perfil/alvo** do usuario (cargo/keyword no
  `subject`/titulo) e **(2) frescor** (`received_at` mais recente). As outras se
  retomam nas janelas seguintes.
- Objetivo: as posicoes **chegam a um score**, nao se acumulam sem
  avaliacao. Sem limiares fixos — o Capitao decide quantas com base no orcamento.

## Anti-padroes

- ❌ Fazer poll com mais frequencia que ~30 min (rate-limit IMAP, nenhum novo alerta).
- ❌ INSERT sem JD completa (SC-02) ou sem a tag `source`.
- ❌ Criar em avalanche durante um flood ignorando o julgamento do Capitao (C-16): incha
  a fila de posicoes que nunca chegarao a um score.
- ❌ Burlar o dedup (SC-05): os mesmos alertas se repetem todos os dias.

## Veja tambem

- `position-insert` — os 5 gates de INSERT (seu fluxo padrao).
- `scout-coord` — claim da fonte `email:*` no boot (anti-colisao).
- `circles-and-sources` — o sourcing web, a fazer DEPOIS do email no inicio do dia.
