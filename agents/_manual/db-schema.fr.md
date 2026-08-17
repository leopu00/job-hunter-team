<!-- @translation: fr, ai-translated 2026-06-06 -->
# Schéma de Base de Données — jobs.db (V6)

**Mis à jour** : 2026-05-29
**Version du schéma** : `PRAGMA user_version = 6`
**Changements par rapport à V5** : ajout des colonnes `positions.write_requested` (INTEGER DEFAULT 0) et `positions.write_requested_at` (TIMESTAMP) pour Writer-on-demand. L'utilisateur sélectionne depuis le tableau de bord web (bouton "Écrire CV") ou via Telegram (`/cv <id>`) les postes pour lesquels il souhaite un CV ; le Capitaine génère des Rédacteurs on-demand uniquement lorsque le flag est activé. Migration idempotente via `_migrate_positions_write_requested()` (ALTER TABLE ADD COLUMN). Voir BACKLOG [JHT-WRITER-ON-DEMAND] (2026-05-29) et mig Supabase 024.
**Changements V4→V5** : ajout de la table `pending_user_messages` pour le pattern fallback de notifications via cloud sync (décision 2026-05-13 — Telegram en panne/non configuré ⇒ écriture en DB ⇒ cloud sync ⇒ tableau de bord web). La migration est non destructive : `CREATE TABLE IF NOT EXISTS` + trigger touch_updated_at standard. Les DB pré-V5 se mettent à jour automatiquement à la première `ensure_schema()`.
**Changements V3→V4** : ajout des colonnes `created_at` et `updated_at` uniformes sur les 5 tables de données, avec `DEFAULT CURRENT_TIMESTAMP` (nouvelles DB) et trigger `touch_updated_at` (AFTER UPDATE) qui maintient `updated_at` automatiquement mis à jour à chaque UPDATE. Les champs de domaine (`scored_at`, `applied_at`, `written_at`, `analyzed_at`, `found_at`, `last_checked`) restent pour la sémantique des événements. Migration rétroactive automatique via `_migrate_v3_to_v4()` dans `shared/skills/_db.py` : ALTER TABLE ADD COLUMN (sans DEFAULT — limite SQLite) + UPDATE des lignes existantes avec les champs de domaine `*_at` comme fallback (ex. `created_at = COALESCE(found_at, CURRENT_TIMESTAMP)`).
**Changements V2→V3** : ajout du `CHECK` constraint sur `positions.status`. Migration via `_migrate_v2_to_v3()`.
**Chemin** : `$JHT_HOME/jobs.db` (canonique) ou `$JHT_DB=<fichier>`. Hors conteneur, la copie du dépôt `shared/data/jobs.db` doit être DEMANDÉE avec `JHT_DB_FALLBACK=1` : sans aucune de ces variables, le module échoue au lieu de deviner un chemin (O-26).
**Scripts de compétences** : `shared/skills/`

Ce fichier est la RÉFÉRENCE OFFICIELLE du schéma de la base de données. Tous les agents doivent lire CE fichier pour connaître la structure des tables et les commandes disponibles.

---

## Tables

### companies
| Colonne | Type | Défaut | Notes |
|---------|------|--------|-------|
| id | INTEGER PK | AUTOINCREMENT | |
| name | TEXT NOT NULL UNIQUE | | Nom de l'entreprise (clé de correspondance) |
| website | TEXT | | URL du site web de l'entreprise |
| hq_country | TEXT | | Pays du siège principal |
| sector | TEXT | | Secteur (fintech, ai, etc.) |
| size | TEXT | | Taille (startup, PME, enterprise) |
| glassdoor_rating | REAL | | Note Glassdoor |
| red_flags | TEXT | | Signaux d'alerte trouvés |
| culture_notes | TEXT | | Notes sur la culture d'entreprise |
| analyzed_by | TEXT | | Qui l'a analysée (analista-1, etc.) |
| analyzed_at | TIMESTAMP | CURRENT_TIMESTAMP | Quand elle a été analysée |
| verdict | TEXT | | GO, CAUTIOUS, NO_GO |
| logo | TEXT | | **mig 056** — data-URI base64 du logo (≤ ~35KB) — écrit UNIQUEMENT par `logo_fetch.py` |
| logo_source | TEXT | | **mig 056** — URL source du logo (audit/refresh) |
| logo_fetched | INTEGER | 0 | **mig 056** — 1 = extraction tentée (patron office_geocoded) ; file `next-for-logo-missing` |
| created_at | TIMESTAMP | CURRENT_TIMESTAMP | **V4** — insertion de ligne |
| updated_at | TIMESTAMP | CURRENT_TIMESTAMP | **V4** — mis à jour automatiquement à chaque UPDATE via trigger |

