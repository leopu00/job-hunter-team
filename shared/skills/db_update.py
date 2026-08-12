#!/usr/bin/env python3
"""Aggiorna dati nel database jobs.db (schema V2).

Uso:
  python3 db_update.py position 42 --status checked
  python3 db_update.py position 42 --status scored --notes "Ottimo match"
  python3 db_update.py company "Adaptify" --verdict GO --red-flags "piccola"
  python3 db_update.py application 42 --critic-verdict PASS --critic-score 8.5 --reviewed-by critico
  python3 db_update.py application 42 --status applied --applied-at "2026-02-19" --applied-via "dynamite"

Salary V2:
  python3 db_update.py position 42 --salary-declared-min 40000 --salary-declared-max 55000
  python3 db_update.py position 42 --salary-estimated-min 35000 --salary-estimated-max 50000 --salary-estimated-source glassdoor

Tracking temporale:
  python3 db_update.py application 42 --written-at "2026-02-20 14:30"
  python3 db_update.py application 42 --response "rejected" --response-at "2026-02-25"
"""

import argparse
import re
import sys
import os
sys.path.insert(0, os.path.dirname(__file__))

from _db import get_db, ensure_schema, resolve_company_id, _column_exists
import role_taxonomy
import maintenance_log

# Campi il cui valore racconta la manutenzione. Vengono fotografati PRIMA
# dell'UPDATE e riletti dopo, così l'evento registra il diff e non il fatto
# nudo: senza before/after non è misurabile il tasso di no-op, che è la sola
# metrica capace di distinguere il lavoro dal timestamp scritto a vuoto.
# Lista fissa e non dedotta dagli argomenti: un campo si aggiunge qui
# consapevolmente, non per effetto collaterale di un flag nuovo.
#
# ⚠️ `last_checked` e `last_open_check` sono ESCLUSI di proposito, e non è una
# dimenticanza. Cambiano ad ogni singola chiamata per costruzione, quindi
# includerli renderebbe OGNI evento un `updated` e il tasso di no-op sarebbe
# sempre zero: si ricostruirebbe, dentro la tabella che serve a smascherarlo,
# esattamente l'inganno da cui siamo partiti — la prova di lavoro che consiste
# nell'aver scritto l'ora.
MAINTENANCE_TRACKED_FIELDS = (
    "status", "url", "deadline", "expires_at", "is_open",
    "office_lat", "office_lon", "office_address",
    "office_geocoded", "office_verified",
    "jd_summary", "jd_text", "notes",
)

# Lato azienda: `logo_fetch` e `website_fetch` sono azioni di manutenzione a
# tutti gli effetti, e senza questo non avrebbero dove essere registrate.
COMPANY_TRACKED_FIELDS = (
    "website", "logo", "logo_source", "logo_fetched",
    "sector", "hq_country", "size",
)


def _snapshot(conn, table, row_id, fields):
    """Valori correnti dei campi tracciati. `{}` se la riga non esiste."""
    present = [f for f in fields if _column_exists(conn, table, f)]
    if not present:
        return {}
    row = conn.execute(
        f"SELECT {', '.join(present)} FROM {table} WHERE id = ?", (row_id,)
    ).fetchone()
    if row is None:
        return {}
    if hasattr(row, "keys"):
        return {f: row[f] for f in present}
    return dict(zip(present, row))


def _diffs(before, after):
    """`[(campo, prima, dopo)]` per i soli campi realmente cambiati.

    Il confronto è sulla rappresentazione testuale: SQLite restituisce 1 dove
    la CLI passa 'true', e un diff che segnala come cambiato un valore
    identico gonfierebbe il conteggio degli `updated` proprio a scapito degli
    `unchanged` — cioè del numero che stiamo cercando di misurare.
    """
    out = []
    for field, old in before.items():
        new = after.get(field)
        if str(old) != str(new):
            out.append((field, old, new))
    return out

# Lettore delle categorie ATTIVE del registro emergente. Usa la funzione
# canonica di _db (active_categories, lane registro dev2: user_id=None →
# local_user_id, stesso default del pass di promozione) appena è disponibile;
# fallback single-tenant tollerante finché il cross-merge non la porta su questo
# branch (così il branch resta self-contained e testabile).
try:
    from _db import active_categories as _read_active_categories
except ImportError:  # pragma: no cover - ponte pre-cross-merge
    def _read_active_categories(conn, *a, **k):
        """Fallback: nomi attivi del registro (single-tenant locale, tollerante)."""
        try:
            rows = conn.execute(
                "SELECT name FROM role_family_registry "
                "WHERE status='active' ORDER BY support_count DESC"
            ).fetchall()
        except Exception:
            return []
        return [(r[0] if not hasattr(r, "keys") else r["name"]) for r in rows]


# --- Tassonomia EMERGENTE: enforcement alla scrittura (write-guard) -----------
# Sentinella catch-all: valore DB stabile (la UI i18n la mostra 'Altro'). Le
# righe legacy 'Other' sono già sentinelle corrette. UNICO literal ammesso — è
# MECCANICA (residuo), NON un nome di categoria di dominio.
_SENTINEL = "Other"


