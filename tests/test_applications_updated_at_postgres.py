"""#186 — applications.updated_at si muove DAVVERO a ogni UPDATE.

Il difetto che questa migrazione chiude non è «manca una colonna»: è che il
verso cloud→macchina non ha un cursore su cui ordinare e filtrare. La colonna
da sola non lo risolve — il `DEFAULT now()` copre soltanto l'INSERT, quindi
una riga appena inserita ha `updated_at` valorizzato **anche senza trigger**.
Un test che inserisce e legge è verde in tutti e due i mondi: è il verde falso
che lascerebbe passare una migrazione a metà, con il cursore fermo e nessuno
che se ne accorge finché un utente non dice che le candidature non tornano.

Perciò qui si UPDATA una riga che esiste già e si pretende che il valore sia
cambiato, e accanto c'è il controllo negativo che mostra la stessa sequenza
sulla tabella gemella senza trigger: lì il valore non si muove. Le due letture
insieme dicono che a far avanzare il cursore è il trigger, non il default.

⚠️ Le due scritture devono stare in TRANSAZIONI diverse: dentro una sola
transazione `now()` è costante, quindi INSERT e UPDATE insieme darebbero lo
stesso istante e il test sarebbe rosso per il motivo sbagliato. Ogni chiamata
a `psql` qui è una transazione a sé.
"""

from __future__ import annotations

import shutil
import subprocess
import time
import uuid
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "supabase/migrations/085_applications_updated_at.sql"
IMAGE = "postgres:16-alpine"
USER_1 = "00000000-0000-0000-0000-000000000001"
POSITION = "10000000-0000-0000-0000-000000000042"
APPLICATION = "30000000-0000-0000-0000-000000000193"


def _run(argv, *, input_text=None, check=True):
    return subprocess.run(
        argv,
        input=input_text,
        text=True,
        capture_output=True,
        check=check,
        timeout=30,
    )