### positions
| Colonne | Type | Défaut | Notes |
|---------|------|--------|-------|
| id | INTEGER PK | AUTOINCREMENT | |
| title | TEXT NOT NULL | | Titre du poste |
| company | TEXT NOT NULL | | Nom de l'entreprise (texte) |
| company_id | INTEGER FK | NULL | Lien vers companies(id) — résolu automatiquement |
| location | TEXT | | Localisation unifiée (Remote EU, London, etc.) |
| remote_type | TEXT | | full_remote, hybrid, onsite |
| salary_declared_min | INTEGER | | Salaire déclaré dans la JD — minimum |
| salary_declared_max | INTEGER | | Salaire déclaré dans la JD — maximum |
| salary_declared_currency | TEXT | EUR | Devise du salaire déclaré |
| salary_estimated_min | INTEGER | | Salaire estimé — minimum |
| salary_estimated_max | INTEGER | | Salaire estimé — maximum |
| salary_estimated_currency | TEXT | EUR | Devise du salaire estimé |
| salary_estimated_source | TEXT | | Source de l'estimation : glassdoor, levels.fyi, manual |
| url | TEXT | | URL de la description de poste |
| source | TEXT | | linkedin, indeed, glassdoor, dynamite, etc. |
| jd_text | TEXT | | Texte COMPLET de la description de poste |
| requirements | TEXT | | Exigences extraites de la JD |
| found_by | TEXT | | Qui l'a trouvée (scout-1, etc.) |
| found_at | TIMESTAMP | CURRENT_TIMESTAMP | Quand elle a été trouvée |
| deadline | TEXT | | Date limite (YYYY-MM-DD ou "non présente") |
| status | TEXT | new | new → checked → scored → writing → ready → applied → response · `excluded` depuis n'importe quelle étape. **V3 : restreint par `CHECK` constraint** — les valeurs absentes de cette liste sont rejetées avec `IntegrityError`. |
| notes | TEXT | | Notes libres |
| last_checked | TIMESTAMP | | Dernière vérification du lien/JD |
| write_requested | INTEGER | 0 | **V6** — `1` = l'utilisateur a demandé un CV pour ce poste (via bouton web ou `/cv` Telegram). Le Capitaine interroge cette colonne pour générer des Rédacteurs on-demand. |
| write_requested_at | TIMESTAMP | NULL | **V6** — quand l'utilisateur a demandé le CV. Utilisé par le Capitaine pour le tri FIFO lors de la génération des Rédacteurs. |
| created_at | TIMESTAMP | CURRENT_TIMESTAMP | **V4** — insertion de ligne |
| updated_at | TIMESTAMP | CURRENT_TIMESTAMP | **V4** — mis à jour automatiquement à chaque UPDATE via trigger |

### position_highlights
| Colonne | Type | Défaut | Notes |
|---------|------|--------|-------|
| id | INTEGER PK | AUTOINCREMENT | |
| position_id | INTEGER FK NOT NULL | | Lien vers positions(id) |
| type | TEXT NOT NULL | | pro, con |
| text | TEXT NOT NULL | | Texte du pour/contre |
| created_at | TIMESTAMP | CURRENT_TIMESTAMP | **V4** — insertion de ligne |
| updated_at | TIMESTAMP | CURRENT_TIMESTAMP | **V4** — mis à jour automatiquement à chaque UPDATE via trigger |

