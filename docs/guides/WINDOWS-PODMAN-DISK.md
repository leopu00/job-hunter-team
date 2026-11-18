# Spazio su disco della macchina Podman in Windows

L'installer Windows crea la macchina WSL dedicata `jht-podman` con un disco
massimo configurato di 30 GiB. È un limite di crescita, non una prenotazione
immediata di tutto quello spazio sul disco Windows. Una macchina preesistente
può avere una configurazione diversa: reinstallare JHT non ne ridimensiona il
disco.

## Nessuna compattazione automatica

Podman 6.0.2 crea il disco della macchina (`ext4.vhdx`) **non sparse**. Liberare
file nel filesystem Linux, per esempio le immagini vecchie tolte da
`jht upgrade`, libera spazio dentro il disco, ma il file `.vhdx` sul disco
Windows resta grande com'era.

Dopo una pulizia che ha tolto almeno un'immagine, `jht upgrade` esegue
`fstrim -a` nella distro e dice in una riga quanto spazio occupa JHT:

- disco non sparse (il caso normale): «JHT occupa circa X GB nel suo disco
  virtuale; si liberano del tutto con `jht uninstall`»;
- disco sparse: «circa X GB liberati nella macchina tornano a Windows quando la
  macchina si ferma».

JHT non cambia la configurazione della distro, non abilita gli sparse VHD con
`--set-sparse`, non esegue `wsl --shutdown` (fermerebbe anche le altre distro
WSL dell'utente) e non consiglia all'utente passi manuali. Nulla richiede
privilegi di amministratore.

Misure del 18/11/2026 (WSL 3.0.5, Podman 6.0.2, utente non amministratore, solo
la distro `podman-jht-podman` di prova):

- disco non sparse: `fstrim` non restituisce niente a Windows;
- `wsl --manage podman-jht-podman --set-sparse true` riesce senza amministratore,
  con l'avviso «VHD sparse sperimentali», ma solo quando la VM di WSL è spenta
  (con la sola distro ferma risponde `ERROR_SHARING_VIOLATION`; la VM si spegne
  da sola circa un minuto dopo l'ultima distro);
- disco sparse: 3 GiB scritti, cancellati e passati da `fstrim` tornano a
  Windows solo quando la VM di WSL lascia il disco, e tornano tutti.

## Per chi è esperto

Le procedure manuali non fanno parte dell'installazione, dell'aggiornamento o
della disinstallazione di JHT. Prima di intervenire servono un backup
verificato dei dati, l'identificazione del disco della sola macchina JHT e
l'arresto coordinato dei suoi utilizzatori. Non modificare i dischi di altre
distro o macchine Podman.

- Disco sparse, una volta sola e senza amministratore: `jht down`,
  `podman machine stop jht-podman`, attendere che la VM di WSL si spenga, poi
  `wsl --manage podman-jht-podman --set-sparse true` e `jht up`. WSL la indica
  come funzione sperimentale. Un disco sparse non si compatta più con
  `Optimize-VHD`: per tornare indietro si usa `--set-sparse false`.
- Compattazione da amministratore, con la macchina ferma e WSL spento:
  `Optimize-VHD -Mode Full` (con Hyper-V) oppure `diskpart` con
  `select vdisk file=<percorso dell'ext4.vhdx>` e `compact vdisk`.

Riferimenti Microsoft:

- [gestione dello spazio disco WSL](https://learn.microsoft.com/windows/wsl/disk-space)
- [comandi WSL e arresto delle distro](https://learn.microsoft.com/windows/wsl/basic-commands)

Queste guide descrivono WSL; non costituiscono una procedura di compattazione
validata per i volumi JHT.
