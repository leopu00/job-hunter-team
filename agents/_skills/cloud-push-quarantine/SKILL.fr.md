---
name: cloud-push-quarantine
description: Inspecte et récupère les lignes isolées par le push cloud après un rejet serveur, sans exposer leur contenu. À utiliser lorsque sync-health signale push_quarantine.
allowed-tools: Bash(jht cloud quarantine *)
---

# cloud-push-quarantine — inspecter, réessayer, résoudre

Le push laisse passer les données valides et ne conserve pour la ligne rejetée
que des métadonnées sûres : table/type, identité opaque, motif assaini,
tentatives et horodatages. Ne demandez ni n'affichez jamais la ligne source.

1. Inspectez avec `jht cloud quarantine list`. Ne rapportez que le nombre, la
   table, l'identité opaque, le code du motif, les tentatives et horodatages.
2. Corrigez la cause locale via le workflow propriétaire. Ne modifiez pas
   `jobs.db` à la main et n'ajoutez aucun cas spécial par table ou code erreur.
3. Réessayez avec `jht cloud quarantine retry <opaque-id>`. Le writer cloud
   canonique est utilisé. Lisez le résultat puis relancez list : un succès
   passe à `resolved`.
4. Utilisez `jht cloud quarantine resolve <opaque-id> --confirm` uniquement
   après avoir vérifié que la ligne locale a été volontairement supprimée ou
   remplacée et qu'aucun nouvel essai n'est requis. L'historique est conservé.

`retry all` n'est permis qu'après correction d'une cause commune et contrôle de
toutes les tables. Ne copiez jamais corps, titres, chemins, user IDs, détails
serveur ou identifiants dans les chats, logs ou le journal.