### scores
| Colonne | Type | Défaut | Notes |
|---------|------|--------|-------|
| id | INTEGER PK | AUTOINCREMENT | |
| position_id | INTEGER FK NOT NULL UNIQUE | | Lien vers positions(id) |
| total_score | INTEGER NOT NULL | | Score total 0-100 |
| stack_match | INTEGER | | Sous-score stack /40 |
| remote_fit | INTEGER | | Sous-score télétravail /25 |
| salary_fit | INTEGER | | Sous-score salaire /20 |
| experience_fit | INTEGER | | Sous-score expérience |
| strategic_fit | INTEGER | | Sous-score stratégique /15 |
| breakdown | TEXT | | Détail du score |
| notes | TEXT | | Notes du scorer |
| scored_by | TEXT | | Qui a attribué le score |
| scored_at | TIMESTAMP | CURRENT_TIMESTAMP | Quand le score a été attribué |
| created_at | TIMESTAMP | CURRENT_TIMESTAMP | **V4** — insertion de ligne |
| updated_at | TIMESTAMP | CURRENT_TIMESTAMP | **V4** — mis à jour automatiquement à chaque UPDATE via trigger |

### applications
| Colonne | Type | Défaut | Notes |
|---------|------|--------|-------|
| id | INTEGER PK | AUTOINCREMENT | |
| position_id | INTEGER FK NOT NULL UNIQUE | | Lien vers positions(id) |
| cv_path | TEXT | | Chemin du CV markdown |
| cl_path | TEXT | | Chemin de la lettre de motivation markdown |
| cv_pdf_path | TEXT | | Chemin du CV PDF |
| cl_pdf_path | TEXT | | Chemin de la lettre de motivation PDF |
| critic_verdict | TEXT | | PASS, NEEDS_WORK, REJECT |
| critic_score | REAL | | Note du critique (1-10) |
| critic_notes | TEXT | | Notes du critique |
| status | TEXT | draft | draft (par défaut) — le flag opérationnel est `applied` (BOOLEAN). Les états `review/approved` ne sont pas actuellement renseignés par les agents. |
| written_at | TIMESTAMP | | Quand le CV a été créé |
| applied_at | TIMESTAMP | | Quand la candidature a été envoyée |
| applied_via | TEXT | | Où elle a été envoyée (linkedin, site, etc.) |
| response | TEXT | | Réponse reçue |
| response_at | TIMESTAMP | | Quand la réponse est arrivée |
| written_by | TEXT | | Qui a rédigé (scrittore-1, etc.) |
| reviewed_by | TEXT | | Qui a effectué la relecture |
| critic_reviewed_at | TIMESTAMP | | Défini automatiquement avec --critic-score |
| applied | BOOLEAN | 0 | TRUE si l'utilisateur a envoyé |
| interview_round | INTEGER | NULL | Phase de l'entretien (1, 2, 3...) |
| cv_drive_id | TEXT | | ID du fichier Google Drive du CV PDF |
| cl_drive_id | TEXT | | ID du fichier Google Drive de la lettre PDF |
| created_at | TIMESTAMP | CURRENT_TIMESTAMP | **V4** — insertion de ligne |
| updated_at | TIMESTAMP | CURRENT_TIMESTAMP | **V4** — mis à jour automatiquement à chaque UPDATE via trigger |

### pending_user_messages

**V5** — file de notifications utilisateur avec fallback sur le tableau de bord web lorsque Telegram n'est pas disponible/configuré. Chaque agent souhaitant communiquer avec l'utilisateur effectue une INSERT ici AVANT de tenter Telegram : si l'envoi Telegram réussit, l'agent met à jour `delivered_via='telegram'` ; s'il échoue ou si Telegram n'est pas configuré, il laisse `delivered_via='web'` et la ligne est synchronisée sur Supabase via `jht cloud push` → le tableau de bord web la présente à l'utilisateur. La réponse de l'utilisateur via le web revient dans les colonnes `user_reply`/`user_reply_at` ; au cycle suivant, l'agent voit le marqueur et répond par le même canal.