def _guard_role_family(conn, raw, _active=None):
    """Enforcement EMERGENTE alla scrittura. Ritorna (role_family, proposed).

    MODELLO B (enforcement in UN punto; l'analista scrive solo --role-family
    <best label> e non può bypassare):
      • etichetta == sentinella → (sentinella, "")  [residuo esplicito, no proposta]
      • etichetta ∈ attive (match esatto) → (attiva, "")  [pulisci proposed]
      • normalize_key(etichetta) == normalize_key(attiva) → (attiva, "")  [variante di superficie]
      • altrimenti → (sentinella, etichetta_raw)  [catch-all + proposta per il clustering]

    `proposed`: "" ⇒ SET role_family_proposed = NULL; <str> ⇒ scrivi raw.
    `_active`: iniettabile per i test (default = lettura dal registro runtime).
    """
    v = str(raw).strip()
    if not v:
        return None, None
    if v.lower() == _SENTINEL.lower() or v.lower() == "altro":
        return _SENTINEL, ""
    active = _active if _active is not None else _read_active_categories(conn)
    if v in active:
        return v, ""
    key = role_taxonomy.normalize_key(v)
    if key:
        for a in active:
            if role_taxonomy.normalize_key(a) == key:
                return a, ""
    return _SENTINEL, v


def interpret_escapes(text):
    """Converte le escape LETTERALI \\n \\t \\r in caratteri veri.

    Gli agenti (LLM) scrivono `\\n\\n` come separatori di paragrafo dentro una
    stringa singola passata come arg CLI. Senza questa conversione finirebbero
    LETTERALI in DB e quindi in dashboard (i `\\n` resterebbero visibili come
    testo). Coerente con jht-telegram-send / jht-notify-user. Applicato ai soli
    campi free-text leggibili dall'utente (notes, jd_summary), non ai campi
    scraped (jd_text/requirements).
    """
    if text is None:
        return None
    text = text.replace("\\n", "\n").replace("\\t", "\t").replace("\\r", "\r")

    # Alcuni LLM scrivono le emoji come escape Python (\U0001F916 / ✨)
    # invece che come caratteri: senza conversione arrivano LETTERALI in
    # dashboard. Surrogates (D800-DFFF) e code point fuori range restano
    # com'erano.
    def _chr(m):
        cp = int(m.group(1), 16)
        if 0xD800 <= cp <= 0xDFFF or cp > 0x10FFFF:
            return m.group(0)
        return chr(cp)

    text = re.sub(r"\\U([0-9A-Fa-f]{8})", _chr, text)
    text = re.sub(r"\\u([0-9A-Fa-f]{4})", _chr, text)
    return text