@pytest.fixture(scope="module")
def postgres16():
    """Lo schema PRIMA della 085, come sta oggi sul vivo.

    `applications` senza `updated_at`, e `update_updated_at()` già definita —
    verificato sul catalogo di produzione: la funzione c'è dalla 001 e la
    usano cinque tabelle. La migrazione la riusa, non la ridefinisce, quindi
    il fixture deve fornirla come la trova il cloud.
    """
    if not shutil.which("docker"):
        pytest.skip("docker non disponibile")
    if _run(["docker", "image", "inspect", IMAGE], check=False).returncode:
        pytest.skip(f"immagine locale {IMAGE} non disponibile")

    name = f"jht-applications-updated-at-{uuid.uuid4().hex[:10]}"
    started = _run(
        [
            "docker",
            "run",
            "--detach",
            "--rm",
            "--name",
            name,
            "-e",
            "POSTGRES_PASSWORD=synthetic-test-only",
            IMAGE,
        ],
        check=False,
    )
    if started.returncode:
        pytest.skip(f"PostgreSQL test non avviabile: {started.stderr.strip()}")

    def psql(sql: str, *, check: bool = True):
        return _run(
            [
                "docker",
                "exec",
                "-i",
                name,
                "psql",
                "-X",
                "-q",
                "-v",
                "ON_ERROR_STOP=1",
                "-U",
                "postgres",
                "-d",
                "postgres",
                "-At",
                "-F",
                "|",
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
            CREATE SCHEMA auth;
            CREATE TABLE auth.users (id UUID PRIMARY KEY);
            INSERT INTO auth.users VALUES ('{USER_1}');

            CREATE FUNCTION public.update_updated_at() RETURNS trigger
              LANGUAGE plpgsql SET search_path TO 'public' AS $fn$
            BEGIN
                NEW.updated_at = now();
                RETURN NEW;
            END;
            $fn$;

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
              status TEXT, applied BOOLEAN,
              applied_at TIMESTAMPTZ, applied_via TEXT,
              created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
              UNIQUE (position_id),
              FOREIGN KEY (user_id, position_id)
                REFERENCES public.positions (user_id, id)
            );

            -- La gemella del controllo negativo: stessa colonna, stesso
            -- default, nessun trigger. È il mondo in cui la migrazione si
            -- fosse fermata al punto (1).
            CREATE TABLE public.applications_senza_trigger (
              id UUID PRIMARY KEY,
              applied BOOLEAN,
              updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
            );

            INSERT INTO public.positions (id, user_id, legacy_id, status)
              VALUES ('{POSITION}', '{USER_1}', 42, 'ready');
            -- Riga NATA PRIMA della migrazione: è il caso delle 428 vere.
            INSERT INTO public.applications (id, user_id, position_id, status)
              VALUES ('{APPLICATION}', '{USER_1}', '{POSITION}', 'draft');
            INSERT INTO public.applications_senza_trigger (id, applied)
              VALUES ('{APPLICATION}', false);
            """
        )
        yield psql
    finally:
        _run(["docker", "rm", "--force", name], check=False)


@pytest.fixture()
def migrato(postgres16):
    """La 085 applicata. Idempotente, quindi ri-applicarla non disturba."""
    postgres16(MIGRATION.read_text(encoding="utf-8"))
    return postgres16


def _updated_at(psql, tabella="applications"):
    """L'istante come numero: confrontare le stringhe di psql è un azzardo."""
    letto = psql(
        f"SELECT extract(epoch FROM updated_at) FROM public.{tabella} "
        f"WHERE id = '{APPLICATION}';"
    )
    return float(letto.stdout.strip())


def test_un_update_muove_il_cursore(migrato):
    """La prova che conta: la riga esiste già e l'UPDATE deve spostarla.

    Se il trigger non ci fosse, questo test sarebbe rosso — ed è l'unico modo
    di distinguere una migrazione completa da una fatta a metà, perché il
    valore letto subito dopo l'INSERT è valorizzato in entrambi i casi.
    """
    prima = _updated_at(migrato)
    assert prima, "la colonna non è valorizzata nemmeno sulla riga esistente"

    migrato(
        f"UPDATE public.applications SET applied = true "
        f"WHERE id = '{APPLICATION}';"
    )

    assert _updated_at(migrato) > prima


def test_il_default_da_solo_non_bastava(migrato):
    """Il controllo negativo, sulla gemella senza trigger.

    Stessa colonna, stesso `DEFAULT now()`, stessa sequenza: qui il valore
    resta fermo. È il mondo che avremmo consegnato fermandoci alla ALTER
    TABLE, e il motivo per cui il punto (2) non è un di più.
    """
    prima = _updated_at(migrato, "applications_senza_trigger")

    migrato(
        f"UPDATE public.applications_senza_trigger SET applied = true "
        f"WHERE id = '{APPLICATION}';"
    )

    assert _updated_at(migrato, "applications_senza_trigger") == prima


def test_le_righe_gia_esistenti_tornano_a_casa_una_volta(migrato):
    """Niente backfill storico: tutte le righe prendono l'istante della ALTER.

    È la scelta che fa tornare a casa le 428 candidature al primo pull. Con i
    timestamp storici quelle più vecchie del lookback resterebbero fuori per
    sempre — cioè proprio quelle da recuperare.
    """
    fuori = migrato(
        "SELECT count(*) FROM public.applications "
        "WHERE updated_at IS NULL OR updated_at < created_at;"
    )

    assert fuori.stdout.strip() == "0"


def test_la_migrazione_si_riapplica_senza_rompere(migrato):
    """Idempotenza: la si applica due volte e il trigger resta uno solo."""
    migrato(MIGRATION.read_text(encoding="utf-8"))

    trigger = migrato(
        "SELECT count(*) FROM pg_trigger "
        "WHERE tgrelid = 'public.applications'::regclass AND NOT tgisinternal;"
    )
    assert trigger.stdout.strip() == "1"


def test_manca_la_funzione_e_la_migrazione_si_ferma(postgres16):
    """La 085 riusa `update_updated_at()`: se non c'è, deve dirlo.

    Senza la guardia, `CREATE TRIGGER` fallirebbe comunque — ma con un errore
    di catalogo che non spiega niente. Qui l'errore nomina la precondizione.
    """
    postgres16("ALTER FUNCTION public.update_updated_at() RENAME TO altrove;")
    try:
        rotta = postgres16(MIGRATION.read_text(encoding="utf-8"), check=False)
    finally:
        postgres16("ALTER FUNCTION public.altrove() RENAME TO update_updated_at;")

    assert rotta.returncode != 0
    assert "085 precondition" in rotta.stderr


def test_la_migrazione_non_ridefinisce_la_funzione_condivisa():
    """Cinque tabelle dipendono da quella funzione: qui non si riscrive.

    Un `CREATE OR REPLACE FUNCTION update_updated_at` in coda a una migrazione
    additiva cambierebbe il comportamento di positions, pending_user_messages,
    position_user_notes, notification_prefs e user_settings senza che il
    titolo della migrazione lo dica.
    """
    sql = MIGRATION.read_text(encoding="utf-8").lower()

    assert "function public.update_updated_at()" in sql
    assert "create function" not in sql
    assert "create or replace function" not in sql
