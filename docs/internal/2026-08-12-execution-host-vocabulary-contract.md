# Contratto del luogo di esecuzione — versione 1

Stato: congelato il 2026-08-12 per `[JHT-SETUP-LOCAL-FIRST]`.

Questo contratto riallinea parole e percorsi a capacità già presenti. Non
introduce un nuovo backend, non rende il cloud un runtime e non promette una
modalità dedicata che il prodotto non guida ancora end-to-end.

## 1. Vocabolario canonico

| Termine | Significato | ID interno |
|---|---|---|
| **PC locale** / **questo computer** | Il container del team gira sullo stesso computer dell'app desktop. | `local` |
| **VPS** / **server remoto** | Il container gira su un host Linux raggiunto dall'app via SSH. | `vps` |
| **PC dedicato sulla LAN** | Variante avanzata del trasporto SSH verso un computer Linux controllato dall'utente. Non è un terzo backend né un percorso guidato separato. | nessun ID nuovo |
| **Dashboard cloud** / **sincronizzazione cloud opzionale** | Account web e copia delle superfici supportate. Non indicano dove gira il team. | nessun host |

«Modalità cloud» non è un luogo di esecuzione. «Modalità locale/ospite» non è
uno stato account: un team locale può essere collegato al cloud e un team su
VPS può non esserlo nel percorso nativo. Per lo stato account si usano
**collegato** e **non collegato**.

L'app non usa l'eufemismo «computer online» al posto di VPS: nasconde costi,
SSH e responsabilità amministrative. Quando serve una spiegazione breve si
scrive «VPS (server remoto)».

## 2. Percorsi e default esistenti

Il **PC locale è il percorso guidato iniziale e di prima classe**:

- l'app nativa prepara il runtime locale finché l'utente non collega
  esplicitamente una VPS;
- è il percorso con meno infrastruttura e quello consigliato quando l'utente
  non sa ancora dove partire;
- offre il team completo, gli stessi provider e il controllo nativo: non è
  demo, fallback o modalità degradata;
- richiede che computer, Docker e rete restino disponibili mentre il team
  lavora. Spegnimento o sospensione fermano il lavoro.

La **VPS è un'opzione reale e supportata**, non il percorso «serio» contrapposto
a uno locale di prova. Continua a lavorare quando il PC dell'utente è spento,
ma richiede un server affittato e amministrato dall'utente, SSH, Docker, rete,
aggiornamenti, storage e fatturazione del provider.

Il preflight CLI non riceve un nuovo default universale: rileva il tipo di host
e, quando è interattivo, chiede conferma. Su un normale computer desktop il
default rilevato è `local`; su un server headless può essere `vps`. Un override
esplicito resta autorevole.

Il **PC dedicato sulla LAN** resta documentato come topologia avanzata. Il
backend SSH esistente può raggiungerlo, ma oggi mancano wizard dedicato,
discovery, Wake-on-LAN, VPN/tunnel, porta SSH personalizzata e validazione
end-to-end del percorso. Non compare quindi come scelta guidata equivalente a
PC locale e VPS.

## 3. Capacità da non inventare

- Non esiste più una dashboard web locale su `localhost:3000`: l'interazione
  locale e VPS vive nell'app nativa; il browser ospita la dashboard cloud.
- La dashboard cloud non rende raggiungibile il runtime e non sostituisce SSH.
- JHT non compra, crea, amministra, sospende o cancella una VPS per l'utente.
- Non si promettono uptime, costi fissi, backup VPS automatici o accesso remoto
  a un PC dedicato fuori dalla LAN.
- L'utente sceglie una sola casa attiva del team; locale e VPS simultanei
  dividono la fonte dei dati.

## 4. Superfici censite

| Superficie | Scelta/comportamento misurato | Allineamento richiesto |
|---|---|---|
| App nativa · checklist setup | Locale implicito; pulsante esplicito per collegare VPS. | Presentare locale come percorso pieno e VPS come alternativa. |
| App nativa · onboarding scriptato | Scelte locale/VPS, locale elencato per primo. | Usare i nomi canonici e trade-off reali. |
| App nativa · tour Coordinatore legacy | Offre locale, PC dedicato e «computer online» come tre percorsi guidati. | Rimuovere la falsa equivalenza del PC dedicato; nominare VPS. |
| CLI · `host-setup.sh` | Rilevamento + conferma locale/VPS. | Conservare comportamento; rimuovere la promessa della dashboard locale/esposta. |
| CLI · `setup.js` | Legge `JHT_HOST_TYPE`; su VPS il wizard richiede oggi pairing cloud, su locale no. | Non trasformarlo in chooser e non nascondere l'eccezione VPS esistente. |
| Web · landing | Nomina soltanto PC dedicato sempre acceso e VPS. | Reintrodurre PC locale come prima opzione. |
| Web · setup guide / getting started | Percorso locale completo con link VPS separato. | Già coerente; proteggere con test. |
| Web · guida VPS | Definisce VPS «raccomandata per una ricerca vera» e app desktop «in arrivo». | Rendere il trade-off neutro e descrivere il controllo SSH già presente. |
| Web · privacy | Presenta locale e cloud come modalità di runtime alternative. | Separare host di esecuzione e sync cloud opzionale. |
| `CHOOSE-WHERE-TO-RUN.md` | Decision tree locale → dedicato avanzato → VPS con limiti espliciti. | Fonte descrittiva corrente da preservare. |

## 5. Vettori obbligatori

1. Nuovo utente nell'app → può completare e attivare il team sul PC locale
   senza VPS e senza account cloud.
2. Scelta VPS → apre il percorso SSH reale; non promette provisioning o
   gestione del server da parte di JHT.
3. Preflight su desktop → propone PC locale; preflight su server rilevato →
   propone VPS; una scelta esplicita vince sul rilevamento.
4. Nessuna superficie dice che la dashboard locale si apre o deve essere
   esposta.
5. Nessuna superficie definisce la VPS come requisito per una ricerca «vera».
6. Stato account non collegato → non viene chiamato «modalità locale».
7. I cataloghi toccati conservano parità completa nelle sette lingue
   `en`, `it`, `hu`, `es`, `de`, `fr`, `pt`.

Modifiche a questi termini, ai default, alle capacità del PC dedicato o al
rapporto runtime/cloud richiedono una nuova versione esplicita del contratto.