def update_position(args):
    conn = get_db()
    ensure_schema(conn)

    # `applied` non è soltanto uno stato della posizione: implica una riga
    # applications completa (flag, timestamp e canale). Scriverlo da qui
    # produrrebbe due verità perché questo comando non riceve quei dati.
    # La corsia application più sotto li scrive insieme nella stessa
    # transazione e resta l'unico ingresso CLI supportato.
    if args.status == 'applied':
        print(
            "⚠️  APPLIED REJECTED: use `db_update.py application <ID> "
            "--applied-at now --applied-via <channel>` so position and "
            "application are updated atomically.",
            file=sys.stderr,
        )
        conn.close()
        sys.exit(1)

    # Bug #14: cattura lo stato corrente PRIMA dell'UPDATE per registrare
    # la transizione. Se status non cambia (es. solo notes aggiornate),
    # nessuna entry viene scritta nel transition log.
    previous_status = None
    if args.status:
        row = conn.execute(
            "SELECT status FROM positions WHERE id = ?", (args.id,)
        ).fetchone()
        if row is not None:
            previous_status = row[0] if not hasattr(row, "keys") else row["status"]

    # `getattr`: update_position è invocata anche con Namespace costruiti a
    # mano da altri moduli, che non conoscono i flag dello storico.
    m_action = getattr(args, 'action', None)
    m_outcome = getattr(args, 'outcome', None)
    evidence = maintenance_log.evidence_from_args(args)

    # Un controllo che non ha concluso nulla non può chiudere la posizione.
    # Rifiutato QUI, prima di scrivere: il rimedio dopo sarebbe una patch sui
    # dati, e nel frattempo l'offerta sarebbe già sparita dal radar.
    if m_outcome:
        try:
            maintenance_log.check_closing_write(
                "is_open", getattr(args, 'is_open', None), m_outcome)
            maintenance_log.check_closing_write(
                "status", getattr(args, 'status', None), m_outcome)
        except maintenance_log.MaintenanceError as e:
            print(f"⚠️  CLOSE REJECTED: {e}")
            conn.close()
            sys.exit(1)
    before_snapshot = (_snapshot(conn, "positions", args.id,
                                 MAINTENANCE_TRACKED_FIELDS)
                       if m_action else {})

    updates = []
    params = []
    changed = []  # campi leggibili per output

    if args.status:
        updates.append("status = ?")
        params.append(args.status)
        changed.append(f"status={args.status}")
    if args.notes:
        updates.append("notes = ?")
        params.append(interpret_escapes(args.notes))
        changed.append(f"notes={args.notes[:40]}...")
    if args.jd_text:
        updates.append("jd_text = ?")
        params.append(args.jd_text)
        changed.append("jd_text")
    if args.jd_summary:
        updates.append("jd_summary = ?")
        params.append(interpret_escapes(args.jd_summary))
        changed.append("jd_summary")
    if args.requirements:
        updates.append("requirements = ?")
        params.append(args.requirements)
        changed.append("requirements")
    if args.location:
        updates.append("location = ?")
        params.append(args.location)
        changed.append(f"location={args.location}")
    if args.remote_type:
        updates.append("remote_type = ?")
        params.append(args.remote_type)
        changed.append(f"remote_type={args.remote_type}")
    if args.url:
        updates.append("url = ?")
        params.append(args.url)
        changed.append("url")
    if args.deadline:
        updates.append("deadline = ?")
        params.append(args.deadline)
        changed.append(f"deadline={args.deadline}")
    if args.title:
        updates.append("title = ?")
        params.append(args.title)
        changed.append(f"title={args.title}")
    if args.company:
        updates.append("company = ?")
        params.append(args.company)
        changed.append(f"company={args.company}")
        # Auto-resolve company_id quando si aggiorna il nome azienda
        cid = resolve_company_id(conn, args.company)
        if cid:
            updates.append("company_id = ?")
            params.append(cid)
            changed.append(f"company_id={cid}")
    if args.salary_declared_min is not None:
        updates.append("salary_declared_min = ?")
        params.append(args.salary_declared_min)
        changed.append(f"salary_declared_min={args.salary_declared_min}")
    if args.salary_declared_max is not None:
        updates.append("salary_declared_max = ?")
        params.append(args.salary_declared_max)
        changed.append(f"salary_declared_max={args.salary_declared_max}")
    if args.salary_declared_currency:
        updates.append("salary_declared_currency = ?")
        params.append(args.salary_declared_currency)
        changed.append(f"salary_declared_currency={args.salary_declared_currency}")
    if args.salary_estimated_min is not None:
        updates.append("salary_estimated_min = ?")
        params.append(args.salary_estimated_min)
        changed.append(f"salary_estimated_min={args.salary_estimated_min}")
    if args.salary_estimated_max is not None:
        updates.append("salary_estimated_max = ?")
        params.append(args.salary_estimated_max)
        changed.append(f"salary_estimated_max={args.salary_estimated_max}")
    if args.salary_estimated_currency:
        updates.append("salary_estimated_currency = ?")
        params.append(args.salary_estimated_currency)
        changed.append(f"salary_estimated_currency={args.salary_estimated_currency}")
    if args.salary_estimated_source:
        updates.append("salary_estimated_source = ?")
        params.append(args.salary_estimated_source)
        changed.append(f"salary_estimated_source={args.salary_estimated_source}")
    if args.source:
        updates.append("source = ?")
        params.append(args.source)
        changed.append(f"source={args.source}")
    if args.last_checked:
        if args.last_checked == 'now':
            updates.append("last_checked = datetime('now', 'localtime')")
        else:
            updates.append("last_checked = ?")
            params.append(args.last_checked)
        changed.append(f"last_checked={args.last_checked}")

    # Role family: ENFORCEMENT tassonomia EMERGENTE alla scrittura (write-guard).
    # 2026-06-15 (GO utente): ZERO nomi hardcoded. role_family DEVE essere o una
    # categoria ATTIVA del registro (decisa/nominata dal team dai dati) o il
    # sentinella catch-all 'Other'. Un'etichetta fuori-registro (one-off / nuova)
    # NON entra come categoria: → 'Other' + l'etichetta raw in role_family_proposed
    # (il pass di promozione la clusterizza; se un cluster supera la soglia NASCE
    # una categoria, nominata dal team). Drift IMPOSSIBILE alla scrittura,
    # qualunque cosa produca l'LLM — fix nel codice, mai patch sui dati VPS.
    rf_in = getattr(args, 'role_family', None)
    if rf_in is not None:
        _has_proposed = _column_exists(conn, 'positions', 'role_family_proposed')
        if str(rf_in).strip() == "":
            # convenzione esistente: "" => SET NULL (ripulisci categoria + proposta)
            updates.append("role_family = NULL")
            changed.append("role_family=NULL")
            if _has_proposed:
                updates.append("role_family_proposed = NULL")
                changed.append("role_family_proposed=NULL")
        else:
            guarded, proposed = _guard_role_family(conn, rf_in)
            if guarded != str(rf_in).strip():
                changed.append(f"role_family-guard({str(rf_in)[:24]}→{guarded})")
            updates.append("role_family = ?")
            params.append(guarded)
            changed.append(f"role_family={guarded}")
            if _has_proposed:
                if proposed == "":
                    updates.append("role_family_proposed = NULL")
                    changed.append("role_family_proposed=NULL")
                elif proposed is not None:
                    updates.append("role_family_proposed = ?")
                    params.append(proposed)
                    changed.append(f"role_family_proposed={proposed[:30]}")

    # Location strutturata (popolata dall'analista). Vedi playbook 2026-05-23.
    # Convenzione: stringa vuota "" => SET NULL (per "ripulire" un campo).
    _loc_fields = (
        ('loc_city',          'loc_city'),
        ('loc_region',        'loc_region'),
        ('loc_country',       'loc_country'),
        ('loc_country_code',  'loc_country_code'),
        ('loc_continent',     'loc_continent'),
        ('work_mode',         'work_mode'),
        ('work_country',      'work_country'),
        ('work_country_code', 'work_country_code'),
        ('location_notes',    'location_notes'),
    )
    for arg_name, col in _loc_fields:
        v = getattr(args, arg_name, None)
        if v is not None:
            if v == "":
                updates.append(f"{col} = NULL")
                changed.append(f"{col}=NULL")
            else:
                updates.append(f"{col} = ?")
                params.append(v)
                changed.append(f"{col}={v[:40]}" if len(v) > 40 else f"{col}={v}")
    if args.is_multi_location is not None:
        updates.append("is_multi_location = ?")
        params.append(1 if args.is_multi_location == 'true' else 0)
        changed.append(f"is_multi_location={args.is_multi_location}")

    # Office geocoding (skill office-geocoding)
    if args.office_lat is not None:
        updates.append("office_lat = ?")
        params.append(args.office_lat)
        changed.append(f"office_lat={args.office_lat}")
    if args.office_lon is not None:
        updates.append("office_lon = ?")
        params.append(args.office_lon)
        changed.append(f"office_lon={args.office_lon}")
    if args.office_address is not None:
        if args.office_address == "":
            updates.append("office_address = NULL")
            changed.append("office_address=NULL")
        else:
            updates.append("office_address = ?")
            params.append(args.office_address)
            changed.append(f"office_address={args.office_address[:40]}")
    if args.office_geocoded is not None:
        updates.append("office_geocoded = ?")
        params.append(1 if args.office_geocoded == 'true' else 0)
        changed.append(f"office_geocoded={args.office_geocoded}")
    if args.office_verified is not None:
        updates.append("office_verified = ?")
        params.append(1 if args.office_verified == 'true' else 0)
        changed.append(f"office_verified={args.office_verified}")

    # Geocoding on-demand: la richiesta e il risultato devono atterrare nella
    # STESSA transazione. In precedenza `geocode_requested` restava acceso
    # dopo il completamento e `next-for-geocoding` provava a dedurre l'ACK da
    # `office_geocoded`. Questo rendeva impossibile un ricalcolo: una nuova
    # richiesta su una riga già geocodificata veniva nascosta dalla coda.
    #
    # Richiediamo entrambi i segnali espliciti usati dalla skill canonica:
    # `--action geocode` identifica la lane e `--office-geocoded true|false`
    # dichiara che il tentativo è terminato (anche dopo ricerca esaustiva
    # fallita). La lane care-mode non accende il flag, quindi l'UPDATE a 0 è
    # un no-op semantico e NON trasforma il geocoding in lavoro automatico.
    if m_action == 'geocode' and args.office_geocoded is not None:
        updates.append("geocode_requested = 0")
        updates.append("geocode_requested_at = NULL")
        changed.append("geocode_requested=acknowledged")

    # Expiry tracking (espansione Analista — RULE-12 richeck giornaliero).
    # expires_at: ISO YYYY-MM-DD da deadline_extract; "" => NULL (sconosciuta).
    if args.expires_at is not None:
        if args.expires_at == "":
            updates.append("expires_at = NULL")
            changed.append("expires_at=NULL")
        else:
            updates.append("expires_at = ?")
            params.append(args.expires_at)
            changed.append(f"expires_at={args.expires_at}")
    if args.is_open is not None:
        updates.append("is_open = ?")
        params.append(1 if args.is_open == 'true' else 0)
        changed.append(f"is_open={args.is_open}")
    if args.last_open_check:
        if args.last_open_check == 'now':
            updates.append("last_open_check = datetime('now', 'localtime')")
        else:
            updates.append("last_open_check = ?")
            params.append(args.last_open_check)
        changed.append(f"last_open_check={args.last_open_check}")

    # [RECHECK-MUST-UPDATE-LAST-CHECKED] — chi scrive la liveness HA guardato
    # l'annuncio, quindi la posizione è stata controllata adesso: `last_checked`
    # avanza con `is_open`/`last_open_check` senza che nessuno debba ricordarsi
    # di passare anche `--last-checked now`. Il 30/07 la #58 è stata verificata
    # (terzo 404 di fila, `is_open=0`) alle 08:38 ed era ancora in testa alla
    # coda alle 10:02: la colonna scritta non era quella su cui la coda gatava.
    # Un flag esplicito vince sempre — qui si copre la dimenticanza, non si
    # sovrascrive una decisione.
    if (args.is_open is not None or args.last_open_check) and not args.last_checked:
        if args.last_open_check and args.last_open_check != 'now':
            # Stesso istante dichiarato per la liveness: due timestamp che
            # raccontano lo stesso controllo non devono divergere.
            updates.append("last_checked = ?")
            params.append(args.last_open_check)
            changed.append(f"last_checked={args.last_open_check} (liveness)")
        else:
            updates.append("last_checked = datetime('now', 'localtime')")
            changed.append("last_checked=now (liveness)")

    if not updates:
        print("No fields to update.")
        return

    # Auto-popola `last_actor` con il nome dell'istanza dell'agente
    # (esportato da start-agent.sh come JHT_AGENT_NAME, es.
    # "scrittore-1", "critico-s2"). Senza l'env var ricade su un
    # placeholder così la UI può comunque distinguere chi ha agito.
    actor = os.environ.get('JHT_AGENT_NAME') or os.environ.get('JHT_AGENT_DIR', '').split('/')[-1] or 'unknown'
    updates.append("last_actor = ?")
    params.append(actor)

    params.append(args.id)
    cursor = conn.execute(f"UPDATE positions SET {', '.join(updates)} WHERE id = ?", params)
    if cursor.rowcount == 0:
        print(f"⚠️  ERROR: no position found with id={args.id}!")
        conn.close()
        sys.exit(1)

    # Bug #14: log transition se status è cambiato. La INSERT è
    # idempotente per (position_id, ts) — due UPDATE consecutivi con lo
    # stesso status producono una sola entry perché previous_status sarà
    # uguale a args.status al secondo turno. notes opzionale: passiamo le
    # notes della UPDATE se rilevanti (es. 'GEO mismatch' nel caso
    # excluded), altrimenti None.
    if args.status and previous_status != args.status:
        transition_notes = args.notes if args.notes else None
        conn.execute(
            "INSERT INTO position_state_transitions "
            "(position_id, from_state, to_state, by_agent, notes) "
            "VALUES (?, ?, ?, ?, ?)",
            (args.id, previous_status, args.status, actor, transition_notes),
        )

    # Evento di manutenzione, nella STESSA transazione dell'UPDATE: un log che
    # sopravvive a una scrittura fallita racconterebbe lavoro mai avvenuto.
    if m_action:
        after_snapshot = _snapshot(conn, "positions", args.id,
                                   MAINTENANCE_TRACKED_FIELDS)
        try:
            n = maintenance_log.record_diffs(
                conn, "position", args.id, m_action,
                _diffs(before_snapshot, after_snapshot),
                outcome=m_outcome, evidence=evidence,
                duration_ms=getattr(args, 'duration_ms', None), by_agent=actor)
        except maintenance_log.MaintenanceError as e:
            # Rete di sicurezza: il controllo pre-scrittura guarda gli
            # argomenti, questo guarda il diff reale. Se una chiusura passa
            # comunque, la si annulla invece di lasciarla a metà.
            conn.rollback()
            print(f"⚠️  WRITE ABORTED: {e}")
            conn.close()
            sys.exit(1)
        changed.append(f"[{m_action}] {n} event(s)")

    conn.commit()
    print(f"Position {args.id} updated: {', '.join(changed)}")
    conn.close()


