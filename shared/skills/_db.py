"""Modulo DB condiviso — connessione e schema V2 per jobs.db"""

import sqlite3
import os

# Path DB unico, coerente con tutto il resto dell'app JHT:
#   1. $JHT_DB esplicito (prima scelta) — dashboard web, API routes e
#      start-agent.sh impostano questa env var su $JHT_HOME/jobs.db
#   2. $JHT_HOME/jobs.db quando JHT_HOME è noto
#   3. path relativo allo script (fallback storico per esecuzioni
#      ad-hoc fuori dal container JHT)
# Prima c'era solo (3): script invocati da /jht_home/agents/shared/skills/
# scrivevano in /jht_home/agents/shared/data/jobs.db, mentre la dashboard
# web leggeva $JHT_HOME/jobs.db → due DB non in sync, posizioni inserite
# dagli agenti invisibili alla UI.
# Nomi che NON esistono ma che si scrivono per sbaglio al posto di quelli
# veri. `JHT_DB_PATH` è il nome lato web (web/lib/jht-paths.ts): chi passa da
# lì lo usa per riflesso, e finora non succedeva niente — il modulo lo
# ignorava e sceglieva un altro path, scrivendo altrove e dichiarando
# successo. Due volte almeno: il 13/07/2026 e il 10/08/2026 (O-26).
_WRONG_ENV_NAMES = ('JHT_DB_PATH', 'JHT_DATABASE', 'JHT_DB_FILE', 'JHT_JOBS_DB')

# Il fallback fuori container resta possibile — è documentato in
# agents/_manual/db-schema*.md — ma va CHIESTO. Ci si finiva dentro per
# sbaglio, ed è la differenza fra un default e una scelta.
_FALLBACK_ENV = 'JHT_DB_FALLBACK'


class DbPathNotConfigured(RuntimeError):
    """Nessun database indicato, o indicato con un nome che non esiste."""


def _resolve_db_path() -> str:
    """Il path del jobs.db, o un errore che dice cosa manca.

    Non ripiega in silenzio: un path plausibile scelto al posto di quello
    chiesto fa riuscire la scrittura NEL POSTO SBAGLIATO, e un'operazione
    riuscita non lascia niente da cercare. Se la variabile giusta è
    `JHT_HOME` e punta ai dati veri di qualcuno, lo stesso errore ci scrive
    dentro dati di prova senza che nessuno se ne accorga.
    """
    env_db = os.environ.get('JHT_DB')
    if env_db:
        return env_db
    jht_home = os.environ.get('JHT_HOME')
    if jht_home:
        return os.path.join(jht_home, 'jobs.db')

    # Il nome sbagliato si riconosce e si DICE. Silenzio qui significherebbe
    # ripetere il difetto: chi l'ha scritto crede di aver configurato il DB.
    mistaken = [name for name in _WRONG_ENV_NAMES if os.environ.get(name)]
    if mistaken:
        raise DbPathNotConfigured(
            f"{mistaken[0]} is not a variable this module reads. "
            f"Use JHT_DB=<file> or JHT_HOME=<dir> (the database is "
            f"$JHT_HOME/jobs.db). Value ignored: {os.environ[mistaken[0]]}"
        )

    fallback = os.path.join(os.path.dirname(__file__), '..', 'data', 'jobs.db')
    if os.environ.get(_FALLBACK_ENV) == '1':
        return fallback
    raise DbPathNotConfigured(
        "no database configured: set JHT_DB=<file> or JHT_HOME=<dir> "
        f"(the database is $JHT_HOME/jobs.db). Outside the container you can "
        f"ask for the repo copy with {_FALLBACK_ENV}=1 ({fallback})."
    )


def __getattr__(name):
    """`_db.DB_PATH` risolto al PRIMO ACCESSO, non all'import (PEP 562).

    Calcolarlo all'import farebbe fallire il semplice `import _db` di
    chiunque, compresa la fase di collection di pytest, che importa i moduli
    prima che le fixture impostino l'ambiente. Il fallimento deve arrivare a
    chi USA il database, non a chi nomina il modulo: è la differenza fra un
    difetto silenzioso corretto e un blocco rumoroso nuovo.
    """
    if name == 'DB_PATH':
        return _resolve_db_path()
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")


def get_db() -> sqlite3.Connection:
    """Restituisce connessione al database con WAL mode e foreign keys."""
    # `globals()`, non l'attributo: chi ASSEGNA `_db.DB_PATH = <file>` sta
    # iniettando un database di prova, e va rispettato. È il modo in cui
    # mezza suite isola il proprio SQLite (e con PEP 562 l'assegnazione
    # crea davvero l'attributo, quindi `__getattr__` non viene più
    # consultato). Senza variabile e senza assegnazione, si fallisce.
    db_path = globals().get('DB_PATH') or _resolve_db_path()
    os.makedirs(os.path.dirname(db_path), exist_ok=True)
    conn = sqlite3.connect(db_path, timeout=10)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.row_factory = sqlite3.Row
    return conn