| Colonne | Type | Défaut | Notes |
|---------|------|--------|-------|
| id | INTEGER | PK AUTOINCREMENT | |
| agent | TEXT | NOT NULL | Qui écrit : `capitano`, `mentor`, `assistente`, ... |
| body | TEXT | NOT NULL | Texte du message (markdown autorisé) |
| kind | TEXT | 'notification' | `notification` / `question` / `digest` / `alert` |
| related_position_id | INTEGER | FK positions(id) | Optionnel — pour les notifications liées à une offre |
| delivered_via | TEXT | NULL | `telegram` (livré via bot) / `web` (en attente sur le tableau de bord) / NULL (en file) |
| delivered_at | TIMESTAMP | | Quand il a été livré sur le canal choisi |
| acknowledged_at | TIMESTAMP | | L'utilisateur a lu/classé via le tableau de bord |
| user_reply | TEXT | | Réponse de l'utilisateur via le tableau de bord web (optionnel) |
| user_reply_at | TIMESTAMP | | Quand l'utilisateur a répondu |
| agent_seen_reply_at | TIMESTAMP | | Quand l'agent a vu la réponse — utilisé par le marqueur de protection prompt-injection pour éviter les traitements en double |
| cloud_synced_at | TIMESTAMP | | Défini par `jht cloud push` |
| created_at | TIMESTAMP | CURRENT_TIMESTAMP | |
| updated_at | TIMESTAMP | CURRENT_TIMESTAMP | Mis à jour automatiquement à chaque UPDATE via trigger |

---

## Index

| Nom | Table | Colonnes |
|-----|-------|----------|
| idx_positions_status | positions | status |
| idx_positions_company | positions | company |
| idx_positions_company_id | positions | company_id |
| idx_positions_url | positions | url |
| idx_positions_write_requested | positions | write_requested (partiel WHERE = 1) |
| idx_scores_total | scores | total_score |
| idx_applications_status | applications | status |
| idx_pending_user_messages_agent | pending_user_messages | agent |
| idx_pending_user_messages_delivery | pending_user_messages | delivered_via, acknowledged_at |
| idx_pending_user_messages_unseen_reply | pending_user_messages | user_reply_at, agent_seen_reply_at |

---

## Commandes CLI

### Requêtes
```bash
python3 shared/skills/db_query.py dashboard                    # Tableau de bord complet
python3 shared/skills/db_query.py stats                        # Comptages des tables
python3 shared/skills/db_query.py positions --status new       # Filtrer par état
python3 shared/skills/db_query.py positions --min-score 70     # Filtrer par score
python3 shared/skills/db_query.py position 42                  # Détail individuel
python3 shared/skills/db_query.py companies --verdict GO       # Entreprises par verdict
python3 shared/skills/db_query.py company "Azienda"            # Détail de l'entreprise
python3 shared/skills/db_query.py check-url 4361788825         # Vérifier les doublons
python3 shared/skills/db_query.py next-for-scorer              # File du scorer
python3 shared/skills/db_query.py next-for-scrittore           # File du rédacteur
python3 shared/skills/db_query.py next-for-critico             # ⚠️ legacy — le Critique est aujourd'hui généré par le Rédacteur, il ne pioche pas dans la file
```

