# 🧩 Header e liste invisibili sul desktop — Tailwind `@layer` vs CSS delle estensioni (2026-07-27)

Su `jobhunterteam.ai` in produzione, un utente con Chrome vedeva **la pagina caricare correttamente ma con pezzi interi di UI mancanti**: niente pulsante **Accedi** nella landing, niente header nella dashboard, e la pagina Posizioni che annunciava `423 risultati · pagina 1 / 9` sopra una **lista completamente vuota**. Stesso account, stesso momento: **da cellulare funzionava tutto**, e **da Brave sullo stesso PC funzionava tutto**.

Il sito non ha nessun bug. HTML e CSS serviti sono corretti e completi. La causa è un **conflitto di cascata CSS fra Tailwind v4 e le estensioni del browser**: Tailwind v4 mette tutte le utility dentro `@layer utilities`, e per le regole della cascata **qualunque regola fuori da un layer batte qualunque regola dentro un layer**, a prescindere da specificità e ordine. Basta che un'estensione inietti nella pagina un banale `.hidden { display: none }` non-layerizzato perché **ogni contenitore scritto come `hidden md:flex` resti invisibile per sempre**.

Nessuna perdita di dati, nessun impatto sul team di agenti: è un guasto puramente di rendering lato client. Ma è **silenzioso, sembra un bug nostro, e colpisce esattamente il nostro pubblico** — chi cerca lavoro ha spesso installate estensioni tipo Huntr, Simplify o Teal che iniettano CSS su ogni sito. Questo documento fissa diagnosi, prova sperimentale e fix proposto.

---

## Impatto

| Dimensione | Effetto |
|---|---|
| Gravità percepita | **Alta** — il sito sembra rotto o incompleto, senza alcun messaggio d'errore |
| Superficie | **16 occorrenze in 11 file** `.tsx` usano il pattern `hidden <breakpoint>:<display>` |
| Chi è colpito | Solo **desktop** (≥ breakpoint), solo con un'estensione che inietta CSS non-layerizzata |
| Chi non è colpito | Mobile, browser/profili senza quelle estensioni, finestre in incognito |
| Perdita dati | **Nessuna** — puro rendering client-side |
| Rilevabilità | **Pessima**: nessun errore in console, nessun 4xx/5xx, SSR corretto, e2e headless verdi |

Le tre manifestazioni osservate:

| Sintomo | Elemento responsabile |
|---|---|
| Manca "Accedi" nella landing | `hidden sm:inline-flex` — `web/app/components/landing/LandingNav.tsx:252` |
| Manca la barra di navigazione della dashboard | `hidden md:flex` — `web/components/Navbar.tsx:60` |
| Posizioni: conteggio giusto, lista vuota | `hidden md:block` — `web/app/(protected)/positions/page.tsx:607` |

Il caso Posizioni è il più istruttivo. La tabella desktop è `hidden md:block` (bloccata su `display:none`) e le card mobile sono `md:hidden` (correttamente nascoste a 1920px). Nessuna delle due viste sopravvive → **la pagina si impagina perfettamente attorno al nulla**.

---

## Causa radice

### Il meccanismo: unlayered batte layered

`web/app/globals.css` inizia con:

```css
@import "tailwindcss";
```

In Tailwind v4 (qui `^4.3.2`) questo si espande in `@layer theme, base, components, utilities`, e **tutte** le utility finiscono dentro `@layer utilities`. Nel bundle servito in produzione l'ordine è corretto:

| Regola | Offset nel CSS | Contesto |
|---|---|---|
| `.hidden{display:none}` | 24728 | `@layer utilities` |
| `.md\:flex{display:flex}` | 66656 | `@layer utilities` → `@media (min-width:48rem)` |

`.md\:flex` viene dopo, stessa specificità, stesso layer → **vince**, ed è per questo che il sito funziona in condizioni normali.