def ensure_schema(conn: sqlite3.Connection):
    """Crea le tabelle se non esistono (schema V7).

    Le migrazioni retroattive vengono eseguite PRIMA del CREATE TABLE
    IF NOT EXISTS, così i CREATE TRIGGER IF NOT EXISTS più sotto
    ricreano i trigger anti-'now' che il DROP TABLE della migrazione v2→v3
    butta via insieme ai loro vincoli.

    Storia:
    - v2→v3: CHECK su `positions.status`.
    - v3→v4: `created_at`/`updated_at` uniformi su tutte le 5 tabelle.
    - v4→v5: tabella `pending_user_messages` (fallback notifiche via cloud
      sync quando Telegram non e' configurato/down — decisione 2026-05-13).
    - v5→v6: `positions.write_requested` + `write_requested_at` per
      Writer-on-demand. L'utente seleziona dal dashboard/Telegram cosa
      portare a CV; il Capitano spawna Scrittori solo quando il flag e'
      acceso. Vedi BACKLOG [JHT-WRITER-ON-DEMAND] (2026-05-29).
    - v6→v7: tabella `_tombstones` + trigger BEFORE DELETE su
      positions/scores/applications. Chiude il gap "DELETE locale non si
      propaga a cloud" (push è UPSERT-only). Tombstones viaggiano nel
      payload del push delta e il receive Supabase fa UPDATE soft
      SET deleted_at = ?. Vedi mig 025 + BACKLOG [JHT-CLOUDSYNC-01]
      DELETE tombstone (2026-05-31).
    - v7→v8: `positions.geocode_requested` + `geocode_requested_at`
      per Geocoding-on-demand. L'utente seleziona dal dashboard/Telegram
      su quali posizioni vuole le coordinate ufficio precise; l'Analista
      esegue la skill `office-geocoding` solo quando il flag è acceso.
      Replica del pattern Writer-on-demand. Vedi BACKLOG (2026-05-31).
    - `positions.url` UNIQUE (indice parziale `idx_positions_url_unique`):
      la dedup era un check-then-insert senza vincolo sotto, quindi due Scout
      sulla stessa fonte potevano scrivere lo stesso annuncio due volte. I
      duplicati già presenti NON vengono cancellati — vedi la politica in
      `_migrate_positions_url_unique` (2026-07-30).
    """
    _run_migrations(conn)

    # These six triggers reject an invalid literal timestamp and expose their
    # RAISE(ABORT) text directly to agents and users.  CREATE TRIGGER IF NOT
    # EXISTS alone would leave the old Italian message installed forever on
    # existing databases, even after the container image is upgraded.  Drop
    # only these named validation triggers so the schema script below can
    # recreate them with the same predicates and the current English text.
    # No table rows or user-authored content are changed.
    conn.executescript("""
    DROP TRIGGER IF EXISTS applications_reject_str_now_insert;
    DROP TRIGGER IF EXISTS applications_reject_str_now_update;
    DROP TRIGGER IF EXISTS positions_reject_str_now_insert;
    DROP TRIGGER IF EXISTS positions_reject_str_now_update;
    DROP TRIGGER IF EXISTS companies_reject_str_now_insert;
    DROP TRIGGER IF EXISTS companies_reject_str_now_update;
    """)
    conn.executescript("""
    CREATE TABLE IF NOT EXISTS companies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        website TEXT,
        hq_country TEXT,
        sector TEXT,
        size TEXT,
        glassdoor_rating REAL,
        red_flags TEXT,
        culture_notes TEXT,
        analyzed_by TEXT,
        analyzed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        verdict TEXT,
        logo TEXT,
        logo_source TEXT,
        logo_fetched INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS positions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        company TEXT NOT NULL,
        company_id INTEGER,
        location TEXT,
        remote_type TEXT,
        salary_declared_min INTEGER,
        salary_declared_max INTEGER,
        salary_declared_currency TEXT DEFAULT 'EUR',
        salary_estimated_min INTEGER,
        salary_estimated_max INTEGER,
        salary_estimated_currency TEXT DEFAULT 'EUR',
        salary_estimated_source TEXT,
        url TEXT,
        source TEXT,
        jd_text TEXT,
        requirements TEXT,
        jd_summary TEXT,
        found_by TEXT,
        found_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        deadline TEXT,
        status TEXT DEFAULT 'new' CHECK (status IN (
            'new','checked','scored','writing','review','ready','applied','response','excluded'
        )),
        notes TEXT,
        last_checked TIMESTAMP,
        last_actor TEXT,
        role_family TEXT,
        role_family_proposed TEXT,
        loc_city TEXT,
        loc_region TEXT,
        loc_country TEXT,
        loc_country_code TEXT,
        loc_continent TEXT,
        work_mode TEXT,
        work_country TEXT,
        work_country_code TEXT,
        is_multi_location INTEGER DEFAULT 0,
        location_notes TEXT,
        office_lat REAL,
        office_lon REAL,
        office_address TEXT,
        office_geocoded INTEGER DEFAULT 0,
        office_verified INTEGER DEFAULT 0,
        expires_at DATE,
        is_open INTEGER DEFAULT 1,
        last_open_check TIMESTAMP,
        write_requested INTEGER DEFAULT 0,
        write_requested_at TIMESTAMP,
        write_request_kind TEXT,
        geocode_requested INTEGER DEFAULT 0,
        geocode_requested_at TIMESTAMP,
        salary_precise_requested INTEGER DEFAULT 0,
        salary_precise_requested_at TIMESTAMP,
        salary_precise TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        -- Length guardrails: mirror dei CHECK constraint Postgres (mig 015).
        -- Origin: incident RobertHalf 2026-05-19 (location 4394 char di HTML
        -- bloccava sync cloud, vedi docs/internal/architecture/cloud-sync-architecture.md).
        -- SQLite locale deve fallire SUBITO al INSERT, non in differita al push.
        CHECK (LENGTH(title) <= 500),
        CHECK (LENGTH(company) <= 300),
        CHECK (location IS NULL OR LENGTH(location) <= 200),
        FOREIGN KEY (company_id) REFERENCES companies(id)
    );

    CREATE TABLE IF NOT EXISTS position_highlights (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        position_id INTEGER NOT NULL,
        type TEXT NOT NULL,
        text TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (position_id) REFERENCES positions(id)
    );

    CREATE TABLE IF NOT EXISTS scores (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        position_id INTEGER NOT NULL UNIQUE,
        total_score INTEGER NOT NULL,
        stack_match INTEGER,
        remote_fit INTEGER,
        salary_fit INTEGER,
        experience_fit INTEGER,
        strategic_fit INTEGER,
        breakdown TEXT,
        notes TEXT,
        scored_by TEXT,
        scored_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (position_id) REFERENCES positions(id)
    );

    CREATE TABLE IF NOT EXISTS applications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        position_id INTEGER NOT NULL UNIQUE,
        cv_path TEXT,
        cl_path TEXT,
        cv_pdf_path TEXT,
        cl_pdf_path TEXT,
        critic_verdict TEXT,
        critic_score REAL,
        critic_notes TEXT,
        critic_round INTEGER,
        status TEXT DEFAULT 'draft',
        written_at TIMESTAMP,
        applied_at TIMESTAMP,
        applied_via TEXT,
        response TEXT,
        response_at TIMESTAMP,
        written_by TEXT,
        reviewed_by TEXT,
        critic_reviewed_at TIMESTAMP,
        applied BOOLEAN DEFAULT 0,
        interview_round INTEGER DEFAULT NULL,
        cv_drive_id TEXT,
        cl_drive_id TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (position_id) REFERENCES positions(id)
    );

    -- [JHT-CHAT-UNIFY] Non e' piu' solo la coda di notifiche agente->utente:
    -- e' lo storico della conversazione, condiviso fra videogioco e web.
    -- `author` dice chi ha parlato ('agent' o 'user'); `chat_ts` e' il `ts`
    -- della riga corrispondente in `chat.jsonl` (presente = turno gia'
    -- specchiato nel file che il gioco legge, guardia anti-loop del mirror).
    -- Vedi supabase/migrations/060_chat_unified.sql.
    CREATE TABLE IF NOT EXISTS pending_user_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        agent TEXT NOT NULL,
        body TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'notification' CHECK (kind IN (
            'notification','question','digest','alert'
        )),
        author TEXT NOT NULL DEFAULT 'agent' CHECK (author IN ('agent','user')),
        chat_ts REAL,
        source_id TEXT,
        related_position_id INTEGER,
        delivered_via TEXT CHECK (delivered_via IN ('telegram','web') OR delivered_via IS NULL),
        delivered_at TIMESTAMP,
        acknowledged_at TIMESTAMP,
        user_reply TEXT,
        user_reply_at TIMESTAMP,
        agent_seen_reply_at TIMESTAMP,
        cloud_synced_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (related_position_id) REFERENCES positions(id)
    );

    -- Claim locale della consegna al pane (O-67). Non contiene il testo:
    -- conserva soltanto l'identita' della riga e rende fail-closed il confine
    -- non transazionale SQLite -> TUI. Un claim sopravvissuto a un crash ha
    -- esito esterno incerto e NON viene fatto scadere automaticamente: il
    -- daemon lo segnala invece di rischiare una seconda consegna.
    CREATE TABLE IF NOT EXISTS pending_user_message_delivery_claims (
        message_id INTEGER PRIMARY KEY,
        claimed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (message_id) REFERENCES pending_user_messages(id)
            ON DELETE CASCADE
    );

    -- Ticket utente→team su una posizione (2026-06-18). L'utente, dalla pagina
    -- posizione, scrive una richiesta testuale libera → ticket 'open'. Il
    -- Capitano lo assegna a un agente (status 'assigned', assigned_agent) come
    -- per il Writer on-demand; l'agente risolve scrivendo response_text
    -- ('resolved'). L'utente vede richiesta+risposta in una sezione dedicata.
    -- Mirror Supabase: mig 043. Write-ops: shared/skills/ticket.py.
    CREATE TABLE IF NOT EXISTS position_tickets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        position_id INTEGER NOT NULL,
        request_text TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'custom',
        status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','assigned','resolved')),
        assigned_agent TEXT,
        response_text TEXT,
        -- id del ticket gemello su Supabase (mig 043): correlazione per il
        -- round-trip cloud↔VPS. NULL = ticket creato in locale, non ancora
        -- pushato sul cloud (il daemon lo INSERT e scrive qui l'id). Vedi
        -- `jht cloud sync-tickets`.
        cloud_id INTEGER,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        assigned_at TIMESTAMP,
        resolved_at TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (position_id) REFERENCES positions(id)
    );

    -- Giudizio dell'utente su una posizione (like/dislike/hide/star/clear).
    -- EVENT-LOG, non stato: 'clear' non cancella niente, è un evento come gli
    -- altri e l'ultimo prevale, così «ritiro il voto» resta leggibile nella
    -- storia invece di sparire da essa (stessa semantica di mig 059).
    --
    -- Fino al 2026-08-11 esisteva SOLO su Supabase, e a cloud spento dare un
    -- giudizio rispondeva errore: il prodotto è local-first, quindi il record
    -- nasce QUI e il cloud è un riflesso, non un prerequisito (O-15).
    -- cloud_id: id del gemello su Supabase, come position_tickets. NULL =
    -- nato in locale e non ancora sincronizzato.
    CREATE TABLE IF NOT EXISTS position_feedback (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        position_id INTEGER NOT NULL,
        action TEXT NOT NULL CHECK (action IN (
            'like','dislike','hide','star','clear'
        )),
        reason TEXT,
        comment TEXT,
        score INTEGER CHECK (score IS NULL OR (score BETWEEN 1 AND 5)),
        direction TEXT CHECK (direction IS NULL OR direction IN (
            'more_like_this','less_like_this'
        )),
        cloud_id INTEGER,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (position_id) REFERENCES positions(id)
    );

    -- Blocco note PRIVATO dell'utente su una posizione (O-22). «Cose che mi
    -- possono essere utili una volta che rivisito la posizione»: un
    -- promemoria per sé, NON un ordine al team — gli agenti non la leggono.
    --
    -- Tabella separata, e non una colonna di `positions`, per due ragioni che
    -- si sommano:
    --   1. `positions.notes` è il campo degli AGENTI. Mescolarle renderebbe
    --      irreversibile la scelta «privata»: una nota già finita sotto gli
    --      occhi del team non si può più rendere privata;
    --   2. `jht cloud restore` fa INSERT OR REPLACE su `positions` con un
    --      elenco esplicito di colonne: una colonna in più verrebbe
    --      AZZERATA a ogni restore. Un campo che perde quello che ci scrivi
    --      è peggio di un campo che non c'è.
    --
    -- Non è un event-log (a differenza di `position_feedback`): è un blocco
    -- note, l'ultimo testo vale. Da qui la PRIMARY KEY su position_id.
    -- Una riga per ORIGINE, non una per posizione (O-33): quando la stessa
    -- nota diverge fra box e sito si tengono ENTRAMBI i testi, e non si
    -- cancella mai niente. «Vince l'ultima» sembrava più semplice ma
    -- obbligava a stabilire quale sia «l'ultima» fra due orologi non
    -- sincronizzati — e il box tronca `created_at` ai secondi mentre il web
    -- tiene i millisecondi (visto su O-16). Tenendole entrambe quel
    -- problema non esiste.
    CREATE TABLE IF NOT EXISTS position_user_notes (
        position_id INTEGER NOT NULL,
        origin TEXT NOT NULL DEFAULT 'box' CHECK (origin IN ('box','web')),
        body TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (position_id, origin),
        FOREIGN KEY (position_id) REFERENCES positions(id)
    );

    -- Bacheca del team: direttive/ordini PERMANENTI dell'utente (strategia,
    -- formazione, policy operative) — es. "modalità mantenimento: CV solo 90+,
    -- stop scouting". A differenza del captain-diary (per-giorno, lezioni di
    -- pacing) queste PERSISTONO finché l'utente non le cambia, e il Capitano le
    -- rilegge a ogni riavvio (handoff). Editabili da chat (Capitano/Assistente)
    -- e — prossimo incremento — dalla dashboard web (cloud_id per il round-trip
    -- Supabase, come position_tickets). Write-ops: shared/skills/team_directives.py.
    CREATE TABLE IF NOT EXISTS team_directives (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        body TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'order' CHECK (kind IN (
            'order','strategy','formation','note'
        )),
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_by TEXT NOT NULL DEFAULT 'user',   -- user | capitano | assistente
        cloud_id INTEGER,                          -- gemello Supabase (round-trip dashboard); NULL = solo locale
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        archived_at TIMESTAMP
    );

    -- [JHT-DB-SCOUT-COORD] Divisione del territorio fra Scout e claim
    -- anti-collisione. Vivevano in un SECONDO file sqlite
    -- (`$JHT_HOME/data/scout_coordination.db`) con un suo risolutore di
    -- percorso, e quel file è stato la causa dell'issue #132: un percorso in
    -- più è un percorso che può non esistere, non essere scrivibile, o
    -- risolversi diverso per due agenti. Qui la coordinazione sta accanto
    -- alle altre tabelle di stato interno della squadra (`team_directives`,
    -- `maintenance_events`), con la stessa risoluzione di path che ogni
    -- agente riceve già (`JHT_DB`), le stesse migrazioni e lo stesso backup.
    -- NON viaggia verso il cloud: `db_to_supabase` sincronizza una lista
    -- esplicita di tabelle e questa non c'è.
    -- Write-ops: shared/skills/scout_coord.py (unico scrittore).
    CREATE TABLE IF NOT EXISTS scout_coordination (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        scout TEXT NOT NULL,
        cerchi TEXT,
        fonti TEXT,
        note TEXT,
        started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        superseded_at TIMESTAMP
    );

    -- Claim per posizione: due Scout non lavorano lo stesso annuncio. La
    -- PRIMARY KEY è il lock — l'INSERT del secondo fallisce, e quel
    -- fallimento è la risposta.
    CREATE TABLE IF NOT EXISTS scout_claims (
        job_id TEXT PRIMARY KEY,
        scout TEXT NOT NULL,
        claimed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_positions_status ON positions(status);
    CREATE INDEX IF NOT EXISTS idx_positions_company ON positions(company);
    CREATE INDEX IF NOT EXISTS idx_positions_company_id ON positions(company_id);
    CREATE INDEX IF NOT EXISTS idx_positions_url ON positions(url);
    CREATE INDEX IF NOT EXISTS idx_positions_write_requested ON positions(write_requested) WHERE write_requested = 1;
    CREATE INDEX IF NOT EXISTS idx_positions_geocode_requested ON positions(geocode_requested) WHERE geocode_requested = 1;
    CREATE INDEX IF NOT EXISTS idx_positions_salary_precise_requested ON positions(salary_precise_requested) WHERE salary_precise_requested = 1;
    CREATE INDEX IF NOT EXISTS idx_scores_total ON scores(total_score);
    CREATE INDEX IF NOT EXISTS idx_applications_status ON applications(status);
    CREATE INDEX IF NOT EXISTS idx_pending_user_messages_agent ON pending_user_messages(agent);
    CREATE INDEX IF NOT EXISTS idx_pending_user_messages_delivery ON pending_user_messages(delivered_via, acknowledged_at);
    CREATE INDEX IF NOT EXISTS idx_pending_user_messages_unseen_reply ON pending_user_messages(user_reply_at, agent_seen_reply_at);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_pending_messages_source_id
      ON pending_user_messages(source_id) WHERE source_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_position_tickets_status ON position_tickets(status);
    CREATE INDEX IF NOT EXISTS idx_position_feedback_position
        ON position_feedback(position_id, id DESC);
    CREATE INDEX IF NOT EXISTS idx_position_tickets_position ON position_tickets(position_id);
    CREATE INDEX IF NOT EXISTS idx_position_tickets_cloud_id ON position_tickets(cloud_id) WHERE cloud_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_team_directives_status ON team_directives(status);
    CREATE INDEX IF NOT EXISTS idx_team_directives_cloud_id ON team_directives(cloud_id) WHERE cloud_id IS NOT NULL;
    -- La distribuzione ATTIVA è la sola lettura calda: `show` la fa a ogni
    -- boot di uno Scout, e con la storia di settimane accanto un full scan
    -- sarebbe l'unica query lenta della coordinazione.
    CREATE INDEX IF NOT EXISTS idx_scout_coordination_active ON scout_coordination(scout) WHERE superseded_at IS NULL;

    -- Bug #14: event-log delle transizioni di stato delle positions.
    -- `positions.status` è una colonna sovrascritta ad ogni UPDATE, quindi
    -- gli stati transitori (es. 'checked' < 5 min prima di passare a
    -- 'scored') sono invisibili a un SELECT COUNT(*) WHERE status=...
    -- Logghiamo ogni transizione qui per snapshot retroattivo, throughput
    -- per stato, drop-off funnel e tempo medio di permanenza per stato.
    --
    -- L'INSERT è fatto dal wrapper db_update.py update_position quando
    -- rileva un cambio di status. Mai scrivere qui a mano da altri
    -- script: il wrapper enforça invariants (from_state coerente con il
    -- previous row, by_agent da JHT_AGENT_NAME).
    CREATE TABLE IF NOT EXISTS position_state_transitions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        position_id INTEGER NOT NULL,
        from_state TEXT,
        to_state TEXT NOT NULL,
        ts TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        by_agent TEXT NOT NULL,
        notes TEXT,
        FOREIGN KEY (position_id) REFERENCES positions(id)
    );
    CREATE INDEX IF NOT EXISTS idx_pst_position_ts ON position_state_transitions(position_id, ts);
    CREATE INDEX IF NOT EXISTS idx_pst_ts ON position_state_transitions(ts);
    CREATE INDEX IF NOT EXISTS idx_pst_to_state ON position_state_transitions(to_state, ts);

    -- Storico dei controlli di manutenzione (design 2026-08-03).
    --
    -- Due cose che oggi il DB non sa dire.
    --
    -- 1) `last_checked` e `last_open_check` tengono SOLO l'ultima data: ad
    --    ogni giro la precedente sparisce. Quindi non si può rispondere a
    --    "quante volte l'abbiamo guardata", "da quanto non la tocchiamo",
    --    "quante volte abbiamo provato a verificarla senza riuscirci". Qui
    --    ogni controllo lascia una riga, anche quello che non ha cambiato
    --    niente: sapere che una posizione è stata guardata è metà del punto.
    --
    -- 2) Quando un controllo NON riesce a stabilire se l'offerta è ancora
    --    aperta, la posizione deve restare viva. Non sapere non è sapere che
    --    è scaduta, e chiudere per dubbio è perdere un'occasione in silenzio.
    --    L'outcome `inconclusive` (e unreachable/skipped/failed) VIETA la
    --    scrittura di is_open=false e status excluded/expired — la regola
    --    esisteva solo come prosa nella skill recheck-liveness, ora la
    --    impone maintenance_log.check_closing_write().
    --
    -- I campi evidence_* sono OPZIONALI: ricordano cosa aveva risposto la
    -- fonte (un 403 ricorrente racconta un authwall, non un annuncio morto).
    --
    -- Append-only. Le INSERT le fanno db_update.py e db_insert.py tramite
    -- maintenance_log.py: mai scrivere qui a mano da altri script.
    CREATE TABLE IF NOT EXISTS maintenance_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        by_agent TEXT NOT NULL,
        target_type TEXT NOT NULL,       -- position | company
        target_id INTEGER NOT NULL,
        action TEXT NOT NULL,            -- vocabolario chiuso, vedi maintenance_log.ACTIONS
        outcome TEXT NOT NULL,           -- vocabolario chiuso, vedi maintenance_log.OUTCOMES
        field TEXT,                      -- campo toccato (NULL = esito senza scrittura)
        before TEXT,                     -- valore prima, come stringa
        after TEXT,                      -- valore dopo, come stringa
        evidence_kind TEXT,              -- http | api | manual | none
        evidence_url TEXT,
        evidence_code INTEGER,           -- status HTTP
        evidence_hash TEXT,              -- sha256 del contenuto normalizzato
        duration_ms INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_me_target ON maintenance_events(target_type, target_id, ts);
    CREATE INDEX IF NOT EXISTS idx_me_ts ON maintenance_events(ts);
    CREATE INDEX IF NOT EXISTS idx_me_outcome ON maintenance_events(action, outcome, ts);
    CREATE INDEX IF NOT EXISTS idx_me_agent ON maintenance_events(by_agent, ts);

    -- Trigger educativi: rifiutano la stringa letterale 'now' nei timestamp
    -- e suggeriscono il pattern corretto. Audit 2026-05-02 mostro' 8 record
    -- con written_at='now' (stringa di 3 caratteri) finiti nel DB perche'
    -- gli Scrittori facevano INSERT inline via `python3 -c "import sqlite3
    -- ... VALUES (..., 'now', ...)"` invece di chiamare la skill UPSERT
    -- (db_update.py application). Un fix silenzioso (UPDATE auto a ISO)
    -- avrebbe mascherato l'anti-pattern; preferiamo RAISE(ABORT) con un
    -- messaggio che insegna come fare. INSERT/UPDATE legittimi (via skill
    -- o con datetime('now','localtime') inline) passano: i trigger
    -- valutano NEW.<col> dopo che le espressioni SQL sono gia' state
    -- valutate, quindi il valore visto e' l'ISO timestamp, non 'now'.
    CREATE TRIGGER IF NOT EXISTS applications_reject_str_now_insert
    BEFORE INSERT ON applications
    WHEN NEW.written_at = 'now' OR NEW.applied_at = 'now' OR NEW.response_at = 'now'
    BEGIN
      SELECT RAISE(ABORT,
        'INVALID TIMESTAMP: you passed the literal string "now" as written_at/applied_at/response_at. USE: python3 /app/shared/skills/db_update.py application <POSITION_ID> ... (the UPSERT skill converts it automatically). Do NOT run an inline INSERT via python3 -c "import sqlite3 ... VALUES (..., now, ...)". See RULE-11b in your prompt.'
      );
    END;

    CREATE TRIGGER IF NOT EXISTS applications_reject_str_now_update
    BEFORE UPDATE ON applications
    WHEN NEW.written_at = 'now' OR NEW.applied_at = 'now' OR NEW.response_at = 'now'
    BEGIN
      SELECT RAISE(ABORT,
        'INVALID TIMESTAMP: you passed the literal string "now" in an UPDATE. USE: python3 /app/shared/skills/db_update.py application <POSITION_ID> --written-at now (the skill converts it), or datetime("now","localtime") in inline SQL.'
      );
    END;

    -- Stessa protezione per positions (found_at, last_checked) e companies
    -- (analyzed_at). Anti-pattern atteso: Scout/Analista che fanno INSERT
    -- inline e passano 'now' invece di datetime('now','localtime'). Skill
    -- canoniche da usare: db_update.py position --last-checked now (gia'
    -- gestita), insert via skill di scout/analista che usano CURRENT_TIMESTAMP.
    CREATE TRIGGER IF NOT EXISTS positions_reject_str_now_insert
    BEFORE INSERT ON positions
    WHEN NEW.found_at = 'now' OR NEW.last_checked = 'now'
    BEGIN
      SELECT RAISE(ABORT,
        'INVALID TIMESTAMP: you passed the literal string "now" as positions.found_at/last_checked. USE: db_update.py position <ID> --last-checked now (it converts the value), or datetime("now","localtime") in inline SQL. Do NOT pass the literal string "now".'
      );
    END;

    CREATE TRIGGER IF NOT EXISTS positions_reject_str_now_update
    BEFORE UPDATE ON positions
    WHEN NEW.found_at = 'now' OR NEW.last_checked = 'now'
    BEGIN
      SELECT RAISE(ABORT,
        'INVALID TIMESTAMP: you passed the literal string "now" in an UPDATE on positions. USE: db_update.py position <ID> --last-checked now, or datetime("now","localtime") in inline SQL.'
      );
    END;

    CREATE TRIGGER IF NOT EXISTS companies_reject_str_now_insert
    BEFORE INSERT ON companies
    WHEN NEW.analyzed_at = 'now'
    BEGIN
      SELECT RAISE(ABORT,
        'INVALID TIMESTAMP: you passed the literal string "now" as companies.analyzed_at. USE: db_update.py company "<name>" ... (the skill sets CURRENT_TIMESTAMP), or datetime("now","localtime") in inline SQL.'
      );
    END;

    CREATE TRIGGER IF NOT EXISTS companies_reject_str_now_update
    BEFORE UPDATE ON companies
    WHEN NEW.analyzed_at = 'now'
    BEGIN
      SELECT RAISE(ABORT,
        'INVALID TIMESTAMP: you passed the literal string "now" in an UPDATE on companies. USE: db_update.py company, or datetime("now","localtime") in inline SQL.'
      );
    END;

    -- Timestamp uniformi (V4). Per ogni tabella due trigger:
    --   - touch_updated_at: AFTER UPDATE → setta updated_at = CURRENT_TIMESTAMP.
    --     La WHEN-clause `NEW.updated_at IS OLD.updated_at` evita la
    --     ricorsione infinita: quando il trigger stesso fa UPDATE, NEW
    --     differisce da OLD e il trigger non rientra.
    --   - default_created_at: AFTER INSERT → popola created_at/updated_at
    --     se NULL. Necessario per i DB migrati v3→v4 dove ALTER TABLE ADD
    --     COLUMN non puo' avere DEFAULT CURRENT_TIMESTAMP (limite SQLite,
    --     vedi `_migrate_v3_to_v4`). Su DB freschi il DEFAULT del CREATE
    --     TABLE riempe gia' i valori e il trigger e' no-op.

    CREATE TRIGGER IF NOT EXISTS companies_touch_updated_at
    AFTER UPDATE ON companies FOR EACH ROW
    WHEN NEW.updated_at IS OLD.updated_at
    BEGIN
      UPDATE companies SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
    END;

    CREATE TRIGGER IF NOT EXISTS companies_default_created_at
    AFTER INSERT ON companies FOR EACH ROW
    WHEN NEW.created_at IS NULL OR NEW.updated_at IS NULL
    BEGIN
      UPDATE companies
      SET created_at = COALESCE(created_at, CURRENT_TIMESTAMP),
          updated_at = COALESCE(updated_at, CURRENT_TIMESTAMP)
      WHERE id = NEW.id;
    END;

    CREATE TRIGGER IF NOT EXISTS positions_touch_updated_at
    AFTER UPDATE ON positions FOR EACH ROW
    WHEN NEW.updated_at IS OLD.updated_at
    BEGIN
      UPDATE positions SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
    END;

    CREATE TRIGGER IF NOT EXISTS positions_default_created_at
    AFTER INSERT ON positions FOR EACH ROW
    WHEN NEW.created_at IS NULL OR NEW.updated_at IS NULL
    BEGIN
      UPDATE positions
      SET created_at = COALESCE(created_at, CURRENT_TIMESTAMP),
          updated_at = COALESCE(updated_at, CURRENT_TIMESTAMP)
      WHERE id = NEW.id;
    END;

    CREATE TRIGGER IF NOT EXISTS position_highlights_touch_updated_at
    AFTER UPDATE ON position_highlights FOR EACH ROW
    WHEN NEW.updated_at IS OLD.updated_at
    BEGIN
      UPDATE position_highlights SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
    END;

    CREATE TRIGGER IF NOT EXISTS position_highlights_default_created_at
    AFTER INSERT ON position_highlights FOR EACH ROW
    WHEN NEW.created_at IS NULL OR NEW.updated_at IS NULL
    BEGIN
      UPDATE position_highlights
      SET created_at = COALESCE(created_at, CURRENT_TIMESTAMP),
          updated_at = COALESCE(updated_at, CURRENT_TIMESTAMP)
      WHERE id = NEW.id;
    END;

    CREATE TRIGGER IF NOT EXISTS scores_touch_updated_at
    AFTER UPDATE ON scores FOR EACH ROW
    WHEN NEW.updated_at IS OLD.updated_at
    BEGIN
      UPDATE scores SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
    END;

    CREATE TRIGGER IF NOT EXISTS scores_default_created_at
    AFTER INSERT ON scores FOR EACH ROW
    WHEN NEW.created_at IS NULL OR NEW.updated_at IS NULL
    BEGIN
      UPDATE scores
      SET created_at = COALESCE(created_at, CURRENT_TIMESTAMP),
          updated_at = COALESCE(updated_at, CURRENT_TIMESTAMP)
      WHERE id = NEW.id;
    END;

    CREATE TRIGGER IF NOT EXISTS applications_touch_updated_at
    AFTER UPDATE ON applications FOR EACH ROW
    WHEN NEW.updated_at IS OLD.updated_at
    BEGIN
      UPDATE applications SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
    END;

    -- O-64: written_at e' il marker persistito della versione del CV. Se
    -- cambia dopo una revisione, il giudizio riguarda per definizione il
    -- testo precedente: lo invalidiamo nello stesso statement che pubblica
    -- la nuova versione. I soli cambi di path/PDF non toccano written_at e
    -- quindi non fanno decadere un verdetto ancora valido.
    CREATE TRIGGER IF NOT EXISTS applications_invalidate_critic_after_rewrite
    AFTER UPDATE OF written_at ON applications FOR EACH ROW
    WHEN NEW.written_at IS NOT OLD.written_at AND (
      NEW.critic_verdict IS NOT NULL OR NEW.critic_score IS NOT NULL OR
      NEW.critic_notes IS NOT NULL OR NEW.critic_round IS NOT NULL OR
      NEW.reviewed_by IS NOT NULL OR NEW.critic_reviewed_at IS NOT NULL
    )
    BEGIN
      UPDATE applications
      SET status = CASE
            WHEN status IN ('ready', 'approved') THEN 'review'
            ELSE status
          END,
          critic_verdict = NULL,
          critic_score = NULL,
          critic_notes = NULL,
          critic_round = NULL,
          reviewed_by = NULL,
          critic_reviewed_at = NULL
      WHERE id = NEW.id;
    END;

    CREATE TRIGGER IF NOT EXISTS applications_default_created_at
    AFTER INSERT ON applications FOR EACH ROW
    WHEN NEW.created_at IS NULL OR NEW.updated_at IS NULL
    BEGIN
      UPDATE applications
      SET created_at = COALESCE(created_at, CURRENT_TIMESTAMP),
          updated_at = COALESCE(updated_at, CURRENT_TIMESTAMP)
      WHERE id = NEW.id;
    END;

    CREATE TRIGGER IF NOT EXISTS pending_user_messages_touch_updated_at
    AFTER UPDATE ON pending_user_messages FOR EACH ROW
    WHEN NEW.updated_at IS OLD.updated_at
    BEGIN
      UPDATE pending_user_messages SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
    END;

    CREATE TRIGGER IF NOT EXISTS pending_user_messages_default_created_at
    AFTER INSERT ON pending_user_messages FOR EACH ROW
    WHEN NEW.created_at IS NULL OR NEW.updated_at IS NULL
    BEGIN
      UPDATE pending_user_messages
      SET created_at = COALESCE(created_at, CURRENT_TIMESTAMP),
          updated_at = COALESCE(updated_at, CURRENT_TIMESTAMP)
      WHERE id = NEW.id;
    END;

    -- Tombstones V7 (vedi _migrate_v6_to_v7_tombstones + mig Supabase 025).
    -- `legacy_id` identifica la riga lato cloud:
    --   - positions: positions.id locale (1:1 con cloud legacy_id)
    --   - scores/applications: position_id locale (1:1 con cloud,
    --     mappato a position_id UUID via lookup legacy_id)
    -- INSERT OR REPLACE per essere idempotenti: se la stessa riga viene
    -- "ricreata" e ri-cancellata, il tombstone più recente vince.
    CREATE TABLE IF NOT EXISTS _tombstones (
        table_name TEXT NOT NULL CHECK (table_name IN ('positions', 'scores', 'applications')),
        legacy_id INTEGER NOT NULL,
        deleted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (table_name, legacy_id)
    );
    CREATE INDEX IF NOT EXISTS idx_tombstones_deleted_at ON _tombstones(deleted_at);

    CREATE TRIGGER IF NOT EXISTS positions_tombstone
    BEFORE DELETE ON positions FOR EACH ROW
    BEGIN
      INSERT OR REPLACE INTO _tombstones (table_name, legacy_id, deleted_at)
      VALUES ('positions', OLD.id, CURRENT_TIMESTAMP);
    END;

    CREATE TRIGGER IF NOT EXISTS scores_tombstone
    BEFORE DELETE ON scores FOR EACH ROW
    BEGIN
      INSERT OR REPLACE INTO _tombstones (table_name, legacy_id, deleted_at)
      VALUES ('scores', OLD.position_id, CURRENT_TIMESTAMP);
    END;

    CREATE TRIGGER IF NOT EXISTS applications_tombstone
    BEFORE DELETE ON applications FOR EACH ROW
    BEGIN
      INSERT OR REPLACE INTO _tombstones (table_name, legacy_id, deleted_at)
      VALUES ('applications', OLD.position_id, CURRENT_TIMESTAMP);
    END;
    """)
    # Secondo giro, ed è quello che conta su un database NUOVO.
    #
    # Le migrazioni sopra girano prima delle CREATE TABLE: su un DB esistente è
    # giusto (alterano tabelle già lì), ma su uno appena creato non trovano
    # NIENTE da alterare — `PRAGMA table_info` torna vuoto e ogni migrazione si
    # salta. Poi il DDL base crea `positions` senza le colonne che solo le
    # migrazioni aggiungono, e il database resta incompleto fino alla chiamata
    # SUCCESSIVA di ensure_schema, in un altro processo.
    #
    # Misurato il 2026-07-25: su un jobs.db fresco, `user_excluded_reason` &
    # co. non esistevano dopo il primo ensure_schema. Chi scriveva subito su
    # quelle colonne — la route web, che apre SQLite diretto senza passare di
    # qui — prendeva "no such column" al primo avvio. Le migrazioni sono tutte
    # idempotenti e guardate da PRAGMA table_info, quindi ripeterle costa una
    # manciata di PRAGMA e chiude il buco.
    _run_migrations(conn)
    conn.execute("PRAGMA user_version = 7")
    conn.commit()