def update_company(args):
    conn = get_db()
    ensure_schema(conn)

    m_action = getattr(args, 'action', None)
    row = conn.execute(
        "SELECT id FROM companies WHERE name = ?", (args.name,)).fetchone()
    company_id = (row[0] if row and not hasattr(row, "keys") else
                  row["id"] if row else None)
    before_snapshot = (_snapshot(conn, "companies", company_id,
                                 COMPANY_TRACKED_FIELDS)
                       if (m_action and company_id) else {})

    updates = []
    params = []

    if args.verdict:
        updates.append("verdict = ?")
        params.append(args.verdict)
    if args.red_flags:
        updates.append("red_flags = ?")
        params.append(args.red_flags)
    if args.culture_notes:
        updates.append("culture_notes = ?")
        params.append(args.culture_notes)
    if args.sector:
        updates.append("sector = ?")
        params.append(args.sector)
    if args.size:
        updates.append("size = ?")
        params.append(args.size)
    if args.glassdoor_rating:
        updates.append("glassdoor_rating = ?")
        params.append(args.glassdoor_rating)
    if args.analyzed_by:
        updates.append("analyzed_by = ?")
        params.append(args.analyzed_by)
    if args.hq_country:
        updates.append("hq_country = ?")
        params.append(args.hq_country)
    if args.website:
        updates.append("website = ?")
        params.append(args.website)

    if not updates:
        print("No fields to update.")
        return

    params.append(args.name)
    conn.execute(f"UPDATE companies SET {', '.join(updates)} WHERE name = ?", params)

    if m_action and company_id:
        after_snapshot = _snapshot(conn, "companies", company_id,
                                   COMPANY_TRACKED_FIELDS)
        maintenance_log.record_diffs(
            conn, "company", company_id, m_action,
            _diffs(before_snapshot, after_snapshot),
            outcome=getattr(args, 'outcome', None),
            evidence=maintenance_log.evidence_from_args(args),
            duration_ms=getattr(args, 'duration_ms', None))

    conn.commit()
    print(f"Company '{args.name}' updated: {', '.join(updates)}")
    conn.close()


