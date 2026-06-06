<!-- @translation: es, ai-translated 2026-06-06 -->
---
name: parse-cv
description: Pre-procesar un archivo CV/perfil (PDF, DOCX, ODT, RTF) a texto plano ANTES de alimentarlo al contexto del LLM. Reduce el costo de tokens 5-10x en CVs largos y produce extracción más confiable que leer PDFs binarios directamente vía visión multimodal. El Assistente llama esta skill en cada documento subido en `$JHT_HOME/profile/sources/` antes de poblar `candidate_profile.yml`. Para imágenes (jpg/png de CV en papel) salta esta skill — léelas vía visión directamente (el LLM es multimodal). Para formatos no soportados la skill sale con código no-cero y el Assistente pide al usuario una alternativa.
allowed-tools: Bash(pdftotext *), Bash(pandoc *), Bash(file *), Bash(test *), Bash(cat *), Bash(wc *), Bash(head *)
---

# parse-cv — extracción de texto de archivo subido por el usuario

El usuario sube su CV vía Telegram (o web drop-zone). El Assistente debe extraer los datos estructurados (nombre, rol, habilidades, experiencias) para poblar `$JHT_HOME/profile/candidate_profile.yml`.

**Sin pre-proceso**: el LLM recibe el PDF binario vía Read tool y hace el parsing directamente. Funciona pero:
- Cuesta muchos tokens (un CV de 2 páginas ≈ 3-5k tokens solo por el archivo)
- Resultados variables en PDFs escaneados / formatos no estándar
- Error silencioso en .pages/.numbers (formatos Apple no legibles)

**Con pre-proceso** (esta skill): pdftotext/pandoc extraen el texto plano en 50-200ms, el LLM recibe solo el texto (500-2000 tokens). Cinco a diez veces menos tokens, parsing más confiable.

## Cuándo ejecutarla

El Assistente llama parse-cv:
1. En cada nuevo archivo en `$JHT_HOME/profile/sources/` con extensión `.pdf .docx .doc .odt .rtf .txt`
2. **NO** en imágenes (`.jpg .jpeg .png .heic .webp`) — esas las lee directamente vía visión multimodal del LLM
3. **NO** en archivos >5 MB (probablemente no son CVs — el Assistente pide aclaración)

## Herramientas disponibles en el contenedor

Ya instaladas (verificar con `command -v`):
- `pdftotext` (vía `poppler-utils`) — PDF → texto
- `pandoc` — docx/odt/rtf/html → texto/markdown
- `file` — detectar tipo MIME
- NO disponible: `tesseract` (OCR), `unrtf` — para escaneos de baja calidad el LLM cae en visión multimodal o pide retry al usuario

## Procedimiento

```bash
SRC="$1"   # ruta al archivo en profile/sources/
[ -f "$SRC" ] || { echo "ERROR: archivo no encontrado: $SRC"; exit 2; }

# 1. Detectar MIME
MIME="$(file -b --mime-type "$SRC")"

# 2. Verificación de tamaño (límite 5 MB)
SIZE=$(stat -c%s "$SRC" 2>/dev/null || stat -f%z "$SRC")
if [ "$SIZE" -gt 5242880 ]; then
  echo "ERROR: archivo >5MB ($SIZE bytes), skip parse"
  exit 3
fi

# 3. Extracción por formato
case "$MIME" in
  application/pdf)
    # PDF: probar pdftotext (preservar layout para CVs tabulares)
    OUT="$(pdftotext -layout -nopgbrk "$SRC" - 2>/dev/null)"
    if [ -z "$OUT" ] || [ "${#OUT}" -lt 50 ]; then
      # Probable PDF escaneo (imágenes, sin capa de texto)
      echo "ERROR: capa de texto del PDF vacía (probable escaneo). Usar visión multimodal o pedir retry al usuario."
      exit 4
    fi
    ;;
  application/vnd.openxmlformats-officedocument.wordprocessingml.document|\
  application/msword|\
  application/vnd.oasis.opendocument.text|\
  application/rtf|\
  text/rtf)
    # Word/ODT/RTF: pandoc → texto plano
    OUT="$(pandoc -f auto -t plain --wrap=none "$SRC" 2>/dev/null)"
    if [ -z "$OUT" ]; then
      echo "ERROR: pandoc no logra extraer texto de $SRC ($MIME)"
      exit 5
    fi
    ;;
  text/plain|text/markdown)
    OUT="$(cat "$SRC")"
    ;;
  *)
    echo "ERROR: tipo MIME no soportado: $MIME"
    echo "       Formatos soportados: pdf, docx, doc, odt, rtf, txt, md"
    echo "       Para imágenes usar visión multimodal directamente."
    exit 6
    ;;
esac

# 4. Imprimir extracto
echo "$OUT"
```

## Códigos de salida

| Código | Significado | Acción del Assistente |
|--------|------------|----------------------|
| 0 | Extracción OK, texto en stdout | Proceder con parsing LLM sobre el texto |
| 2 | Archivo no encontrado | Bug interno, log + skip |
| 3 | Archivo >5 MB | Preguntar al usuario: "Este archivo es grande, ¿es realmente un CV? Mándame solo el CV." |
| 4 | PDF sin capa de texto (escaneo) | Fall-back: leer el PDF vía visión multimodal (el LLM "ve" la imagen). Si eso también falla, pedir retry: "El escaneo es poco legible, ¿puedes rehacer una foto más nítida o mandarme el archivo original Word/PDF?" |
| 5 | Fallo de pandoc | Preguntar: "El archivo parece corrupto. ¿Puedes re-exportarlo?" |
| 6 | MIME no soportado (ej. `.pages` Apple) | Preguntar: "No logro leer el formato. ¿Puedes exportarlo como PDF y reenviármelo?" |

## Salida esperada

Texto plano con layout preservado donde sea posible (importante para CVs con tablas/columnas). La skill NO hace parsing semántico — eso es trabajo del LLM Assistente después, leyendo el stdout de esta skill.

Ejemplo de llamada:

```bash
TEXT="$(bash /app/agents/_skills/parse-cv/extract.sh "$JHT_HOME/profile/sources/cv-marco.pdf")"
RC=$?
case $RC in
  0) # pasar $TEXT al LLM para poblar candidate_profile.yml
     ;;
  4) # PDF escaneo: leer vía visión multimodal del LLM
     ;;
  3|5|6) # pedir retry al usuario vía telegram-send
     ;;
esac
```

## Notas de diseño

- **Sin OCR explícito** (sin tesseract): añade ~200 MB a la imagen Docker y el LLM multimodal ya cubre el caso de escaneo bien.
- **Sin detección de idioma**: el LLM es multilingüe y maneja CVs en cualquier idioma (ver `agents/assistente/assistente.md` § CV upload — regla "responder en idioma del usuario, datos quedan en idioma original del CV").
- **Sin truncamiento por tamaño**: el límite de 5 MB es anti-abuso, no para CVs reales (un CV serio es 200 KB-2 MB).
- **Skill invocable en paralelo**: idempotente, sin estado externo modificado (la skill SOLO LEE el archivo e imprime).
