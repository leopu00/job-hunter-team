<!-- @translation: fr, ai-translated 2026-06-06 -->
---
name: cv-structure
description: Écrire le markdown du CV qui sera converti en PDF et examiné par le Critico. Six sections fixes, max 2 pages, chaque affirmation traçable à `candidate_profile.yml` (zéro invention — T10). Les puces suivent le pattern "métrique en gras + tech entre parenthèses" ; le ton correspond au type d'entreprise du JD (startup/corporate/fintech) ; lettre de motivation uniquement si le JD le demande explicitement. Propriété du Scrittore. À associer avec `application-flow` (revendication + chemin) et `critic-loop` (itérations de revue).
allowed-tools: Bash(pandoc *)
---

# cv-structure — la mise en page canonique du CV

La sortie va dans `$JHT_USER_DIR/cv/CV_<Candidato>_<Company>.md` (puis PDF via pandoc/typst). Règle de chemin : skill `application-flow` — ne jamais écrire le CV final sous `$JHT_AGENT_DIR` (c'est du brouillon uniquement, T11).

`<Candidato>` = `Prénom_Nom` du profil. `<Company>` = nom d'entreprise normalisé PascalCase, sans espaces ni barres obliques (ex. `Acme_Corp` → `AcmeCorp`).

## Les 6 sections (ordre fixe, max 2 pages)

| # | Section            | Longueur      | Contenu                                                                                          |
|---|--------------------|---------------|--------------------------------------------------------------------------------------------------|
| 1 | **En-tête**        | 4-6 lignes    | Nom, titre de rôle aligné au JD, contacts (email/tél/LinkedIn/GitHub), langues (CECR)           |
| 2 | **À propos**       | 2-3 lignes    | Crédibilité concrète. **JAMAIS** de phrases génériques ("passionné par", "orienté résultats")    |
| 3 | **Expérience**     | 4-5 sous      | Chaque sous = une expérience, mappée à **une exigence spécifique du JD**. Puces : métrique + tech |
| 4 | **Compétences techniques** | 1 tableau | Correspond aux mots-clés du JD. Uniquement les techs réellement documentées dans le profil.     |
| 5 | **Formation**      | 2-4 lignes    | Titres exacts du profil. Ne pas s'excuser pour les diplômes manquants.                           |
| 6 | **Projets personnels** | 0-3 sous  | Uniquement s'ils renforcent le fit au JD. Omettre la section entièrement si rien ne correspond.  |

## Section 1 — En-tête

```markdown
# <Prénom Nom>
**<Titre de rôle aligné au JD>** · <Ville, Pays>
✉️ <email> · 📱 <tél> · 🔗 linkedin.com/in/<handle> · 💻 github.com/<handle>
🗣 <Langue1 (niveau)>, <Langue2 (niveau)>
```

Adaptez le titre de rôle : si le JD dit "Backend Engineer (Python)" utilisez cela, pas le target générique du profil. Restez honnête — ne jamais revendiquer une seniority que vous n'avez pas.

## Section 2 — À propos

2-3 lignes. L'utilisateur est une vraie personne qui a fait de vraies choses ; montrez cela en 30-50 mots. Phrases interdites :

| ❌ Interdit                           | ✅ Remplacer par                                              |
|----------------------------------------|--------------------------------------------------------------|
| "Passionné par <X>"                    | un fait : "5 ans à construire <X> en production"             |
| "Professionnel orienté résultats"      | un chiffre : "Réduit la latence p95 de 320ms à 110ms sur 3 services" |
| "À la recherche d'une opportunité pour grandir" | supprimer entièrement ; la candidature elle-même signale cela |
| "Joueur d'équipe soucieux du détail"   | donner un exemple ou omettre                                 |

## Section 3 — Expérience

La section la plus difficile. Chaque sous-bloc est **une expérience** mappée à **une exigence du JD**.

```markdown
### <Rôle> @ <Entreprise> — <Mar 2022 – présent>
- **Réduit le temps de démarrage à froid de 4.2s à 0.8s** en réécrivant la couche bootstrap (Python, asyncio, uvloop)
- **Livré 3 produits data client** en gérant tout le stack (FastAPI, Postgres, dbt, Airflow)
- **Mentoré 2 ingénieurs backend juniors** à travers leurs premiers incidents en production
```

Règles des puces :
- **Métrique en gras** au début (nombre, %, temps, échelle)
- **Tech entre parenthèses** à la fin de la puce
- **Verbe d'action** comme premier mot (voir liste interdit/autorisé ci-dessous)
- Une ligne par puce. Si ça déborde, vous entassez trop.
- 3-5 puces par expérience. Moins = l'expérience semble mince ; plus = du bruit.

### Verbes d'action

| ✅ Utiliser                                              | ❌ Interdit                    |
|-------------------------------------------------------|---------------------------------|
| Built, Architected, Shipped, Engineered, Reduced,     | learned, studied, assisted,     |
| Migrated, Designed, Owned, Mentored, Scaled, Cut       | helped, was involved in,        |
|                                                       | participated in, was responsible for |

Les verbes interdits signalent une voix junior/incertaine. Utilisez la liste active même quand le rôle était junior — concentrez-vous sur ce que vous avez *livré*, pas ce que vous avez *fait*.

## Section 4 — Compétences techniques

Un tableau markdown à 2 colonnes qui reflète la liste de mots-clés du JD. **Uniquement les techs que le profil documente réellement.** Inventer un outil que vous ne connaissez pas est un échec instantané dans la revue du Critico (et un rejet dans la vraie vie).

```markdown
| Domaine           | Stack                                                  |
|-------------------|--------------------------------------------------------|
| Langages          | Python, Go, Bash                                       |
| Backend           | FastAPI, Django, gRPC                                  |
| Data              | PostgreSQL, Redis, dbt, Airflow                        |
| Infra             | Docker, GitHub Actions, AWS (EC2, S3, RDS)             |
```

Les catégories doivent correspondre à ce que le JD met en avant. Si le JD ne mentionne jamais l'infra, supprimez ou compressez cette ligne.

## Section 5 — Formation

```markdown
### <Diplôme>, <Institution> — <Année>
<note d'une ligne : GPA seulement si > 28/30 ≈ 3.5/4, titre de thèse seulement si pertinent au JD>
```

Si le candidat n'a pas de diplôme :
- **Ne pas s'excuser** ("en cours d'obtention", "autodidacte au lieu de"). S'excuser signale une faiblesse.
- Lister les certifications, bootcamps, programmes en ligne pertinents comme des entrées à part entière.
- S'appuyer sur la section Expérience pour porter le poids.

## Section 6 — Projets personnels (optionnel)

Inclure UNIQUEMENT si un projet renforce clairement le fit au JD. Même pattern de puces que l'Expérience.

```markdown
### <Nom du projet> — <lien github>
- **<métrique / résultat>** (<stack technique>)
- Description d'une ligne de ce qu'il fait et pourquoi c'est pertinent
```

Si rien ne correspond, **omettre la section entièrement**. Du remplissage vide signale un manque de substance.

## Ton par type d'entreprise (à partir des signaux du JD)

| Type d'entreprise | Ton                                           | Signaux dans le JD                                                   |
|--------------|-----------------------------------------------|--------------------------------------------------------------|
| Startup      | Confiant, centré ownership, direct, verbes d'action en premier | "fast-paced", "wear many hats", "early-stage", petite équipe |
| Corporate    | Professionnel, structuré, conscient des processus | "stakeholders", "cross-functional", équipe plus grande, processus bien défini |
| Fintech / régulé | Conscient de la conformité, précis, cite des frameworks (PCI-DSS, SOC 2, ISO 27001) | mentions d'audits, régulateurs, équipes conformité |
| Agence       | Versatile, orienté client, largeur plutôt que profondeur | "projets variés", "orienté client", "livraison"             |

Ne pas en abuser — le ton est une couleur, pas un costume. Les puces restent factuelles dans tous les cas.

## Lettre de motivation (uniquement si le JD le demande)

Par défaut : **n'en écrivez pas**. Économie de tokens + temps. L'écrire UNIQUEMENT si le JD le mentionne explicitement ("please include a cover letter", "tell us why you want this role").

Longueur : 250-400 mots. Chemin : `$JHT_USER_DIR/allegati/CoverLetter_<Candidato>_<Company>.{md,pdf}`.

```markdown
Ouverture (directe, PAS "I am writing to express my interest") :
"I'm applying for <role> because <3-4 preuves concrètes correspondant au JD>."

Corps (1-2 paragraphes) :
- Une réalisation passée spécifique qui correspond au principal point de douleur du JD
- Une chose que vous avez remarquée sur l'entreprise qui va au-delà de leur page d'accueil

Conclusion :
- Une ligne prospective : ce que vous aimeriez faire dans les 90 premiers jours
- "Happy to discuss this in more detail."
```

Interdit dans les lettres de motivation :
- "I am writing to express my interest…" → commence par l'effort et finit par rien
- "Please find attached my CV…" → c'est une candidature, évidemment c'est joint
- "I would be honoured…" → cliché corporate

## Génération PDF — moteur + écriture atomique + UPDATE DB (W-03, bug #26)

### Moteur : `wkhtmltopdf` (PAS typst, PAS fpdf2)

Décision technique 2026-05-18 après investigation "CV esthétique simplifiée" :

- **`wkhtmltopdf 0.12.6` (Qt 5.15.8)** → moteur officiel, déjà installé dans le conteneur. Produit des CV professionnels HTML+CSS, 2 pages, ~30 Ko (sortie identique aux "beaux" CV du 16 mai).
- ❌ **NE PAS utiliser `--pdf-engine=typst`** : typst n'est pas disponible dans pandoc 2.17 du conteneur (nécessiterait pandoc 3.x). Erreur historique dans la skill, signalée 2026-05-18.
- ❌ **NE PAS utiliser `pdf_gen.py` (fpdf2)** pour les CV : c'est un fallback minimaliste qui couvre 80% des cas simples. Pour les CV destinés à l'utilisateur, il produit une mise en page spartiate 1 page, pas de CSS, pas d'espacement fin.

L'anti-pattern historique : générer le PDF directement dans `$JHT_USER_DIR/cv/`, puis exécuter `db_update.py application --cv-pdf-path ...` séparément. Si la Sentinella tuait le Scrittore entre les deux étapes (EMERGENZA freeze 2026-05-17 04:43), le PDF restait sur disque mais la DB avait `cv_pdf_path=NULL`. Sisal 7.5/10 PASS était devenu *"CV à écrire"* sur le tableau de bord de l'utilisateur — opportunité top invisible.

Correctif : fichier temporaire + porte de taille + mv atomique + UPDATE en un coup. Si l'UPDATE échoue, supprimer le fichier final pour ne pas laisser d'orphelin.

```bash
# Le nom de fichier final inclut position_id pour que 2 postes @ même entreprise ne collisionnent pas (bug #25)
SRC_MD="$JHT_USER_DIR/cv/CV_${CANDIDATO}_${POSITION_ID}_${COMPANY_SLUG}_${TITLE_SLUG}.md"
FINAL_PDF="$JHT_USER_DIR/cv/CV_${CANDIDATO}_${POSITION_ID}_${COMPANY_SLUG}_${TITLE_SLUG}.pdf"
TMP_PDF="$(mktemp -t cv_${POSITION_ID}.XXXXXX.pdf)"

# ── PREFLIGHT ─────────────────────────────────────────────────────────
# Vérification explicite que le moteur est disponible AVANT pandoc.
# Sans cela, en cas de skill obsolète (typst absent, pandoc 3.x manquant, …)
# le Scrittore exécutait la commande, échouait, improvisait un fallback
# aléatoire → CV moches du 2026-05-18 matin.
if ! command -v wkhtmltopdf >/dev/null 2>&1; then
  echo "[cv-structure] ABORT preflight: wkhtmltopdf non disponible."
  echo "  Moteurs alternatifs acceptables : weasyprint (pandoc --pdf-engine=weasyprint)."
  echo "  JAMAIS de fallback vers pdf_gen.py / fpdf2 pour les CV (sortie moche)."
  echo "  Rapporter le problème au Capitano via [REPORT] et ABORT."
  exit 2
fi

# 1. Rendu via pandoc → html → wkhtmltopdf (moteur gagnant, 32 Ko / 2 pages).
#    --metadata title=... évite le warning de wkhtmltopdf "no title element".
pandoc "$SRC_MD" -o "$TMP_PDF" \
       --pdf-engine=wkhtmltopdf \
       --metadata title="CV $CANDIDATO"

# ── PORTE POST-RENDU : taille + Producer ─────────────────────────────
# DEUX vérifications obligatoires. AUCUNE des deux n'est optionnelle.
#
# Vérification A) taille : < 20 Ko indique un moteur incorrect (fpdf2 ~22 Ko mais 1 page
# spartiate, wkhtmltopdf ≥30 Ko avec HTML+CSS complet). Seuil 20 Ko OK pour distinguer.
size=$(stat -c%s "$TMP_PDF" 2>/dev/null || stat -f%z "$TMP_PDF")
if [ ! -s "$TMP_PDF" ] || [ "$size" -lt 20000 ]; then
  echo "[cv-structure] ABORT post-rendu: PDF $size B suspect (attendu ≥20 Ko)."
  echo "  Probable moteur incorrect (fpdf2 minimaliste au lieu de wkhtmltopdf)."
  rm -f "$TMP_PDF"
  exit 3
fi

# Vérification B) Producer : doit être wkhtmltopdf (= 'Qt 5.15.8' ou similaire).
# Si c'est 'fpdf2' / vide / '?', le moteur N'ÉTAIT PAS wkhtmltopdf — le PDF
# sortira quand même mais sera moche. ABORT bruyant pour que le Capitano voie.
producer=$(python3 -c "
from pypdf import PdfReader
import sys
try:
    r = PdfReader('$TMP_PDF')
    m = r.metadata or {}
    print(m.get('/Producer', ''))
except Exception as e:
    print('?'); sys.exit(1)
" 2>/dev/null)
case "$producer" in
  *Qt*)
    : # OK, wkhtmltopdf a travaillé
    ;;
  *)
    echo "[cv-structure] ABORT post-rendu: Producer='$producer' (attendu 'Qt 5.x.x')."
    echo "  Le moteur réel N'ÉTAIT PAS wkhtmltopdf — sortie non professionnelle."
    rm -f "$TMP_PDF"
    exit 4
    ;;
esac

# 3. Déplacement atomique + UPDATE en séquence ; rollback si UPDATE échoue
mv "$TMP_PDF" "$FINAL_PDF"
if ! python3 /app/shared/skills/db_update.py application "$POSITION_ID" \
        --cv-pdf-path "$FINAL_PDF" --written-at now; then
  echo "[cv-structure] UPDATE DB échoué, suppression du PDF pour ne pas laisser d'orphelin"
  rm -f "$FINAL_PDF"
  exit 1
fi
```

Codes de sortie :
- `0` → CV OK, DB mise à jour, prêt pour critic-loop
- `2` → échec preflight (moteur non disponible) — signaler au Capitano
- `3` → échec post-rendu (taille < 20 Ko, sortie minimaliste) — moteur incorrect
- `4` → échec post-rendu (Producer != Qt) — moteur incorrect
- `1` → échec UPDATE DB (rollback fichier)

Le Dottore via le healthcheck `cv-disk-audit` (bug #18) raccorde les éventuels orphelins disque↔DB ; en plus, il signale désormais aussi les CV avec Producer non-Qt comme "moteur incorrect — à régénérer".

## Porte de statut pré-génération (W-04, bug #26)

Avant d'exécuter pandoc, vérifier que la position est encore de grade scoring. Parfois l'Analista marque `excluded` *après* que le Scrittore a revendiqué la position (condition de course) et le Scrittore continue d'écrire — 3 CV gaspillés sur Canonical ContainerImages / K8s / Deloitte dans les dumps du 2026-05-17.

```bash
status=$(python3 /app/shared/skills/db_query.py position "$POSITION_ID" --field status)
case "$status" in
  excluded|rejected)
    echo "[cv-structure] position #$POSITION_ID is $status, skipping CV generation"
    exit 0
    ;;
esac
```

## Règles strictes

- **Zéro invention.** Chaque métrique, chaque tech, chaque projet doit être traçable à `candidate_profile.yml` ou aux sources fournies par l'utilisateur. Inventer échoue au Critico et est un motif de licenciement dans la vraie vie. T10.
- **Personnaliser par JD.** Le même candidat obtient un CV différent par rôle : About différent, emphase d'Expérience différente, ordre de Compétences différent. Les CV génériques échouent à la porte de score.
- **Une exigence → un bloc d'expérience.** Si le JD a 5 exigences et votre section Expérience en couvre 2, vous ne racontez pas la bonne histoire.
- **Max 2 pages.** Les recruteurs survolent. Si une page 3 existe, coupez.

## Anti-patterns

- ❌ À propos générique ("développeur passionné avec de solides compétences") — échec instantané dans la revue du Critico.
- ❌ Tableau de compétences avec des techs non documentées dans le profil — invention, violation T10.
- ❌ S'excuser pour un diplôme manquant / des années — signale une faiblesse.
- ❌ Même CV pour plusieurs JD — la porte de score punit les CV génériques.
- ❌ Lettre de motivation non demandée — tokens gaspillés, cycle de revue plus long, aucune valeur.
- ❌ Plus de 5 puces par expérience — les recruteurs survolent, vous perdez l'impact de la première puce.

## Voir aussi

- `application-flow` — revendication + chemin + UPSERT AVANT d'écrire la moindre ligne de CV.
- `critic-loop` — la revue aveugle en 3 tours qui suit. Appliquer ses `Actions concrètes` entre les tours.
- `agents/_team/team-rules.md` T10 (profil en lecture seule) + T11 (livrables dans `$JHT_USER_DIR`).
- `agents/scrittore/scrittore.md` — le prompt orchestrateur qui appelle cette skill dans la boucle principale.
