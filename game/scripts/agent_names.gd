class_name AgentNames
## Il cognome di ogni agente del team, come funzione pura di ruolo + numero.
##
## In ufficio "il numero di un agente È la sua identità": scrivania e volto
## seguono il numero e non l'ordine di spawn (CharacterDefs.VARIANT_BY_DESK),
## così `scout-2` è la stessa persona fra un riavvio e l'altro. Il cognome
## obbedisce alla stessa regola ed è l'ultimo pezzo che mancava: l'indice N-1
## di SURNAMES[ruolo] è il cognome di `<ruolo>-N`, su ogni macchina, per
## sempre. Nessun sorteggio, nessuno stato su disco, nessuna dipendenza dal
## roster vivo — solo tabella e aritmetica.
##
## L'uid tecnico non cambia MAI: `scout-1` resta `scout-1` nei dati, nei log,
## su tmux e verso il backend. Qui si decide soltanto come lo si SCRIVE a
## schermo.
##
## Criteri delle liste (valgono per tutte):
##  - cognomi riconoscibili, del mestiere che il ruolo fa davvero;
##  - distinti a colpo d'occhio DENTRO il ruolo: mai due che condividano
##    l'inizio, perché su una targhetta di scrivania si legge la prima sillaba
##    e basta (è la ragione per cui manca Marlowe accanto a Marple, e Woolf
##    non ha un omofono fra gli Scout);
##  - solo ASCII. Il set di caratteri disponibile è quello dei dizionari UI
##    (JetBrains Mono, 7 lingue): niente lettere che il font di gioco non
##    renda. Il self-test lo verifica carattere per carattere.
##
## API per chi mostra i nomi (la chat a fumetti la usa così):
##   AgentNames.surname("scout-1")       # → "Holmes"
##   AgentNames.display_name("scout-1")  # → "Holmes · scout-1"
##   AgentNames.short_name("scout-1")    # → "Holmes"  (solo cognome)

## Separatore fra cognome e uid. Lo stesso interpunto già in uso ovunque
## nell'interfaccia ("%d posizioni · %d visibili") ed esistente nei dizionari
## delle 7 lingue: non introduce un carattere nuovo nel font.
const SEP := " · "

## Ruoli di reparto: liste ordinate, indice N-1 → `<ruolo>-N`. Dieci nomi
## coprono il roster reale con margine (il Capitano scala fino a 5-6 istanze
## per ruolo, CharacterDefs.DEPT_ROLES ne siede 6); oltre la lista si degrada
## all'uid nudo invece di riciclare un cognome già in uso.
##
## SCOUT → chi cerca per mestiere: detective e investigatori, storici e
## immaginari. Il Ricercatore batte le aziende come loro battono la città.
const SCOUT := ["Holmes", "Colombo", "Poirot", "Marple", "Montalbano",
		"Dupin", "Spade", "Pinkerton", "Vidocq", "Fletcher"]

## ANALISTI → scienziati: chi guarda un dato e capisce cosa dice davvero.
const ANALISTA := ["Einstein", "Newton", "Curie", "Galilei", "Darwin",
		"Fermi", "Turing", "Bohr", "Mendel", "Lovelace"]

## SCORER → chi segna. Richiesta esplicita dell'utente: grandi realizzatori
## dello sport, un mestiere solo — mettere punti sul tabellone. Calcio
## (Ronaldo, Piola, Kane), tennis (Sinner), tiro con l'arco (Ellison),
## basket (Jordan), hockey (Gretzky, Ovechkin), cricket (Bradman),
## ginnastica (Biles). Dei viventi si usa solo il cognome.
const SCORER := ["Ronaldo", "Sinner", "Ellison", "Jordan", "Gretzky",
		"Piola", "Kane", "Bradman", "Ovechkin", "Biles"]

## SCRITTORI → scrittori. Calvino apre: è il Redattore di casa.
const SCRITTORE := ["Calvino", "Hemingway", "Austen", "Orwell", "Borges",
		"Woolf", "Kafka", "Dumas", "Melville", "Verne"]

## CRITICI → critici e giudici: chi legge il lavoro di un altro e dice se
## regge. Cinema (Ebert, Kael), arte (Ruskin, Vasari), letteratura (Croce,
## Bloom, Diderot), musica (Hanslick), e due giudici veri e propri —
## Salomone l'archetipo, Marshall la corte suprema.
const CRITICO := ["Ebert", "Kael", "Ruskin", "Croce", "Vasari", "Bloom",
		"Solomon", "Marshall", "Diderot", "Hanslick"]

## I core sono singoli: un cognome ciascuno, scelto sull'archetipo del ruolo
## e non sul suo settore. Toscanini coordina senza suonare uno strumento;
## Jeeves è l'assistente per antonomasia; Pacioli ha inventato la partita
## doppia (la Sentinella in gioco è "Il Tesoriere", guardiano del budget);
## Miyagi è il mentore; Nightingale ha fatto della cura una disciplina —
## e teneva i conti della salute meglio di chiunque; Torvalds è, alla
## lettera, il mantenitore.
##
## Restano liste di uno perché la forma è la stessa: `mentor-1` e `mentor`
## portano allo stesso cognome, e un domani un secondo Dottore troverebbe
## il posto dove aggiungerlo.
const COORDINATORE := ["Toscanini"]
const ASSISTENTE := ["Jeeves"]
const SENTINELLA := ["Pacioli"]
const MENTOR := ["Miyagi"]
const DOTTORE := ["Nightingale"]
const MANTENITORE := ["Torvalds"]

