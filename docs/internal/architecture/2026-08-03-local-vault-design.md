# `[JHT-LOCAL-VAULT]` — design implementabile del vault locale

> Stato: design, non implementazione crittografica. Audit: 2026-08-03.
> Threat model padre: [`SECURITY.md`](../../../SECURITY.md). Audit credenziali:
> [`access-and-credentials.md`](../ops/access-and-credentials.md).

## 1. Problema concreto

Oggi convivono due realtà:

- `shared/credentials/` e `jht secrets` hanno cifratura autenticata a riposo;
- la password email realmente usata dal team vive in
  `~/.jht/credentials/email_monitor.json`, JSON in chiaro `0600`, perché
  `game/scripts/setup/setup_service.gd`, `email_monitor.py` e alcune skill si
  scambiano direttamente quel file.

Il vault deve eliminare il secondo caso senza promettere protezione durante una
macchina già compromessa. Protegge disco spento, backup e letture accidentali
da altri account; non protegge da root, malware nello stesso account o da un
agent autorizzato mentre il team sta usando il segreto.

## 2. Decisioni vincolanti

1. **Niente nuova crypto fatta in casa.** Il codice applicativo non combina a
   mano primitive nuove. Si riusa un'implementazione mantenuta e auditata di
   Argon2id + AEAD, oppure il keyring OS per il wrapping della chiave. La scelta
   della libreria è un ADR e un dependency/security review prima del codice.
2. **Niente plaintext persistente.** In particolare niente "decifra, scrivi
   `email_monitor.json`, poi shred": lo shred non è affidabile su SSD,
   filesystem copy-on-write, snapshot e Docker Desktop.
3. **Envelope encryption.** Una data-encryption key (DEK) random cifra gli
   elementi del vault. La master password/OS keyring protegge solo la DEK
   (KEK/wrapped key). Cambiare master password non ricifra tutti i secret.
4. **Fail closed.** Vault bloccato, tag AEAD invalido, versione sconosciuta o
   permessi insicuri = nessun secret restituito e nessun fallback plaintext.
5. **Least disclosure.** Discovery dice quali capability sono disponibili
   (`email.read`, `smtp.send`, `hetzner.provision`), mai i valori.

## 3. Formato on-disk versionato

Directory `~/.jht/vault/` mode `0700`:

```text
vault.json             # metadata + DEK wrapped, 0600
items/<uuid>.json      # un AEAD payload per secret, 0600
audit.jsonl            # metadata accessi, mai valori, 0600
```

Schema minimo `vault.json`:

```json
{
  "version": 1,
  "vault_id": "uuid",
  "key_wrap": {
    "mode": "master_password | os_keyring",
    "kdf": { "name": "argon2id", "params": "ADR-locked", "salt": "base64" },
    "aead": { "name": "ADR-locked", "nonce": "base64", "ciphertext": "base64" }
  },
  "created_at": "RFC3339",
  "updated_at": "RFC3339"
}
```

Ogni item cifra un JSON `{name, value, scopes, created_at, rotated_at}` e usa
come associated data almeno `vault_id + item_id + version + name`, così un file
non può essere rinominato/scambiato senza far fallire l'autenticazione.
Algoritmo e parametri non vengono scelti in questo ticket: prima si misura il
tempo di unlock sulle tre platform e si registra l'ADR.

## 4. Runtime: broker, non file permanente

Un processo locale `jht-vault-agent` possiede la DEK solo mentre il vault è
sbloccato. Interfaccia locale:

```text
unlock(password via stdin/IPC protetto) -> session_id
status() -> locked | unlocked + capability names
get(name, scope, caller) -> secret bytes oppure denied
lock() -> invalida sessioni e azzera buffer best-effort
rotate(name, value) -> nuovo item + audit
```

- Unix: socket sotto `$XDG_RUNTIME_DIR/jht/` mode `0600` (fallback runtime dir
  sotto `~/.jht/run/`, mai esposto in Docker bind pubblico).
- Windows: named pipe ACLata all'utente corrente.
- Il protocollo ha request size cap, peer identity check, nonce/session TTL e
  non logga payload o header di autorizzazione.

