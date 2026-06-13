# 🛑 REGOLA FERREA — Mai intervenire in un team in osservazione/simulazione

**2026-06-13.** Stabilita dall'utente dopo un intervento errato: dev3 ha mandato una direttiva
"OPERATORE dev3" al Capitano di barto/Kimi spingendolo a scalare 3→6 worker per correggere il
pacing SOTTO-PACE. Sbagliato.

## La regola
Quando un team JHT gira in **osservazione/simulazione**, la postura è **SOLA LETTURA**. È VIETATO:
- mandare direttive al Capitano (o a qualsiasi agente) via tmux / `jht-tmux-send`;
- forzare scale-up / scale-down dei worker;
- editare la config a caldo per influenzare il comportamento;
- "dare una spinta" al pacing o a qualunque decisione che il team deve prendere da solo.

**OK invece:** letture (SSH read-only, `capture-pane`, query DB, log). Azioni di **infrastruttura**
sanzionate dall'utente (deploy/recreate del container, fix config esplicitamente richiesti) — NON
sono "intervento nella simulazione".

## Perché
L'osservazione serve a vedere **come il team si comporta DA SOLO**. La Sentinella esiste per
calcolarsi il pacing; il Capitano per decidere. Un intervento manuale:
1. **sporca i dati** dell'osservazione — non sai più se il comportamento è del team o tuo;
2. **costa un riavvio** per ripulire: l'unico modo di rimuovere la contaminazione di una sessione è
   ricreare il container e ripartire da zero;
3. rende inutili i ruoli autonomi (Sentinella, Capitano) che abbiamo costruito.

## Cosa fare invece
Un comportamento sbagliato osservato (es. SOTTO-PACE che non guida lo scale-up in modalità
use-it-or-lose-it vicino al reset) è un **finding per il CODICE** — si fixa nella logica
Sentinella / `weekly_pace` / prompt perché il team lo computi da solo. **Mai** una spinta runtime.
Anche "ritrattare" un intervento è a sua volta un intervento: per ripulire si ricrea il container.

## Riferimenti
- Memoria: `feedback_no_intervention_in_simulations.md`
- Correlati: `feedback_test_via_desktop_app` (mai ricreare sessioni/lanciare script a mano durante i
  test e2e), `feedback_setup_wizard_all_inclusive` (solo comandi `jht`, mai `docker exec`/tmux a mano)
