# Provisioning di una VPS nuova: mappa del percorso reale

Stato: 16/10/2026, letta sul ramo di integrazione (9b9d645da). Descrive cosa fanno
oggi il desktop e la CLI per portare una squadra su un server nuovo, e quali
punti hanno una prova automatica. Nessun dato di server reali: gli indirizzi
sono quelli riservati alla documentazione (`192.0.2.x`).

## Due percorsi dal desktop, uno dalla CLI

| | App desktop (Tauri) | Gioco (Godot) | CLI sul server |
|---|---|---|---|
| Codice | `desktop/src-tauri/src/onboarding.rs`, `runtime_host.rs` | `game/scripts/setup/setup_service.gd` | `scripts/install.sh`, `scripts/host-setup.sh` |
| Fiducia nel server | probe ed25519 + **conferma dell'utente** sull'impronta SHA256, poi `known_hosts` per account e host:porta | `ssh-keyscan` e **pin automatico alla prima connessione** (l'impronta si mostra dopo) | l'utente confronta a mano l'impronta con quella del provider |
| Installer sul server | scaricato dall'app, **verificato con lo sha256 incorporato**, inviato su stdin | `curl -fsSL …/install.sh \| bash` sul server, **senza digest** | `curl … -o install.sh`, lettura, poi `bash install.sh` |
| Token di pairing | su stdin, poi nell'ambiente di `install.sh --pairing-token-env` (mai negli argomenti di un processo) | non usato | scelta dell'utente in `jht setup` |
| Idempotenza | rilancio di `REMOTE_INSTALL` | installa solo se `jht` manca | rilancio di `install.sh` |

## La sequenza dell'app desktop (`prepare_impl`, ramo VPS)

1. `ssh-keyscan -t ed25519` (probe) → l'utente conferma l'impronta → `known_hosts`
   privato. Senza pin: `host_key_missing`. Chiave cambiata: `host_key_mismatch`.
2. `validate_host`: indirizzo, utente (non serve root), porta, chiave privata
   assoluta e di dimensione ragionevole, `known_hosts` leggibile.
3. `ssh … REMOTE_INSTALL`, con `BatchMode=yes`, `StrictHostKeyChecking=yes`,
   `GlobalKnownHostsFile=/dev/null`. Sul server: lo script legge lo sha256 e il
   token dalla stdin, controlla l'installer (exit 87 se non coincide, 86 se
   non c'è uno strumento per l'hash) e lancia `install.sh --pairing-token-env` con il token nell'ambiente.
4. `install.sh` su Linux, nell'ordine: rilevamento del sistema (apt, dnf,
   pacman) → riuso di Docker se `docker info` risponde, altrimenti installa
   Docker e il plugin compose, `systemctl enable --now docker`, gruppo docker
   → `docker info` (con sudo come ripiego) → risoluzione del ramo in un commit
   immutabile (`api.github.com`) → scarico di compose, wrapper e `host-setup.sh`,
   controlli di forma, manifesto d'integrità → PATH (`/etc/profile.d` per root,
   `~/.bashrc` e simili per gli altri) → rifiuto se l'uid 1001 è di un altro
   account → salvataggio di `~/.jht/.pairing-token` (0600) → `host-setup.sh
   --host-type=vps` (scrive `~/.jht/host.env`; con RAM < 8 GB e swap < 1 GB
   crea 2 GB di `/swapfile`) → `chown -R 1001:1001`.
5. `ssh … jht up`: **qui** si scarica l'immagine (digest fissato in compose) e
   parte il container; l'installer non scarica l'immagine.
6. Snapshot, `jht providers use <provider>`, `jht providers update <provider>`,
   salvataggio dell'host. Poi login del provider, avvio della squadra.
7. Primo boot del container (`pid1`): con `JHT_HOST_TYPE=vps` e un
   `.pairing-token` senza `cloud.json` lancia `jht cloud pair` una volta; se
   fallisce il boot continua e il token resta per il tentativo successivo.

## Cosa ha oggi una prova automatica

| Punto | Prova |
|---|---|
| Sequenza install → up → snapshot → provider | `tests/test_vps_provisioning_sequence.py` (comandi veri di `onboarding.rs` via un `ssh` finto) |
| Installer, `host-setup.sh`, file scritti, token 0600, `host.env` vps | stesso file, installer e host-setup **veri** in un sandbox |
| Digest sbagliato o installer manomesso | stesso file (exit 87, nulla scritto) |
| Pin assente o cambiato, server irraggiungibile | stesso file (exit 255, nulla gira sul server) |
| Docker assente, non installabile, daemon fermo, download fallito | stesso file (si ferma prima di scrivere file e token) |
| Disco pieno | stesso file (controllo in `install.sh`, prima di installare Docker) |
| Doppio rilancio | stesso file (secondo giro identico; solo il token cambia con un token nuovo; PATH scritto una volta) |
| Probe/conferma del pin in Rust | test unitari in `runtime_host.rs` |
| Errori ssh (255) e installer (86/87) distinti dal fallimento del passo; timeout armato prima di scrivere su stdin | test unitari in `onboarding.rs` e `runtime_host.rs` |
| Token di pairing fuori dagli argomenti dei processi sul server | `tests/test_vps_provisioning_sequence.py` (gli argomenti e l'ambiente dei figli dell'installer) |

## Cosa resta senza prova

- Un OpenSSH vero e un server vero: il test usa un modello dell'`ssh` (stesse
  opzioni dell'app, controllate sul sorgente) e un sandbox al posto del server.
- `apt-get`, `dnf`, `pacman` e `systemctl` reali; la rete verso `ghcr.io`.
- `jht up` reale con il wrapper scaricato, il pull dell'immagine e il
  container: nel test `jht` dopo l'install è un registratore.
- Il pairing al primo boot contro il cloud.
- Il percorso del gioco (Godot): nessuna prova nel test; il suo pin
  automatico e il `curl | bash` senza digest sono differenze di fiducia
  rispetto al percorso dell'app.
- La prova reale su un target autorizzato la decide l'operatore.
