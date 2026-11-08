"""Acceso a la base de datos Postgres de Supabase.

El esquema está en db/migraciones/*.sql y se aplica con `python -m app.configurar`.
Precios en cobre (bigint). Horas en timestamptz (UTC).
"""

from __future__ import annotations

from pathlib import Path

import psycopg
from psycopg.rows import dict_row

from app.config import BASE_DIR

MIGRATIONS_DIR = BASE_DIR / "db" / "migraciones"


def connect(database_url: str) -> psycopg.Connection:
    # autocommit: cada sentencia se confirma sola, salvo dentro de conn.transaction().
    return psycopg.connect(
        database_url,
        autocommit=True,
        row_factory=dict_row,
        connect_timeout=15,
        application_name="mercadowow",
    )


def migration_files(directory: Path = MIGRATIONS_DIR) -> list[Path]:
    """Migraciones en orden (0001_…, 0002_…). Falla si hay números repetidos."""
    files = sorted(directory.glob("[0-9][0-9][0-9][0-9]_*.sql"))
    numbers = [f.name[:4] for f in files]
    if len(numbers) != len(set(numbers)):
        raise RuntimeError(f"Números de migración repetidos en {directory}")
    return files


def apply_migrations(conn: psycopg.Connection, directory: Path = MIGRATIONS_DIR) -> list[str]:
    """Aplica las migraciones pendientes, cada una en su propia transacción."""
    conn.execute(
        "create table if not exists schema_migrations ("
        " version text primary key, applied_at timestamptz not null default now())"
    )
    conn.execute("alter table schema_migrations enable row level security")
    done = {r["version"] for r in conn.execute("select version from schema_migrations")}
    applied = []
    for path in migration_files(directory):
        version = path.stem
        if version in done:
            continue
        with conn.transaction():
            conn.execute(path.read_text(encoding="utf-8"))
            conn.execute("insert into schema_migrations (version) values (%s)", (version,))
        applied.append(version)
    return applied


def pending_migrations(conn: psycopg.Connection) -> list[str]:
    exists = conn.execute("select to_regclass('public.schema_migrations') is not null as e").fetchone()["e"]
    done = set()
    if exists:
        done = {r["version"] for r in conn.execute("select version from schema_migrations")}
    return [p.stem for p in migration_files() if p.stem not in done]


def market_status(conn: psycopg.Connection, market_key: str) -> dict | None:
    row = conn.execute(
        """
        select m.key, m.label, m.provider, m.is_demo, m.source_url,
               s.last_source_updated_at, s.last_success_at, s.last_attempt_at,
               s.last_new_data_at, s.last_error, s.last_error_at,
               s.consecutive_failures,
               -- '-infinity' (= toca ya) no existe en Python: se devuelve como null.
               case when isfinite(s.next_attempt_at) then s.next_attempt_at end as next_attempt_at,
               (s.lease_expires_at > now()) as en_curso,
               (select count(*) from snapshots x where x.market_id = m.id) as versiones,
               (select count(*) from items i where i.market_id = m.id) as objetos,
               (select value from settings where key = 'url_funcion') is not null as programada,
               now() as hora_bd
          from markets m
          left join fetch_state s on s.market_id = m.id
         where m.key = %s
        """,
        (market_key,),
    ).fetchone()
    if row is None:
        return None
    row["registro"] = conn.execute(
        """
        select l.finished_at, l.status, l.http_status, l.rows_received, l.message
          from fetch_log l join markets m on m.id = l.market_id
         where m.key = %s
         order by l.finished_at desc
         limit 8
        """,
        (market_key,),
    ).fetchall()
    return row


def request_update(conn: psycopg.Connection, market_key: str) -> dict:
    with conn.transaction():
        return conn.execute("select solicitar_actualizacion(%s) as r", (market_key,)).fetchone()["r"]
