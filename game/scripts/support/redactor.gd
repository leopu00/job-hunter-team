class_name Redactor
## Ripulitore PII: l'UNICO punto in cui log e diagnostica vengono sanificati
## prima di lasciare il computer dell'utente.
##
## Perché esiste: la segnalazione in-app allega i log del gioco e del runtime, e
## quei log parlano di candidature vere — nome del candidato, email di contatto,
## telefono, path del CV, token del provider e dei bot Telegram, IP della VPS.
## Spedire quel materiale grezzo a un endpoint pubblico significherebbe
## ricostruire il problema PII che il repo ha già scontato due volte con lo
## scrub della storia (02/07 e 05/06). Qui la regola è: si redige PRIMA che i
## byte lascino la macchina, non a valle.
##
## Il contratto è deliberatamente conservativo — meglio oscurare una riga utile
## che far uscire un segreto. Ogni sostituzione lascia un segnaposto tipizzato
## (`[email]`, `[secret]`, `[ip]`…) così chi legge il report capisce che lì
## c'era un dato e di che natura era, invece di trovare un buco muto.
##
## Gemello lato server: `web/lib/redact.ts` applica le stesse famiglie di regole
## come difesa in profondità (client vecchi, invii manuali). I due file vanno
## tenuti allineati; i casi di prova vivono in `tools/redactor_selftest.gd` e in
## `tests/js/validators/redact.test.ts`.

## Regole in ordine di applicazione: dalla più specifica alla più generica.
## L'ordine conta — i blocchi di chiave privata vanno tolti prima che le regole
## per riga possano frammentarli, e i segreti prima delle regole generiche che
## potrebbero consumarne un pezzo.
const RULES: Array[Dictionary] = [
	# ── Segreti ────────────────────────────────────────────────────────
	{
		"key": "private_key",
		"family": "secret",
		"pattern": r"-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----",
		"replace": "[private-key]",
	},
	{
		# `token: abc123`, `password=hunter2`, `api_key "…"`. Si conserva il
		# nome della chiave (diagnostico: dice QUALE credenziale era) e si
		# butta solo il valore.
		"key": "assigned_secret",
		"family": "secret",
		# \x22 e \x27 sono le virgolette: scritte così il pattern non contiene
		# mai un apice che chiuderebbe la stringa raw di GDScript.
		"pattern": r"(?i)\b(token|api[_-]?key|apikey|secret|password|passwd|pwd|credential|bearer)s?\b\s*[:=]\s*[\x22\x27]?([^\s\x22\x27,;}\]]{6,})",
		"replace": "$1: [secret]",
	},
	{
		# Token BotFather: 8-10 cifre, due punti, 35 caratteri.
		"key": "telegram_token",
		"family": "secret",
		"pattern": r"\b\d{8,10}:[A-Za-z0-9_-]{35}\b",
		"replace": "[telegram-token]",
	},
	{
		"key": "github_token",
		"family": "secret",
		"pattern": r"\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b",
		"replace": "[github-token]",
	},
	{
		# sk-…, sk-ant-…: la famiglia di chiavi dei provider LLM.
		"key": "provider_key",
		"family": "secret",
		"pattern": r"\bsk-[A-Za-z0-9_-]{16,}\b",
		"replace": "[provider-key]",
	},
	{
		"key": "jwt",
		"family": "secret",
		"pattern": r"\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b",
		"replace": "[jwt]",
	},
	{
		# Credenziali dentro un URL: https://utente:password@host
		"key": "url_credentials",
		"family": "secret",
		"pattern": r"://[^\s/@:]+:[^\s/@]+@",
		"replace": "://[credentials]@",
	},
	{
		"key": "url_secret_param",
		"family": "secret",
		"pattern": r"(?i)([?&](?:token|key|secret|code|access_token|refresh_token)=)[^&\s\x22\x27]+",
		"replace": "$1[secret]",
	},
	{
		# Il local-token di JHT è esadecimale a 64 caratteri; qualunque
		# stringa esadecimale lunga è comunque un segreto o un hash, mai un
		# dato leggibile. Gli SHA di commit compaiono abbreviati (7-8) e
		# restano intatti.
		"key": "long_hex",
		"family": "secret",
		"pattern": r"\b[a-fA-F0-9]{32,}\b",
		"replace": "[hash]",
	},

	# ── Dati personali ─────────────────────────────────────────────────
	{
		"key": "email",
		"family": "personal",
		"pattern": r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}",
		"replace": "[email]",
	},
	{
		# Solo numeri con prefisso internazionale esplicito: le euristiche
		# più larghe divorano timestamp, fps e id posizione dai log.
		"key": "phone_intl",
		"family": "personal",
		"pattern": r"\+\d{1,3}[\s.-]?\d[\d\s.-]{7,14}\d",
		"replace": "[phone]",
	},
	{
		"key": "phone_labeled",
		"family": "personal",
		"pattern": r"(?i)\b(tel|telefono|phone|cellulare|mobile)\b\s*[:=]?\s*[\d][\d\s.-]{6,}\d",
		"replace": "$1: [phone]",
	},
	{
		"key": "iban",
		"family": "personal",
		"pattern": r"\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b",
		"replace": "[iban]",
	},
	{
		"key": "fiscal_code",
		"family": "personal",
		"pattern": r"\b[A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]\b",
		"replace": "[fiscal-code]",
	},
	{
		# IP pubblici (quindi: la VPS dell'utente). Loopback e range privati
		# restano leggibili — servono a capire la topologia e non
		# identificano nessuno.
		"key": "public_ip",
		"family": "personal",
		"pattern": r"\b(?!10\.)(?!127\.)(?!0\.)(?!255\.)(?!169\.254\.)(?!192\.168\.)(?!172\.(?:1[6-9]|2\d|3[01])\.)\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b",
		"replace": "[ip]",
	},
	{
		# Il nome utente del sistema operativo è un identificativo diretto e
		# compare in ogni path assoluto dei log.
		"key": "home_path",
		"family": "personal",
		"pattern": r"(?i)([/\\](?:Users|home)[/\\])([^/\\\s\x22\x27:;,)\]]+)",
		"replace": "$1[user]",
	},
	{
		# Il CV e la lettera si chiamano quasi sempre col nome del candidato.
		# L'estensione resta: dice se il problema è su PDF o DOCX.
		"key": "document_name",
		"family": "personal",
		"pattern": r"(?i)\b[\w %+-]{1,80}\.(pdf|docx|doc|odt|rtf)\b",
		"replace": "[document].$1",
	},
]

