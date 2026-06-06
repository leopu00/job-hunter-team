<!-- @translation: pt, ai-translated 2026-06-06 -->
---
name: parse-cv
description: Pré-processar um ficheiro CV/perfil (PDF, DOCX, ODT, RTF) em texto simples ANTES de o alimentar ao contexto LLM. Reduz o custo de tokens em 5-10x em CVs longos e produz extração mais fiável do que ler PDFs binários diretamente via visão multimodal. O Assistente chama esta skill em cada documento carregado em `$JHT_HOME/profile/sources/` antes de popular `candidate_profile.yml`. Para imagens (jpg/png de CV em papel) pular esta skill — lê-las via visão diretamente (o LLM é multimodal). Para formatos não suportados a skill sai com código não-zero e o Assistente pede ao utilizador uma alternativa.
allowed-tools: Bash(pdftotext *), Bash(pandoc *), Bash(file *), Bash(test *), Bash(cat *), Bash(wc *), Bash(head *)
---

# parse-cv — extração de texto de ficheiro carregado pelo utilizador

O utilizador carrega o seu CV via Telegram (ou drop-zone web). O Assistente
deve extrair os dados estruturados (nome, papel, competências, experiências) para
popular `$JHT_HOME/profile/candidate_profile.yml`.

**Sem pré-processamento**: o LLM recebe o PDF binário via tool Read e
faz o parsing diretamente. Funciona mas:
- Custa muitos tokens (um CV 2 páginas ≈ 3-5k tokens só para o ficheiro)
- Resultados variáveis em PDFs digitalizados / formatos não-standard
- Erro silencioso em .pages/.numbers (formatos Apple não legíveis)

**Com pré-processamento** (esta skill): pdftotext/pandoc extraem o
texto simples em 50-200ms, o LLM recebe apenas o texto (500-2000 tokens).
Cinco a dez vezes menos tokens, parsing mais fiável.

## Quando lançar

O Assistente chama parse-cv:
1. Em cada novo ficheiro em `$JHT_HOME/profile/sources/` com extensão
   `.pdf .docx .doc .odt .rtf .txt`
2. **NÃO** nas imagens (`.jpg .jpeg .png .heic .webp`) — essas
   são lidas diretamente via visão multimodal do LLM
3. **NÃO** em ficheiros >5 MB (provavelmente não são CVs — o Assistente
   pede esclarecimento)

## Ferramentas disponíveis no container

Já instaladas (verificar com `command -v`):
- `pdftotext` (via `poppler-utils`) — PDF → texto
- `pandoc` — docx/odt/rtf/html → texto/markdown
- `file` — detetar tipo MIME
- NÃO disponível: `tesseract` (OCR), `unrtf` — para digitalizações de baixa
  qualidade o LLM usa visão multimodal ou pede retry ao utilizador

## Procedimento

```bash
SRC="$1"   # caminho para o ficheiro em profile/sources/
[ -f "$SRC" ] || { echo "ERROR: ficheiro não encontrado: $SRC"; exit 2; }

# 1. Detetar MIME
MIME="$(file -b --mime-type "$SRC")"

# 2. Verificação de tamanho (limite 5 MB)
SIZE=$(stat -c%s "$SRC" 2>/dev/null || stat -f%z "$SRC")
if [ "$SIZE" -gt 5242880 ]; then
  echo "ERROR: ficheiro >5MB ($SIZE bytes), skip parse"
  exit 3
fi

# 3. Extração por formato
case "$MIME" in
  application/pdf)
    # PDF: tentar pdftotext (preservar layout para CVs tabulares)
    OUT="$(pdftotext -layout -nopgbrk "$SRC" - 2>/dev/null)"
    if [ -z "$OUT" ] || [ "${#OUT}" -lt 50 ]; then
      # Provável PDF digitalização (imagens, sem camada de texto)
      echo "ERROR: camada de texto do PDF vazia (provável digitalização). Usar visão multimodal ou pedir retry ao utilizador."
      exit 4
    fi
    ;;
  application/vnd.openxmlformats-officedocument.wordprocessingml.document|\
  application/msword|\
  application/vnd.oasis.opendocument.text|\
  application/rtf|\
  text/rtf)
    # Word/ODT/RTF: pandoc → texto simples
    OUT="$(pandoc -f auto -t plain --wrap=none "$SRC" 2>/dev/null)"
    if [ -z "$OUT" ]; then
      echo "ERROR: pandoc não consegue extrair texto de $SRC ($MIME)"
      exit 5
    fi
    ;;
  text/plain|text/markdown)
    OUT="$(cat "$SRC")"
    ;;
  *)
    echo "ERROR: tipo MIME não suportado: $MIME"
    echo "       Formatos suportados: pdf, docx, doc, odt, rtf, txt, md"
    echo "       Para imagens usar visão multimodal diretamente."
    exit 6
    ;;
esac

# 4. Imprimir extrato
echo "$OUT"
```

## Códigos de saída

| Código | Significado | Ação do Assistente |
|--------|-------------|-------------------|
| 0 | Extração OK, texto em stdout | Prosseguir com parsing LLM no texto |
| 2 | Ficheiro não encontrado | Bug interno, log + skip |
| 3 | Ficheiro >5 MB | Perguntar ao utilizador: "Este ficheiro é grande, é mesmo um CV? Envia-me apenas o CV." |
| 4 | PDF sem camada de texto (digitalização) | Fallback: ler o PDF via visão multimodal (o LLM "vê" a imagem). Se isso também falhar, pedir retry: "A digitalização é pouco legível, podes tirar uma foto mais nítida ou enviar-me o ficheiro original Word/PDF?" |
| 5 | Falha do pandoc | Perguntar: "O ficheiro parece corrompido. Podes tentar exportá-lo novamente?" |
| 6 | MIME não suportado (ex. `.pages` Apple) | Perguntar: "Não consigo ler o formato. Podes exportá-lo como PDF e reenviar?" |

## Output esperado

Texto simples com layout preservado onde possível (importante para CVs
com tabelas/colunas). A skill NÃO faz parsing semântico — isso é
trabalho do LLM Assistente depois, lendo o stdout desta skill.

Exemplo de chamada:

```bash
TEXT="$(bash /app/agents/_skills/parse-cv/extract.sh "$JHT_HOME/profile/sources/cv-marco.pdf")"
RC=$?
case $RC in
  0) # passar $TEXT ao LLM para popular candidate_profile.yml
     ;;
  4) # PDF digitalização: ler via visão multimodal do LLM
     ;;
  3|5|6) # pedir retry ao utilizador via telegram-send
     ;;
esac
```

## Notas de projeto

- **Sem OCR explícito** (sem tesseract): adiciona ~200 MB à imagem
  Docker e o LLM multimodal já cobre o caso de digitalização bem.
- **Sem deteção de idioma**: o LLM é multilingue e gere CVs
  em qualquer idioma (ver `agents/assistente/assistente.md` § CV
  upload — regra "responder no idioma do utilizador, dados ficam no idioma
  original do CV").
- **Sem truncagem por tamanho**: o limite 5 MB é anti-abuso, não
  para CVs reais (um CV sério tem 200 KB-2 MB).
- **Skill chamável em paralelo**: idempotente, sem estado externo
  modificado (a skill APENAS LÊ o ficheiro e imprime).
