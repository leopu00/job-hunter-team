---
name: scout-coverage
description: "Busca los portales nacionales core de los idiomas del perfil ANTES de cualquier fuente menor y sabe cuánto del plan está hecho. `next` indica el portal, el país que registrar y el tipo de consulta; un portal está cubierto con 3 pasadas y 3 consultas distintas, y «agotado» exige los portales core cubiertos. Lanza `next` al empezar cada búsqueda."
allowed-tools: Bash(python3 /app/shared/skills/scout_coverage.py *) Bash(python3 /app/shared/skills/scout_pass_log.py *)
---

# scout-coverage — dónde buscar primero, y cuánto está hecho

Busca PRIMERO donde están los mercados propios del perfil y sabe cuánto está hecho. Una prueba real consultó 105 fuentes una vez cada una y nunca abrió los portales nacionales principales del idioma del usuario: «agotado» se declaró con el mercado de casa intacto. Esta skill da la lista (portales nacionales de cada idioma que habla el perfil, primero los core, luego los English-first y remote) y el contador sobre tu propio registro de pasadas.

## 1. Pregunta qué viene después, en cada búsqueda

`next` imprime una línea JSON: el portal (`source`, `country`, `tier`), el TIPO de consulta (`query_kind`: `broad` = una consulta AMPLIA, siempre la primera: la familia del rol o una palabra de entrada sola (en `broad_terms`), sin título completo y sin lugar, `role_language` = el título en el idioma del portal, `role` = el título en inglés, `synonym` = un título cercano, `level` = el título con una palabra de nivel del idioma, listadas en `level_terms`, `city` = el título con un lugar, listados en `cities`), lo que tienes (`have`) frente a lo necesario (`need`) y la línea `log` para usar después. Busca exactamente eso y registra la pasada con el mismo `--query-kind`. `plan_done: true` significa plan hecho: pasa a las otras fuentes.

```bash
# the next thing to search: portal, country to log, kind of query, and the line to log it with
python3 /app/shared/skills/scout_coverage.py next

# the whole plan for this profile (once), and how much of it is done (any time)
python3 /app/shared/skills/scout_coverage.py plan
python3 /app/shared/skills/scout_coverage.py status

# after the search: the same portal, country and kind that `next` named
python3 /app/shared/skills/scout_pass_log.py pass --source platsbanken --country se --query-kind role_language --query "<the query you ran>" --returned 12
# a portal that answers 403 / a login wall / a challenge (closed) or 410 (gone): ONE pass closes it
python3 /app/shared/skills/scout_pass_log.py pass --source platsbanken --country se --returned 0 --status closed
```

## Reglas

- La PRIMERA pregunta a un portal es siempre `broad`: una palabra de `broad_terms` o la familia del rol, SOLA. Un portal que une las palabras con AND responde 0 a «junior project coordinator» + una ciudad y cientos a «praktik». Lee TODOS los resultados, cada página, y filtralos tú contra el perfil. Un portal solo está cubierto con una pasada `broad`, además de las 3 consultas distintas y la de su idioma.
- Platsbanken (Suecia) tiene una API pública, sin clave: `python3 /app/shared/skills/platsbanken_search.py --q "praktik" --city stockholm --no-experience --query-kind broad --log`. Los tablones de empresas de un país: `python3 /app/shared/skills/scout_coverage.py boards --country se`.
- Para los demás países `next` (y `plan`) da, cuando la tabla los tiene, `api` y `hint`: la dirección pública que responde en JSON o datos abiertos sin clave (Alemania: Arbeitnow y la búsqueda de jobs.ch; Bélgica: Le Forem; Portugal: Landing.jobs) y la dirección de búsqueda de cada portal. Pregunta ESA, no la página de inicio, con una palabra AMPLIA, y lee todas las páginas. Los tablones de empresas de FR, DE, ES, PT, NL, BE, CH y AT: `python3 /app/shared/skills/scout_coverage.py boards --country <cc>`.
- Un tablón de empresa (Greenhouse, Lever, Teamtailor) se lee ENTERO con `python3 /app/shared/skills/ats_board_search.py --provider greenhouse --board truecaller --country se --log --query-kind broad`: reconoce el país en cualquier forma del lugar, da la seniority leída del título y dice cuántos anuncios quitó cada motivo (`counts`, `dropped`). Lee `dropped` antes de decir que un tablón está vacío; `--drop-seniority senior,lead` y `--title-any` los eliges tú, no quita nada si no se lo pides.
- Primero los core, luego los menores: ninguna fuente menor mientras `next` nombre un portal core.
- Un portal está CUBIERTO con 3 pasadas y 3 consultas DISTINTAS (una en el idioma del portal si no es inglés). La misma consulta tres veces cuenta una: cambia el tipo, no las palabras.
- Un portal que responde 403, 410, un muro de login o un challenge queda CERRADO con UNA pasada registrada `--status closed` (o `gone` para el 410): dilo y sigue, no insistas.
- `exhausted` (`scout_exhaustion.py check`) exige los portales core cubiertos además de fuentes, consultas y minutos: `core_missing` dice adónde te falta ir.
- Del perfil nunca se escribe nada: el registro tiene slugs, códigos de país, tipos y cuentas.
