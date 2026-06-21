#!/usr/bin/env python3
# Read-only generator: jobs.db -> CaseStudyRun JSON (aggregato e anonimo).
# Gira SUL VPS; emette solo dati aggregati su stdout (niente PII).
import sqlite3, json, unicodedata, datetime, collections, glob, os

c = sqlite3.connect("file:/root/.jht/jobs.db?mode=ro", uri=True)
cur = c.cursor()
Q = lambda s, *a: cur.execute(s, a).fetchall()

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
match = {
    "scored": n, "avg": round(avg, 1), "min": mn, "max": mx,
    "strong70": s70, "strong80": s80,
    "buckets": buckets, "composition": composition,
}

# ── categorie (role_family emerse) ───────────────────────────────────
categories = [{"name": name, "count": cnt} for name, cnt in Q(
    "SELECT COALESCE(NULLIF(TRIM(role_family),''),'Non categorizzato') rf,COUNT(*) "
    "FROM positions GROUP BY rf ORDER BY 2 DESC, rf")]

# ── paesi ─────────────────────────────────────────────────────────────
countries = [{"name": name, "code": code, "count": cnt} for name, code, cnt in Q(
    "SELECT loc_country, MAX(loc_country_code), COUNT(*) "
    "FROM positions WHERE loc_country IS NOT NULL AND TRIM(loc_country)<>'' "
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
         "AND loc_city IS NOT NULL AND TRIM(loc_city)<>''")
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

# ── usage giornaliero (% del budget SETTIMANALE AI consumato per giorno) ──
# Da sentinel-data.jsonl: weekly_usage è cumulativo dentro la settimana (cresce
# 0→~100) e si azzera al reset (Gio ~06:00 UTC). Consumo del giorno = valore di
# FINE giornata − fine del giorno precedente nella STESSA settimana (0 se è il
# primo giorno della settimana). Robusto all'oscillazione intraday; ogni
# settimana completa somma ~100%.
def _week_key(day_iso):  # giovedì di riferimento (settimana di budget)
    d = datetime.date.fromisoformat(day_iso)
    return (d - datetime.timedelta(days=(d.weekday() - 3) % 7)).isoformat()

SENTINEL = "/root/.jht/logs/sentinel-data.jsonl"
usage = None
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
        samples.append((ts, e["weekly_usage"]))
        if e.get("provider"):
            provider = e["provider"]
    samples.sort()
    day_last = collections.OrderedDict()  # day -> weekly_usage di fine giornata
    for ts, wu in samples:
        day_last[ts[:10]] = wu  # l'ultimo sample del giorno sovrascrive
    daily = []
    week_prev = {}  # week_key -> fine del giorno precedente (nella settimana)
    for day, end in day_last.items():
        wk = _week_key(day)
        pct = end - week_prev.get(wk, 0)
        week_prev[wk] = end
        # pct = consumo del giorno; cum = totale settimanale a fine giornata
        daily.append({"day": day, "pct": round(max(pct, 0), 1),
                      "cum": round(end, 1), "week": wk})
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
    usage = {"provider": provider, "unit": "weekly_budget_pct",
             "daily": daily, "workingHours": working_hours}

out = {
    "source": "betaC-codex",
    "tsRange": [ts_min, ts_max],
    "totals": {"positions": positions, "scored": scored_status, "excluded": excluded_status},
    "match": match,
    "categories": categories,
    "countries": countries,
    "cities": cities,
    "salary": salary,
    "agents": agents,
    "events": events,
    "usage": usage,
}
print(json.dumps(out, ensure_ascii=False, indent=2))
