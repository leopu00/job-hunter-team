# 🎨 Minor Tracker — rifiniture grafiche

Piccole rifiniture estetiche del sito pubblico, non bloccanti. Da spuntare
quando fatte. Tracker creato il 2026-06-21.

## 🖼️ Pulizia immagini (punti bianchi residui)

Artefatti bianchi (residui di rimozione sfondo) da ripulire nelle immagini:

- [ ] `web/public/landing-team.png` — immagine del team nella **home** (sezione
      "Il team"): rimuovere i punti bianchi residui nell'immagine.
- [ ] `web/public/the-box.png` — immagine principale della pagina **Project**
      (`/project`): stessi punti bianchi residui da rimuovere.

## 👥 Diversità di genere figure agenti (`/agents`)

Al momento **quasi tutti** gli agenti illustrati sono uomini. In futuro
rigenerare **almeno un paio di figure come donne** per equilibrare il roster.
Non urgente, da fare quando c'è tempo (i prompt sono in
[`landing-image-prompts.md`](./landing-image-prompts.md): basta cambiare il
genere lasciando il resto — ruolo, prop, occhiali, stile).

## ✅ Fatto

- Home: rimosso il placeholder immagine nella sezione Prezzi (era brutto).
- Home: aggiunte sezioni text-only **Project** (→ `/project`) e **Studies**
  (→ `/case-studies`) sotto Prezzi.
- Pagina team (`/agents`): rimossi i placeholder immagine per gli agenti senza
  immagine (resta lo spazio vuoto fino a quando l'immagine viene generata).