def _run_migrations(conn: sqlite3.Connection) -> None:
    """Tutte le migrazioni incrementali, in ordine. Idempotenti: ognuna
    controlla da sé se ha già lavorato, quindi è sicuro chiamarle più volte."""
    _migrate_v2_to_v3(conn)
    _migrate_v3_to_v4(conn)
    _migrate_positions_status_review(conn)
    _migrate_positions_length_constraints(conn)
    _migrate_positions_role_family(conn)
    _migrate_positions_structured_location(conn)
    _migrate_positions_office_geocoding(conn)
    _migrate_positions_write_requested(conn)
    _migrate_positions_write_request_kind(conn)
    _migrate_cover_letter_request_effect(conn)
    _migrate_v6_to_v7_tombstones(conn)
    _migrate_positions_geocode_requested(conn)
    _migrate_positions_expiry(conn)
    _migrate_positions_salary_precise(conn)
    _migrate_positions_role_family_proposed(conn)
    _migrate_positions_user_excluded(conn)
    _migrate_positions_recheck_requested(conn)
    _migrate_positions_jd_summary(conn)
    _migrate_role_family_registry(conn)
    _migrate_position_tickets_cloud_id(conn)
    _migrate_position_tickets_active_rescore(conn)
    _migrate_companies_logo(conn)
    _migrate_pending_messages_chat_turns(conn)
    _migrate_positions_url_unique(conn)
    _migrate_scout_coordination_unique(conn)
    _migrate_position_feedback(conn)
    _migrate_position_user_notes(conn)
    _migrate_position_user_notes_origin(conn)
    _migrate_applications_critic_round(conn)


