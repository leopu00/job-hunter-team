# Contratto sync cloud del tema — versione 1

Stato: congelato il 2026-08-12 per `[JHT-CLOUD-SYNC-THEME]`.

Questo contratto definisce il solo perimetro autorizzato prima di creare la
tabella o cambiare il runtime. Lingua, valuta, colonne, sidebar e ogni altra
preferenza sono escluse dalla versione 1.

## 1. Schema e ownership

Supabase conserva una riga opzionale per utente:

```text
user_settings(
  user_id uuid primary key references auth.users(id) on delete cascade,
  theme text not null check (theme in ('dark', 'light', 'system')),
  updated_at timestamptz not null
)
```

La riga appartiene esclusivamente a `user_id`. RLS consente `SELECT`,
`INSERT`, `UPDATE` e `DELETE` soltanto quando `auth.uid() = user_id`. Il
browser usa la sessione dell'utente; non è autorizzato un bypass service-role.
`updated_at` è assegnato dal database alla creazione e a ogni modifica.

L'assenza della riga significa «tema cloud non ancora inizializzato», non un
tema implicito.

## 2. Storage browser

- `jht-theme` contiene la cache locale validata: `dark`, `light` o `system`.
- `jht-theme-pending.v1` contiene una modifica esplicita autenticata che il
  cloud non ha ancora confermato. Il record include il tema e l'id
  dell'utente che l'ha prodotta, così non può essere applicato a un altro
  account.

Valori assenti, illeggibili o fuori enum sono ignorati. La preferenza di
sistema è il fallback quando `jht-theme` non contiene un valore valido.

## 3. Bootstrap e precedenza

Un visitatore anonimo legge e scrive soltanto `jht-theme`. Non legge né
scrive `user_settings` e non crea pending cloud.

Per un utente autenticato, l'ordine è:

1. Se esiste un pending valido dello stesso utente, ritentare prima quella
   scrittura. Solo la risposta cloud positiva la rende confermata, aggiorna
   `jht-theme` e rimuove il pending.
2. Senza pending, leggere `user_settings`.
3. Se la riga esiste, il tema cloud prevale e aggiorna `jht-theme`.
4. Se la lettura riesce e la riga non esiste, inizializzarla una sola volta
   dal `jht-theme` valido del browser, oppure da `system` se la cache non è
   valida. La cache è confermata soltanto dopo la risposta positiva.

Il bootstrap non è un confronto last-write-wins fra due fonti: è consentito
soltanto dopo una lettura cloud riuscita che ha accertato l'assenza della
riga. Due bootstrap concorrenti non devono sovrascriversi silenziosamente:
chi perde il primo inserimento rilegge e adotta la riga ormai esistente.

## 4. Offline e fail-closed

Una modifica esplicita di un utente autenticato si applica subito alla UI e
a `jht-theme`, quindi il tema resta utilizzabile offline. Prima della
richiesta cloud viene scritto il pending associato all'utente.

- Successo cloud: applicare il valore restituito dal server e cancellare il
  pending.
- Errore di rete, autenticazione, schema o database: conservare cache e
  pending; non dichiarare il tema sincronizzato e ritentare al successivo
  evento utile (nuovo mount autenticato, ritorno online o nuova modifica).
- Errore durante una lettura: conservare la cache; non creare la riga, non
  inviare il valore locale e non sovrascrivere nulla nel cloud.
- Cambio account: un pending con `user_id` diverso non viene inviato. Il tema
  cloud dell'account corrente prevale secondo la sezione 3.

Il runtime non espone uno stato di successo ottimistico: «sincronizzato» è
vero soltanto dopo una risposta cloud positiva.

## 5. Vettori obbligatori

1. Browser A autenticato imposta `dark`; dopo conferma, browser B senza cache
   legge `dark` dalla riga cloud.
2. Riga assente + cache locale `light` → singolo bootstrap `light`.
3. Lettura cloud fallita + cache `dark` → UI `dark`, zero inizializzazioni e
   zero sovrascritture.
4. Scrittura `light` fallita → UI/cache `light`, pending presente, nessun
   successo; il retry riuscito cancella il pending.
5. Riga cloud `dark` + cache locale stale `light`, senza pending → `dark`
   prevale e riallinea la cache.
6. Visitatore anonimo cambia tema → solo `jht-theme`, nessun accesso a
   `user_settings` e nessun pending.
7. Pending dell'utente A durante una sessione dell'utente B → non viene
   inviato; il cloud di B prevale.

Qualsiasi aggiunta di campi, modifica alla precedenza, rimozione del pending
o inclusione di lingua/valuta/colonne richiede una nuova versione esplicita
di questo contratto.
