---
name: feedback-query
description: Lê feedback do utilizador (like/dislike/hide/star) da cloud — por posição ou agregado numa janela. O Scorer usa-o apenas como evidência contextual de preferência para posições futuras, excluindo a atual; o Mentor conta motivos recorrentes (Padrão F) e o Scout usa-o como sinal contextual. Retorna um payload neutro "sem sinal" quando a cloud está indisponível.
allowed-tools: Bash(python3 *)
---
<!-- @translation: pt, ai-translated 2026-06-06 -->

## Fronteira raw/display (`RAW_DISPLAY_BOUNDARY`)

O `reason` de um julgamento é um **código** de uma lista fechada (`too_senior`, `too_junior`, `wrong_location`, `salary_low`, `wrong_stack`, `company`, `scam_or_gone`, `closed`, `already_applied`, `other`). O que o utilizador escreve com palavras suas é uma nota privada que esta skill nunca devolve: em nenhum campo há texto do utilizador, e não há nada para citar, retransmitir ou parafrasear. O `label` do tema é uma frase fixa para o código. Uma `note` é apenas um enum fechado `no-signal:*`: trata-a como estado de disponibilidade, nunca como detalhe de infraestrutura.

# feedback-query — Feedback do utilizador por posição

O utilizador pode clicar like/dislike/hide/star em qualquer posição a partir do dashboard web. Esses cliques são armazenados no Supabase `position_feedback` (mig 019 base + mig 028 extendida) e expostos aos agentes via esta skill. Schema:

| Coluna              | Tipo    | Significado |
|---------------------|---------|---------|
| `position_legacy_id`| TEXT    | O `legacy_id` (string) da posição em `positions` |
| `action`            | TEXT    | Um de `like`, `dislike`, `hide`, `star`, `clear` (mig 059 — o utilizador retira o juízo; ganha o último evento, portanto um `clear` no fim significa "sem juízo") |
| `reason`            | TEXT    | Motivo opcional: um código da lista fechada acima |
| `score`             | INTEGER | Pontuação granular opcional 1-5 (mig 028) |
| `direction`         | TEXT    | Opcional `more_like_this` / `less_like_this` — sinal de padrão para o Scout, NÃO skip por posição (mig 028) |
| `created_at`        | TS      | Momento da submissão |

A skill chama `GET /api/positions/{legacy_id}/feedback` na cloud (usando o bearer token em `$JHT_HOME/cloud.json`). Com cloud desativada ou falha de rede, a skill **não dá erro** — retorna `ok=true, latest_action=null` com um campo `note`. Os agentes devem continuar.

## Lookup de posição única

```bash
python3 /app/shared/skills/feedback_query.py check <legacy_id>
```

Output (JSON em stdout):

```json
{
  "ok": true,
  "legacy_id": "42",
  "latest_action": "dislike",
  "latest_direction": "less_like_this",
  "count": 2,
  "actions": [
    {"action": "dislike", "created_at": "2026-05-30T14:21:00Z",
     "reason": "too_senior", "score": 2, "direction": "less_like_this"},
    {"action": "like", "created_at": "2026-05-28T09:00:00Z",
     "reason": null, "score": null, "direction": null}
  ]
}
```

`latest_action` é o clique mais recente. `latest_direction` é o valor NON-NULL mais recente de `direction` no histórico (em qualquer lugar no actions[], não necessariamente a ação mais recente). `actions[]` está ordenado DESC por `created_at`. Vazio quando não existe feedback:

```json
{"ok": true, "legacy_id": "99", "latest_action": null,
 "latest_direction": null, "count": 0, "actions": []}
```

Quando a cloud está desativada ou o endpoint inalcançável, a skill retorna:

```json
{"ok": true, "legacy_id": "...", "latest_action": null,
 "latest_direction": null, "count": 0, "actions": [],
 "note": "no-signal:cloud-disabled"}
```

## Leitura agregada (janela sobre todas as posições)

Uma única chamada HTTP em vez de N: `GET /api/positions/feedback?days=&limit=`, mesmo bearer token, mesmo fallback neutro.

```bash
# Todos os eventos de feedback na janela, do mais recente
python3 /app/shared/skills/feedback_query.py recent --days 30

# Os códigos de motivo, contados sobre posições distintas
python3 /app/shared/skills/feedback_query.py themes --days 30 --min-positions 3
```

