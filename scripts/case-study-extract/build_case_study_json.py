#!/usr/bin/env python3
# Read-only generator: jobs.db -> CaseStudyRun JSON (aggregato e anonimo).
# Gira SUL VPS; emette solo dati aggregati su stdout (niente PII).
import sqlite3, json, unicodedata, datetime, collections, glob, os

c = sqlite3.connect("file:/root/.jht/jobs.db?mode=ro", uri=True)
cur = c.cursor()
Q = lambda s, *a: cur.execute(s, a).fetchall()

# ── finestra opzionale di sessione (per NON mescolare run diversi) ──────
# Env:
#   JHT_CS_SOURCE   etichetta della sorgente nello snapshot (default: betaC-codex)
#   JHT_CS_FROM     inizio finestra inclusivo "YYYY-MM-DD" (vuoto = dall'inizio)
#   JHT_CS_TO       fine finestra ESCLUSIVA "YYYY-MM-DD"   (vuoto = fino a oggi)
#   JHT_CS_PROVIDER forza il provider del budget (es. codex/kimi); vuoto = dai dati
# La finestra filtra positions.found_at, position_state_transitions.ts e i sample
# di budget. È realizzata con TEMP TABLE che SHADOWANO le tabelle reali: in SQLite
# il nome non qualificato risolve prima sulla TEMP, quindi TUTTE le query sotto
# restano identiche. Il DB principale resta read-only (le TEMP vivono nello store
# temporaneo, separato). Senza env → copie integrali = comportamento invariato.
SOURCE = os.environ.get("JHT_CS_SOURCE", "").strip() or "betaC-codex"
FROM = os.environ.get("JHT_CS_FROM", "").strip()
TO = os.environ.get("JHT_CS_TO", "").strip()

def _win(col):
    conds, params = [], []
    if FROM:
        conds.append(f"{col} >= ?"); params.append(FROM)
    if TO:
        conds.append(f"{col} < ?"); params.append(TO)
    return (" AND " + " AND ".join(conds)) if conds else "", params

_pf, _pp = _win("found_at")
cur.execute(f"CREATE TEMP TABLE positions AS SELECT * FROM main.positions WHERE 1=1{_pf}", _pp)
cur.execute("CREATE TEMP TABLE scores AS SELECT * FROM main.scores "
            "WHERE position_id IN (SELECT id FROM positions)")
_ef, _ep = _win("ts")
cur.execute("CREATE TEMP TABLE position_state_transitions AS "
            f"SELECT * FROM main.position_state_transitions WHERE 1=1{_ef}", _ep)

# ── totals ────────────────────────────────────────────────────────────
positions = Q("SELECT COUNT(*) FROM positions")[0][0]
scored_status = Q("SELECT COUNT(*) FROM positions WHERE status='scored'")[0][0]
excluded_status = Q("SELECT COUNT(*) FROM positions WHERE status='excluded'")[0][0]

# ── match ─────────────────────────────────────────────────────────────
n, avg, mn, mx, s70, s80 = Q(
    "SELECT COUNT(*),AVG(total_score),MIN(total_score),MAX(total_score),"
    "SUM(total_score>=70),SUM(total_score>=80) FROM scores")[0]
buckets_raw = dict(Q(
    "SELECT CASE WHEN total_score<40 THEN '0-39' WHEN total_score<60 THEN '40-59' "
    "WHEN total_score<70 THEN '60-69' WHEN total_score<80 THEN '70-79' ELSE '80-100' END b,"
    "COUNT(*) FROM scores GROUP BY b"))
buckets = [{"label": l, "n": buckets_raw.get(l, 0)}
           for l in ["0-39", "40-59", "60-69", "70-79", "80-100"]]
comp = Q("SELECT AVG(stack_match),AVG(experience_fit),AVG(strategic_fit),"
         "AVG(remote_fit),AVG(salary_fit) FROM scores")[0]
