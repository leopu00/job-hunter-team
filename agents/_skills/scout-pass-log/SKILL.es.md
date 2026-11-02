---
name: scout-pass-log
description: "Mide tus búsquedas para que el equipo sepa si una fuente está agotada o si la búsqueda está mal hecha. Tras cada búsqueda en una fuente anota cuántos candidatos volvieron; cuando un candidato sale de los gates anota dónde acabó. Dos comandos cortos, vocabulario cerrado, nunca texto libre."
allowed-tools: Bash(python3 /app/shared/skills/scout_pass_log.py *)
---
<!-- @translation: es, ai-translated 2026-11-02 -->

# scout-pass-log — mide lo que devuelven tus búsquedas

Desde fuera nadie puede decir si las fuentes de un perfil están agotadas o si el Scout busca mal: un candidato descartado antes del INSERT (enlace muerto, un filtro, un idioma visto en el anuncio) no dejaba rastro. Estos dos comandos dejan una línea breve cada uno. No cuestan nada y nunca detienen tu trabajo.

## Cuándo

- **Tras cada búsqueda en una fuente** (volvió una lista de candidatos): el comando `pass`.
- **Cuando cada candidato sale de los gates** (insertado, o descartado y por qué): el comando `candidate`. Añade `--opened` si descargaste la JD completa (el paso caro).

## Comandos

```bash
python3 /app/shared/skills/scout_pass_log.py pass --source greenhouse --country nl --returned 25 \
    --query-kind role --query "<the query you searched>"
python3 /app/shared/skills/scout_pass_log.py candidate --source greenhouse --country nl --outcome language --opened
python3 /app/shared/skills/scout_pass_log.py candidate --source greenhouse --country nl --outcome inserted --opened
```

## Vocabulario cerrado

`--source`: el mismo slug que das a `--source` del INSERT (`linkedin`, `greenhouse`, ...). `--country`: dos letras (`nl`), o `multi` / `remote`. `--query-kind`: `role` · `role_language` · `company` · `generic` · `other`. `--outcome`: `inserted` · `duplicate` · `dead_link` · `closed_ad` · `seniority` · `work_auth` · `domain` · `experience` · `language` · `other`.

## Reglas

- El texto libre se rechaza (salida 2, nada escrito): nunca pongas un título, una empresa, un nombre ni nada del perfil en un campo. La consulta que buscaste va en `--query` solo para reducirse a un hash; su texto nunca se guarda.
- Si se rechaza, corrige el valor y vuelve a llamar. Nunca te saltes la búsqueda o el candidato por eso.
- `language` es el resultado de un candidato que descartas porque el anuncio exige un idioma que el usuario no habla, lo hayas visto en la lista o en la JD.
- Una llamada por búsqueda y una por candidato, en la misma llamada de shell que el gate que decidió, cuando puedas.
