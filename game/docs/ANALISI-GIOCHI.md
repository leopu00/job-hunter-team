# Analisi giochi di riferimento — appunti sessione con Leone (2026-07-07)

Analisi guidata, un gioco alla volta: cosa c'è / cosa non c'è / cosa ci piace / cosa non ci piace.
Gli screenshot non sono scaricabili dalla sandbox (rete bloccata verso il CDN Steam): gli URL diretti sono stabili, salvarli a mano in `docs/refs/<gioco>/` se servono in locale.

---

## 1. Going Under (Aggro Crab, 2020) — ufficio startup come hub ✅ analizzato

Steam: https://store.steampowered.com/app/1154810/Going_Under/

**Cosa c'è:** ufficio 3D esplorabile con colleghi alle scrivanie; conversazioni con il personaggio inquadrato in primo piano ("in prima persona") e vignette/speech bubble in sequenza sopra i parlanti; open space leggibile dall'alto.

**Cosa ci piace (Leone):**
- Le schermate di conversazione: il personaggio con cui parli viene messo in primo piano, e il dialogo si costruisce con le vignette una dopo l'altra. **Questa è la direzione giusta per il nostro dialogo.**
- Il loop generale ufficio-hub (avvicinati alla scrivania → parli) funziona.

**Cosa NON ci piace (Leone):**
- Lo stile grafico: troppo colorato, troppo cartone. Non è il nostro registro (noi: noir, inchiostrato, lampade calde + neon).

**Verdetto:** direzione giusta per il *layout* della conversazione (personaggio in primo piano + vignette), stile grafico da ignorare completamente.

**Screenshot chiave (URL stabili CDN Steam):**
- Dialogo con vignette: https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/1154810/ss_44c45c7d011aa70f34bb7cdcbd925311fc9069d2.1920x1080.jpg
- Ufficio hub: https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/1154810/ss_8f0a8f20fc5b04639f5b7d95c879298eb17202d2.1920x1080.jpg

---

## 2. Yes, Your Grace ✅ analizzato

Steam: https://store.steampowered.com/app/1115690/Yes_Your_Grace/

**Cosa ci piace (Leone):**
- La grafica è **già fattibile**: questo livello di 2D/2.5D è più o meno quello che ci immaginiamo. Going Under era troppo 3D — il 3D può essere un obiettivo futuro, per ora si resta su un 2D così.

**Cosa NON ci piace / cosa manca (Leone):**
- Qui si cammina solo a destra e sinistra (side-view, veramente 2D). Noi vogliamo un **"2D tridimensionato"**: la profondità dell'ufficio c'è, cammini a destra/sinistra, su/giù e in diagonale (8 direzioni), ma resti in 2D. → È esattamente la vista top-down/¾ con Y-sort già prevista nel GDD.

**Verdetto:** livello di resa grafica di riferimento (fattibile); movimento invece a 8 direzioni con profondità, non side-scroller.

## 3. Coffee Talk ✅ analizzato (poco utile)

Steam: https://store.steampowered.com/app/914800/Coffee_Talk/

**Verdetto (Leone):** poco interessante. L'unica cosa che conferma è il pattern ricorrente della conversazione col personaggio davanti. Il resto no: pixel art (esclusa dal progetto), niente mondo esplorabile. **Nota di metodo: basta riferimenti pixel art / basta doppioni dello stesso pattern conversazione.**

## 4. VA-11 Hall-A ⏭️ saltato

Steam: https://store.steampowered.com/app/447530/VA11_HallA/
Saltato su indicazione di Leone: pixel art + stesso pattern conversazione di Coffee Talk, non aggiunge nulla.

## 5. Hades ❌ scartato da Leone

Steam: https://store.steampowered.com/app/1145360/Hades/

**Verdetto (Leone):** non serve — le schermate del gioco sono tutta un'altra cosa (action/combattimento, gioco completamente diverso dal nostro). L'unico concetto eventualmente riutilizzabile (1 ritratto illustrato + poche varianti emotive per personaggio, già nel RESEARCH-DOSSIER §2) non si vede dalle schermate dello store e non è emerso nulla di nuovo.

## 6. Disco Elysium — nord visivo isometrico noir ⬜ da analizzare

Steam: https://store.steampowered.com/app/632470/Disco_Elysium__The_Final_Cut/

## 7. The Red Strings Club — parlare è il gameplay ⬜ da analizzare

Steam: https://store.steampowered.com/app/589200/The_Red_Strings_Club/

## 8. Two Point Hospital — leggibilità dall'alto, muri di vetro ⬜ da analizzare

Steam: https://store.steampowered.com/app/535930/Two_Point_Hospital/
