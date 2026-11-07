# T200 memoria e residui

## Fatto

La memoria SWR per Profilo, Dettaglio agente e Posizioni è collegata, con generazioni e reset del contesto. La persistenza disco resta spenta: pageDataIdentityReader è null.

## Fermo e perché

Privacy/export, ciclo assistito, profilo nullable, dipendenze e origine release storici restano scollegati. Non sono autorizzati deploy, migrazioni o nuova persistenza.

## Custodia Git

- Ref locale: `refs/archive/page-data-recovery-source-20261107`
- SHA: `aaadd33cafd4cf90457421b1abda764910b601b7`
- Il riferimento conserva il lavoro; questa nota non carica né applica codice.

## Ripresa

Per il disco servono fingerprint nativi verificati account+squadra da T201/T202. Per gli altri residui: confrontare il comportamento corrente e recuperare solo il delta utile, con review e prove proprie.