composition = [
    {"key": "stack",     "label": "Competenze",    "avg": round(comp[0], 1)},
    {"key": "exp",       "label": "Esperienza",    "avg": round(comp[1], 1)},
    {"key": "strategic", "label": "Fit strategico","avg": round(comp[2], 1)},
    {"key": "remote",    "label": "Modalita",      "avg": round(comp[3], 1)},
    {"key": "salary",    "label": "Retribuzione",  "avg": round(comp[4], 1)},
]
scores_raw = [r[0] for r in Q(
    "SELECT total_score FROM scores WHERE total_score IS NOT NULL ORDER BY total_score")]
match = {
    "scored": n, "avg": round(avg, 1), "min": mn, "max": mx,
    "strong70": s70, "strong80": s80,
    "buckets": buckets, "composition": composition,
    "scores": scores_raw,
}

# ── categorie (role_family emerse) ───────────────────────────────────
# count = posizioni nella famiglia; scored = quante hanno uno score;
# avg = media total_score sulle scorate (None se nessuna). LEFT JOIN così le
# famiglie senza posizioni scorate restano in lista con avg=None.
categories = [
    {"name": name, "count": cnt, "scored": scored,
     "avg": round(avg, 1) if avg is not None else None}
    for name, cnt, scored, avg in Q(
        "SELECT COALESCE(NULLIF(TRIM(p.role_family),''),'Non categorizzato') rf,"
        "COUNT(DISTINCT p.id) cnt,"
        "COUNT(s.total_score) scored,"
        "AVG(s.total_score) avg_score "
        "FROM positions p LEFT JOIN scores s ON s.position_id=p.id "
        "GROUP BY rf ORDER BY 2 DESC, rf")]

# ── fonti (job board / ATS / pagine carriera) ────────────────────────
# Normalizzate (lower/trim, '_'→'-' per fondere company_careers/company-careers);
# top-12 individuali, la coda lunga finisce in "Altre".
src_rows = Q(
    "SELECT COALESCE(NULLIF(TRIM(REPLACE(LOWER(source),'_','-')),''),'sconosciuta') src,"
    "COUNT(*) FROM positions GROUP BY 1 ORDER BY 2 DESC, 1")
SRC_TOP = 12
sources = [{"name": name, "count": cnt} for name, cnt in src_rows[:SRC_TOP]]
src_rest = sum(cnt for _, cnt in src_rows[SRC_TOP:])
if src_rest:
    sources.append({"name": "Altre", "count": src_rest})

# ── fonti NEL TEMPO (barre impilate per giorno, colore = fonte) ──────
# Stessa normalizzazione di `sources`; top-8 individuali + "Altre" (coda lunga)
# per tenere leggibile lo stack. Bucket per giorno di found_at (UTC, come usage).
SRC_TOP_DAILY = 8
top_daily = [name for name, _ in src_rows[:SRC_TOP_DAILY]]
top_daily_set = set(top_daily)
day_src = Q(
    "SELECT substr(found_at,1,10) d,"
    "COALESCE(NULLIF(TRIM(REPLACE(LOWER(source),'_','-')),''),'sconosciuta') src "
    "FROM positions WHERE found_at IS NOT NULL AND TRIM(found_at)<>''")
sd_agg = collections.OrderedDict()
sd_has_altre = False
for d, src in day_src:
    key = src if src in top_daily_set else "Altre"
    if key == "Altre":
        sd_has_altre = True
    sd_agg.setdefault(d, {})
    sd_agg[d][key] = sd_agg[d].get(key, 0) + 1
sources_daily = [{"day": d, "counts": sd_agg[d]} for d in sorted(sd_agg)]
sources_daily_keys = top_daily + (["Altre"] if sd_has_altre else [])

# ── score medio per giorno PER fonte (linee sull'asse dx del grafico fonti) ──
# Solo posizioni scorate; stesse chiavi top-8 + "Altre" di sourcesDaily.
sc_rows = Q(
    "SELECT substr(p.found_at,1,10) d,"
    "COALESCE(NULLIF(TRIM(REPLACE(LOWER(p.source),'_','-')),''),'sconosciuta') src,"
    "s.total_score "
    "FROM positions p JOIN scores s ON s.position_id=p.id "
    "WHERE p.found_at IS NOT NULL AND TRIM(p.found_at)<>'' AND s.total_score IS NOT NULL")