Saída de `themes`:

```json
{"ok": true, "window_days": 30,
 "events_total": 31, "events_with_reason": 19,
 "positions_with_reason": 17, "positions_cleared": 2,
 "by_action": {"like": 6, "dislike": 21, "hide": 3, "star": 1},
 "min_positions": 3,
 "themes": [
   {"key": "too_senior", "label": "too senior",
    "positions": 7, "events": 7, "share": 0.412,
    "actions": {"dislike": 6, "hide": 1},
    "legacy_ids": ["42", "51", "63"]}
 ]}
```

Como funciona a contagem: cada posição conta **uma vez**, com o motivo do seu julgamento **mais recente**, e só contam os motivos que são um código da lista (um motivo antigo em texto livre lê-se como `other`). Não há texto para agrupar e nada é interpretado. `other` é contado mas não diz nada de específico.

Limites deliberados, declarados para que ninguém leia nos números mais do que lá está:
- Um tema é um código, por isso é tão grosseiro quanto a lista: `wrong_location` não diz que cidade. Nada do que o utilizador escreveu está disponível para o refinar.
- As posições cujo **último** evento é `clear` ficam de fora (o juízo foi retirado); `--include-cleared` traz-nas de volta.
- `share` = posições do tema / `positions_with_reason`.
- `--top N`, `--days 0` para todo o histórico. (`--field` é aceite e ignorado, por causa de prompts antigos.)
- Fallback quando o endpoint agregado não responde: `--legacy-ids 12,13,14` lê essas posições uma a uma (mais lento, mesmo formato de saída).

Flags: `--days` (padrão 30, `0` = tudo), `--limit` (padrão 500 eventos), `--min-positions` (padrão 3).

Quando o payload traz uma `note` enum fechada (`no-signal:*`), não há agregado. Trata-a como "sem dados", nunca como "sem feedback", e não retransmitas o código.

## Como os agentes a usam

**Scorer — `FUTURE_FEEDBACK_ONLY`:** chama `themes --days 30 --min-positions 1 --top 10 --exclude-legacy-id <legacy_id>`. Usa os códigos `key` / `label` apenas como evidência contextual de preferência ao avaliar essa posição futura. O feedback de uma posição já votada nunca altera score, status ou notes: sem bónus/malus fixo, marker de feedback ou backfill. Os scores existentes ficam inalterados. O-70 reavaliação explícita é um fluxo separado pedido pelo utilizador.

**Mentor** (Padrão F, read-only): `themes` sobre os últimos 30 dias para contar os códigos de motivo que o utilizador escolhe. Limiares e interpretação vivem na skill `mentor-patterns`. O Mentor fala **ao utilizador** — nunca emite instruções de pesquisa a partir deste dado.

**Scout** (sinal contextual opcional):
- Não para skip por posição — isso já é tratado por dedup (SC-05).
- Usar parcamente ao re-avaliar uma posição conhecida (ex. lógica de promoção): se o utilizador explicitamente deu dislike, não re-surfacar mesmo que a dedup normalmente re-pontuasse.
- **Sinal de padrão via `direction`** (mig 028): quando `latest_direction='less_like_this'` numa posição, o utilizador está a pedir menos posições COMO aquela (mesma empresa / role_family / localização). Despriorizar essa fonte/padrão em pesquisas subsequentes. Quando `latest_direction='more_like_this'`, priorizar replicar o padrão. Isto é uma dica contextual, não uma regra rígida — combinar com o panorama mais amplo (ex. um único `less_like_this` num nicho pequeno pode ser ruído; três na mesma empresa não são).

## Notas

- A skill é **read-only**. Escritas acontecem apenas do browser via POST `/api/positions/{legacy_id}/feedback`.
- O bearer token vem de `cloud.json`; sem necessidade de variável env separada.
- Timeout de 10s em `check`, 20s na chamada agregada. Se processar muitas posições com `check`, esperar ~50–200ms por chamada — é exatamente o que `recent` / `themes` existem para evitar.
- O agregado é restrito ao utilizador do lado do servidor: devolve o feedback deste utilizador e mais nada.