def _migrate_v2_to_v3(conn: sqlite3.Connection) -> None:
    """Aggiunge CHECK su positions.status per DB già su user_version 2.

    SQLite non supporta `ALTER TABLE ADD CHECK`: serve il rituale
    create-new + copy + drop + rename. Eseguito solo se la versione
    sul disco è esattamente 2 (DB nuovi finiscono già a 3 via il
    CREATE TABLE qui sopra; DB più vecchi non sono mai esistiti in
    produzione).

    Idempotente: se positions ha già il CHECK, l'INSERT passa e la
    rename ha lo stesso schema → operazione no-op semantica. Se un
    valore non-canonico fosse presente, l'INSERT fallirebbe; in tal
    caso meglio fail-fast che corruzione silenziosa.
    """
    current_version = conn.execute("PRAGMA user_version").fetchone()[0]
    if current_version != 2:
        return

    schema_row = conn.execute(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='positions'"
    ).fetchone()
    if schema_row:
        # Marker preciso: la stringa "check(statusin" (whitespace strip + upper)
        # è univoca al CHECK constraint che vogliamo. Una guard naive su 'CHECK'
        # falsa-positivava sulla colonna `last_checked`.
        sql_norm = ''.join((schema_row['sql'] or '').upper().split())
        if 'CHECK(STATUSIN' in sql_norm:
            return  # già migrato (es. DB ricreato da un client più recente)

    conn.executescript("""
        CREATE TABLE positions_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            company TEXT NOT NULL,
            company_id INTEGER,
            location TEXT,
            remote_type TEXT,
            salary_declared_min INTEGER,
            salary_declared_max INTEGER,
            salary_declared_currency TEXT DEFAULT 'EUR',
            salary_estimated_min INTEGER,
            salary_estimated_max INTEGER,
            salary_estimated_currency TEXT DEFAULT 'EUR',
            salary_estimated_source TEXT,
            url TEXT,
            source TEXT,
            jd_text TEXT,
            requirements TEXT,
            found_by TEXT,
            found_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            deadline TEXT,
            status TEXT DEFAULT 'new' CHECK (status IN (
                'new','checked','scored','writing','review','ready','applied','response','excluded'
            )),
            notes TEXT,
            last_checked TIMESTAMP,
            FOREIGN KEY (company_id) REFERENCES companies(id)
        );

        INSERT INTO positions_new SELECT * FROM positions;
        DROP TABLE positions;
        ALTER TABLE positions_new RENAME TO positions;

        CREATE INDEX IF NOT EXISTS idx_positions_status ON positions(status);
        CREATE INDEX IF NOT EXISTS idx_positions_company ON positions(company);
        CREATE INDEX IF NOT EXISTS idx_positions_company_id ON positions(company_id);
        CREATE INDEX IF NOT EXISTS idx_positions_url ON positions(url);
    """)


def _column_exists(conn: sqlite3.Connection, table: str, column: str) -> bool:
    rows = conn.execute(f"PRAGMA table_info({table})").fetchall()
    return any(row['name'] == column for row in rows)


def _migrate_applications_critic_round(conn: sqlite3.Connection) -> None:
    """Rende locale lo stato di round gia' presente nel modello cloud.

    ``db_update.py`` accetta ``--critic-round`` da tempo, ma lo schema SQLite
    fresco non aveva la colonna. O-64 deve poter invalidare lo stato completo
    del Critico e sincronizzarlo, non soltanto voto e verdetto.
    """
    if not _table_exists(conn, 'applications'):
        return
    if not _column_exists(conn, 'applications', 'critic_round'):
        conn.execute("ALTER TABLE applications ADD COLUMN critic_round INTEGER")


def _table_exists(conn: sqlite3.Connection, table: str) -> bool:
    row = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (table,)
    ).fetchone()
    return row is not None


def _index_exists(conn: sqlite3.Connection, index: str) -> bool:
    row = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='index' AND name=?", (index,)
    ).fetchone()
    return row is not None


# Precedenza fra righe che condividono un URL: vince quella su cui è stato
# fatto più lavoro. È la stessa scala già dichiarata in
# `db_migrate_v2.step1_cleanup` — non ne inventiamo una seconda.
_URL_WINNER_ORDER = """
    ORDER BY has_app DESC, has_score DESC,
             CASE p.status
                 WHEN 'applied'  THEN 10 WHEN 'response' THEN 9
                 WHEN 'ready'    THEN 8  WHEN 'review'   THEN 7
                 WHEN 'writing'  THEN 6  WHEN 'scored'   THEN 5
                 WHEN 'checked'  THEN 4  WHEN 'new'      THEN 3
                 WHEN 'excluded' THEN 1  ELSE 0
             END DESC,
             p.id ASC
"""


def _log_url_dedup(entries) -> None:
    """Audit JSONL degli URL spostati dalla migrazione UNIQUE.

    Su un DB di un utente vero questa migrazione tocca dati che l'utente
    vede: deve restare una traccia leggibile anche a mesi di distanza. Come
    `db_insert._log_dedup_skip`, non blocca mai la migrazione se la
    directory dei log non è scrivibile — il lavoro vero è già a posto.
    """
    import sys
    for e in entries:
        print(
            f"[migrate] duplicate positions.url: moved #{e['moved_id']} to "
            f"'{e['new_url']}' (winner: #{e['winner_id']})",
            file=sys.stderr,
        )
    try:
        import json
        from datetime import datetime, timezone
        log_dir = os.path.join(os.environ.get('JHT_HOME', '/jht_home'), 'logs')
        os.makedirs(log_dir, exist_ok=True)
        ts = datetime.now(timezone.utc).isoformat()
        with open(os.path.join(log_dir, 'url-dedup.log'), 'a', encoding='utf-8') as f:
            for e in entries:
                f.write(json.dumps({"ts": ts, **e}) + "\n")
    except (OSError, ValueError):
        pass


def _resolve_duplicate_urls(conn: sqlite3.Connection) -> list:
    """Rende unici gli URL già duplicati SENZA cancellare nessuna riga.

    Vedi la politica dichiarata in `_migrate_positions_url_unique`.
    Ritorna la lista degli spostamenti fatti (vuota se non c'era nulla).
    """
    groups = conn.execute(
        "SELECT url FROM positions "
        "WHERE url IS NOT NULL AND url <> '' "
        "GROUP BY url HAVING COUNT(*) > 1"
    ).fetchall()
    if not groups:
        return []

    # `applications`/`scores` esistono sempre insieme a `positions` sui DB
    # veri, ma la migrazione gira anche a metà creazione di un DB nuovo.
    has_app = (
        "EXISTS(SELECT 1 FROM applications a WHERE a.position_id = p.id)"
        if _table_exists(conn, 'applications') else "0"
    )
    has_score = (
        "EXISTS(SELECT 1 FROM scores s WHERE s.position_id = p.id)"
        if _table_exists(conn, 'scores') else "0"
    )

    moved = []
    for group in groups:
        url = group['url']
        rows = conn.execute(
            f"SELECT p.id, p.status, {has_app} AS has_app, {has_score} AS has_score "
            f"FROM positions p WHERE p.url = ? {_URL_WINNER_ORDER}",
            (url,),
        ).fetchall()
        winner = rows[0]
        for loser in rows[1:]:
            # Frammento, non query string: `#...` non viaggia al server, il
            # link continua ad aprire la stessa pagina. L'id del perdente è
            # nel suffisso perché tre righe sullo stesso URL non finiscano
            # con due stringhe identiche.
            new_url = f"{url}#jht-duplicate-{loser['id']}-of-{winner['id']}"
            note = (
                f"[jht] Duplicate URL of #{winner['id']}: the row was kept, "
                f"and the URL was made unique with a fragment "
                f"(UNIQUE migration on positions.url)."
            )
            conn.execute(
                "UPDATE positions "
                "SET url = ?, notes = CASE WHEN notes IS NULL OR notes = '' "
                "                          THEN ? ELSE notes || char(10) || ? END "
                "WHERE id = ?",
                (new_url, note, note, loser['id']),
            )
            moved.append({
                "url": url,
                "winner_id": winner['id'],
                "moved_id": loser['id'],
                "new_url": new_url,
            })

    if moved:
        _log_url_dedup(moved)
    return moved