sc_agg = collections.OrderedDict()  # day -> {key: [somma, n]}
for d, src, sc in sc_rows:
    key = src if src in top_daily_set else "Altre"
    bucket = sc_agg.setdefault(d, {})
    acc = bucket.get(key, [0.0, 0])
    acc[0] += sc
    acc[1] += 1
    bucket[key] = acc
sources_score_daily = [
    {"day": d, "score": {k: round(v[0] / v[1], 1) for k, v in sc_agg[d].items()}}
    for d in sorted(sc_agg)
]

# ── score medio COMPLESSIVO per fonte (grafico a barre, non per periodo) ──
sc_by_src = collections.OrderedDict()  # key -> [somma, n]
for d, src, sc in sc_rows:
    key = src if src in top_daily_set else "Altre"
    acc = sc_by_src.get(key, [0.0, 0])
    acc[0] += sc
    acc[1] += 1
    sc_by_src[key] = acc
sources_score = [
    {"name": k, "avg": round(v[0] / v[1], 1), "n": v[1]}
    for k, v in sc_by_src.items()
]
sources_score.sort(key=lambda r: -r["avg"])

# ── paesi (solo posizioni VERIFICATE, non escluse: es. UK escluse per work-auth) ──
countries = [{"name": name, "code": code, "count": cnt} for name, code, cnt in Q(
    "SELECT loc_country, MAX(loc_country_code), COUNT(*) "
    "FROM positions WHERE loc_country IS NOT NULL AND TRIM(loc_country)<>'' "
    "AND status<>'excluded' "
    "GROUP BY loc_country ORDER BY 3 DESC, loc_country")]

# ── città (geocodificate, normalizzate/deduplicate) ──────────────────
def strip_accents(s):
    return "".join(ch for ch in unicodedata.normalize("NFKD", s)
                   if not unicodedata.combining(ch))
def norm(s):
    return strip_accents(s).lower().strip()

ALIAS = {"lisboa": "lisbon"}  # stessa città, grafie diverse
country_keys = {norm(r[0]) for r in Q(
    "SELECT DISTINCT loc_country FROM positions WHERE loc_country IS NOT NULL")}

rows = Q("SELECT loc_city, loc_country, office_lat, office_lon FROM positions "
         "WHERE office_lat IS NOT NULL AND office_lon IS NOT NULL "
         "AND loc_city IS NOT NULL AND TRIM(loc_city)<>'' "
         "AND status<>'excluded'")
agg = {}
for city, country, lat, lon in rows:
    k = ALIAS.get(norm(city), norm(city))
    if k in country_keys:   # scarta geocodifiche errate (city == nazione)
        continue
    a = agg.setdefault(k, {"names": {}, "country": country, "lat": 0.0, "lon": 0.0, "n": 0})
    a["names"][city] = a["names"].get(city, 0) + 1   # grafia più frequente = display
    a["lat"] += lat; a["lon"] += lon; a["n"] += 1
    if country:
        a["country"] = country
cities = []
for k, a in agg.items():
    display = max(a["names"].items(), key=lambda kv: kv[1])[0]
    cities.append({
        "city": display, "country": a["country"] or "",
        "lat": round(a["lat"] / a["n"], 4), "lon": round(a["lon"] / a["n"], 4),
        "count": a["n"],
    })
cities.sort(key=lambda c: (-c["count"], c["city"]))

# ── salary (EUR, min e max dichiarati) ───────────────────────────────
sn, smin, smax = Q(
    "SELECT COUNT(*),AVG(salary_declared_min),AVG(salary_declared_max) FROM positions "
    "WHERE salary_declared_currency='EUR' AND salary_declared_min IS NOT NULL "
    "AND salary_declared_max IS NOT NULL")[0]
salary = {"n": sn, "avgMin": round(smin) if smin else None,
          "avgMax": round(smax) if smax else None}

# ── eventi (timeline per-agente, da position_state_transitions) ──────
events = [{"ts": ts.replace(" ", "T") + "Z", "agent": by, "action": to}
          for to, by, ts in Q(
              "SELECT to_state, by_agent, ts FROM position_state_transitions "
              "WHERE by_agent LIKE '%-%' ORDER BY ts, id")]
agents = sorted({e["agent"] for e in events})
ts_min, ts_max = Q("SELECT MIN(ts),MAX(ts) FROM position_state_transitions")[0]

