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

## 6. Disco Elysium ⭐⭐ RIFERIMENTO PRINCIPALE (confermato da Leone)

Steam: https://store.steampowered.com/app/632470/Disco_Elysium__The_Final_Cut/

**Verdetto (Leone):** "Esattamente quello che stavo cercando" — uno dei suoi giochi preferiti, era la grafica che aveva in testa senza ricordare il nome. **Punto di riferimento principale del progetto, soprattutto per la grafica.**

**Cosa ci piace (Leone):**
- La grafica in toto: il vibe, i colori, il modo di disegnare (pittorico a mano). "Voglio prendere soprattutto da questo videogioco."
- È il "2D tridimensionato" giusto: isometrico, cammini in tutte le direzioni con profondità reale, ma tutto dipinto, niente 3D vero né pixel.

**Differenza col nostro (Leone):**
- DE è una open map grande (quartieri, edifici, si cammina per la città). Noi restiamo **dentro la box**: un solo ufficio, anche se può essere grande.

**Per la sessione dev1 — estrazione dello stile DE:**

1. Scarica questi screenshot (URL stabili, CDN Steam) in `game/docs/refs/disco-elysium/` e **aprili/guardali** prima di toccare la grafica degli ambienti:
   - https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/632470/ss_b3694e99ffdb686d1bbbbe16a540d3d2ccd509c4.1920x1080.jpg (esterno isometrico)
   - https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/632470/ss_9125a718ee9ba85386ae5d4eb820f3266073fc97.1920x1080.jpg (layout dialogo con pannello laterale)
   - https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/632470/ss_dec29c440fab2f7817d68c1380c019290eb1755e.1920x1080.jpg
   - Altre: pagina Steam 632470 e artbook ufficiale (DLC "Soundtrack & Artbooklet").
2. Caratteri del look da replicare (in ordine di importanza):
   - **Pittorico con pennellate visibili**: niente riempimenti flat uniformi; texture da pittura a olio/acquerello sporco su pavimenti e muri.
   - **Valore prima del colore**: scene scure e desaturate, la luce definisce le zone — pozze calde (lampade) su ambiente freddo. Contrasto di valore forte, colori smorzati con pochi accenti.
   - **Bordi imperfetti**: contorni rotti/materici, non linee vettoriali pulite.
   - **Camera fissa isometrica**: ogni inquadratura componibile come un quadro.
3. In Godot: sfondi come **texture dipinte** (anche generate + paintover) invece di forme procedurali flat; grana/vignette a schermo intero; luci come gradienti additivi caldi. Gli SVG flat attuali vanno bene come blockout, non come resa finale.

**Note tecniche per replicare il look (dal RESEARCH-DOSSIER §3.1):**
- Sfondi = scene 3D di blocco ridipinte a mano; normal map dipinte a mano per far cadere la luce "come pensa un illustratore"; camera fissa → ogni schermata art-directed come un quadro.
- ⚠️ Da riconciliare col GDD: il GDD dice "illustrazione flat/pulita fedele agli agents-*.png". La direzione confermata da Leone è più pittorica/materica alla DE, almeno per gli **ambienti**; i personaggi restano fedeli agli agents-*.png. La sessione dev1 deve aggiornare il GDD in questo senso.

## 7. The Red Strings Club ⏭️ saltato

Pixel art → escluso su indicazione di Leone.

## 8. Two Point Hospital ⏭️ saltato

3D cartone → escluso; l'unico concetto utile (muri di vetro / leggibilità dall'alto) è già nel RESEARCH-DOSSIER §4.

## 9. Shadowrun: Hong Kong ✅ analizzato — riferimento grafico secondario

Steam: https://store.steampowered.com/app/346940/Shadowrun_Hong_Kong__Extended_Edition/

**Verdetto (Leone):** carino, la grafica assomiglia a Disco Elysium — "il concetto del disegno è un po' questo, la direzione è questa". Riferimento grafico secondario.

**Cosa NON c'entra col nostro:**
- È uno sparatutto/tattico: c'è combattimento, mostri — noi siamo un gioco SENZA azione, solo conversazioni (come DE).
- Tanti ambienti a campo aperto — noi praticamente tutto al chiuso, dentro la box.

---

# Sintesi decisioni (per la sessione dev1)

1. **Riferimento grafico principale: Disco Elysium** — pittorico a mano, isometrico noir, vibe e colori. Secondario: Shadowrun Hong Kong. Il GDD ("flat/pulito") va aggiornato verso questa direzione per gli ambienti; personaggi fedeli agli `agents-*.png`.
2. **Livello di resa minimo fattibile ora: Yes, Your Grace**; il 3D (alla Going Under) al massimo obiettivo futuro, non ora.
3. **Movimento: "2D tridimensionato"** — 8 direzioni con profondità (top-down/¾ + Y-sort), NON side-scroller, NON 3D.
4. **Conversazioni: personaggio in primo piano + vignette in sequenza** (pattern visto in Going Under, unico suo elemento buono).
5. **Ambito: tutto al chiuso, dentro la box** (ufficio anche grande, ma niente open map).
6. **Esclusi in blocco: pixel art e 3D cartone.** Niente azione/combattimento: il gameplay è parlare.