const SURNAMES := {
	"scout": SCOUT,
	"analista": ANALISTA,
	"scorer": SCORER,
	"scrittore": SCRITTORE,
	"critico": CRITICO,
	"coordinatore": COORDINATORE,
	"assistente": ASSISTENTE,
	"sentinella": SENTINELLA,
	"mentor": MENTOR,
	"dottore": DOTTORE,
	"mantenitore": MANTENITORE,
}

## Nomi alternativi dello STESSO ruolo che circolano nel gioco: gli id di
## reparto sono plurali (CharacterDefs.DEPT_ROLES), gli slug singolari, e il
## VPS chiama "capitano" il Coordinatore (stessa equivalenza di
## BackendBus._chat_role). Chi passa uno di questi deve ottenere il cognome
## giusto, non il vuoto.
const ROLE_ALIASES := {
	"analisti": "analista",
	"scrittori": "scrittore",
	"critici": "critico",
	"capitano": "coordinatore",
	"maintainer": "mantenitore",
}


## Il cognome di un agente, "" se non ne ha uno.
##
## Accetta sia l'uid per istanza (`scout-2`) sia lo slug nudo (`scout`): lo
## slug nudo indica il lead, che in scena siede alla scrivania 1 ed è
## `scout-1` per il backend, quindi porta al PRIMO cognome della lista. Così
## la stessa persona ha lo stesso nome da qualunque chiave la si raggiunga.
##
## Restituisce "" — mai un errore, mai un cognome riciclato — quando:
##  - il ruolo non è nella tabella (`vps-1`, un ruolo nuovo);
##  - il suffisso non è un numero (`sentinella-worker`, `critico-s1`): senza
##    numero non c'è identità stabile, e senza identità stabile non c'è nome;
##  - il numero esce dalla lista (`scout-11`): meglio un uid nudo che due
##    Holmes nella stessa stanza.
static func surname(slug_or_uid: String) -> String:
	var role := role_of(slug_or_uid)
	if not SURNAMES.has(role):
		return ""
	var n := number_of(slug_or_uid)
	var list: Array = SURNAMES[role]
	if n < 1 or n > list.size():
		return ""
	return str(list[n - 1])


## La forma completa da mostrare dove c'è spazio: `Holmes · scout-1`.
##
## Il cognome apre la riga perché è il pezzo umano ed è quello che sopravvive
## a un taglio: se lo spazio finisce si perde la coda tecnica, non il nome.
## L'uid resta dentro INTATTO — è la chiave con cui il resto del gioco, i log
## e tmux ritrovano lo stesso agente.
##
## `fallback` è quello che si mostrava prima dei cognomi ("Scout 2",
## "Critico S1"): serve a chi ha già un'etichetta buona e vuole solo
## arricchirla quando un cognome esiste. Senza fallback si degrada all'uid.
static func display_name(slug_or_uid: String, fallback := "") -> String:
	var sn := surname(slug_or_uid)
	if sn != "":
		return sn + SEP + slug_or_uid
	return fallback if fallback.strip_edges() != "" else slug_or_uid


## La forma corta per gli spazi stretti (vignette sopra la testa, targhe di
## stato, celle di tabella con due nomi sulla stessa riga): il solo cognome.
static func short_name(slug_or_uid: String, fallback := "") -> String:
	var sn := surname(slug_or_uid)
	if sn != "":
		return sn
	return fallback if fallback.strip_edges() != "" else slug_or_uid


## Il cognome ha la precedenza sul nome di scena: `Holmes · Il Ricercatore`.
## Serve dove in UI si mostra un'etichetta umana (CharacterDefs.AGENTS.name,
## DEPT_ROLES.label) invece dell'uid.
static func with_label(slug_or_uid: String, label: String) -> String:
	var sn := surname(slug_or_uid)
	if sn == "" or label.strip_edges() == "":
		return label if label.strip_edges() != "" else slug_or_uid
	if label.contains(sn):
		return label
	return sn + SEP + label


static func has_surname(slug_or_uid: String) -> bool:
	return surname(slug_or_uid) != ""


## Il ruolo base di uno slug o di un uid: la parte prima del primo "-",
## normalizzata sugli alias.
static func role_of(slug_or_uid: String) -> String:
	var clean := slug_or_uid.strip_edges().to_lower()
	if clean == "":
		return ""
	var head := clean.split("-")[0]
	return str(ROLE_ALIASES.get(head, head))


## Il numero d'istanza di un uid. Lo slug nudo vale 1 (il lead); tutto ciò che
## segue il PRIMO "-" deve essere un intero positivo, altrimenti vale 0 —
## "nessuna identità numerica". Si guarda la coda intera e non l'ultimo pezzo
## perché `scout-1-2` e `scout--1` non sono l'istanza 1 di niente: sono uid
## che non riconosciamo, e vanno lasciati passare nudi.
static func number_of(slug_or_uid: String) -> int:
	var clean := slug_or_uid.strip_edges().to_lower()
	if clean == "":
		return 0
	var dash := clean.find("-")
	if dash < 0:
		return 1
	var tail := clean.substr(dash + 1)
	if not tail.is_valid_int():
		return 0
	return maxi(0, tail.to_int())


## Quanti cognomi ha un ruolo (0 se il ruolo non è in tabella). La usa il
## self-test, ma serve anche a chi volesse sapere fino a dove si scala con
## un nome proprio.
static func roster_size(role: String) -> int:
	var normalized := role_of(role)
	if not SURNAMES.has(normalized):
		return 0
	return (SURNAMES[normalized] as Array).size()
