<!-- @translation: es, ai-translated 2026-08-03 -->
---
name: recheck-liveness
description: "Comprueba si una oferta SIGUE ABIERTA sin producir falsos abiertos. Sustituye al curl improvisado (HTTP 200 = \"abierta\") que NO ve la caducidad renderizada en JavaScript (Ashby/Workday/Greenhouse) ni el authwall de LinkedIn (200 también para las cerradas). Úsala SIEMPRE en el recheck; nunca fijes is_open a mano a partir de un único HTTP 200."
allowed-tools: Bash(python3 /app/shared/skills/recheck_liveness.py *)
---

# recheck-liveness — "¿la oferta sigue abierta?", hecho como es debido

## Por qué existe
El recheck antiguo era un curl improvisado (`code=200 marker=none → abierta`). curl solo ve el HTML
EN BRUTO, así que en muchos ATS (Ashby/Workday/Greenhouse) y en LinkedIn el estado
"caducada/cerrada" se renderiza en JS o queda detrás de un authwall → curl no lo ve → `is_open=1` en
ofertas que ya están CERRADAS. Datos sucios aguas abajo (score, mapa).

## Cómo se usa
```sh
python3 /app/shared/skills/recheck_liveness.py "<url>" "[título opcional]"
```
Salida JSON + exit code:
| state | exit | significado |
|---|---|---|
| `OPEN` | 0 | apertura verificada |
| `CLOSED` | 1 | cerrada/caducada (404/410 o marcador de cierre) |
| `OPEN_UNVERIFIED` | 2 | imposible verificar (host JS/authwall + navegador caído) |

## Qué hace (por niveles)
1. **curl** rápido: código HTTP + escaneo de marcadores de cierre (EN+IT) + 404/410.
2. host **ATS-JS / LinkedIn** o código ambiguo → **escalar al NAVEGADOR**
   (render con Playwright) y volver a escanear los marcadores sobre el HTML RENDERIZADO.
3. sigue sin estar claro → **`OPEN_UNVERIFIED`** — NUNCA un falso abierto (patrón `resilience`).

## Regla de oro
- `is_open=1` **SOLO** si `state == OPEN`.
- `state == CLOSED` → `status='expired'` + una nota que recoja la `evidence`.
- `state == OPEN_UNVERIFIED` → **deja `is_open` sin cambios** + una nota `[OPEN_UNVERIFIED]`;
  no lo hagas pasar por abierta.
- El curl improvisado de "200 = abierta" está **prohibido** como forma de decidir la liveness.