### Insertion
```bash
# Poste (Scout)
python3 shared/skills/db_insert.py position \
  --title "Python Developer" --company "Azienda" \
  --location "Remote EU" --remote-type full_remote \
  --salary-declared-min 40000 --salary-declared-max 65000 \
  --url "https://..." --source linkedin --found-by scout-1 \
  --jd-text "TESTO COMPLETO JD" --requirements "Python, Flask"

# Entreprise (Analista)
python3 shared/skills/db_insert.py company \
  --name "Azienda" --hq-country "Italia" --sector "fintech" \
  --verdict GO --analyzed-by analista-1

# Score (Scorer)
python3 shared/skills/db_insert.py score \
  --position-id 42 --total 85 --stack-match 35 --remote-fit 20 \
  --salary-fit 15 --experience-fit 5 --strategic-fit 10 --scored-by scorer

# Candidature (Rédacteur)
python3 shared/skills/db_insert.py application \
  --position-id 42 --cv-path "..." --cl-path "..." \
  --cv-pdf-path "..." --cl-pdf-path "..." \
  --written-by scrittore-1 --written-at now

# Point fort/faible (Analista/Scorer)
python3 shared/skills/db_insert.py highlight \
  --position-id 42 --type pro --text "Stack identico"
```

### Mise à jour
```bash
# État du poste
python3 shared/skills/db_update.py position 42 --status checked

# Salaire déclaré
python3 shared/skills/db_update.py position 42 --salary-declared-min 40000 --salary-declared-max 55000

# Salaire estimé
python3 shared/skills/db_update.py position 42 \
  --salary-estimated-min 35000 --salary-estimated-max 50000 --salary-estimated-source glassdoor

# Dernière vérification (OBLIGATOIRE après vérification du lien)
python3 shared/skills/db_update.py position 42 --last-checked now

# Note du critique (critic_reviewed_at est défini automatiquement)
python3 shared/skills/db_update.py application 42 \
  --critic-verdict PASS --critic-score 8.5 --critic-notes "note"

# Candidature envoyée (applied=1 est défini automatiquement avec --applied-at)
python3 shared/skills/db_update.py application 42 \
  --applied-at "2026-02-28" --applied-via linkedin

# Réponse
python3 shared/skills/db_update.py application 42 \
  --response "rejected" --response-at now

# Phase d'entretien (1=premier entretien, 2=deuxième, etc.)
python3 shared/skills/db_update.py application 42 --interview-round 1
```

### Synchronisation (stockage cloud optionnel)
```bash
python3 shared/skills/db_to_sheets.py sync            # DB → Google Sheets
python3 shared/skills/db_to_sheets.py sync --dry-run  # Aperçu sans écriture

python3 shared/skills/db_to_supabase.py sync          # DB → Supabase (miroir en lecture seule)
python3 shared/skills/db_to_supabase.py sync --dry-run

python3 shared/skills/db_to_drive.py sync             # CV/CL PDF → Google Drive
python3 shared/skills/db_to_drive.py sync --dry-run
```

### Migration
```bash
python3 shared/skills/db_migrate_v2.py --verify       # Vérifier l'intégrité
```

---

## Comportements automatiques

| Action | Effet automatique |
|--------|-------------------|
| `--critic-score X` | Définit `critic_reviewed_at = NOW` |
| `--applied-at "..."` | Définit `applied = 1` |
| Insert position avec `--company "X"` | Résolution automatique de `company_id` depuis companies |
| Update position avec `--company "X"` | Résolution automatique de `company_id` depuis companies |

---

## Pipeline des états

```
new → checked → scored → writing → ready → applied → response
  │       │         │         │       │
  ▼       ▼         ▼         ▼       ▼
        excluded (lien mort, non qualifié, score < 40, critic_score < 5, etc.)
```

**État par phase :**
- `new` — le Scout vient d'insérer (Phase 1)
- `checked` — l'Analyste a vérifié et promu (Phase 2) · `excluded` si [LINK_MORTO/SCAM/GEO/LINGUA/SENIORITY/STACK]
- `scored` — le Scorer a attribué un score (Phase 3) · `excluded` si score < 40
- `writing` — le Rédacteur l'a pris en charge (Phase 4) — claim coordonné entre pairs
- `ready` — le Round 3 du Critique a donné un score ≥ 5 (Phase 4) · `excluded` si score < 5
- `applied` — l'utilisateur a confirmé l'envoi (Phase 5) — manuel, jamais par l'équipe
- `response` — réponse reçue (`interview`/`rejected`/`ghosted`) — flag géré par l'utilisateur