## Le due famiglie di regola. `secret` copre credenziali e chiavi, `personal`
## copre i dati che identificano una persona. Un filtro vuoto significa
## "tutte" — il default sicuro, così una chiamata distratta redige di più,
## mai di meno.
const FAMILIES := ["secret", "personal"]

## Il testo ripulito e basta — per chi non ha bisogno del rendiconto.
static func redact(text: String, extra_terms: PackedStringArray = PackedStringArray()) -> String:
	return redact_with_report(text, extra_terms)["text"]


## Solo credenziali e chiavi, lasciando intatto il resto.
##
## È il trattamento riservato a ciò che l'utente SCRIVE di suo pugno nel form:
## quelle frasi sono il contenuto della segnalazione e devono restare
## leggibili — se qualcuno racconta "la mia email non arriva", oscurargli la
## parola email rende il report inutile. Ma se incolla un token nel racconto,
## quello non deve uscire comunque: la scelta di scriverlo non è un consenso
## informato a pubblicarlo su un issue tracker.
static func redact_secrets(text: String) -> String:
	return redact_with_report(text, PackedStringArray(),
			PackedStringArray(["secret"]))["text"]


## Ripulisce e rendiconta: `{"text": String, "counts": {regola: quante}}`.
## Il rendiconto non è decorazione — la UI lo mostra all'utente prima
## dell'invio ("12 email, 3 token rimossi"), che è ciò che rende il consenso
## informato invece che una casella da spuntare al buio.
static func redact_with_report(text: String,
		extra_terms: PackedStringArray = PackedStringArray(),
		families: PackedStringArray = PackedStringArray()) -> Dictionary:
	var counts := {}
	var out := text
	var every := families.is_empty()
	for rule in RULES:
		if not every and not families.has(str(rule["family"])):
			continue
		var re := _compiled(str(rule["pattern"]))
		if re == null:
			continue
		var hits := re.search_all(out).size()
		if hits > 0:
			counts[rule["key"]] = hits
			out = re.sub(out, str(rule["replace"]), true)
	# I termini noti (nome e cognome dell'utente, come li ha scritti al primo
	# avvio) vanno per ultimi: sono i più specifici e non devono interferire
	# con le regole strutturali sopra.
	var term_hits := 0
	if not every and not families.has("personal"):
		extra_terms = PackedStringArray()
	for term in extra_terms:
		var clean := term.strip_edges()
		if clean.length() < 3:
			continue
		var re := _compiled(r"(?i)\b" + _escape(clean) + r"\b")
		if re == null:
			continue
		term_hits += re.search_all(out).size()
		out = re.sub(out, "[name]", true)
	if term_hits > 0:
		counts["known_name"] = term_hits
	return {"text": out, "counts": counts}


## Vero se nel testo resta qualcosa che somiglia a un segreto: la usa il
## selftest e la può usare chi vuole un'ultima verifica prima di spedire.
static func has_residual_secret(text: String) -> bool:
	for key in ["private_key", "telegram_token", "github_token", "provider_key",
			"jwt", "long_hex", "email"]:
		for rule in RULES:
			if rule["key"] != key:
				continue
			var re := _compiled(str(rule["pattern"]))
			if re != null and re.search(text) != null:
				return true
	return false


## Riassunto leggibile del rendiconto, nella lingua della UI.
static func summary(counts: Dictionary) -> String:
	if counts.is_empty():
		return UIStrings.t("feedback.redacted_none")
	var total := 0
	for key in counts:
		total += int(counts[key])
	return UIStrings.t("feedback.redacted_count") % total


static var _cache := {}

static func _compiled(pattern: String) -> RegEx:
	if _cache.has(pattern):
		var cached: RegEx = _cache[pattern]
		return cached
	var re := RegEx.new()
	if re.compile(pattern) != OK:
		# Un pattern rotto non deve azzoppare l'invio: si salta la regola e
		# si lascia traccia, perché una regola muta è un buco di privacy.
		push_error("[redactor] pattern non compilabile: " + pattern)
		_cache[pattern] = null
		return null
	_cache[pattern] = re
	return re


## I nomi propri possono contenere caratteri che il motore regex interpreta
## (l'apostrofo di "D'Angelo" no, il punto di un secondo nome sì).
static func _escape(value: String) -> String:
	var out := ""
	for i in value.length():
		var ch := value[i]
		if "\\^$.|?*+()[]{}".contains(ch):
			out += "\\"
		out += ch
	return out
