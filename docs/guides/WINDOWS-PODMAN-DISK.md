# Spazio su disco della macchina Podman in Windows

L'installer Windows crea la macchina WSL dedicata `jht-podman` con un disco
massimo configurato di 30 GiB. È un limite di crescita, non una prenotazione
immediata di tutto quello spazio sul disco Windows. Una macchina preesistente
può avere una configurazione diversa: reinstallare JHT non ne ridimensiona il
disco.

## Nessuna compattazione automatica

JHT non abilita gli sparse VHD con `--set-sparse`, non pianifica `fstrim` e non
esegue `wsl --shutdown` per recuperare spazio. Quest'ultimo comando fermerebbe
anche le altre distro WSL dell'utente.

Liberare file nel filesystem Linux non promette una riduzione immediata del
file `.vhdx` sul disco Windows. Le procedure manuali di compact/sparse non fanno
parte dell'installazione, dell'aggiornamento o della disinstallazione JHT.
Prima di intervenire manualmente occorrono un backup verificato dei dati,
l'identificazione del disco della sola macchina JHT e l'arresto coordinato dei
suoi utilizzatori. Non modificare i dischi di altre distro o macchine Podman.

Una futura compattazione automatica richiede una prova sulla versione WSL
supportata: arresto della sola macchina JHT, riduzione effettiva del VHDX,
riavvio e integrità di bytes, proprietari e permessi dei volumi, con tutte le
altre distro e i runtime dell'utente invariati. Finché questa prova manca,
JHT non promette il recupero automatico dello spazio Windows.

Riferimenti Microsoft:

- [gestione dello spazio disco WSL](https://learn.microsoft.com/windows/wsl/disk-space)
- [comandi WSL e arresto delle distro](https://learn.microsoft.com/windows/wsl/basic-commands)

Queste guide descrivono WSL; non costituiscono una procedura di compattazione
validata per i volumi JHT.