def _migrate_positions_url_unique(conn: sqlite3.Connection) -> None:
    """`positions.url` diventa UNIQUE — e nessuna riga viene cancellata.

    Prima c'era solo `idx_positions_url`, non-unico: la dedup era un
    check-then-insert e fra il SELECT e l'INSERT non c'era niente a impedire
    che due Scout sulla stessa fonte scrivessero lo stesso annuncio due
    volte. La transazione `BEGIN IMMEDIATE` in `db_insert.insert_position` è
    la prima linea; questo indice è l'ultima, quella che vale anche per chi
    scrive fuori dal wrapper (`python3 -c "import sqlite3 …"` — anti-pattern
    già visto, vedi i trigger anti-'now' qui sopra).

    POLITICA sui duplicati preesistenti — **nessun DELETE**. Questa funzione
    gira dentro `ensure_schema`, cioè a ogni invocazione di ogni agente,
    senza backup e senza nessuno che guardi: cancellare righe qui sarebbe una
    perdita di dati silenziosa su un DB vero, e il trigger
    `positions_tombstone` la propagherebbe pure al cloud. Quindi, per ogni
    gruppo di righe che condividono un URL:

    - vince la riga con più lavoro sopra (application > score > status più
      avanzato > id più basso) e tiene l'URL invariato;
    - le altre RESTANO, con lo stesso URL più un frammento
      `#jht-duplicate-<id>-of-<id-vincitore>`, più una riga in `notes`;
    - ogni spostamento va su stderr e in `$JHT_HOME/logs/url-dedup.log`.

    Fail-safe: se malgrado tutto l'indice non nasce, la funzione NON solleva.
    `ensure_schema` è chiamata da ogni agente a ogni giro: romperla per un
    vincolo di igiene sarebbe peggio del vincolo mancante. Resta
    `idx_positions_url` e resta la transazione, che è ciò che chiude la race.

    Indice PARZIALE (`url IS NOT NULL AND url <> ''`): in SQLite i NULL sono
    distinti fra loro, quindi le righe senza URL non si darebbero fastidio
    comunque, ma la stringa vuota sì — e nessuno la considera un'identità.
    """
    if not _table_exists(conn, 'positions'):
        return
    if _index_exists(conn, 'idx_positions_url_unique'):
        return  # già migrato: costa una lettura di sqlite_master per giro
    try:
        _resolve_duplicate_urls(conn)
        conn.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_positions_url_unique "
            "ON positions(url) WHERE url IS NOT NULL AND url <> ''"
        )
    except sqlite3.Error as exc:
        import sys
        print(
            f"[migrate] unique index on positions.url was NOT created ({exc}). "
            "Deduplication still relies on the transaction in db_insert.py.",
            file=sys.stderr,
        )


def _migrate_position_user_notes_origin(conn: sqlite3.Connection) -> None:
    """Da «una nota per posizione» a «una nota per ORIGINE» (O-33).

    La chiave primaria in SQLite non si cambia con un ALTER: la tabella si
    ricrea. Ricreare significa poter perdere righe, quindi qui non si copia
    sperando — si CONTA prima, si copia, si riconta, e se il totale non
    coincide ci si ferma con un errore PRIMA di toccare la vecchia. Una
    migrazione senza verifica è un'ipotesi, e l'ipotesi sarebbe sui dati di
    qualcuno.

    Idempotente: se la colonna `origin` c'è già, non fa niente.
    """
    if not _table_exists(conn, 'position_user_notes'):
        return  # la crea già nella forma nuova lo schema base
    if _column_exists(conn, 'position_user_notes', 'origin'):
        return

    before = conn.execute(
        "SELECT COUNT(*) FROM position_user_notes").fetchone()[0]

    conn.execute("""
        CREATE TABLE position_user_notes_new (
            position_id INTEGER NOT NULL,
            origin TEXT NOT NULL DEFAULT 'box' CHECK (origin IN ('box','web')),
            body TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (position_id, origin),
            FOREIGN KEY (position_id) REFERENCES positions(id)
        )
    """)
    # Le note esistenti sono nate sul box: è l'unico posto da cui si potevano
    # scrivere prima di O-33.
    conn.execute("""
        INSERT INTO position_user_notes_new
            (position_id, origin, body, created_at, updated_at)
        SELECT position_id, 'box', body, created_at, updated_at
          FROM position_user_notes
    """)

    after = conn.execute(
        "SELECT COUNT(*) FROM position_user_notes_new").fetchone()[0]
    if after != before:
        # Niente DROP: si lascia tutto com'è e si dice cosa non torna. Meglio
        # una migrazione che non è passata di una nota che non c'è più.
        conn.execute("DROP TABLE position_user_notes_new")
        raise RuntimeError(
            "position_user_notes migration aborted: "
            f"{before} rows before, {after} copied. Nothing was dropped."
        )

    conn.execute("DROP TABLE position_user_notes")
    conn.execute(
        "ALTER TABLE position_user_notes_new RENAME TO position_user_notes")


def _migrate_position_user_notes(conn: sqlite3.Connection) -> None:
    """Crea `position_user_notes` sui DB nati prima di O-22.

    Additiva e idempotente. Chi scrive e chi legge controllano che la tabella
    esista prima di toccarla: fra l'aggiornamento del CLI e il primo giro
    delle migrazioni c'è una finestra reale, ed è lì che un utente perde
    quello che ha appena scritto (stesso difetto trovato su O-16).

    La crea nella forma di O-33 — chiave `(position_id, origin)` — e non in
    quella originale. Su un DB appena creato questa gira nel primo giro di
    `_run_migrations`, cioè PRIMA del DDL base: se qui nascesse con la vecchia
    chiave, `_migrate_position_user_notes_origin` la troverebbe subito dopo
    senza `origin` e proverebbe a ricrearla mentre `positions` ancora non
    esiste, fallendo con "no such table: main.positions". Nascere già nella
    forma nuova rende quella migrazione un no-op sul DB nuovo e la lascia
    lavorare solo dove serve davvero: i jobs.db fra O-22 e O-33.
    """
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS position_user_notes (
            position_id INTEGER NOT NULL,
            origin TEXT NOT NULL DEFAULT 'box' CHECK (origin IN ('box','web')),
            body TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (position_id, origin),
            FOREIGN KEY (position_id) REFERENCES positions(id)
        );
    """)


def _migrate_position_feedback(conn: sqlite3.Connection) -> None:
    """Crea `position_feedback` sui DB nati prima di O-15.

    Additiva e idempotente: CREATE TABLE IF NOT EXISTS, nessun rename, nessun
    drop, nessuna riscrittura di righe esistenti. Un DB che non l'ha ancora
    continua a funzionare — chi scrive e chi legge controllano la presenza
    della tabella prima di toccarla, perché un jobs.db più vecchio del codice
    è la condizione normale fra l'aggiornamento del CLI e il primo giro delle
    migrazioni (è il difetto trovato su O-16, qui evitato per costruzione).
    """
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS position_feedback (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            position_id INTEGER NOT NULL,
            action TEXT NOT NULL CHECK (action IN (
                'like','dislike','hide','star','clear'
            )),
            reason TEXT,
            comment TEXT,
            score INTEGER CHECK (score IS NULL OR (score BETWEEN 1 AND 5)),
            direction TEXT CHECK (direction IS NULL OR direction IN (
                'more_like_this','less_like_this'
            )),
            cloud_id INTEGER,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (position_id) REFERENCES positions(id)
        );
        CREATE INDEX IF NOT EXISTS idx_position_feedback_position
            ON position_feedback(position_id, id DESC);
    """)


def _migrate_scout_coordination_unique(conn: sqlite3.Connection) -> None:
    """`(scout, started_at)` diventa UNIQUE su `scout_coordination`.

    È il vincolo che mancava sotto la dedup dell'import legacy: il
    controllo-poi-inserisci di `scout_coord.import_legacy`, senza niente
    sotto, lasciava a due bootstrap concorrenti (ogni Scout ne fa uno
    pre-spawn) la finestra per importare la stessa storia due volte —
    misurato: 4 processi, 20 righe invece di 5.

    POLITICA sui duplicati preesistenti: si cancellano SOLO i duplicati
    ESATTI — stessa chiave E stesso contenuto (`cerchi`, `fonti`, `note`,
    `superseded_at`): ridondanza pura lasciata dalla doppia importazione,
    stato interno della squadra, tabella che non sincronizza verso il cloud.
    Di quelli si tiene la prima copia (MIN(id)) e le altre spariscono, con
    traccia su stderr. Righe con la STESSA chiave `(scout, started_at)` ma
    contenuto diverso NON sono ridondanza: sono un conflitto. Non si toccano
    — il CREATE UNIQUE INDEX qui sotto fallisce, l'errore esce su stderr ben
    visibile, e quale riga tenere lo decide un umano, non una migrazione che
    gira da sola a ogni boot.

    Fail-safe come `_migrate_positions_url_unique`: se l'indice non nasce
    la funzione NON solleva — `ensure_schema` gira a ogni invocazione di
    ogni agente e romperla per un vincolo di igiene sarebbe peggio del
    vincolo mancante.
    """
    if not _table_exists(conn, 'scout_coordination'):
        return
    if _index_exists(conn, 'idx_scout_coordination_scout_started_unique'):
        return  # già migrato
    try:
        # Duplicati ESATTI, su chiave E contenuto: solo quelli si cancellano.
        _GROUP = "scout, started_at, cerchi, fonti, note, superseded_at"
        dupes = conn.execute(
            f"SELECT COUNT(*) FROM (SELECT 1 FROM scout_coordination "
            f"GROUP BY {_GROUP} HAVING COUNT(*) > 1)"
        ).fetchone()[0]
        if dupes:
            removed = conn.execute(
                f"DELETE FROM scout_coordination WHERE id NOT IN "
                f"(SELECT MIN(id) FROM scout_coordination GROUP BY {_GROUP})"
            ).rowcount
            import sys
            print(
                f"[migrate] scout_coordination: removed {removed} exact "
                f"duplicate row(s) across {dupes} group(s) before the UNIQUE "
                "index (double legacy import).",
                file=sys.stderr,
            )
        conn.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS "
            "idx_scout_coordination_scout_started_unique "
            "ON scout_coordination(scout, started_at)"
        )
    except sqlite3.Error as exc:
        import sys
        print(
            f"[migrate] unique index on scout_coordination(scout, started_at) "
            f"was NOT created ({exc}). If this is a uniqueness conflict, rows "
            "share the (scout, started_at) key with DIFFERENT content: they "
            "were left in place on purpose — inspect and resolve them by "
            "hand. Until then, legacy-import dedup relies on the in-memory "
            "check in scout_coord.import_legacy.",
            file=sys.stderr,
        )


def _migrate_positions_status_review(conn: sqlite3.Connection) -> None:
    """Allow the pipeline's review status and add last_actor to positions.

    `db_update.py` has accepted `status=review` and writes `last_actor`, so
    older/fresh schemas without those fields break the normal agent flow.
    """
    if not _table_exists(conn, 'positions'):
        return

    schema_row = conn.execute(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='positions'"
    ).fetchone()
    schema_sql = schema_row['sql'] or '' if schema_row else ''
    has_review_status = "'review'" in schema_sql or '"review"' in schema_sql
    has_last_actor = _column_exists(conn, 'positions', 'last_actor')

    if has_review_status and has_last_actor:
        return

    existing_columns = {
        row['name'] for row in conn.execute("PRAGMA table_info(positions)").fetchall()
    }
    desired_columns = [
        'id',
        'title',
        'company',
        'company_id',
        'location',
        'remote_type',
        'salary_declared_min',
        'salary_declared_max',
        'salary_declared_currency',
        'salary_estimated_min',
        'salary_estimated_max',
        'salary_estimated_currency',
        'salary_estimated_source',
        'url',
        'source',
        'jd_text',
        'requirements',
        'found_by',
        'found_at',
        'deadline',
        'status',
        'notes',
        'last_checked',
        'last_actor',
        'created_at',
        'updated_at',
    ]
    select_columns = [
        column if column in existing_columns else 'NULL' for column in desired_columns
    ]

    conn.execute("DROP TABLE IF EXISTS positions_new")
    conn.execute("""
        CREATE TABLE positions_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            company TEXT NOT NULL,
            company_id INTEGER,
            location TEXT,
            remote_type TEXT,
            salary_declared_min INTEGER,
            salary_declared_max INTEGER,
            salary_declared_currency TEXT DEFAULT 'EUR',
            salary_estimated_min INTEGER,
            salary_estimated_max INTEGER,
            salary_estimated_currency TEXT DEFAULT 'EUR',
            salary_estimated_source TEXT,
            url TEXT,
            source TEXT,
            jd_text TEXT,
            requirements TEXT,
            found_by TEXT,
            found_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            deadline TEXT,
            status TEXT DEFAULT 'new' CHECK (status IN (
                'new','checked','scored','writing','review','ready','applied','response','excluded'
            )),
            notes TEXT,
            last_checked TIMESTAMP,
            last_actor TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (company_id) REFERENCES companies(id)
        )
    """)
    conn.execute(
        f"""
        INSERT INTO positions_new ({', '.join(desired_columns)})
        SELECT {', '.join(select_columns)} FROM positions
        """
    )
    conn.execute("DROP TABLE positions")
    conn.execute("ALTER TABLE positions_new RENAME TO positions")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_positions_status ON positions(status)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_positions_company ON positions(company)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_positions_company_id ON positions(company_id)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_positions_url ON positions(url)")