# ── usage giornaliero (% del budget AI consumato per giorno) ──
# Da sentinel-data.jsonl: weekly_usage è cumulativo dentro il ciclo di budget
# (cresce 0→~100) e si azzera al reset. Il reset NON è solo il giovedì di
# calendario: l'utente può prendere un nuovo abbonamento e ripartire da 0 senza
# aspettare la settimana. Quindi i CICLI si rilevano dai dati: nuovo ciclo quando
# il cum SCENDE (reset, naturale o nuovo abbonamento) o c'è un buco di giorni.
# Consumo del giorno = fine giornata − fine del giorno prima NELLO STESSO ciclo
# (= il valore stesso se è il primo giorno del ciclo). `week` = data inizio ciclo.

SENTINEL = "/root/.jht/logs/sentinel-data.jsonl"
usage = None
hour_cum = {}  # "YYYY-MM-DDTHH" -> budget cumulato % (ultimo sample dell'ora)
if os.path.exists(SENTINEL):
    samples = []  # (ts, weekly_usage)
    provider = "codex"
    for line in open(SENTINEL):
        line = line.strip()
        if not line:
            continue
        try:
            e = json.loads(line)
        except Exception:
            continue
        ts = e.get("ts", "")
        if not ts or e.get("weekly_usage") is None:
            continue
        if FROM and ts[:10] < FROM:   # stessa finestra di sessione delle positions
            continue
        if TO and ts[:10] >= TO:
            continue
        samples.append((ts, e["weekly_usage"]))
        if e.get("provider"):
            provider = e["provider"]
    samples.sort()
    for ts, wu in samples:  # budget cum per ORA (ultimo sample dell'ora vince)
        hour_cum[ts[:13]] = wu
    day_last = collections.OrderedDict()  # day -> weekly_usage di fine giornata
    # per il de-glitch opzionale (sotto): target di reset dichiarato + se ben formato,
    # presi dall'ULTIMO sample del giorno (coerente con day_last). Riletti dal file.
    day_reset = {}   # day -> weekly_reset_at_unix (fine giornata)
    day_dated = {}   # day -> True se weekly_reset_at ha una DATA (post fix bridge 30/06)
    def _dated(s):
        return bool(s) and ("UTC" in str(s) or str(s)[:2] == "20")
    for line in open(SENTINEL):
        line = line.strip()
        if not line:
            continue
        try:
            e = json.loads(line)
        except Exception:
            continue
        ts = e.get("ts", "")
        if not ts or e.get("weekly_usage") is None:
            continue
        if (FROM and ts[:10] < FROM) or (TO and ts[:10] >= TO):
            continue
        day_reset[ts[:10]] = e.get("weekly_reset_at_unix")
        day_dated[ts[:10]] = _dated(e.get("weekly_reset_at"))
    for ts, wu in samples:
        day_last[ts[:10]] = wu  # l'ultimo sample del giorno sovrascrive
    daily = []
    prev_day = None
    prev_end = None
    cycle = None  # data di inizio del ciclo di budget corrente
    for day, end in day_last.items():
        gap = (prev_day is not None and
               (datetime.date.fromisoformat(day)
                - datetime.date.fromisoformat(prev_day)).days > 1)
        reset = prev_end is not None and end < prev_end - 1  # cum sceso = reset
        if cycle is None or reset or gap:
            cycle, base = day, 0.0  # nuovo ciclo: riparte da 0
        else:
            base = prev_end
        pct = end - base
        # pct = consumo del giorno; cum = totale del ciclo a fine giornata
        daily.append({"day": day, "pct": round(max(pct, 0), 1),
                      "cum": round(end, 1), "week": cycle})
        prev_day, prev_end = day, end

    # ── de-glitch RESET SETTIMANALI SPURII (opt-in, JHT_CS_STITCH_WEEKLY=1) ──
    # Solo per Codex: il weekly è un rolling-7d letto da OpenAI attraverso le
    # sessioni Codex parallele (sentinel-bridge fetch_codex_rollout); a volte una
    # sessione fresca riporta il weekly ~0 con reset "adesso+7g" → un AZZERAMENTO
    # SPURIO, non un reset vero (osservato 10/07: due azzeramenti in 12h). Qui, se
    # un inizio-ciclo BEN FORMATO cade ben prima del target dichiarato dal ciclo
    # precedente, lo ricuce nel ciclo (offset sul cum) e segna il giorno per una
    # marcatura nel grafico (riga rossa "lettura budget non affidabile"). Non tocca
    # il periodo malformato (giugno) né gli altri provider. Default OFF → invariato.
    stitched_resets = []
    if os.environ.get("JHT_CS_STITCH_WEEKLY", "").strip() and daily:
        def _epoch(d):
            return datetime.datetime(*map(int, d.split("-")),
                                     tzinfo=datetime.timezone.utc).timestamp()
        eff_week = None
        offset = 0.0
        prev_scum = 0.0
        prev_d = None
        orig_prev_week = None
        for rec in daily:
            day, ocum, oweek = rec["day"], rec["cum"], rec["week"]
            boundary = oweek != orig_prev_week
            spurious = False
            if boundary:
                prev_target = day_reset.get(prev_d) if prev_d else None
                # spurio: azzeramento ben formato > 1.5 giorni PRIMA del target dichiarato
                spurious = (eff_week is not None and day_dated.get(day, False)
                            and isinstance(prev_target, (int, float))
                            and (prev_target - _epoch(day)) > 1.5 * 86400)
                if spurious:
                    offset += prev_scum          # continua: somma il picco raggiunto
                    stitched_resets.append(day)
                else:
                    eff_week, offset = day, 0.0   # reset vero: nuovo ciclo
            base_for_pct = 0.0 if (boundary and not spurious) else prev_scum
            scum = ocum + offset
            rec["cum"] = round(scum, 1)
            rec["pct"] = round(max(scum - base_for_pct, 0), 1)
            rec["week"] = eff_week or oweek
            prev_scum, prev_d, orig_prev_week = scum, day, oweek

    # orario di lavoro configurato (contesto: su quali ore/giorni si spalma)
    working_hours = None
    CONFIG = "/root/.jht/jht.config.json"
    if os.path.exists(CONFIG):
        try:
            wh = json.load(open(CONFIG)).get("team", {}).get("working_hours")
            if wh:
                working_hours = {
                    "timezone": wh.get("timezone"),
                    "windows": [
                        {"days": w.get("days", []), "start": w.get("start"),
                         "end": w.get("end")}
                        for w in wh.get("windows", [])
                    ],
                }
        except Exception:
            pass
    provider = os.environ.get("JHT_CS_PROVIDER", "").strip() or provider
    usage = {"provider": provider, "unit": "weekly_budget_pct",
             "daily": daily, "workingHours": working_hours}
    if stitched_resets:  # giorni con azzeramento weekly spurio (marcatura grafico)
        usage["stitchedResets"] = stitched_resets