def update_application(args):
    conn = get_db()
    ensure_schema(conn)

    applied_flag = (
        args.applied.lower() in ('true', '1', 'yes')
        if args.applied is not None else False
    )
    if args.applied is not None and not applied_flag:
        # Il flag da solo non sa a quale stato operativo tornare e lascerebbe
        # applied_at/applied_via sospesi. L'undo web usa invece transizione e
        # fatti disponibili, nella stessa transazione dei tre campi.
        print(
            "⚠️  APPLIED UNDO REJECTED: use the manual-application undo "
            "action so position and application are restored atomically.",
            file=sys.stderr,
        )
        conn.close()
        sys.exit(1)
    marks_applied = bool(
        args.status == 'applied' or args.applied_at or applied_flag
    )
    if marks_applied:
        # Un timestamp senza canale (o viceversa) non è uno stato completo.
        # `status=applied` può essere una scorciatoia legittima, ma l'istante
        # va materializzato adesso, non lasciato implicito nella posizione.
        if not (args.applied_via or '').strip():
            print(
                "⚠️  APPLIED REJECTED: --applied-via is required whenever "
                "an application is marked as sent.",
                file=sys.stderr,
            )
            conn.close()
            sys.exit(1)
        args.status = 'applied'
        args.applied_at = args.applied_at or 'now'

    previous_position_status = None
    if marks_applied:
        position = conn.execute(
            "SELECT status FROM positions WHERE id = ?", (args.position_id,)
        ).fetchone()
        if not position:
            print(
                f"⚠️  position_id={args.position_id} does not exist in "
                "positions. Aborting application update.",
                file=sys.stderr,
            )
            conn.close()
            sys.exit(1)
        previous_position_status = (
            position['status'] if hasattr(position, 'keys') else position[0]
        )

    updates = []
    params = []

    # L'identità dello Scrittore appartiene al write path, non al Critico.
    # `--written-by` è la fonte esplicita; per le scritture degli artefatti
    # accettiamo anche JHT_AGENT_NAME, esportato da start-agent.sh. Il vecchio
    # codice leggeva JHT_AGENT_ID, che il launcher non ha mai esportato: il
    # fallback era quindi morto. Limitarlo ai campi writer-owned evita che un
    # update del Critico attribuisca per errore a sé un CV creato senza autore.
    writer_fields_changed = any((
        args.written_at,
        args.cv_path,
        args.cl_path,
        args.cv_pdf_path,
        args.cl_pdf_path,
    ))
    written_by = (args.written_by or '').strip()
    if not written_by and writer_fields_changed:
        written_by = (
            os.environ.get('JHT_AGENT_NAME')
            or os.environ.get('JHT_AGENT_ID', '')
        ).strip()
    if written_by:
        updates.append("written_by = ?")
        params.append(written_by)

    if args.status:
        updates.append("status = ?")
        params.append(args.status)
    if args.critic_verdict:
        updates.append("critic_verdict = ?")
        params.append(args.critic_verdict)
    if args.critic_score is not None:
        updates.append("critic_score = ?")
        params.append(args.critic_score)
        updates.append("critic_reviewed_at = datetime('now', 'localtime')")
    if args.critic_notes:
        updates.append("critic_notes = ?")
        params.append(args.critic_notes)
    if args.critic_round is not None:
        updates.append("critic_round = ?")
        params.append(args.critic_round)
    if args.reviewed_by:
        updates.append("reviewed_by = ?")
        params.append(args.reviewed_by)
    if args.written_at:
        if args.written_at == 'now':
            updates.append("written_at = datetime('now', 'localtime')")
        else:
            updates.append("written_at = ?")
            params.append(args.written_at)
    if args.applied_at:
        if args.applied_at == 'now':
            updates.append("applied_at = datetime('now', 'localtime')")
        else:
            updates.append("applied_at = ?")
            params.append(args.applied_at)
        # Auto-cascade: se si setta applied_at, segna anche applied=1
        updates.append("applied = 1")
    if args.applied_via:
        updates.append("applied_via = ?")
        params.append(args.applied_via)
    if args.response:
        updates.append("response = ?")
        params.append(args.response)
    if args.response_at:
        if args.response_at == 'now':
            updates.append("response_at = datetime('now', 'localtime')")
        else:
            updates.append("response_at = ?")
            params.append(args.response_at)
    if args.cv_path:
        updates.append("cv_path = ?")
        params.append(args.cv_path)
    if args.cl_path:
        updates.append("cl_path = ?")
        params.append(args.cl_path)
    if args.cv_pdf_path:
        updates.append("cv_pdf_path = ?")
        params.append(args.cv_pdf_path)
    if args.cl_pdf_path:
        updates.append("cl_pdf_path = ?")
        params.append(args.cl_pdf_path)
    if args.applied is not None:
        updates.append("applied = ?")
        params.append(1 if args.applied.lower() in ('true', '1', 'yes') else 0)
    if args.interview_round is not None:
        updates.append("interview_round = ?")
        params.append(args.interview_round)

    if not updates:
        print("No fields to update.")
        return

    params.append(args.position_id)
    cursor = conn.execute(f"UPDATE applications SET {', '.join(updates)} WHERE position_id = ?", params)
    if cursor.rowcount == 0:
        # UPSERT: nessuna application esistente → INSERT iniziale.
        # Senza questo path, lo Scrittore deve fare INSERT a mano via
        # python3 -c "import sqlite3 ..." e finiva per passare la stringa
        # 'now' invece di datetime('now') — bug dei record con
        # written_at='now' letterale (vedi audit 2026-05-02).
        # Verifica che la position esista (FK guard).
        if not conn.execute("SELECT 1 FROM positions WHERE id = ?", (args.position_id,)).fetchone():
            print(f"⚠️  position_id={args.position_id} does not exist in positions. Aborting INSERT.")
            conn.close()
            return
        # Default: written_at=now se non specificato. `written_by`, quando
        # disponibile, è già nella lista UPDATE/INSERT costruita sopra;
        # --reviewed-by resta invece confinato al campo reviewed_by.
        # Costruiamo INSERT solo coi campi noti dall'UPDATE + position_id.
        ins_cols = ['position_id']
        ins_vals = [args.position_id]
        ins_placeholders = ['?']
        # Riusa la stessa coerenza UPDATE→INSERT campo-per-campo.
        for clause, val in _zip_set_clauses(updates, params[:-1]):
            col = clause.split('=', 1)[0].strip()
            rhs = clause.split('=', 1)[1].strip()
            ins_cols.append(col)
            if rhs == '?':
                ins_placeholders.append('?')
                ins_vals.append(val)
            else:
                # es. datetime('now', 'localtime') — espressione SQL inline
                ins_placeholders.append(rhs)
        # written_at di default a now se non gia' settato
        if 'written_at' not in ins_cols:
            ins_cols.append('written_at')
            ins_placeholders.append("datetime('now', 'localtime')")
        sql = f"INSERT INTO applications ({', '.join(ins_cols)}) VALUES ({', '.join(ins_placeholders)})"
        conn.execute(sql, ins_vals)
        created = True
    else:
        created = False

    if marks_applied:
        # La stessa transazione che pubblica applied_at aggiorna lo stato
        # operativo e il suo event-log. Se uno dei tre statement fallisce,
        # nessuna superficie può osservare una candidatura a metà.
        conn.execute(
            "UPDATE positions SET status = 'applied', last_actor = ? "
            "WHERE id = ?",
            (
                os.environ.get('JHT_AGENT_NAME')
                or os.environ.get('JHT_AGENT_DIR', '').split('/')[-1]
                or 'user',
                args.position_id,
            ),
        )
        if previous_position_status != 'applied':
            conn.execute(
                "INSERT INTO position_state_transitions "
                "(position_id, from_state, to_state, by_agent) "
                "VALUES (?, ?, 'applied', ?)",
                (
                    args.position_id,
                    previous_position_status,
                    os.environ.get('JHT_AGENT_NAME') or 'user',
                ),
            )
    conn.commit()
    if created:
        print(
            f"Application for position {args.position_id} CREATED "
            "(initial INSERT)."
        )
    else:
        print(
            f"Application for position {args.position_id} updated "
            f"({cursor.rowcount} row)"
        )
    conn.close()


