---
name: cloud-push-quarantine
description: Prüft und repariert vom Cloud-Push nach einer Serverablehnung isolierte Zeilen, ohne deren Inhalt offenzulegen. Verwenden, wenn sync-health push_quarantine meldet.
allowed-tools: Bash(jht cloud quarantine *)
---

# cloud-push-quarantine — prüfen, erneut senden, abschließen

Der Push lässt gültige Daten weiterlaufen und speichert für eine abgelehnte
Zeile nur sichere Metadaten: Tabelle/Typ, undurchsichtige Identität, bereinigter
Grund, Versuche und Zeitstempel. Die Quellzeile niemals anfordern oder ausgeben.

1. Mit `jht cloud quarantine list` prüfen. Nur Anzahl, Tabelle, undurchsichtige
   Identität, Grundcode, Versuche und Zeitstempel melden.
2. Die lokale Ursache im zuständigen Workflow beheben. `jobs.db` nicht manuell
   bearbeiten und keine Sonderfälle für Tabellen oder Fehlercodes einführen.
3. Mit `jht cloud quarantine retry <opaque-id>` erneut versuchen. Dabei wird der
   kanonische Cloud-Writer verwendet. Ergebnis lesen und list wiederholen:
   Erfolg bedeutet `resolved`.
4. `jht cloud quarantine resolve <opaque-id> --confirm` nur verwenden, wenn
   geprüft wurde, dass die lokale Zeile absichtlich entfernt oder ersetzt wurde
   und kein Retry nötig ist. Der Auditverlauf bleibt erhalten.

`retry all` ist nur nach Behebung einer gemeinsamen Ursache und Prüfung aller
Tabellen erlaubt. Keine Bodies, Titel, Pfade, user IDs, Serverdetails oder
Zugangsdaten in Chat, Logs oder Logbook kopieren.