Il problema è la specifica CSS Cascade Layers: nell'origine *author*, le dichiarazioni **non assegnate ad alcun layer hanno priorità su tutte quelle assegnate a un layer**. Il confronto per specificità avviene *dopo* quello per layer, quindi non lo può ribaltare. Una estensione che inietta

```css
.hidden { display: none }   /* fuori da qualsiasi @layer */
```

vince su `@layer utilities { … .md\:flex{display:flex} … }` **sempre**, anche se la sua specificità è identica e persino se viene prima nel sorgente. La media query continua a matchare, ma non serve a niente: il `display:none` non è più recuperabile da nessuna utility Tailwind.

### La variante subdola: stesso nome di layer

Un'estensione può rompere le cose anche *usando* i layer. L'ordine dei layer è fissato dalla **prima apparizione del nome** nel documento; una seconda `@layer utilities { … }` iniettata dopo non crea un layer nuovo, **confluisce nello stesso**, dove torna a decidere l'ordine sorgente. Un foglio di stile dell'estensione appeso a `<head>` a runtime arriva dopo il nostro → il suo `.hidden` vince di nuovo.

Questo è rilevante perché sempre più estensioni sono a loro volta scritte in Tailwind.

### Perché mobile e Brave stanno bene

- **Mobile**: sotto il breakpoint la vista attiva non è gated dietro `hidden`. Le card mobile sono `md:hidden`, quindi visibili di default e mai toccate dall'iniezione.
- **Brave**: profilo pulito, senza quelle estensioni. Stesso identico bundle, rendering corretto.
- **e2e headless**: girano senza estensioni. **Questa classe di guasto è invisibile alla nostra suite.**

---

## Prova sperimentale

Riproduzione su Chrome 150.0.7871.182, profilo pulito, viewport 1920×260, pilotato via CDP sulla produzione.

```js
// 1. misura lo stato sano
{ navLinks: "flex", signIn: "flex" }

// 2. inietta UNA riga, come farebbe il content script di un'estensione
const s = document.createElement("style");
s.textContent = ".hidden{display:none}";   // fuori da @layer
document.head.appendChild(s);

// 3. rimisura
{ navLinks: "none", signIn: "none", mdMatches: true }
```

`mdMatches: true` è il punto chiave: **la media query continua a matchare**, quindi non è un problema di breakpoint, viewport o zoom. Lo screenshot risultante è sovrapponibile a quello riportato dall'utente — solo `JHT` a sinistra e la bandierina della lingua spinta al bordo destro, nel posto che occuperebbe "Accedi".

Verifiche a corredo, tutte negative (cioè: il sito è a posto):

- HTML servito: contiene tutti i link nav e `<a href="/?login=true">Sign in</a>`.
- CSS servito: `78457` byte, `Content-Length` coerente, `cache-control: public,max-age=31536000,immutable`; `.md\:flex` e `.sm\:inline-flex` presenti e nell'ordine giusto.
- HTML: `cache-control: private, no-cache, no-store, must-revalidate` → nessuna possibilità di HTML stantio.
- Nessun service worker registrato nell'app.
- Nessuno zoom per-host impostato in `Preferences` per `jobhunterteam.ai`.
- Render headless a 1920px in dark, light e `it`+light: **nav completa e "Accedi" presenti** in tutti e tre.

## L'estensione colpevole

Ispezione del profilo Chrome interessato (`Profile 2`). Sospetto principale:

| Estensione | Evidenza |
|---|---|
| **NordPass Password Manager** | `css/content.css`, **1,18 MB**, Tailwind v4, contiene `.hidden{display:none}` **e** dichiara un proprio `@layer utilities` — esattamente la variante "stesso nome di layer" |
| **Huntr — Job Search Tracker & Autofill** | content script su `http://*/*` + `https://*/*` con jQuery, jQuery UI e CSS proprie su **ogni** sito. Presente alla prima scansione, sparito alla seconda (rimosso durante il troubleshooting) |