def _migrate_positions_length_constraints(conn: sqlite3.Connection) -> None:
    """Replica i CHECK constraint length di Postgres (mig 015) su SQLite.

    Aggiunge `CHECK (LENGTH(title) <= 500)`, `CHECK (LENGTH(company) <= 300)`,
    `CHECK (location IS NULL OR LENGTH(location) <= 200)` a positions.

    Origin: incident RobertHalf 2026-05-19 — scout RobertHalf ha scritto
    4394 char di HTML in `positions.location`. SQLite (senza constraint)
    ha accettato; Postgres (con mig 015) ha rifiutato; daemon push ha
    bloccato sync per 1h causando 504 GATEWAY_TIMEOUT user-facing.

    Fail-fast: con questo migration, INSERT con field over-length fallisce
    immediatamente sul container, l'agente vede l'errore nel suo turn e
    ri-parsa la pagina sorgente invece di far esplodere il sync asincrono.

    Idempotente: guard via introspezione `sqlite_master`. Salta se i
    constraint sono gia' presenti nello schema.

    Rows pre-esistenti che violano il constraint vengono troncate a
    placeholder durante il rebuild (impossibile lasciarle: il CREATE TABLE
    del rebuild ha gia' i CHECK, INSERT ... SELECT fallirebbe altrimenti).
    """
    if not _table_exists(conn, 'positions'):
        return

    schema_row = conn.execute(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='positions'"
    ).fetchone()
    schema_sql = (schema_row['sql'] or '') if schema_row else ''
    # Match case-insensitive: confronto contro literal UPPERCASE (in `LENGTH(TITLE)`
    # invece di `LENGTH(title)`) altrimenti il .upper() del subject non darebbe
    # mai match per via dei nomi colonna trasformati. Controlliamo tutti e 3
    # i constraint per evitare migrazioni parziali su schema custom.
    schema_upper = schema_sql.upper()
    has_all_constraints = (
        'LENGTH(TITLE)' in schema_upper and
        'LENGTH(COMPANY)' in schema_upper and
        'LENGTH(LOCATION)' in schema_upper
    )
    if has_all_constraints:
        return

    # Trova e tronca rows che violerebbero i nuovi constraint. Non possiamo
    # lasciarle al rebuild: il nuovo positions_new ha i CHECK e
    # INSERT...SELECT fallirebbe atomicamente.
    truncated = 0
    for col, max_len in (('title', 500), ('company', 300), ('location', 200)):
        cursor = conn.execute(
            f"SELECT id, LENGTH({col}) AS len FROM positions WHERE {col} IS NOT NULL AND LENGTH({col}) > ?",
            (max_len,)
        )
        rows = cursor.fetchall()
        for row in rows:
            row_id = row['id']
            original_len = row['len']
            placeholder = f"[truncated by mig length-constraints: was {original_len} chars]"
            conn.execute(
                f"UPDATE positions SET {col}=? WHERE id=?",
                (placeholder[:max_len], row_id)
            )
            truncated += 1

    if truncated:
        # Non c'e' logger condiviso qui — print su stderr e' la convenzione
        # delle altre migrate (vedi _migrate_v3_to_v4). Visibile in
        # `jht migrate` stdout e nel boot pid1.
        import sys
        print(
            f"[migrate] truncated {truncated} positions rows violating length constraints",
            file=sys.stderr,
        )

    existing_columns = {
        row['name'] for row in conn.execute("PRAGMA table_info(positions)").fetchall()
    }
    # Lista columns coerente con lo schema canonico in ensure_schema().
    desired_columns = [
        'id', 'title', 'company', 'company_id', 'location', 'remote_type',
        'salary_declared_min', 'salary_declared_max', 'salary_declared_currency',
        'salary_estimated_min', 'salary_estimated_max', 'salary_estimated_currency',
        'salary_estimated_source', 'url', 'source', 'jd_text', 'requirements',
        'found_by', 'found_at', 'deadline', 'status', 'notes', 'last_checked',
        'last_actor', 'created_at', 'updated_at',
    ]
    select_columns = [
        column if column in existing_columns else 'NULL' for column in desired_columns
    ]

    conn.execute("DROP TABLE IF EXISTS positions_new")
    conn.execute("""
        CREATE TABLE positions_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            company TEXT NOT NULL,
            company_id INTEGER,
            location TEXT,
            remote_type TEXT,
            salary_declared_min INTEGER,
            salary_declared_max INTEGER,
            salary_declared_currency TEXT DEFAULT 'EUR',
            salary_estimated_min INTEGER,
            salary_estimated_max INTEGER,
            salary_estimated_currency TEXT DEFAULT 'EUR',
            salary_estimated_source TEXT,
            url TEXT,
            source TEXT,
            jd_text TEXT,
            requirements TEXT,
            found_by TEXT,
            found_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            deadline TEXT,
            status TEXT DEFAULT 'new' CHECK (status IN (
                'new','checked','scored','writing','review','ready','applied','response','excluded'
            )),
            notes TEXT,
            last_checked TIMESTAMP,
            last_actor TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            CHECK (LENGTH(title) <= 500),
            CHECK (LENGTH(company) <= 300),
            CHECK (location IS NULL OR LENGTH(location) <= 200),
            FOREIGN KEY (company_id) REFERENCES companies(id)
        )
    """)
    conn.execute(
        f"""
        INSERT INTO positions_new ({', '.join(desired_columns)})
        SELECT {', '.join(select_columns)} FROM positions
        """
    )
    conn.execute("DROP TABLE positions")
    conn.execute("ALTER TABLE positions_new RENAME TO positions")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_positions_status ON positions(status)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_positions_company ON positions(company)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_positions_company_id ON positions(company_id)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_positions_url ON positions(url)")


def _migrate_positions_role_family(conn: sqlite3.Connection) -> None:
    """Aggiunge `positions.role_family` (text, nullable).

    Categoria semantica del ruolo popolata dall'analista (es. 'Technical
    Writing', 'CAD / CNC'). NULL = non classificata. Allinea SQLite locale
    a Supabase mig 'add_role_family_to_positions' del 2026-05-23.
    """
    if not _table_exists(conn, 'positions'):
        return
    if _column_exists(conn, 'positions', 'role_family'):
        return
    conn.execute("ALTER TABLE positions ADD COLUMN role_family TEXT")
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_positions_role_family "
        "ON positions(role_family) WHERE role_family IS NOT NULL"
    )


def _migrate_positions_structured_location(conn: sqlite3.Connection) -> None:
    """Aggiunge le 10 colonne location strutturate popolate dall'analista.

    Vedi `docs/internal/experiments/2026-05-23-location-playbook.md`. Allinea SQLite a
    Supabase mig `add_structured_location_columns` del 2026-05-23.
    """
    if not _table_exists(conn, 'positions'):
        return
    cols = (
        ('loc_city',           'TEXT'),
        ('loc_region',         'TEXT'),
        ('loc_country',        'TEXT'),
        ('loc_country_code',   'TEXT'),
        ('loc_continent',      'TEXT'),
        ('work_mode',          'TEXT'),
        ('work_country',       'TEXT'),
        ('work_country_code',  'TEXT'),
        ('is_multi_location',  'INTEGER DEFAULT 0'),
        ('location_notes',     'TEXT'),
    )
    for name, decl in cols:
        if not _column_exists(conn, 'positions', name):
            conn.execute(f"ALTER TABLE positions ADD COLUMN {name} {decl}")
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_positions_loc_country_code "
        "ON positions(loc_country_code) WHERE loc_country_code IS NOT NULL"
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_positions_work_mode "
        "ON positions(work_mode) WHERE work_mode IS NOT NULL"
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_positions_loc_continent "
        "ON positions(loc_continent) WHERE loc_continent IS NOT NULL"
    )


def _migrate_positions_office_geocoding(conn: sqlite3.Connection) -> None:
    """Aggiunge le 5 colonne office_* per office geocoding precise.

    Vedi skill `agents/_skills/office-geocoding/SKILL.md`. Mirror delle
    colonne Supabase prod (già esistenti lì pre-2026-05).
    """
    if not _table_exists(conn, 'positions'):
        return
    cols = (
        ('office_lat',       'REAL'),
        ('office_lon',       'REAL'),
        ('office_address',   'TEXT'),
        ('office_geocoded',  'INTEGER DEFAULT 0'),
        ('office_verified',  'INTEGER DEFAULT 0'),
    )
    for name, decl in cols:
        if not _column_exists(conn, 'positions', name):
            conn.execute(f"ALTER TABLE positions ADD COLUMN {name} {decl}")
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_positions_office_geocoded "
        "ON positions(office_geocoded) WHERE office_geocoded = 1"
    )


def _migrate_positions_jd_summary(conn: sqlite3.Connection) -> None:
    """Aggiunge `positions.jd_summary` (text, nullable).

    Sintesi della JD scritta dall'Analista PER l'utente (1-3 paragrafi o
    bullet, lingua dell'utente, markdown leggero: grassetto/bullet/emoji) —
    è la versione ottimizzata e leggibile che la pagina posizione mostra al
    posto del dump grezzo di `jd_text`. Allinea SQLite a Supabase mig 049.
    """
    if not _table_exists(conn, 'positions'):
        return
    if _column_exists(conn, 'positions', 'jd_summary'):
        return
    conn.execute("ALTER TABLE positions ADD COLUMN jd_summary TEXT")


def _migrate_companies_logo(conn: sqlite3.Connection) -> None:
    """Aggiunge `companies.logo`, `logo_source`, `logo_fetched`.

    Logo aziendale mostrato sulla pagina posizione del web:
    - `logo`: data-URI base64 (image/png|jpeg|webp|x-icon), max ~35KB raw.
      Inline nella riga: viaggia con la sync companies esistente, nessuno
      storage esterno, la CSP web permette già `data:` in img-src.
    - `logo_source`: URL da cui è stato estratto (audit/refresh).
    - `logo_fetched`: 0/1 "lavoro tentato" — pattern `office_geocoded`:
      distingue "mai provato" (candidato per la coda logo-missing) da
      "provato ma nessun logo utilizzabile" (non riprovare a ogni sweep).
    Popolate dall'Analista via skill `logo-extraction` →
    `shared/skills/logo_fetch.py`. Allinea SQLite a Supabase mig 056.
    """
    if not _table_exists(conn, 'companies'):
        return
    for name, decl in (
        ('logo', 'TEXT'),
        ('logo_source', 'TEXT'),
        ('logo_fetched', 'INTEGER DEFAULT 0'),
    ):
        if not _column_exists(conn, 'companies', name):
            conn.execute(f"ALTER TABLE companies ADD COLUMN {name} {decl}")


