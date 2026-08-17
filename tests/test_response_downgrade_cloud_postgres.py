"""#186 × #187 — il terzo anello: la cancellazione dell'esito arriva al cloud?

Il box, dopo che la corsia gli ha riscritto `applied` sopra un esito, rimanda
su quella riga: `positions.status = 'applied'` e una candidatura con `response`
vuota (misurato in `tests/js/tasks/cloud-response-outcome-survives.test.ts`).
Resta una domanda sola, e finora era stata risposta LEGGENDO: il cloud si
difende, o accetta la cancellazione?

Qui la risposta si misura su un PostgreSQL 16 vero, con la funzione e il
trigger PRESI DAL FILE di migrazione — non ricopiati — e con la RPC che la
route usa davvero. Nessuna riga di nessun utente: due UUID sintetici.

⚠️ Il verso è quello vero: PULL PRIMA, CLICK DOPO. Sul cloud la posizione è
già `response` quando il box rimanda `applied`, perché è il box ad avere la
fotografia vecchia.

I test che descrivono ciò che DEVE valere sono `xfail(strict=True)` finché il
regresso del backflow è aperto: il giorno che la correzione entra diventano
verdi e lo strict li fa fallire, chiedendo di togliere il marcatore. Un test
che descrivesse il comportamento di oggi lo cementerebbe.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import time
import uuid
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
MIGRATION_076 = ROOT / "supabase/migrations/076_application_sync_identity.sql"
MIGRATION_081 = ROOT / "supabase/migrations/081_live_schema_reconciliation.sql"
IMAGE = "postgres:16-alpine"
USER_1 = "00000000-0000-0000-0000-000000000001"
POSITION = "10000000-0000-0000-0000-000000000042"
LEGACY = 42


def _run(argv, *, input_text=None, check=True):
    return subprocess.run(
        argv,
        input=input_text,
        text=True,
        capture_output=True,
        check=check,
        timeout=30,
    )


def _trigger_ddl() -> str:
    """La difesa del cloud, estratta dal file vivo invece che ricopiata.

    Ricopiare il corpo qui vorrebbe dire misurare la nostra idea del trigger:
    il giorno che qualcuno lo cambia, questo test resterebbe verde sul testo
    vecchio — cioè direbbe di sì guardando altrove.
    """
    sql = MIGRATION_081.read_text(encoding="utf-8")
    inizio = sql.index(
        "CREATE OR REPLACE FUNCTION public.reject_stale_applied_position_downgrade"
    )
    fine = sql.index(
        "EXECUTE FUNCTION public.reject_stale_applied_position_downgrade();",
        inizio,
    )
    return sql[inizio : fine + len(
        "EXECUTE FUNCTION public.reject_stale_applied_position_downgrade();"
    )]


@pytest.fixture(scope="module")
def cloud():
    """Il cloud come sta DOPO il click dell'utente: esito registrato."""
    if not shutil.which("docker"):
        pytest.skip("docker non disponibile")
    if _run(["docker", "image", "inspect", IMAGE], check=False).returncode:
        pytest.skip(f"immagine locale {IMAGE} non disponibile")

    name = f"jht-response-downgrade-{uuid.uuid4().hex[:10]}"
    started = _run(
        [
            "docker", "run", "--detach", "--rm", "--name", name,
            "-e", "POSTGRES_PASSWORD=synthetic-test-only", IMAGE,
        ],
        check=False,
    )
    if started.returncode:
        pytest.skip(f"PostgreSQL test non avviabile: {started.stderr.strip()}")

    def psql(sql: str, *, role: str = "postgres", check: bool = True):
        return _run(
            [
                "docker", "exec", "-i", name, "psql", "-X", "-q",
                "-v", "ON_ERROR_STOP=1", "-U", role, "-d", "postgres",
                "-At", "-F", "|",
            ],
            input_text=sql,
            check=check,
        )

    try:
        stable = 0
        for _ in range(100):
            ready = psql("SELECT 1;", check=False)
            stable = stable + 1 if ready.returncode == 0 else 0
            if stable == 2:
                break
            time.sleep(0.1)
        else:
            pytest.fail("PostgreSQL 16 non è diventato ready")

        psql(
            f"""
            CREATE ROLE anon NOLOGIN;
            CREATE ROLE authenticated NOLOGIN;
            CREATE ROLE service_role LOGIN BYPASSRLS;
            CREATE SCHEMA auth;
            CREATE TABLE auth.users (id UUID PRIMARY KEY);
            INSERT INTO auth.users VALUES ('{USER_1}');

            CREATE TABLE public.positions (
              id UUID PRIMARY KEY,
              user_id UUID NOT NULL REFERENCES auth.users(id),
              legacy_id INTEGER NOT NULL,
              status TEXT,
              UNIQUE (user_id, legacy_id),
              UNIQUE (user_id, id)
            );
            CREATE TABLE public.applications (
              id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
              user_id UUID NOT NULL REFERENCES auth.users(id),
              position_id UUID NOT NULL,
              cv_path TEXT, cv_pdf_path TEXT, cl_path TEXT, cl_pdf_path TEXT,
              status TEXT, critic_score REAL, critic_verdict TEXT,
              critic_notes TEXT, critic_round INTEGER,
              written_at TIMESTAMPTZ, applied_at TIMESTAMPTZ,
              applied_via TEXT, response TEXT, response_at TIMESTAMPTZ,
              written_by TEXT, reviewed_by TEXT,
              critic_reviewed_at TIMESTAMPTZ, applied BOOLEAN,
              cv_drive_id TEXT, cl_drive_id TEXT,
              UNIQUE (position_id),
              FOREIGN KEY (user_id, position_id)
                REFERENCES public.positions (user_id, id)
            );
            CREATE TABLE public.scores (
              id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
              user_id UUID NOT NULL REFERENCES auth.users(id),
              position_id UUID NOT NULL, total_score INTEGER NOT NULL,
              UNIQUE (position_id),
              FOREIGN KEY (user_id, position_id)
                REFERENCES public.positions (user_id, id)
            );
            GRANT SELECT, INSERT, UPDATE ON
              public.positions, public.applications, public.scores
              TO service_role;

            INSERT INTO public.positions (id, user_id, legacy_id, status)
              VALUES ('{POSITION}', '{USER_1}', {LEGACY}, 'response');
            """
        )
        psql(MIGRATION_076.read_text(encoding="utf-8"))
        psql(_trigger_ddl())
        psql(
            f"""
            INSERT INTO public.applications (
              user_id, position_id, legacy_id, status, applied, applied_at,
              applied_via, response, response_at
            ) VALUES (
              '{USER_1}', '{POSITION}', 193, 'response', true,
              '2026-08-16T09:30:00+00:00', 'user_manual',
              'rejected', '2026-08-17T08:00:00+00:00'
            );
            """
        )
        yield psql
    finally:
        _run(["docker", "rm", "--force", name], check=False)


