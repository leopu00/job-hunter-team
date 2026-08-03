<!-- @translation: pt, ai-translated 2026-08-03 -->
---
name: recheck-liveness
description: "Verifica se um anúncio AINDA ESTÁ ABERTO sem produzir falsos abertos. Substitui o curl improvisado (HTTP 200 = \"aberto\") que NÃO vê a expiração renderizada em JavaScript (Ashby/Workday/Greenhouse) nem a authwall do LinkedIn (200 também para os fechados). Usa-a SEMPRE no recheck; nunca definas is_open à mão a partir de um único HTTP 200."
allowed-tools: Bash(python3 /app/shared/skills/recheck_liveness.py *)
---

# recheck-liveness — "o anúncio ainda está aberto?", feito como deve ser

## Porque existe
O recheck antigo era um curl improvisado (`code=200 marker=none → aberto`). O curl só vê o HTML EM
BRUTO, por isso em muitos ATS (Ashby/Workday/Greenhouse) e no LinkedIn o estado
"expirado/fechado" é renderizado em JS ou fica atrás de uma authwall → o curl não o vê →
`is_open=1` em anúncios que já estão FECHADOS. Dados sujos a jusante (score, mapa).

## Como usá-la
```sh
python3 /app/shared/skills/recheck_liveness.py "<url>" "[título opcional]"
```
Saída JSON + exit code:
| state | exit | significado |
|---|---|---|
| `OPEN` | 0 | abertura verificada |
| `CLOSED` | 1 | fechado/expirado (404/410 ou marcador de fecho) |
| `OPEN_UNVERIFIED` | 2 | impossível verificar (host JS/authwall + browser em baixo) |

## O que faz (por níveis)
1. **curl** rápido: código HTTP + varrimento dos marcadores de fecho (EN+IT) + 404/410.
2. host **ATS-JS / LinkedIn** ou código ambíguo → **escalar para o BROWSER**
   (render com Playwright) e novo varrimento dos marcadores sobre o HTML RENDERIZADO.
3. continua incerto → **`OPEN_UNVERIFIED`** — NUNCA um falso aberto (padrão `resilience`).

## Regra de ouro
- `is_open=1` **APENAS** se `state == OPEN`.
- `state == CLOSED` → `status='expired'` + uma nota que inclua a `evidence`.
- `state == OPEN_UNVERIFIED` → **deixa `is_open` inalterado** + uma nota `[OPEN_UNVERIFIED]`;
  não o faças passar por aberto.
- O curl improvisado "200 = aberto" está **proibido** como forma de decidir a liveness.