def _migrate_pending_messages_chat_turns(conn: sqlite3.Connection) -> None:
    """Aggiunge `pending_user_messages.author` + `chat_ts` ([JHT-CHAT-UNIFY]).

    La tabella smette di essere la sola coda agente->utente e diventa lo
    storico della conversazione, lo stesso che il videogioco legge da
    `chat.jsonl`:
    - `author`: 'agent' | 'user'. Un turno dell'utente e' una RIGA, non piu'
      soltanto il campo `user_reply` appeso a un messaggio dell'agente
      (limite che sul web spegneva il composer appena finivano i messaggi
      senza risposta).
    - `chat_ts`: il `ts` unix della riga gemella in
      `/jht_home/agents/<ruolo>/chat.jsonl`. Valorizzato = il turno e' gia'
      nel file che il gioco legge. E' la chiave di dedup del mirror nei due
      versi: senza, ogni giro riscriverebbe nel file cio' che ne ha letto.

    Allinea SQLite a Supabase mig 060. Idempotente (guard PRAGMA table_info).

    Nota sul CHECK di `author`: SQLite non sa aggiungere un CHECK con ALTER,
    e non vale il rituale create+copy+drop+rename su una tabella che ha una
    FK verso positions. Il vincolo vive sul CREATE TABLE dei DB nuovi e sul
    cloud (mig 060); qui il DEFAULT garantisce comunque che nessuna riga
    esistente resti senza autore.
    """
    if not _table_exists(conn, 'pending_user_messages'):
        return
    if not _column_exists(conn, 'pending_user_messages', 'author'):
        conn.execute(
            "ALTER TABLE pending_user_messages "
            "ADD COLUMN author TEXT NOT NULL DEFAULT 'agent'"
        )
    if not _column_exists(conn, 'pending_user_messages', 'chat_ts'):
        conn.execute("ALTER TABLE pending_user_messages ADD COLUMN chat_ts REAL")
    # Identita' del canale inbound (O-67). Per Telegram e'
    # `telegram:<ruolo>:<update_id>`: sopravvive a restart e replay fra
    # journal, offset e SQLite senza deduplicare sul testo (due "ok" restano
    # due turni). Locale soltanto: sul cloud l'identita' continua a essere il
    # legacy_id della riga, quindi il payload di sync non cambia.
    if not _column_exists(conn, 'pending_user_messages', 'source_id'):
        conn.execute("ALTER TABLE pending_user_messages ADD COLUMN source_id TEXT")
    # Identità del gemello cloud, quando il messaggio è NATO sul web (O-16).
    # Stesso patto di `position_tickets.cloud_id`: NULL = nata in locale, ed è
    # il caso di ogni riga preesistente — nessuna riscrittura, nessun default
    # da inventare. Serve perché un turno scritto dal web ha già un'identità
    # (legacy_id negativo) prima che il box lo veda: importandolo il box gli
    # assegnava un id locale positivo e il full-push lo ripubblicava come se
    # fosse nato qui, creando un gemello che l'upsert su (user_id, legacy_id)
    # non poteva riconoscere.
    if not _column_exists(conn, 'pending_user_messages', 'cloud_legacy_id'):
        conn.execute(
            "ALTER TABLE pending_user_messages ADD COLUMN cloud_legacy_id INTEGER"
        )
    # Il mirror cerca "i turni che non sono ancora in chat.jsonl": indice
    # parziale, a regime quasi vuoto.
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_pending_messages_unmirrored "
        "ON pending_user_messages(agent, id) WHERE chat_ts IS NULL"
    )
    # Il verso opposto: l'ingest chiede "di questi ts, quali ho gia'?" per
    # ogni riga della coda di chat.jsonl che rilegge. E' la guardia contro i
    # doppioni, quindi gira a ogni giro in cui il file si muove e su liste
    # lunghe quanto la coda. Senza indice sarebbe una scansione della tabella
    # per ogni battuta scambiata.
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_pending_messages_mirrored "
        "ON pending_user_messages(agent, chat_ts) WHERE chat_ts IS NOT NULL"
    )
    conn.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_pending_messages_source_id "
        "ON pending_user_messages(source_id) WHERE source_id IS NOT NULL"
    )


def _migrate_position_tickets_cloud_id(conn: sqlite3.Connection) -> None:
    """Aggiunge `position_tickets.cloud_id` (int, nullable).

    Correlazione per il round-trip cloud↔VPS dei ticket ([JHT-DATA-SYNC]
    fase 2): l'id del ticket gemello su Supabase (mig 043). NULL = creato in
    locale, non ancora pushato (il daemon `jht cloud sync-tickets` lo INSERT
    sul cloud e scrive qui l'id). Per i ticket creati dal web cloud, il pull
    li importa in locale già con cloud_id valorizzato. Idempotente: guard
    `_column_exists`. La tabella può non esistere su DB pre-2026-06-18 → in
    quel caso il CREATE TABLE IF NOT EXISTS più sotto la crea già con la colonna.
    """
    if not _table_exists(conn, 'position_tickets'):
        return
    if _column_exists(conn, 'position_tickets', 'cloud_id'):
        return
    conn.execute("ALTER TABLE position_tickets ADD COLUMN cloud_id INTEGER")
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_position_tickets_cloud_id "
        "ON position_tickets(cloud_id) WHERE cloud_id IS NOT NULL"
    )


def _migrate_position_tickets_active_rescore(conn: sqlite3.Connection) -> None:
    """Impedisce due rivalutazioni attive senza rompere i DB precedenti.

    ``kind`` è sempre stato testo libero, quindi un database antecedente a
    O-70 può già contenere più ``rescore`` open/assigned per la stessa
    posizione. Creare subito l'indice UNIQUE renderebbe ``ensure_schema``
    inutilizzabile proprio su quei database.

    La sanatoria non cancella ticket né testo: mantiene attivo quello su cui
    il team ha già iniziato a lavorare (``assigned`` prima di ``open``), poi
    il più antico e infine l'id minore come spareggio stabile. Gli altri
    diventano ``resolved`` e restano integralmente leggibili nello storico.
    UPDATE e CREATE INDEX vivono nella stessa transazione SQLite aperta dalla
    connessione, quindi non esiste una finestra senza vincolo dopo la cura.
    """
    index = 'idx_position_tickets_active_rescore'
    if not _table_exists(conn, 'position_tickets') or _index_exists(conn, index):
        return

    conn.execute("""
        WITH ranked AS (
            SELECT id,
                   ROW_NUMBER() OVER (
                       PARTITION BY position_id
                       ORDER BY CASE status WHEN 'assigned' THEN 0 ELSE 1 END,
                                CASE WHEN created_at IS NULL THEN 1 ELSE 0 END,
                                created_at ASC,
                                id ASC
                   ) AS active_rank
              FROM position_tickets
             WHERE kind = 'rescore'
               AND status IN ('open', 'assigned')
        )
        UPDATE position_tickets
           SET status = 'resolved',
               resolved_at = COALESCE(resolved_at, CURRENT_TIMESTAMP),
               updated_at = CURRENT_TIMESTAMP
         WHERE id IN (SELECT id FROM ranked WHERE active_rank > 1)
    """)
    conn.execute(f"""
        CREATE UNIQUE INDEX IF NOT EXISTS {index}
            ON position_tickets(position_id, kind)
            WHERE kind = 'rescore' AND status IN ('open', 'assigned')
    """)


def _migrate_positions_user_excluded(conn: sqlite3.Connection) -> None:
    """Aggiunge le colonne di esclusione MANUALE dell'UTENTE (mirror Supabase mig 041).

    L'utente esclude una job offer dalla pagina dettaglio scegliendo una causa
    (5 default + 'Altro'). Effetto: status -> 'excluded' → la posizione esce da
    next-for-recheck / next-for-categorize (che filtrano già lo stato), così gli
    agenti NON ri-verificano la liveness: lo fa l'utente. Reversibile via
    user_excluded_prev_status. Idempotente: guard PRAGMA table_info (limite SQLite:
    no DEFAULT non-costante in ADD COLUMN, qui tutte NULL-able).
    """
    if not _table_exists(conn, 'positions'):
        return
    cols = (
        ('user_excluded_reason',      'TEXT'),
        ('user_excluded_note',        'TEXT'),
        ('user_excluded_at',          'TIMESTAMP'),
        ('user_excluded_prev_status', 'TEXT'),
    )
    for name, decl in cols:
        if not _column_exists(conn, 'positions', name):
            conn.execute(f"ALTER TABLE positions ADD COLUMN {name} {decl}")
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_positions_user_excluded "
        "ON positions(user_excluded_at) WHERE user_excluded_at IS NOT NULL"
    )


def _migrate_positions_recheck_requested(conn: sqlite3.Connection) -> None:
    """Aggiunge `recheck_requested` + `recheck_requested_at` (mirror Supabase mig 042).

    Recheck/liveness ON-DEMAND: il recheck NON è più autonomo (era RULE-12, causa
    del weekly burn). L'utente lo richiede dalla pagina posizione → flag a 1 →
    l'Analista serve next-for-recheck (flag-driven). "Servito" = last_open_check
    aggiornato dopo recheck_requested_at (la posizione esce senza azzerare il
    flag). Idempotente: guard PRAGMA table_info.
    """
    if not _table_exists(conn, 'positions'):
        return
    cols = (
        ('recheck_requested',    'INTEGER DEFAULT 0'),
        ('recheck_requested_at', 'TIMESTAMP'),
    )
    for name, decl in cols:
        if not _column_exists(conn, 'positions', name):
            conn.execute(f"ALTER TABLE positions ADD COLUMN {name} {decl}")
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_positions_recheck_requested "
        "ON positions(recheck_requested) WHERE recheck_requested = 1"
    )


def _migrate_positions_expiry(conn: sqlite3.Connection) -> None:
    """Aggiunge expires_at / is_open / last_open_check (espansione Analista 2026-06-13).

    Scadenze machine-readable + ciclo aperto/scaduto. L'Analista parsa il JD con
    `deadline_extract.py` -> `expires_at` (DATE ISO, NULL se sconosciuta); al richeck
    giornaliero (RULE-12) setta `is_open=0` se link morto o `expires_at` passata.
    `deadline` TEXT resta (raw, polluto: 164/219 valori ma 3 ISO). Mirror Supabase
    mig 038. Idempotente: guard PRAGMA table_info, DEFAULT costante (limite SQLite
    ADD COLUMN). Vedi docs/internal/ANALISTA-EXPANSION-design.md.
    """
    if not _table_exists(conn, 'positions'):
        return
    cols = (
        ('expires_at',      'DATE'),
        ('is_open',         'INTEGER DEFAULT 1'),
        ('last_open_check', 'TIMESTAMP'),
    )
    for name, decl in cols:
        if not _column_exists(conn, 'positions', name):
            conn.execute(f"ALTER TABLE positions ADD COLUMN {name} {decl}")
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_positions_open_expiry "
        "ON positions(expires_at) WHERE is_open = 1"
    )


def _migrate_positions_write_requested(conn: sqlite3.Connection) -> None:
    """Aggiunge `positions.write_requested` + `write_requested_at` (V6).

    Flag user-driven per Writer-on-demand: l'utente seleziona dal dashboard
    web (button "Scrivi CV") o via Telegram (`/cv <id>`) le posizioni per
    cui vuole un CV. Il Capitano monitora il flag e spawna Scrittori
    on-demand — niente piu' auto-write su tutto cio' che passa lo Scorer.

    Vedi BACKLOG [JHT-WRITER-ON-DEMAND] (2026-05-29) e Supabase mig 024.

    Idempotente: guard via PRAGMA table_info, ALTER ADD COLUMN solo se
    mancante (limite SQLite: no DEFAULT non-costante in ADD COLUMN, ma
    `DEFAULT 0` e' costante quindi OK).
    """
    if not _table_exists(conn, 'positions'):
        return
    if not _column_exists(conn, 'positions', 'write_requested'):
        conn.execute("ALTER TABLE positions ADD COLUMN write_requested INTEGER DEFAULT 0")
    if not _column_exists(conn, 'positions', 'write_requested_at'):
        conn.execute("ALTER TABLE positions ADD COLUMN write_requested_at TIMESTAMP")
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_positions_write_requested "
        "ON positions(write_requested) WHERE write_requested = 1"
    )


def _migrate_positions_write_request_kind(conn: sqlite3.Connection) -> None:
    """Distingue CV iniziale e cover letter nella stessa coda Writer.

    ``NULL`` resta il valore legacy equivalente a ``cv``: un box non ancora
    aggiornato può continuare a sincronizzare il flag senza rompere il cloud.
    """
    if not _table_exists(conn, 'positions'):
        return
    if not _column_exists(conn, 'positions', 'write_request_kind'):
        conn.execute(
            "ALTER TABLE positions ADD COLUMN write_request_kind TEXT"
        )


def _migrate_cover_letter_request_effect(conn: sqlite3.Connection) -> None:
    """Chiude la richiesta solo insieme a un nuovo artefatto cover letter.

    Il trigger è il seam comune a skill e agenti: una risposta testuale o un
    UPDATE no-op non possono dichiarare completato il lavoro. Un INSERT non
    basta perché la cover letter è richiedibile solo su application esistente.
    """
    if not (_table_exists(conn, 'positions') and
            _table_exists(conn, 'applications') and
            _column_exists(conn, 'positions', 'write_request_kind')):
        return
    conn.execute("""
        CREATE TRIGGER IF NOT EXISTS cover_letter_request_effect
        AFTER UPDATE OF cl_path, cl_pdf_path ON applications
        WHEN EXISTS (
            SELECT 1 FROM positions p
             WHERE p.id = NEW.position_id
               AND p.write_requested = 1
               AND p.write_request_kind = 'cover_letter'
        ) AND (
            NEW.cl_path IS NOT OLD.cl_path OR
            NEW.cl_pdf_path IS NOT OLD.cl_pdf_path
        )
        BEGIN
            UPDATE positions
               SET write_requested = 0,
                   write_requested_at = CASE
                     WHEN strftime('%Y-%m-%d %H:%M:%f', 'now', 'localtime') >
                          COALESCE(write_requested_at, '')
                     THEN strftime('%Y-%m-%d %H:%M:%f', 'now', 'localtime')
                     ELSE strftime('%Y-%m-%d %H:%M:%f', write_requested_at,
                                   '+0.001 seconds')
                   END,
                   write_request_kind = NULL,
                   updated_at = CASE
                     WHEN strftime('%Y-%m-%d %H:%M:%f', 'now', 'localtime') >
                          COALESCE(updated_at, '')
                     THEN strftime('%Y-%m-%d %H:%M:%f', 'now', 'localtime')
                     ELSE strftime('%Y-%m-%d %H:%M:%f', updated_at,
                                   '+0.001 seconds')
                   END
             WHERE id = NEW.position_id
               AND write_requested = 1
               AND write_request_kind = 'cover_letter';
        END
    """)