Huntr merita una nota a parte: è un **tracker per la ricerca di lavoro**. La sovrapposizione col nostro pubblico è pressoché totale, e inietta su ogni pagina. Va considerato parte dell'ambiente di esecuzione realistico di JHT, non un caso limite.

Non abbiamo isolato con certezza quale delle due sia stata la causa nell'incidente specifico, e **non ha molta importanza**: il fix non deve dipendere da *quale* estensione è installata.

---

## Fix proposto (⚠️ non ancora applicato)

Una riga in `web/app/globals.css`: tenere theme e preflight dentro i layer, e **portare le utility fuori dai layer**.

```css
/* prima */
@import "tailwindcss";

/* dopo */
@layer theme, base, components;
@import "tailwindcss/theme.css" layer(theme);
@import "tailwindcss/preflight.css" layer(base);
@import "tailwindcss/utilities.css";   /* niente layer() → non più scavalcabili */
```

Con le utility non-layerizzate, `.md\:flex` e il `.hidden` di un'estensione tornano a competere ad armi pari, e decide l'ordine sorgente di Tailwind — che è già quello corretto.

**Cosa cambia in negativo:** le utility smettono di essere sopravanzate dal CSS non-layerizzato *nostro*. Va verificato che nessuna regola custom in `globals.css` contasse su quel comportamento per sovrascrivere una utility.

**Validazione richiesta prima del merge:** giro visivo su landing, `/dashboard`, `/positions`, `/map`, `/swipe`, `/team`, `/profile`, `/case-studies` e `/docs` — sono le pagine che contengono le 16 occorrenze di `hidden <bp>:`.

### Alternative scartate

| Opzione | Perché no |
|---|---|
| Evitare il pattern `hidden md:block` a mano | 16 punti da riscrivere e nessuna garanzia sui futuri; cura il sintomo, non la causa |
| Ri-dichiarare le utility critiche fuori layer | Lista da mantenere a mano, si disallinea al primo componente nuovo |
| Aggiungere `!important` | Le estensioni possono usarlo a loro volta; degrada tutto il foglio di stile |
| Non fare nulla e dire agli utenti di disattivare le estensioni | Inaccettabile per un prodotto in beta pubblica |

---

## Lezioni

1. **Tailwind v4 è più fragile di Tailwind v3 in presenza di estensioni.** Il passaggio a `@layer` per default è una regressione di robustezza in ambiente browser reale, e non è documentata come tale.
2. **Le e2e headless non vedono questa classe di bug.** Girano senza estensioni. Se vogliamo coprirla serve un test che inietti CSS non-layerizzata e verifichi che la nav resti visibile — costa poco ed è deterministico.
3. **"Funziona sul mio browser" va verificato con un profilo pulito, non con il proprio.** Il primo sospetto era una CSS stantia o un deploy vecchio; entrambe le piste erano sbagliate e hanno bruciato tempo. La svolta è arrivata confrontando un render headless pulito con lo screenshot dell'utente e notando che **la bandierina occupava la posizione di "Accedi"** — cioè che l'elemento era fuori dal flow, non solo invisibile.
4. **Un conteggio corretto sopra una lista vuota è una firma diagnostica.** Dati e logica stavano funzionando; solo il contenitore era nascosto.

---

## Riferimenti

- Occorrenze del pattern: `grep -rnoE '\bhidden (sm|md|lg|xl|2xl):(flex|block|grid|inline|inline-flex|inline-block|table|contents)' --include=*.tsx web/`
- Punti chiave: `web/app/components/landing/LandingNav.tsx:155,252` · `web/components/Navbar.tsx:60` · `web/app/(protected)/positions/page.tsx:607` · `web/app/components/RecentPositionsTable.tsx:251`
- Entry CSS: `web/app/globals.css:1`
- Spec: [CSS Cascading and Inheritance Level 5 — Layer Ordering](https://www.w3.org/TR/css-cascade-5/#layer-ordering)
- Stato repo alla diagnosi: `master` @ `2c9ca39a4` (v0.3.0), Tailwind `^4.3.2`, Next `^16.2.11`