def _zip_set_clauses(set_clauses, params):
    """Itera coppie (clause, param) dove clause = 'col = ?' o 'col = expr'.

    Le clausole con RHS='?' consumano un param dalla lista; quelle con
    espressione SQL inline (es. datetime(...)) non consumano nulla.
    """
    pi = 0
    for c in set_clauses:
        rhs = c.split('=', 1)[1].strip()
        if rhs == '?':
            yield c, params[pi]
            pi += 1
        else:
            yield c, None


def main():
    parser = argparse.ArgumentParser(description='Update data in jobs.db')
    sub = parser.add_subparsers(dest='entity', required=True)

    # position
    p = sub.add_parser('position')
    p.add_argument('id', type=int)
    p.add_argument('--status', choices=['new', 'checked', 'excluded', 'scored', 'writing', 'review', 'ready', 'applied', 'response'])
    p.add_argument('--notes')
    p.add_argument('--jd-text')
    p.add_argument('--jd-summary', help="User-facing JD summary (lightweight Markdown, user's language) — written by the Analyst and shown on the position page instead of raw text")
    p.add_argument('--requirements')
    p.add_argument('--location')
    p.add_argument('--remote-type', choices=['full_remote', 'hybrid', 'onsite'])
    p.add_argument('--url')
    p.add_argument('--deadline', help='Deadline date YYYY-MM-DD or "not present"')
    p.add_argument('--title')
    p.add_argument('--company')
    p.add_argument('--salary-declared-min', type=int)
    p.add_argument('--salary-declared-max', type=int)
    p.add_argument('--salary-declared-currency')
    p.add_argument('--salary-estimated-min', type=int)
    p.add_argument('--salary-estimated-max', type=int)
    p.add_argument('--salary-estimated-currency')
    p.add_argument('--salary-estimated-source', help='Estimate source: glassdoor, levels.fyi, manual')
    p.add_argument('--source')
    p.add_argument('--last-checked', help='Date/time of the last link check (YYYY-MM-DD HH:MM or "now")')
    p.add_argument('--expires-at', help='Application deadline ISO YYYY-MM-DD (from deadline_extract); "" => NULL')
    p.add_argument('--is-open', choices=['true', 'false'], help='Whether the position is still open (RULE-12 recheck): false if the link is dead or expires_at has passed')
    p.add_argument('--last-open-check', help='Date/time of the last opening recheck (YYYY-MM-DD HH:MM or "now")')
    # Role family (categoria semantica del ruolo) — tassonomia EMERGENTE.
    # L'analista scrive la categoria ATTIVA che meglio combacia (vedi
    # `db_query active-categories`) o, se nessuna calza, un'etichetta concisa: il
    # write-guard accetta il match (anche di superficie) o coerce a 'Other' +
    # role_family_proposed. Nessuna lista fissa, nessun --role-family-proposed.
    p.add_argument('--role-family', help='Role category (Analyst): ACTIVE registry name if the offer belongs there, otherwise a concise label → the guard routes it (match or Other+proposal)')
    # Location strutturata (popolata dall'analista). Vedi playbook 2026-05-23.
    p.add_argument('--loc-city', help='Office city (e.g. "Dublin"). NULL if only the country/continent is known.')
    p.add_argument('--loc-region', help='Region/state (e.g. "Friuli-Venezia Giulia"). Optional.')
    p.add_argument('--loc-country', help='Office country (e.g. "Italy"). NULL if only the continent is known.')
    p.add_argument('--loc-country-code', help='ISO-3166 alpha-2 (e.g. "IT").')
    p.add_argument('--loc-continent', choices=['Europe', 'Asia', 'Americas', 'Africa', 'Oceania'])
    p.add_argument('--work-mode', choices=['onsite', 'hybrid', 'remote'], help='Work mode. Replaces is_remote/remote_type.')
    p.add_argument('--work-country', help='Contracting country (signing entity). Determines salary/CBA.')
    p.add_argument('--work-country-code', help='ISO-2 code of the contracting country.')
    p.add_argument('--is-multi-location', choices=['true', 'false'], help='true if the JD lists multiple cities/countries (single centroid pin).')
    p.add_argument('--location-notes', help='Free-form Analyst notes (e.g. "EU multi-country: NL+DE+GB")')
    # Office geocoding precise (skill office-geocoding)
    p.add_argument('--office-lat', type=float, help='Office WGS84 latitude (e.g. 41.8933203)')
    p.add_argument('--office-lon', type=float, help='Office WGS84 longitude (e.g. 12.4829321)')
    p.add_argument('--office-address', help='Full office address (geocoder display_name)')
    p.add_argument('--office-geocoded', choices=['true', 'false'], help='true if geocoding was attempted (even if it failed)')
    p.add_argument('--office-verified', choices=['true', 'false'], help='true if you are CERTAIN this is the correct office; false if city-level/multi-ambiguous')
    # Storico dei controlli: --action registra il giro, --outcome ne dice l'esito.
    maintenance_log.add_cli_args(p)

    # company
    c = sub.add_parser('company')
    c.add_argument('name')
    c.add_argument('--verdict', choices=['GO', 'CAUTIOUS', 'NO_GO'])
    c.add_argument('--red-flags')
    c.add_argument('--culture-notes')
    c.add_argument('--hq-country', help='Headquarters country')
    c.add_argument('--sector')
    c.add_argument('--size')
    c.add_argument('--glassdoor-rating', type=float)
    c.add_argument('--analyzed-by')
    c.add_argument('--website', help='Official website (used by logo-extraction)')
    maintenance_log.add_cli_args(c)

    # application
    a = sub.add_parser('application')
    a.add_argument('position_id', type=int)
    a.add_argument('--status', choices=['draft', 'review', 'ready', 'approved', 'applied', 'response'])
    a.add_argument('--critic-verdict', choices=['PASS', 'NEEDS_WORK', 'REJECT'])
    a.add_argument('--critic-score', type=float)
    a.add_argument('--critic-notes')
    a.add_argument('--critic-round', type=int, help='Critic round number (1 or 2)')
    a.add_argument('--reviewed-by')
    a.add_argument('--written-by', help='Writer identity; falls back to JHT_AGENT_NAME when saving CV/CL artifacts')
    a.add_argument('--written-at', help='When the CV was created (YYYY-MM-DD HH:MM or "now")')
    a.add_argument('--applied-at', help='When the application was submitted')
    a.add_argument('--applied-via')
    a.add_argument('--response', help='Response received')
    a.add_argument('--response-at', help='When the response arrived (YYYY-MM-DD HH:MM or "now")')
    a.add_argument('--cv-path')
    a.add_argument('--cl-path')
    a.add_argument('--cv-pdf-path')
    a.add_argument('--cl-pdf-path')
    a.add_argument('--applied', help='true/false — whether the user submitted the application')
    a.add_argument('--interview-round', type=int, help='Interview stage (1, 2, 3...)')

    args = parser.parse_args()

    if args.entity == 'position':
        update_position(args)
    elif args.entity == 'company':
        update_company(args)
    elif args.entity == 'application':
        update_application(args)


if __name__ == '__main__':
    main()