def _migrate_positions_geocode_requested(conn: sqlite3.Connection) -> None:
    """Aggiunge `positions.geocode_requested` + `geocode_requested_at` (V8).

    Flag user-driven per Geocoding-on-demand: l'utente seleziona dal
    dashboard web (button "Geocodifica") o via Telegram le posizioni
    per cui vuole coordinate ufficio precise (`office-geocoding` skill).
    L'Analista esegue la skill solo quando il flag e' acceso — niente
    piu' sforzo aggressivo 3-tentativi su tutto il pool.

    Replica esatta del pattern Writer-on-demand (vedi
    `_migrate_positions_write_requested` + Supabase mig 024). Vedi
    BACKLOG [Cloud Sync — Geocoding opt-in/out] (2026-05-31).

    Idempotente: guard via PRAGMA table_info, ALTER ADD COLUMN solo se
    mancante.
    """
    if not _table_exists(conn, 'positions'):
        return
    if not _column_exists(conn, 'positions', 'geocode_requested'):
        conn.execute("ALTER TABLE positions ADD COLUMN geocode_requested INTEGER DEFAULT 0")
    if not _column_exists(conn, 'positions', 'geocode_requested_at'):
        conn.execute("ALTER TABLE positions ADD COLUMN geocode_requested_at TIMESTAMP")
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_positions_geocode_requested "
        "ON positions(geocode_requested) WHERE geocode_requested = 1"
    )


def _migrate_positions_salary_precise(conn: sqlite3.Connection) -> None:
    """Aggiunge `positions.salary_precise_requested` + `_at` + `salary_precise` (V9).

    Flag USER-DRIVEN per Salary-precise on-demand: l'analista produce sempre la
    stima rough (`salary_estimated_*`) nel passaggio pipeline; la versione PRECISA
    (ricerca azienda + media web + tasse + NETTO) e' costosa → l'utente la richiede
    dal dashboard/Telegram, il flag viaggia nel sync (push+pull, cross-device) e
    l'analista la produce solo quando acceso, scrivendo il breakdown in
    `salary_precise`. Replica del pattern Writer/Geocoding-on-demand (mig 024/027).

    recheck/categorize NON hanno colonna: sono code SISTEMATICHE via query naturale
    (last_open_check stale / role_family IS NULL), loop-guard gratis.

    Idempotente: guard via _column_exists, ALTER ADD COLUMN solo se mancante.
    """
    if not _table_exists(conn, 'positions'):
        return
    if not _column_exists(conn, 'positions', 'salary_precise_requested'):
        conn.execute("ALTER TABLE positions ADD COLUMN salary_precise_requested INTEGER DEFAULT 0")
    if not _column_exists(conn, 'positions', 'salary_precise_requested_at'):
        conn.execute("ALTER TABLE positions ADD COLUMN salary_precise_requested_at TIMESTAMP")
    if not _column_exists(conn, 'positions', 'salary_precise'):
        conn.execute("ALTER TABLE positions ADD COLUMN salary_precise TEXT")
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_positions_salary_precise_requested "
        "ON positions(salary_precise_requested) WHERE salary_precise_requested = 1"
    )


def _migrate_positions_role_family_proposed(conn: sqlite3.Connection) -> None:
    """Aggiunge `positions.role_family_proposed` (tassonomia EMERGENTE, 2026-06-15).

    Quando l'analista non trova una categoria ATTIVA del registro che calzi, la
    role_family diventa la sentinella catch-all ('Other') e l'etichetta fine
    proposta dall'analista (raw, mostrata) va qui. Il pass di promozione
    (`role_registry`) clusterizza le righe-sentinella per `normalize_key(proposed)`
    e promuove un cluster a categoria attiva quando supera la soglia di supporto.
    Niente colonna-chiave-normalizzata: la chiave si calcola al volo (più leggera).

    Idempotente: guard via _column_exists, ALTER ADD COLUMN solo se mancante.
    """
    if not _table_exists(conn, 'positions'):
        return
    if not _column_exists(conn, 'positions', 'role_family_proposed'):
        conn.execute("ALTER TABLE positions ADD COLUMN role_family_proposed TEXT")


def _migrate_role_family_registry(conn: sqlite3.Connection) -> None:
    """Crea `role_family_registry` (tassonomia EMERGENTE, 2026-06-15).

    Registro PER-utente delle categorie `role_family` ATTIVE, decise e nominate
    dal TEAM a partire dai dati reali — NESSUN nome di categoria predefinito in
    codice. Parte VUOTO: una categoria nasce solo quando un cluster di proposte
    (righe-sentinella + `role_family_proposed`) raggiunge la soglia di supporto
    nel pass di promozione.

    - `status`: 'active' (mostrata/abbinabile) | 'dormant' (sotto-soglia o oltre
      il cap ~20) | 'merged' (confluita in `merged_into`).
    - `support_count`: cache ricomputata dal pass dai `positions`.
    - PK (user_id, name): active + supporto sono PER-utente (un candidato finance
      non vede attive le categorie di un dev → la tassonomia si adatta al
      candidato). `user_id` keyed anche per parità col cloud multi-tenant.

    Idempotente: CREATE TABLE/INDEX IF NOT EXISTS.
    """
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS role_family_registry (
            user_id       TEXT NOT NULL,
            name          TEXT NOT NULL,
            status        TEXT NOT NULL DEFAULT 'active',
            support_count INTEGER NOT NULL DEFAULT 0,
            merged_into   TEXT,
            created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            promoted_at   TIMESTAMP,
            PRIMARY KEY (user_id, name)
        )
        """
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_rfr_active "
        "ON role_family_registry(user_id, status)"
    )


def local_user_id() -> str:
    """User_id del candidato LOCALE (DB single-candidate sul VPS).

    Il prompt analista e il write-guard non conoscono lo user_id → risolviamo
    qui un default stabile, così la firma per-utente (`active_categories`,
    registro) resta valida per il cloud multi-tenant ma localmente non serve
    passare l'id. Fonte: env `JHT_SUPABASE_USER_ID` (impostata al boot del
    container, già usata da db_to_supabase); fallback costante 'local' se
    assente. La sync (cli/cloud.js) mappa il valore locale allo user_id reale
    nel push verso il cloud.
    """
    return os.environ.get("JHT_SUPABASE_USER_ID") or "local"


def active_categories(conn: sqlite3.Connection, user_id=None, with_support: bool = False):
    """Categorie `role_family` ATTIVE per `user_id` dal registro emergente.

    Ritorna i soli `name` con `status='active'` (dormant/merged ESCLUSE),
    ordinati per supporto desc poi nome. `with_support=True` → list[(name, n)].

    È l'UNICA fonte delle categorie a runtime: niente lista hardcoded. Usata da:
    - write-guard (db_update): enforce `role_family ∈ active(user) ∪ {sentinella}`;
    - prompt analista (via CLI `db_query.py active-categories <user_id>`):
      match-best-active-or-Altro.
    Tabella assente / utente senza attive → lista vuota (cold-start: tutto va
    nella sentinella finché il pass non promuove il primo cluster).
    `user_id=None` → risolto a `local_user_id()` (default candidato locale).
    """
    if user_id is None:
        user_id = local_user_id()
    try:
        rows = conn.execute(
            "SELECT name, support_count FROM role_family_registry "
            "WHERE user_id = ? AND status = 'active' "
            "ORDER BY support_count DESC, name ASC",
            (user_id,),
        ).fetchall()
    except sqlite3.OperationalError:
        return []
    if with_support:
        return [(r[0], r[1]) for r in rows]
    return [r[0] for r in rows]


def _migrate_v6_to_v7_tombstones(conn: sqlite3.Connection) -> None:
    """Aggiunge tabella `_tombstones` + 3 trigger BEFORE DELETE (V7).

    Chiude il gap "DELETE locale non si propaga a cloud": il push delta
    in cli/src/commands/cloud.js è UPSERT-only, quindi righe cancellate
    in SQLite (es. cleanup duplicati di db_migrate_v2.py o future
    operazioni del Capitano) restavano ghost in Supabase per sempre.

    Schema:
      _tombstones(table_name, legacy_id, deleted_at) — PK composta.
      legacy_id identifica la riga lato cloud:
        - positions: OLD.id locale (1:1 con cloud legacy_id)
        - scores/applications: OLD.position_id (1:1 con cloud, via
          mapping legacy_id → position_id UUID).

    Trigger BEFORE DELETE FOR EACH ROW (positions/scores/applications)
    fanno INSERT OR REPLACE in _tombstones, poi il DELETE prosegue
    normalmente (hard-delete locale invariato — gli agenti continuano a
    leggere SQLite senza filtri deleted_at). Tombstones viaggiano nel
    push e il receive Supabase applica UPDATE SET deleted_at = ?.

    Vedi BACKLOG [JHT-CLOUDSYNC-01] DELETE tombstone (2026-05-31) +
    docs/internal/architecture/cloud-sync-architecture.md + Supabase mig 025.

    Idempotente: tabella e trigger sono CREATE ... IF NOT EXISTS sia
    qui sia nel blocco principale di ensure_schema. La funzione di
    migrazione è ridondante per DB freschi (lo schema viene già creato
    nel CREATE TABLE principale), ma utile per DB pre-V7 dove il blocco
    principale è già stato eseguito una volta: SQLite no-op-pa il
    CREATE TABLE IF NOT EXISTS per tabelle esistenti ma chiama
    comunque i CREATE TRIGGER IF NOT EXISTS, quindi a regime non
    occorre logica esplicita qui. Lasciata vuota come placeholder per
    migrazioni V8+ future.
    """
    # No-op: lo schema V7 è interamente additivo (nuova tabella + 3
    # trigger), tutti CREATE ... IF NOT EXISTS già presenti nel blocco
    # executescript di ensure_schema. Nessun ALTER COLUMN né data
    # migration necessaria.
    return


def _migrate_v3_to_v4(conn: sqlite3.Connection) -> None:
    """Aggiunge `created_at`/`updated_at` uniformi a tutte le 5 tabelle.

    SQLite vieta `ALTER TABLE ADD COLUMN ... DEFAULT CURRENT_TIMESTAMP`
    (default deve essere costante), quindi:
      1. ADD COLUMN senza DEFAULT,
      2. UPDATE delle righe esistenti con CURRENT_TIMESTAMP (o un domain
         field se piu' informativo: found_at, analyzed_at, scored_at,
         written_at/applied_at),
      3. il DEFAULT vero e proprio resta nel CREATE TABLE per i DB
         freschi; i trigger `*_default_created_at` (AFTER INSERT) coprono
         eventuali insert sul DB migrato che non passano la colonna.

    Idempotente: guard via `PRAGMA table_info`. Eseguita solo se
    `user_version` e' esattamente 3 (DB gia' su V3). I DB freschi
    (user_version=0) saltano questa e finiscono a V4 direttamente
    via il CREATE TABLE in `ensure_schema`.
    """
    if conn.execute("PRAGMA user_version").fetchone()[0] != 3:
        return

    fallback_fields = {
        'positions':            'found_at',
        'companies':            'analyzed_at',
        'scores':               'scored_at',
        'applications':         'COALESCE(written_at, applied_at)',
        'position_highlights':  None,  # nessun domain field utile
    }

    for table, fallback in fallback_fields.items():
        if not _column_exists(conn, table, 'created_at'):
            conn.execute(f"ALTER TABLE {table} ADD COLUMN created_at TIMESTAMP")
        if not _column_exists(conn, table, 'updated_at'):
            conn.execute(f"ALTER TABLE {table} ADD COLUMN updated_at TIMESTAMP")

        created_expr = (
            f"COALESCE({fallback}, CURRENT_TIMESTAMP)" if fallback else "CURRENT_TIMESTAMP"
        )
        conn.execute(
            f"UPDATE {table} SET created_at = {created_expr} WHERE created_at IS NULL"
        )
        conn.execute(
            f"UPDATE {table} SET updated_at = CURRENT_TIMESTAMP WHERE updated_at IS NULL"
        )


def resolve_company_id(conn: sqlite3.Connection, company_name: str):
    """Cerca company_id per nome (case-insensitive). Ritorna ID o None."""
    if not company_name:
        return None
    row = conn.execute(
        "SELECT id FROM companies WHERE LOWER(name) = LOWER(?)", (company_name,)
    ).fetchone()
    return row['id'] if row else None
