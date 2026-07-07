# ROADMAP — oltre il vertical slice

Cose deliberatamente FUORI dal prototipo, in ordine di valore stimato.
Le fonti tra parentesi rimandano a `RESEARCH-DOSSIER.md` (§) e
`ANALISI-GIOCHI.md`.

## Prossimi passi naturali

1. **Dati reali** — `SupabaseDataSource` al posto del mock: il contratto è
   già pronto (`DATA-ADAPTER.md`). Con i dati veri il registro, l'HUD, le
   bubble e le visite diventano lo stato reale del team dell'utente.
2. **Chat LLM negli agenti** (§7.4): il formato dialogo porta già i tag
   emozione inline — un LLM può emettere battute + tag e il ritratto
   reagisce. Input libero come oggetto diegetico (terminale), chip di
   risposte suggerite, attenzione alla prompt injection (gli agenti
   maneggiano dati reali).
3. **Asset pittorici completi** (pipeline dev1-art già avviata in
   `assets/gen-art/`): mobili restanti, ritratti Mentor 6 emozioni
   pittoriche full (PortraitView supporta già swap completi), muri/quinte
   della box, personaggi in-world ridipinti.
4. **Visite più profonde** (Yes, Your Grace): decisioni che spendono
   risorse (budget API, crediti CV), coda multi-agente visibile, eventi
   dalla giornata reale del team (weekly, hard-stop, throttle).
5. **Corkboard progressi** sul muro (§6): la mappa-città/bacheca delle
   candidature come oggetto fisico in ufficio, non solo pannello TAB.

## Più avanti

- Espansione ufficio: altre stanze/piani (archivio del Critico, stanza
  del Tesoriere), sempre al chiuso dentro la box.
- Salvataggio profilo/avatar (oggi il wizard è in-memoria).
- i18n: stringhe già centralizzate in `ui_strings.gd` + `dialogues.gd`
  (il sito supporta 7 lingue).
- Audio: musica ambient generativa, foley passi, brusio ufficio.
- Zoom-band alla Two Point (lontano = piano leggibile, vicino = emote);
  camera follow su click agente (§9.8).
- Export Windows/Linux; integrazione nell'app desktop Electron esistente
  (finestra dedicata o modalità "gioco" della dashboard).

## Esplicitamente esclusi (decisioni)

- 3D / 3D cartone e pixel art (ANALISI-GIOCHI, vietati).
- Multiplayer / uffici virtuali puri (§1.2: i "virtual office" puri sono
  morti; la differenza nostra è l'utility gamificata).
- Azione/combattimento: il gameplay è parlare.
