<!-- @translation: pt, ai-translated 2026-06-06 -->
---
name: feedback-query
description: Ler feedback do utilizador (like/dislike/hide/star) para uma posição dada a partir da cloud. Usado pelo Scorer para aplicar um multiplicador na pontuação final e pelo Scout como sinal contextual. Retorna um payload neutro "sem sinal" quando a cloud está desativada ou inalcançável, para que os chamadores nunca falhem de forma crítica.
allowed-tools: Bash(python3 *)
---

# feedback-query — Feedback do utilizador por posição

O utilizador pode clicar like/dislike/hide/star em qualquer posição a partir do dashboard web. Esses cliques são armazenados no Supabase `position_feedback` (mig 019 base + mig 028 extendida) e expostos aos agentes via esta skill. Schema:

| Coluna              | Tipo    | Significado |
|---------------------|---------|---------|
| `position_legacy_id`| TEXT    | O `legacy_id` (string) da posição em `positions` |
| `action`            | TEXT    | Um de `like`, `dislike`, `hide`, `star` |
| `reason`            | TEXT    | Razão curta opcional (≤500 char) |
| `comment`           | TEXT    | Comentário verboso opcional (≤2000 char, mig 028) |
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
     "reason": "too senior", "comment": "5+ anni in Java richiesti, non mi interessa stack legacy",
     "score": 2, "direction": "less_like_this"},
    {"action": "like", "created_at": "2026-05-28T09:00:00Z",
     "reason": null, "comment": null, "score": null, "direction": null}
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
 "note": "no-signal (cloud-disabled)"}
```

## Como os agentes a usam

**Scorer** (obrigatório no momento do scoring):
1. Após computar a pontuação base (soma dos componentes ponderados), chamar `feedback_query check <legacy_id>`.
2. Aplicar multiplicador baseado em `latest_action`:
   - `like` → final_score = round(base * 1.10), adicionar nota `feedback:like+10%`
   - `star` → final_score = round(base * 1.15), adicionar nota `feedback:star+15%`
   - `dislike` → final_score = round(base * 0.85), adicionar nota `feedback:dislike-15%`
   - `hide` → status=`excluded`, nota `feedback:hide`, pular escrita de pontuação
   - `null` → sem alteração
3. Limitar pontuação final a 100 após multiplicador.

**Scout** (sinal contextual opcional):
- Não para skip por posição — isso já é tratado por dedup (SC-05).
- Usar parcamente ao re-avaliar uma posição conhecida (ex. lógica de promoção): se o utilizador explicitamente deu dislike, não re-surfacar mesmo que a dedup normalmente re-pontuasse.
- **Sinal de padrão via `direction`** (mig 028): quando `latest_direction='less_like_this'` numa posição, o utilizador está a pedir menos posições COMO aquela (mesma empresa / role_family / localização). Despriorizar essa fonte/padrão em pesquisas subsequentes. Quando `latest_direction='more_like_this'`, priorizar replicar o padrão. Isto é uma dica contextual, não uma regra rígida — combinar com o panorama mais amplo (ex. um único `less_like_this` num nicho pequeno pode ser ruído; três na mesma empresa não são).

## Notas

- A skill é **read-only**. Escritas acontecem apenas do browser via POST `/api/positions/{legacy_id}/feedback`.
- O bearer token vem de `cloud.json`; sem necessidade de variável env separada.
- Timeout de 10s por chamada. Se processar muitas posições em batch, esperar ~50–200ms por chamada. Para runs em bulk, encaixar no loop com pausas de throttle como habitual.
