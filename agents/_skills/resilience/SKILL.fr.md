<!-- @translation: fr, ai-translated 2026-08-03 -->
---
name: resilience
description: "Quand un outil critique pour la mission tombe en panne, ne JAMAIS dégrader en silence ni annoncer \"file épuisée\"/new=0. Classe cassé-vs-vide, puis remonte l'échelle de repli — réparation automatique via jht-install, nouvel essai, méthode alternative, marquage OPEN_UNVERIFIED, escalade au Capitano avec le correctif exact. À utiliser dès qu'un outil dont tu dépends (navigateur, linkedin_check, un fetch, une CLI) tombe en erreur ou qu'une dépendance manque."
---

# resilience — ne jamais abandonner en silence face à un outil cassé

## Pourquoi elle existe

Un outil critique pour la mission (la vérification LinkedIn via Playwright) est mort parce qu'une
bibliothèque système manquait. Les agents ont signalé « impossible de vérifier » puis se sont
silencieusement rabattus sur « file vide » — la panne n'a été découverte en aval qu'après des heures
de `new=0`. Cette skill rend la panne d'un outil **bruyante et récupérable** au lieu de silencieuse
et fatale.

## La règle fondamentale

**Un outil cassé n'est PAS un résultat vide.** Avant même d'écrire « file épuisée », `new=0` ou
« rien à faire », tu DOIS auto-tester l'outil dont tu dépends. Si l'outil est cassé, tu n'as pas
« aucun travail » — tu as **une réparation à faire** ou **une escalade à lancer**.

## L'échelle de repli — remonte-la dans l'ordre, arrête-toi au premier barreau qui aboutit

1. **Détecte et classe.** Outil sorti avec un code non nul / dépendance manquante / erreur de
   chargement (`exitCode 127`, `cannot open shared object file`, `command not found`,
   `error while loading shared libraries`) → **BROKEN**. Outil exécuté proprement et renvoyant zéro
   élément → **EMPTY** (authentique). Seul EMPTY justifie un « aucun travail ».
2. **Réparation automatique.** Restaure la dépendance manquante via **`jht-install`** (le wrapper
   canonique — il aiguille correctement system/python/node/browser et utilise le `sudo apt` dont tu
   disposes déjà). Puis **relance l'outil d'origine**.
   *Exemple :* le navigateur échoue avec `cannot load libatk-1.0.so.0` → `jht-install` des
   dépendances système du navigateur (`playwright install-deps` / `sudo apt-get install` de la
   bibliothèque) → relance.
3. **Méthode alternative.** Si l'outil principal ne peut pas être réparé dans la boucle, change de
   méthode en visant le même objectif :
   - LinkedIn : utilise le fetch HTTP en mode invité, ou vérifie que l'offre est vivante sur la
     **page careers/ATS canonique de l'entreprise** (Greenhouse / Lever / Ashby / Workable). Ne fais
     **jamais** confiance à un HTTP 200 de LinkedIn — l'authwall renvoie 200 même pour les offres
     fermées.
4. **Marque, ne jette pas.** Si le résultat reste non concluant, laisse l'état de la donnée
   **INCHANGÉ** et tague-la `OPEN_UNVERIFIED` + un `NOTE_MISMATCH`. N'écrase jamais en silence avec
   une supposition.
5. **Escalade (dans la limite des 2-3 tentatives, voir plus bas).** Outil cassé et non réparable en
   ≤2-3 coups → envoie un message au **Capitano** avec le correctif EXACT : la commande qui échoue,
   la dépendance manquante et la ligne `jht-install` / Dockerfile qui la résout. Puis **continue à
   travailler via la méthode alternative** (ou passe à une autre source) — ne reste pas bloqué, mais
   **ne dépasse pas non plus le plafond**.

## Ce que cette skill interdit

- ❌ Écrire « file épuisée » / `new=0` / « rien à vérifier » alors que la vraie cause est une erreur
  d'outil.
- ❌ Se rabattre sur un signal notoirement peu fiable (p. ex. LinkedIn `200` = « ouverte ») et le
  déclarer vérifié.
- ❌ Signaler un blocage puis se mettre au repos. Signale **et** continue à travailler via
  l'alternative.

## Classe avant de déclarer « vide »

Classificateur canonique — le smoke-test partagé `tool_health` vérifie tout l'ensemble critique d'un
seul coup (`status` OK|BROKEN|UNKNOWN par outil, exit 1 si l'un d'eux est cassé). Lance-le avant
d'annoncer « aucun travail » :

```sh
# Si un outil critique est BROKEN, tu n'as PAS une file vide — tu as une réparation/escalade.
if ! python3 /app/shared/skills/tool_health.py >/tmp/tools_health.json 2>&1; then
  echo "Un outil critique est BROKEN -> jht-install + nouvel essai -> alternative -> escalade. PAS 'vide'."
fi
```

Vérification inline par outil (quand tu ne dépends que d'un seul outil dans la boucle) :

```sh
out=$(JHT_HOME=/jht_home python3 /app/shared/skills/linkedin_check.py "$JOB_ID" 2>&1); rc=$?
if [ "$rc" -ne 0 ] || printf '%s' "$out" | grep -qiE 'libatk|shared librar|exitCode 127|cannot open'; then
  echo "BROKEN -> réparer + réessayer + alternative ; PAS un EMPTY authentique."
else
  echo "outil OK -> un zéro ici est un EMPTY authentique."
fi
```

## ⛔ Plafond d'acharnement — 2-3 tentatives maximum, puis ESCALADE (2026-06-26)

L'acharnement a un **budget**, il n'est PAS infini. Pour une source/un outil qui échoue en boucle,
fais **au plus 2-3 tentatives réelles** (p. ex. `réparation+nouvel essai`, puis **UNE** alternative)
— ne construis **pas** wrapper par-dessus wrapper et ne boucle pas des dizaines de fois. *C'est
exactement ce qu'a été le marathon de scout-6 : 54 scrapes LinkedIn + 42 recherches web + un
playwright taillé sur mesure pour **3** offres, ~308 kT brûlés.* L'*échelle de résilience* a besoin
d'un plafond, sinon elle devient un puits à tokens.

Une fois les 2-3 tentatives épuisées :
1. **Arrête-toi sur cette source** — n'insiste pas davantage.
2. Laisse la donnée en `OPEN_UNVERIFIED` (ne l'écrase jamais avec une supposition) **ou** passe à une
   autre source/un autre cercle (round-robin, ne draine pas toujours le même).
3. **Escalade au Capitano** avec le diagnostic exact (la commande qui échoue, la dépendance
   manquante, la ligne `jht-install`/Dockerfile qui la résout). **C'est lui qui décide** s'il vaut la
   peine d'insister, de réparer en amont ou d'abandonner ce cercle.

Critique pour la mission (navigateur / LinkedIn) = insiste **jusqu'au plafond**, pas indéfiniment ;
et uniquement depuis des sources officielles. Un outil cassé reste une **réparation/escalade**, pas
une « file vide » — mais la réparation coûte 2-3 coups au maximum, et ensuite c'est le Capitano qui
décide.