def _stato(psql):
    letto = psql(
        f"""
        SELECT position.status, application.status, application.response
          FROM public.positions AS position
          JOIN public.applications AS application
            ON application.position_id = position.id
         WHERE position.user_id = '{USER_1}' AND position.legacy_id = {LEGACY};
        """
    )
    return letto.stdout.strip().split("|")


def _push_della_posizione(psql, check=True):
    """Ciò che la route fa con la riga che il box rimanda: un UPDATE su status."""
    return psql(
        f"""
        UPDATE public.positions SET status = 'applied'
         WHERE user_id = '{USER_1}' AND legacy_id = {LEGACY};
        """,
        check=check,
    )


def _push_della_candidatura(psql, check=True):
    """La RPC che la route chiama, con la riga COME LA MANDA IL BOX.

    `response` assente: in locale non c'è mai arrivata, perché la corsia che
    scende non la porta.
    """
    riga = {
        "legacy_id": 193,
        "position_legacy_id": LEGACY,
        "_receipt_id": "q_aaaaaaaaaaaaaaaaaaaaaaaa",
        "status": "applied",
        "applied": True,
        "applied_at": "2026-08-16T09:30:00+00:00",
        "applied_via": "user_manual",
        "response": None,
        "response_at": None,
    }
    payload = json.dumps([riga], separators=(",", ":"))
    return psql(
        f"SELECT public.sync_upsert_applications('{USER_1}', "
        f"$json${payload}$json$::jsonb);",
        role="service_role",
        check=check,
    )


def test_il_cloud_parte_con_l_esito_registrato(cloud):
    # Se questa lettura non è quella attesa, i due test sotto misurerebbero
    # un'altra situazione: la prima cosa da provare è lo stato di partenza.
    assert _stato(cloud) == ["response", "response", "rejected"]


@pytest.mark.xfail(
    strict=True,
    reason="#186×#187 aperto: il trigger difende 'applied' e non difende "
    "'response', quindi il downgrade passa",
)
def test_il_cloud_rifiuta_lo_stato_piu_vecchio_del_box(cloud):
    """Il trigger di O-97 ferma i downgrade da (applied, response) verso
    stati FUORI da quella coppia. `applied` è dentro, quindi
    `response -> applied` non è un downgrade per lui: passa.

    Che sia una difesa mancante e non una svista è il punto da decidere a
    valle — qui si misura soltanto che difesa NON c'è.
    """
    rifiutato = _push_della_posizione(cloud, check=False)

    assert rifiutato.returncode != 0
    assert "stale_position_downgrade" in rifiutato.stderr


@pytest.mark.xfail(
    strict=True,
    reason="#186×#187 aperto: sync_upsert_applications scrive "
    "response = EXCLUDED.response, e il box manda NULL",
)
def test_l_esito_sopravvive_al_push_del_box(cloud):
    """La domanda che conta: dopo il giro, l'esito dell'utente c'è ancora?

    La guardia della RPC alza `stale_application_downgrade` solo se lo status
    in arrivo è fuori da (applied, response) o se mancano applied/applied_at/
    applied_via. La riga del box li ha tutti e porta `applied`: passa la
    guardia, e l'UPDATE scrive `response = EXCLUDED.response`, cioè NULL.
    """
    _push_della_posizione(cloud, check=False)
    _push_della_candidatura(cloud, check=False)

    assert _stato(cloud)[2] == "rejected"
