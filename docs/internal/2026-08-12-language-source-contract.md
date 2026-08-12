# Contratto della lingua di prodotto — versione 1

Stato: congelato il 2026-08-12 per
`[WIN-TWO-SOURCES-OF-TRUTH-FOR-LANGUAGE]`.

Questo documento rende eseguibile una decisione già presa, non ne introduce
una nuova. La policy lockata del 13 maggio (`RULE-T14` e
`2026-05-06-agent-prompts-i18n.md`) dice che l'utente sceglie una lingua dal
desktop e che tutta la superficie visibile — gioco, web e agenti — usa quella
lingua.

## 1. Artefatto canonico

La sola preferenza persistente è:

```
$JHT_HOME/i18n-prefs.json
```

Schema versione 1:

```json
{
  "locale": "en"
}
```

`locale` ammette soltanto `en`, `it`, `hu`, `es`, `de`, `fr`, `pt`. Un file
assente, illeggibile o con un valore diverso significa «preferenza non ancora
scelta», non italiano e non una scelta implicita dal locale del sistema.

Ogni writer valida prima il codice e sostituisce l'intero piccolo artefatto in
modo atomico. Non esistono merge fra preferenze concorrenti né timestamp da
confrontare: una scelta esplicita più recente sostituisce la precedente.

## 2. Reader e precedenza

Il gioco nativo, il web locale e il bootstrap degli agenti leggono lo stesso
campo. Il default, quando nessuna preferenza esiste, è `en`.

`JHT_LANG` e `host.env::JHT_LANG` non sono una seconda preferenza persistente:
servono a test, registrazioni e bootstrap prima che l'artefatto esista. Per i
processi del team la precedenza è quindi:

1. `$JHT_HOME/i18n-prefs.json::locale` valido;
2. `JHT_LANG` valido;
3. `host.env::JHT_LANG` valido;
4. `en`.

Il gioco può ancora accettare `JHT_LANG` come override effimero nei selftest e
nelle registrazioni, ma non lo persiste. In una normale esecuzione desktop non
riceve quell'override e legge l'artefatto canonico.

I prompt di un agente vengono materializzati allo spawn: una modifica della
preferenza vale dal prossimo spawn/refresh, non riscrive il prompt di una
sessione già viva.

## 3. Writer

Sono writer autorizzati:

- il picker iniziale e Impostazioni → Lingua del gioco;
- `POST /api/i18n` sul desktop/web locale;
- il preflight host, soltanto per inizializzare l'artefatto se manca;
- il trasporto desktop verso il runtime attivo, locale o VPS, per consegnare
  la stessa scelta al team controllato dal gioco.

Il gioco aggiorna `UIStrings.lang` soltanto dopo che la scrittura canonica
locale è riuscita. Se è collegato a una VPS, il cambio non può essere
dichiarato completo per gli agenti finché lo stesso artefatto non è stato
validato e scritto in `/jht_home`; un errore di trasporto deve restare
visibile, mai essere trasformato in successo.

Al collegamento a una VPS la preferenza desktop esplicita viene consegnata al
runtime. È la direzione già fissata dalla policy («l'utente sceglie dal
desktop»), non una riconciliazione bidirezionale inventata.

## 4. Stato precedente e non-migrazione

`user://lang.cfg` era lo storage privato del gioco e non è mai stato il
contratto degli agenti. Dopo questo fix non viene più letto né scritto.

Non viene cancellato, convertito o importato in `i18n-prefs.json`: farlo
inventerebbe una precedenza fra due scelte senza data e potrebbe sovrascrivere
una preferenza canonica più recente. Un vecchio `lang.cfg` resta quindi un file
inerte e recuperabile. `host.env` resta intatto per compatibilità del runtime,
ma non può vincere sull'artefatto canonico.

## 5. Vettori obbligatori

1. `lang.cfg=it`, `i18n-prefs.json={"locale":"de"}` → gioco e nuovo agente
   usano `de`.
2. preferenza canonica `fr`, `JHT_LANG=en`, `host.env::JHT_LANG=it` → un nuovo
   agente usa `fr`.
3. artefatto assente, `JHT_LANG=hu` → bootstrap `hu`; il reader non inventa un
   file.
4. artefatto assente e nessun bootstrap → `en` e picker iniziale.
5. cambio gioco `es` → `i18n-prefs.json::locale=es`; `lang.cfg` non viene
   toccato.
6. valore `xx` o scrittura fallita → nessun cambio in memoria e nessun
   successo dichiarato.

Una modifica a path, schema, valori ammessi, precedenza, direzione desktop→VPS
o semantica di errore richiede una nuova versione esplicita di questo
contratto prima di cambiare il codice.
