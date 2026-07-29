<!-- @translation: pt, ai-translated 2026-06-06 -->
---
name: feedback-query
description: Ler feedback do utilizador (like/dislike/hide/star) a partir da cloud — uma posição de cada vez, ou agregado numa janela. Usado pelo Scorer para aplicar um multiplicador na pontuação final e para levar o motivo do utilizador para a nota, pelo Mentor para contar os motivos recorrentes (Padrão F) e pelo Scout como sinal contextual. Retorna um payload neutro "sem sinal" quando a cloud está desativada ou inalcançável, para que os chamadores nunca falhem de forma crítica.
allowed-tools: Bash(python3 *)
---

# feedback-query — Feedback do utilizador por posição

O utilizador pode clicar like/dislike/hide/star em qualquer posição a partir do dashboard web. Esses cliques são armazenados no Supabase `position_feedback` (mig 019 base + mig 028 extendida) e expostos aos agentes via esta skill. Schema:

| Coluna              | Tipo    | Significado |
|---------------------|---------|---------|
| `position_legacy_id`| TEXT    | O `legacy_id` (string) da posição em `positions` |
| `action`            | TEXT    | Um de `like`, `dislike`, `hide`, `star`, `clear` (mig 059 — o utilizador retira o juízo; ganha o último evento, portanto um `clear` no fim significa "sem juízo") |
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

## Leitura agregada (janela sobre todas as posições)

Uma única chamada HTTP em vez de N: `GET /api/positions/feedback?days=&limit=`, mesmo bearer token, mesmo fallback neutro.

```bash
# Todos os eventos de feedback na janela, do mais recente
python3 /app/shared/skills/feedback_query.py recent --days 30

# Os motivos escritos pelo utilizador, agrupados por semelhança
python3 /app/shared/skills/feedback_query.py themes --days 30 --min-positions 3
```

Saída de `themes`:

```json
{"ok": true, "window_days": 30, "field": "both",
 "events_total": 31, "events_with_text": 19,
 "positions_with_text": 17, "positions_cleared": 2,
 "by_action": {"like": 6, "dislike": 21, "hide": 3, "star": 1},
 "min_positions": 3,
 "themes": [
   {"key": "tropp senio", "label": "troppo senior",
    "positions": 7, "events": 8, "share": 0.412,
    "actions": {"dislike": 6, "hide": 2},
    "legacy_ids": ["42", "51", "63"],
    "examples": ["troppo senior", "richiesta troppo seniore — Lead role"]}
 ]}
```

Como funciona o agrupamento (nenhuma correspondência exata exigida, nenhuma dependência nova): minúsculas → acentos fora → pontuação fora → palavras funcionais fora → cada palavra cortada aos primeiros 5 caracteres (`senior` / `seniority` / `seniore` / `séniorité` caem numa só chave) → contam-se palavras isoladas e **pares adjacentes**, por **posições distintas**, não por eventos. Um par absorve as suas partes quando cobre ≥ 80% das mesmas posições, por isso "demasiado senior" ganha a "senior"; os intensificadores ficam no fluxo de propósito. `reason` e `comment` são tokenizados em separado, portanto nenhum par é inventado a cavalo dos dois.

Limites deliberados, declarados para que ninguém leia nos números mais do que lá está:
- Sinónimos distantes ficam separados (`salário` e `RAL` são dois temas) — isto é contagem de palavras, não semântica. Lê os `examples` (verbatim, máx. 3) e junta com a cabeça.
- As posições cujo **último** evento é `clear` ficam de fora (o juízo foi retirado); `--include-cleared` traz-nas de volta.
- `share` = posições do tema / `positions_with_text`.
- `--field reason|comment|both` (padrão `both`), `--top N`, `--days 0` para todo o histórico.
- Fallback quando o endpoint agregado não responde: `--legacy-ids 12,13,14` lê essas posições uma a uma (mais lento, mesmo formato de saída).

Flags: `--days` (padrão 30, `0` = tudo), `--limit` (padrão 500 eventos), `--min-positions` (padrão 3), `--text-chars` em `recent` (padrão 300, trunca comentários longos).

Quando o payload traz uma `note` (`no-signal (...)`), não há agregado: cloud desligada, endpoint ausente ou rede em baixo. Trata isso como "sem dados", nunca como "sem feedback".

## Como os agentes a usam

**Scorer** (obrigatório no momento do scoring):
1. Após computar a pontuação base (soma dos componentes ponderados), chamar `feedback_query check <legacy_id>`.
2. Aplicar multiplicador baseado em `latest_action`:
   - `like` → final_score = round(base * 1.10), adicionar nota `feedback:like+10%`
   - `star` → final_score = round(base * 1.15), adicionar nota `feedback:star+15%`
   - `dislike` → final_score = round(base * 0.85), adicionar nota `feedback:dislike-15%`
   - `hide` → status=`excluded`, nota `feedback:hide`, pular escrita de pontuação
   - `clear` / `null` → sem alteração (um juízo retirado não é um juízo)
3. **Leva o motivo para a nota**, quando o utilizador escreveu um. Pega em `reason` (ou, se vazio, `comment`) do **mesmo evento** de `latest_action` — `actions[0]` — cita-o literalmente, corta a ~80 caracteres e acrescenta-o à nota:

   ```
   feedback:dislike-15% — "demasiado senior"
   feedback:star+15% — "exatamente a stack que quero"
   ```

   Sem texto nesse evento → a nota fica como está. O motivo vale **só para esta posição**: nunca o leves para outra, não o transformes numa regra, não o reescrevas nem o resumas — são palavras do utilizador e o utilizador relê-as. Agregar os motivos através das posições é trabalho do Mentor (Padrão F), não do Scorer.
4. Limitar pontuação final a 100 após multiplicador.

**Mentor** (Padrão F, read-only): `themes` sobre os últimos 30 dias para contar os motivos que o utilizador escreve. Limiares e interpretação vivem na skill `mentor-patterns`. O Mentor fala **ao utilizador** — nunca emite instruções de pesquisa a partir deste dado.

**Scout** (sinal contextual opcional):
- Não para skip por posição — isso já é tratado por dedup (SC-05).
- Usar parcamente ao re-avaliar uma posição conhecida (ex. lógica de promoção): se o utilizador explicitamente deu dislike, não re-surfacar mesmo que a dedup normalmente re-pontuasse.
- **Sinal de padrão via `direction`** (mig 028): quando `latest_direction='less_like_this'` numa posição, o utilizador está a pedir menos posições COMO aquela (mesma empresa / role_family / localização). Despriorizar essa fonte/padrão em pesquisas subsequentes. Quando `latest_direction='more_like_this'`, priorizar replicar o padrão. Isto é uma dica contextual, não uma regra rígida — combinar com o panorama mais amplo (ex. um único `less_like_this` num nicho pequeno pode ser ruído; três na mesma empresa não são).

## Notas

- A skill é **read-only**. Escritas acontecem apenas do browser via POST `/api/positions/{legacy_id}/feedback`.
- O bearer token vem de `cloud.json`; sem necessidade de variável env separada.
- Timeout de 10s em `check`, 20s na chamada agregada. Se processar muitas posições com `check`, esperar ~50–200ms por chamada — é exatamente o que `recent` / `themes` existem para evitar.
- O agregado é restrito ao utilizador do lado do servidor: devolve o feedback deste utilizador e mais nada.
