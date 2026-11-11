---
name: scout-language-gate
description: "Elige países y consultas según los idiomas del perfil y descarta a un candidato cuyo anuncio exige un idioma que el usuario no habla ANTES de descargar el anuncio completo. `plan` una vez y `screen` en cada candidato con título y snippet. Caso real: 100 de 100 candidatos de un portal descartados por idioma tras la descarga completa."
allowed-tools: Bash(python3 /app/shared/skills/scout_language.py *)
---
<!-- @translation: es, ai-translated 2026-11-02 -->

# scout-language-gate — primero el idioma, luego la descarga

El idioma es el corte que más a menudo mata a un candidato DESPUÉS de haber pagado la búsqueda, la descarga del anuncio completo y a veces el INSERT. Esta skill lo aplica en código, antes de la descarga, con lo que la lista ya muestra. No inventa: descarta solo con pruebas, y un idioma que el perfil habla, un anuncio en inglés o un texto demasiado corto nunca se descartan.

## 1. Planifica la búsqueda

`plan` da a cada país un modo. `local`: el perfil habla allí un idioma de trabajo. `english_friendly`: los puestos en inglés son comunes y el perfil habla inglés: búscalo, añadiendo los calificadores que imprime (`English-speaking`, `international team`, `English required`). `english_only`: solo merece la pena abrir anuncios en inglés. No excluye nada (prioridad sí, exclusión no, SC-04): empieza por el `order` que imprime y no gastes las primeras pasadas en países `english_only`. También lista los `portals`: los portales de empleo escritos en el idioma de su país que el perfil no sabe leer (jobs.ch, jobup, jobnet, stepstone-de...) son `skip`, igual que EURES en un país cuyo idioma el perfil no habla (`eures`): no los busques (`portal --source S --country CC` responde por uno, salida 10 = skip). Las listas ATS nunca se excluyen aquí.

## 2. Revisa cada candidato antes de la descarga

Pasa a `screen` el título y, si la fuente lo muestra, el snippet. `skip_language` (salida 10): no lo descargues; con `--log` ya deja su línea en el log de pasadas (resultado `language`, sin abrir). `ok` o `unknown`: sigue por los gates como siempre. Solo lee el texto de la lista: tras la descarga completa el anuncio pasa por los filtros del Gate 4 y por el Analista como antes.

```bash
# once, before choosing countries and queries: the plan for THIS profile's languages
python3 /app/shared/skills/scout_language.py plan

# for each candidate, from what the LIST shows, BEFORE you fetch the full ad (exit 10 = drop it)
python3 /app/shared/skills/scout_language.py screen --title "<title>" --snippet "<the list's snippet, if any>" \
    --country nl --source greenhouse --log

# one job board in one country (exit 10 = it is in the language of its country and the profile cannot read it: skip it)
python3 /app/shared/skills/scout_language.py portal --source jobs.ch --country ch
```

## 3. Pon al final el nivel que no es el del perfil (nunca lo descartes)

`screen` también responde `"seniority": "above"` o `"below"` cuando el TÍTULO nombra un nivel (Senior, Principal, Head of, Junior, Trainee...) que no es el de ESTE perfil: su `seniority_target`, si no sus años de experiencia. Para un perfil senior `Senior` y `Principal` no dan ningún código: son su objetivo. Es un ORDEN, no un veredicto: en la misma pasada inserta primero los candidatos sin `seniority` y después los que lo llevan, y nunca descartes uno por eso (la brecha de seniority la decide el Scorer; regla SC-04). En un primer arranque cada uno de los que el Analista tuvo que excluir por nivel costó una descarga y un INSERT y retrasó el 20.º puntaje.

## Reglas

- Nunca saltes a un candidato que `screen` no descartó por adivinar su idioma: la herramienta descarta con pruebas, tú no.
- Pasa el texto tal como está en la lista. La respuesta solo contiene códigos (`required_language`, `ad_language`, `title_language`) y nada del anuncio se guarda.
- Si no se pueden leer los idiomas del perfil, `screen` responde `unknown` a todo y no descarta nada.
