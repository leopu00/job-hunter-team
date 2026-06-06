<!-- @translation: fr, ai-translated 2026-06-06 -->
---
name: parse-cv
description: Pré-traiter un fichier CV/profil (PDF, DOCX, ODT, RTF) en texte brut AVANT de l'injecter dans le contexte LLM. Réduit le coût en tokens de 5-10x sur les longs CV et produit une extraction plus fiable que la lecture directe de PDF binaires via la vision multimodale. L'Assistente appelle cette skill sur chaque document uploadé dans `$JHT_HOME/profile/sources/` avant de remplir `candidate_profile.yml`. Pour les images (jpg/png de CV papier), sauter cette skill — les lire via la vision directement (le LLM est multimodal). Pour les formats non supportés, la skill sort non-zero et l'Assistente demande une alternative à l'utilisateur.
allowed-tools: Bash(pdftotext *), Bash(pandoc *), Bash(file *), Bash(test *), Bash(cat *), Bash(wc *), Bash(head *)
---

# parse-cv — extraction de texte depuis un fichier uploadé par l'utilisateur

L'utilisateur uploade son CV via Telegram (ou la zone de dépôt web). L'Assistente doit extraire les données structurées (nom, rôle, compétences, expériences) pour remplir `$JHT_HOME/profile/candidate_profile.yml`.

**Sans pré-traitement** : le LLM reçoit le PDF binaire via l'outil Read et fait le parsing directement. Ça fonctionne mais :
- Coûte beaucoup de tokens (un CV 2 pages ≈ 3-5k tokens rien que pour le fichier)
- Résultats variables sur les PDF scannés / formats non-standard
- Erreur silencieuse sur .pages/.numbers (formats Apple non lisibles)

**Avec pré-traitement** (cette skill) : pdftotext/pandoc extraient le texte brut en 50-200ms, le LLM reçoit uniquement le texte (500-2000 tokens). Cinq à dix fois moins de tokens, parsing plus fiable.

## Quand la lancer

L'Assistente appelle parse-cv :
1. Sur chaque nouveau fichier dans `$JHT_HOME/profile/sources/` avec extension `.pdf .docx .doc .odt .rtf .txt`
2. **PAS** sur les images (`.jpg .jpeg .png .heic .webp`) — celles-ci sont lues directement via la vision multimodale du LLM
3. **PAS** sur les fichiers >5 Mo (probablement pas des CV — l'Assistente demande clarification)

## Outils disponibles dans le conteneur

Déjà installés (vérifier avec `command -v`) :
- `pdftotext` (via `poppler-utils`) — PDF → texte
- `pandoc` — docx/odt/rtf/html → texte/markdown
- `file` — détecter le type MIME
- NON disponible : `tesseract` (OCR), `unrtf` — pour les scans de basse qualité, le LLM s'appuie sur la vision multimodale ou demande un renvoi à l'utilisateur

## Procédure

```bash
SRC="$1"   # chemin vers le fichier dans profile/sources/
[ -f "$SRC" ] || { echo "ERROR: file non trovato: $SRC"; exit 2; }

# 1. Détecter le MIME
MIME="$(file -b --mime-type "$SRC")"

# 2. Vérification de taille (limite 5 Mo)
SIZE=$(stat -c%s "$SRC" 2>/dev/null || stat -f%z "$SRC")
if [ "$SIZE" -gt 5242880 ]; then
  echo "ERROR: file >5MB ($SIZE bytes), skip parse"
  exit 3
fi

# 3. Extraction par format
case "$MIME" in
  application/pdf)
    # PDF : essayer pdftotext (préserver la mise en page pour les CV tabulaires)
    OUT="$(pdftotext -layout -nopgbrk "$SRC" - 2>/dev/null)"
    if [ -z "$OUT" ] || [ "${#OUT}" -lt 50 ]; then
      # Probable PDF scanné (images, pas de couche texte)
      echo "ERROR: PDF text layer vuoto (probabile scansione). Usa vision multimodal o chiedi retry all'utente."
      exit 4
    fi
    ;;
  application/vnd.openxmlformats-officedocument.wordprocessingml.document|\
  application/msword|\
  application/vnd.oasis.opendocument.text|\
  application/rtf|\
  text/rtf)
    # Word/ODT/RTF : pandoc → texte brut
    OUT="$(pandoc -f auto -t plain --wrap=none "$SRC" 2>/dev/null)"
    if [ -z "$OUT" ]; then
      echo "ERROR: pandoc non riesce a estrarre testo da $SRC ($MIME)"
      exit 5
    fi
    ;;
  text/plain|text/markdown)
    OUT="$(cat "$SRC")"
    ;;
  *)
    echo "ERROR: MIME type non supportato: $MIME"
    echo "       Formati supportati: pdf, docx, doc, odt, rtf, txt, md"
    echo "       Per immagini usa vision multimodal direttamente."
    exit 6
    ;;
esac

# 4. Afficher l'extrait
echo "$OUT"
```

## Codes de sortie

| Code | Signification | Action de l'Assistente |
|------|-------------|-------------------|
| 0 | Extraction OK, texte sur stdout | Procéder avec le parsing LLM sur le texte |
| 2 | Fichier non trouvé | Bug interne, loguer + sauter |
| 3 | Fichier >5 Mo | Demander à l'utilisateur : "Ce fichier est volumineux, est-ce vraiment un CV ? Envoyez-moi juste le CV." |
| 4 | PDF sans couche texte (scan) | Fallback : lire le PDF via la vision multimodale (le LLM "voit" l'image). Si ça échoue aussi, demander un renvoi : "Le scan est peu lisible, pouvez-vous refaire une photo plus nette ou m'envoyer le fichier original Word/PDF ?" |
| 5 | Échec pandoc | Demander : "Le fichier semble corrompu. Pouvez-vous le ré-exporter et me le renvoyer ?" |
| 6 | MIME non supporté (ex. `.pages` Apple) | Demander : "Je n'arrive pas à lire le format. Pouvez-vous l'exporter en PDF et me le renvoyer ?" |

## Sortie attendue

Texte brut avec mise en page préservée quand possible (important pour les CV avec tableaux/colonnes). La skill NE FAIT PAS de parsing sémantique — c'est le travail du LLM Assistente après, en lisant le stdout de cette skill.

Exemple d'appel :

```bash
TEXT="$(bash /app/agents/_skills/parse-cv/extract.sh "$JHT_HOME/profile/sources/cv-marco.pdf")"
RC=$?
case $RC in
  0) # passer $TEXT au LLM pour remplir candidate_profile.yml
     ;;
  4) # PDF scanné : lire via la vision multimodale du LLM
     ;;
  3|5|6) # demander un renvoi à l'utilisateur via telegram-send
     ;;
esac
```

## Notes de conception

- **Pas d'OCR explicite** (pas de tesseract) : ajoute ~200 Mo à l'image Docker et le LLM multimodal couvre déjà bien le cas scan.
- **Pas de détection de langue** : le LLM est multilingue et gère les CV dans n'importe quelle langue (voir `agents/assistente/assistente.md` § Upload CV — règle "répondre dans la langue de l'utilisateur, les données restent dans la langue originale du CV").
- **Pas de troncature basée sur la taille** : la limite de 5 Mo est anti-abus, pas pour les CV réels (un CV sérieux fait 200 Ko-2 Mo).
- **Skill appelable en parallèle** : idempotente, pas d'état externe modifié (la skill SEULEMENT LIT le fichier et imprime).