Gli agent non ricevono la master key. Il launcher chiede al broker solo gli
scope necessari al ruolo. Per i tool legacy che richiedono un file, il bridge
materializza JSON dentro un mount **tmpfs** del container (`/run/jht-secrets`,
mode `0700/0600`) e lo rimuove a stop/lock. Il path persistente
`~/.jht/credentials/email_monitor.json` smette di essere letto e viene migrato.

## 5. Flusso UX e stati

```text
ABSENT --setup(password x2 / keyring)--> UNLOCKED
LOCKED --unlock--> UNLOCKED --idle/stop/quit/manual--> LOCKED
UNLOCKED --corruption/wrong password--> LOCKED + errore esplicito
```

- Setup mostra: password persa = secret irrecuperabili senza export; non è la
  password account JHT; password email deve essere una app-password revocabile.
- "Start team" richiede unlock se manca una sessione valida.
- Auto-lock configurabile, default quando il team si ferma e all'uscita app.
  Un team 24/7 resta necessariamente unlocked: rischio dichiarato nella UI.
- Tre tentativi errati introducono backoff locale; niente wipe automatico.

## 6. Migrazione senza perdita

1. Rileva `credentials/email_monitor.json`; controlla owner/perms e schema.
2. Chiede unlock/setup, importa come item `email_monitor` con scope
   `email.read` e `smtp.send`.
3. Esegue round-trip attraverso il broker e una verifica IMAP/SMTP esplicita.
4. Solo dopo il round-trip rinomina il vecchio file in
   `email_monitor.json.migrated-<timestamp>` e propone la rimozione. Non lo
   cancella prima; niente `shred` promesso.
5. Al primo riavvio riuscito senza fallback, rimuove il backup con consenso o
   lascia istruzioni chiare. Ogni passaggio è idempotente.

Gli store GCM esistenti (`*.enc`, `*.enc.json`) richiedono un importer per
formato/versione, non una lettura euristica. Nessun file viene riscritto se la
passphrase non autentica il payload.

## 7. API applicative

Un unico package `shared/vault/` espone:

```ts
interface Vault {
  status(): VaultStatus;
  unlock(input: UnlockInput): Promise<VaultSession>;
  lock(): Promise<void>;
  listCapabilities(): Promise<string[]>;
  read(name: string, scope: string): Promise<SecretHandle>;
  write(name: string, value: Uint8Array, scopes: string[]): Promise<void>;
  delete(name: string): Promise<void>;
}
```

`SecretHandle` non implementa `toJSON()`/`toString()` impliciti; espone bytes
per il minor tempo possibile e un `dispose()`. Logging/redaction rifiuta il tipo.
CLI, gioco e daemon usano questa API: niente tre implementazioni crypto.

## 8. Test/gate richiesti prima dello shipping

- known-answer e tamper tests forniti dalla libreria scelta;
- wrong password, nonce/tag/ciphertext/associated-data modificati → fail closed;
- permessi `0700/0600` su Linux/macOS e ACL utente su Windows;
- nessun secret in log, errori, crash dump, argv o process list;
- migrazione plaintext e dei due formati GCM su copia temporanea, con rollback;
- lock invalida socket/sessione/tmpfs e il tool legacy non legge più il secret;
- test Windows/macOS/Linux nativi, non solo container;
- backup/export cifrato e restore su directory vuota con manifest completo;
- fuzz del parser del formato versionato e limiti di dimensione.

## 9. Decisioni ancora bloccanti (ADR)

- libreria/primitive e parametri KDF per desktop e headless;
- default master-password vs keyring OS, e recovery key opzionale;
- TTL/auto-lock compatibile col funzionamento 24/7;
- disponibilità/semantica tmpfs su Docker Desktop Windows/macOS;
- quali ruoli ricevono quali scope e se un consenso per-use è sostenibile.

Finché questi cinque punti non sono decisi e testati, implementare una nuova
cifratura sarebbe solo spostare il rischio. Il primo incremento sicuro è il
broker + interfaccia mock + migrazione dry-run; la crypto reale arriva dopo ADR
e dependency review.
