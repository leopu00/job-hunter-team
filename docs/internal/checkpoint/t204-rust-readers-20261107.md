# T204 lettori Rust

## Fatto

Sono conservati in Git il puro dei lettori nativi, il proof separato, la bozza i18n e la fixture sintetica. Nessun trasloco T204 è attivato da questa nota.

## Fermo e perché

Mancano prove composte sulla base finale, acquisizioni globali e negativi dei veri guard. I vecchi P/F e le loro prove non sono verdi del prodotto corrente.

## Custodia Git

- Ref locale: `refs/archive/native-reader-recovery-source-20261107`
- SHA: `ab366ff6da95021e66546bcc8a6596d7641070c9`
- Il riferimento conserva il lavoro; questa nota non carica né applica codice.

## Ripresa

Riconciliare T196, tabella modelli e propagazione lingua; separare puro e observer; acquisire input e casi reali prima di qualsiasi freeze. Godot e PS1 sono fuori T204.