# ── attività + budget per ORA (per viste intraday su fasi corte, es. burst free-run) ──
# Solo le ore con almeno una transizione (compatto). Ogni bucket:
# {hour:"YYYY-MM-DDTHH", counts:{ruolo:n}, cum: budget% a quell'ora}. Il cum è
# riportato in avanti dall'ultimo sample noto, così le ore senza sample budget
# non azzerano la linea.
hour_acts = collections.OrderedDict()  # hour -> {role: n}
for e in events:
    hr = e["ts"][:13]  # "YYYY-MM-DDTHH"
    role = e["agent"].split("-")[0]
    b = hour_acts.setdefault(hr, {})
    b[role] = b.get(role, 0) + 1
hourly = []
_last_cum = 0.0
for hr in sorted(hour_acts):
    if hr in hour_cum:
        _last_cum = hour_cum[hr]
    hourly.append({"hour": hr, "counts": hour_acts[hr], "cum": round(_last_cum, 1)})

# ── funnel TROVATE → ESCLUSE / TENUTE (per giorno + totali) ──────────
# Per ogni giorno di found_at: quante posizioni trovate e come sono finite
# (status attuale). "tenute" = non escluse. Serve a mostrare la proporzione
# escluse vs tenute giorno per giorno (e in totale, per il donut).
fd_rows = Q(
    "SELECT substr(found_at,1,10) d, status, COUNT(*) "
    "FROM positions WHERE found_at IS NOT NULL AND TRIM(found_at)<>'' "
    "GROUP BY 1, 2")
