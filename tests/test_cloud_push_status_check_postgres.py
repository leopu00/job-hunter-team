"""#194 — ciò che il box PRODUCE deve passare il CHECK che il cloud APPLICA.

Il difetto non si vede da nessuno dei due lati preso da solo. Sul box il
valore è costruito e sembra ragionevole; sul cloud il vincolo esiste ed è
corretto; a mancare è la relazione fra i due, e il fallimento arriva a runtime
in produzione — 57 rifiuti l'ora per sedici ore, `SQLSTATE 23514` sempre sullo
stesso vincolo, senza che niente diventi rosso in CI.

Perciò qui non si asserisce su una stringa. Il valore lo si CHIEDE al modulo
JavaScript eseguendolo davvero, e lo si scrive contro il CHECK vero, letto
dalla migrazione invece che ricopiato. Una prova che ricopia il vincolo
verifica la copia, non il vincolo.

⚠️ Vale solo l'ULTIMA definizione del CHECK: la 073 lo introduce e la 081 lo
ribadisce. Le migrazioni sono storia congelata, non lo stato del database.

I tre casi insieme dicono una cosa sola:
  1. il valore che il box pubblica oggi viene RIFIUTATO con 23514
     (è il difetto, ed è il controllo negativo: se il CHECK non partecipasse,
     questo caso sarebbe verde e tutto il file non proverebbe niente);
  2. l'UPDATE rifiutato non avanza NEMMENO il timestamp — la riga resta viva e
     lo stato dentro è di ieri, che è peggio di un dato assente perché sembra
     fresco;
  3. il valore che il box pubblicherà dopo il fix viene ACCETTATO.
Il (3) è rosso finché il fix non esiste, e torna rosso se qualcuno lo disfa:
non asserisce una parola scelta a mano, ma l'uscita del modulo.
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
import time
import uuid
from pathlib import Path
from urllib.parse import urlparse, urlunparse

import pytest


ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS = ROOT / "supabase/migrations"
PERIODIC_PUSH = ROOT / "cli/src/lib/periodic-push.js"
IMAGE = "postgres:16-alpine"
CONSTRAINT = "team_state_cloud_push_status_valid"
USER_1 = "00000000-0000-0000-0000-000000000001"
QUARANTINED = 3
STALE_CHECKED_AT = "2026-08-17 15:53:36+00"


def _run(argv, *, input_text=None, check=True):
    return subprocess.run(
        argv,
        input=input_text,
        text=True,
        capture_output=True,
        check=check,
        timeout=60,
    )


def _live_check_definition() -> str:
    """Il CHECK come lo applica il cloud: l'ultima migrazione che lo definisce.

    Il corpo si ritaglia contando le parentesi, non con una regex avida: il
    predicato ne contiene di sue e un match pigro lo troncherebbe al primo
    `)`, lasciando passare un vincolo diverso da quello vivo.
    """
    marker = f"ADD CONSTRAINT {CONSTRAINT} CHECK ("
    latest = None
    for path in sorted(MIGRATIONS.glob("*.sql")):
        text = path.read_text(encoding="utf-8")
        start = text.rfind(marker)
        if start < 0:
            continue
        cursor = start + len(marker)
        depth = 1
        while cursor < len(text) and depth:
            if text[cursor] == "(":
                depth += 1
            elif text[cursor] == ")":
                depth -= 1
            cursor += 1
        assert depth == 0, f"parentesi non bilanciate in {path.name}"
        latest = text[start:cursor]
    assert latest, f"nessuna migrazione definisce {CONSTRAINT}"
    return latest


def _published_status(quarantined: int) -> str:
    """Il valore che il box pubblica DAVVERO, chiesto al modulo eseguendolo.

    È il perno del test: una costante ricopiata qui direbbe solo che due
    stringhe di questo file coincidono, e resterebbe verde il giorno che il
    produttore cambia idea.
    """
    if not shutil.which("node"):
        pytest.skip("node non disponibile")
    script = f"""
      const mod = await import({PERIODIC_PUSH.as_uri()!r});
      const state = mod.nextPeriodicPushState({{
        state: {{}},
        now: Date.parse("2026-08-18T06:13:20.000Z"),
        signature: "synthetic",
        result: {{ ok: true, quarantined: {quarantined} }},
        source: "periodic",
      }});
      const observation = mod.periodicPushObservation({{ state }});
      process.stdout.write(String(observation.cloud_push_status));
    """
    out = _run(["node", "--input-type=module", "-e", script])
    return out.stdout.strip()


SCHEMA = """
CREATE TABLE public.team_state (
  user_id UUID PRIMARY KEY,
  cloud_push_status TEXT,
  cloud_push_checked_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.team_state
  {check};
INSERT INTO public.team_state
  (user_id, cloud_push_status, cloud_push_checked_at)
VALUES ('{user}', 'failed', '{checked_at}');
"""


def _psql_argv(client, target):
    return [
        *client,
        "-X",
        "-q",
        "-v",
        "ON_ERROR_STOP=1",
        *target,
        "-At",
        "-F",
        "|",
    ]


@pytest.fixture(scope="module")
def postgres16():
    """`team_state` col CHECK vivo montato sopra, e nient'altro.

    Due strade per lo stesso vincolo: in CI c'è il service `postgres:16-alpine`
    dietro `JHT_TEST_POSTGRES_URL`, in locale si tira su un container. Senza il
    primo ramo questo test **skipperebbe proprio dove serve** — un gate che non
    gira in CI è una difesa che esiste e non copre, ed è il difetto che questo
    ticket racconta, non un altro.
    """
    bootstrap = SCHEMA.format(
        check=_live_check_definition(), user=USER_1, checked_at=STALE_CHECKED_AT
    )

    external_url = os.environ.get("JHT_TEST_POSTGRES_URL")
    if external_url:
        client = shutil.which("psql")
        parsed = urlparse(external_url)
        if not client or not parsed.hostname:
            pytest.fail("JHT_TEST_POSTGRES_URL richiede psql e un host valido")
        database = f"jht_cloud_push_status_{uuid.uuid4().hex[:12]}"

        def run_on(url, sql, *, check=True, verbose=False):
            prelude = "\\set VERBOSITY verbose\n" if verbose else ""
            return _run(
                _psql_argv([client], ["-d", url]),
                input_text=prelude + sql,
                check=check,
            )

        run_on(external_url, f'CREATE DATABASE "{database}";')
        database_url = urlunparse(parsed._replace(path=f"/{database}"))

        def psql(sql, *, check=True, verbose=False):
            return run_on(database_url, sql, check=check, verbose=verbose)

        try:
            psql(bootstrap)
            yield psql
        finally:
            run_on(
                external_url,
                f'DROP DATABASE IF EXISTS "{database}" WITH (FORCE);',
                check=False,
            )
        return

    if not shutil.which("docker"):
        pytest.skip("docker non disponibile")
    if _run(["docker", "image", "inspect", IMAGE], check=False).returncode:
        pytest.skip(f"immagine locale {IMAGE} non disponibile")

    name = f"jht-cloud-push-status-{uuid.uuid4().hex[:10]}"
    started = _run(
        [
            "docker", "run", "--detach", "--rm", "--name", name,
            "-e", "POSTGRES_PASSWORD=synthetic-test-only", IMAGE,
        ],
        check=False,
    )
    if started.returncode:
        pytest.skip(f"PostgreSQL test non avviabile: {started.stderr.strip()}")

    def psql(sql, *, check=True, verbose=False):
        prelude = "\\set VERBOSITY verbose\n" if verbose else ""
        return _run(
            _psql_argv(
                ["docker", "exec", "-i", name, "psql"],
                ["-U", "postgres", "-d", "postgres"],
            ),
            input_text=prelude + sql,
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
        psql(bootstrap)
        yield psql
    finally:
        _run(["docker", "rm", "--force", name], check=False)


def _publish(psql, status: str, *, check: bool):
    """La scrittura che il box tenta a ogni tick: stato e istante insieme."""
    return psql(
        f"""
        UPDATE public.team_state
           SET cloud_push_status = '{status}',
               cloud_push_checked_at = now(),
               updated_at = now()
         WHERE user_id = '{USER_1}';
        """,
        check=check,
        verbose=True,
    )


def test_the_check_really_participates(postgres16):
    """Controllo negativo: senza questo, tutto il file potrebbe essere vuoto.

    Il valore interpolato è quello che la produzione rifiuta da sedici ore. Se
    passasse, vorrebbe dire che il fixture ha montato un vincolo diverso da
    quello vivo — e i casi seguenti non proverebbero niente.
    """
    refused = _publish(postgres16, f"quarantined:{QUARANTINED}", check=False)
    assert refused.returncode != 0, "il CHECK non sta mordendo: prova invalida"
    assert "23514" in refused.stderr, refused.stderr
    assert CONSTRAINT in refused.stderr


def test_a_refused_update_freezes_the_timestamp_too(postgres16):
    """Il sintomo che rende il difetto peggiore di un dato mancante.

    L'UPDATE porta lo stato E l'istante nello stesso comando: se il CHECK lo
    rifiuta, rotola indietro per intero. La riga resta viva e aggiornata di
    continuo, con dentro una fotografia di ieri pomeriggio: chi guarda non
    vede un buco, vede un dato che sembra fresco.
    """
    _publish(postgres16, f"quarantined:{QUARANTINED}", check=False)
    read = postgres16(
        f"SELECT cloud_push_status, cloud_push_checked_at FROM public.team_state"
        f" WHERE user_id = '{USER_1}';"
    )
    status, checked_at = read.stdout.strip().split("|")
    assert status == "failed"
    assert checked_at.startswith("2026-08-17 15:53:36")


def test_what_the_box_publishes_is_accepted(postgres16):
    """Il criterio del ticket: una scrittura rifiutata che diventa accettata.

    Il valore non è scritto qui: è quello che `periodicPushObservation`
    restituisce eseguita davvero. Disfare il fix nel modulo JavaScript riporta
    questo caso al rosso con 23514, senza toccare una riga di questo file.
    """
    published = _published_status(QUARANTINED)
    accepted = _publish(postgres16, published, check=False)
    assert accepted.returncode == 0, (
        f"il box pubblica {published!r}, che il CHECK vivo rifiuta:\n"
        f"{accepted.stderr}"
    )
    read = postgres16(
        f"SELECT cloud_push_status FROM public.team_state"
        f" WHERE user_id = '{USER_1}';"
    )
    assert read.stdout.strip() == published
    assert not re.fullmatch(r"\d+", published), (
        "lo stato pubblicato non deve essere un conteggio nudo"
    )