fd = collections.OrderedDict()  # day -> {status: n}
for d, st, n in fd_rows:
    fd.setdefault(d, {})[(st or "?")] = n
funnel_daily = []
for d in sorted(fd):
    sm = fd[d]
    excl = sm.get("excluded", 0)
    found = sum(sm.values())
    funnel_daily.append({
        "day": d, "found": found, "excluded": excl, "kept": found - excl,
        "scored": sm.get("scored", 0), "ready": sm.get("ready", 0),
    })
status_tot = {(st or "?"): n for st, n in Q(
    "SELECT status, COUNT(*) FROM positions GROUP BY status")}
_excl_tot = status_tot.get("excluded", 0)
_found_tot = sum(status_tot.values())
funnel_totals = {
    "found": _found_tot, "excluded": _excl_tot, "kept": _found_tot - _excl_tot,
    "scored": status_tot.get("scored", 0), "ready": status_tot.get("ready", 0),
}

# ── imbuto di conversione (POSIZIONI DISTINTE, monotòno) ──────────────
# La card di conversione (trovate → valutate → forti≥70 → eccellenti≥80) deve
# decrescere step-su-step. Perciò NON usa funnelTotals.scored (posizioni nello
# stato 'scored' → sottostima quando avanzano a 'ready') né match.strong70/80
# (che contano gli EVENTI di score, ri-score inclusi → sovrastima). Qui ogni
# stadio è una POSIZIONE DISTINTA, con la soglia sul MIGLIOR punteggio ricevuto.
conv_scored = Q("SELECT COUNT(DISTINCT position_id) FROM scores "
                "WHERE total_score IS NOT NULL")[0][0]
_best = Q("SELECT MAX(total_score) FROM scores WHERE total_score IS NOT NULL "
          "GROUP BY position_id")
conversion = {
    "found": _found_tot,
    "scored": conv_scored,
    "strong70": sum(1 for (m,) in _best if m >= 70),
    "strong80": sum(1 for (m,) in _best if m >= 80),
}

# ── per-giorno (found_at): match forti/eccellenti prodotti ────────────
# Per ogni giorno di found_at: quante posizioni hanno il MIGLIOR punteggio
# ≥70 (forti) e ≥80 (eccellenti). Serve al grafico temporale "score alto al
# giorno". Bucket per giorno di scoperta, coerente con funnelDaily/sourcesDaily.
_bd = Q("SELECT substr(p.found_at,1,10) d, MAX(s.total_score) best "
        "FROM positions p JOIN scores s ON s.position_id=p.id "
        "WHERE p.found_at IS NOT NULL AND TRIM(p.found_at)<>'' "
        "AND s.total_score IS NOT NULL GROUP BY p.id")
_sd = collections.OrderedDict()
for d, best in _bd:
    b = _sd.setdefault(d, {"scored": 0, "strong70": 0, "strong80": 0})
    b["scored"] += 1
    if best >= 70:
        b["strong70"] += 1
    if best >= 80:
        b["strong80"] += 1
score_daily = [{"day": d, "scored": _sd[d]["scored"],
                "strong70": _sd[d]["strong70"], "strong80": _sd[d]["strong80"]}
               for d in sorted(_sd)]

out = {
    "source": SOURCE,
    "tsRange": [ts_min, ts_max],
    "totals": {"positions": positions, "scored": scored_status, "excluded": excluded_status},
    "match": match,
    "categories": categories,
    "sources": sources,
    "sourcesDaily": sources_daily,
    "sourcesDailyKeys": sources_daily_keys,
    "sourcesScoreDaily": sources_score_daily,
    "sourcesScore": sources_score,
    "countries": countries,
    "cities": cities,
    "salary": salary,
    "agents": agents,
    "events": events,
    "hourly": hourly,
    "funnelDaily": funnel_daily,
    "funnelTotals": funnel_totals,
    "conversion": conversion,
    "scoreDaily": score_daily,
    "usage": usage,
}
print(json.dumps(out, ensure_ascii=False, indent=2))
