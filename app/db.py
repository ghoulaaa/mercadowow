"""Acceso a la base de datos Postgres de Supabase.

El esquema está en db/migraciones/*.sql y se aplica con `python -m app.configurar`.
Precios en cobre (bigint). Horas en timestamptz (UTC).
"""

from __future__ import annotations

from pathlib import Path

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

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
    """Estado del panel. Lo calcula la función SQL estado_mercado (la misma que usa Netlify)."""
    return conn.execute("select estado_mercado(%s) as r", (market_key,)).fetchone()["r"]


def list_markets(conn: psycopg.Connection) -> list[dict]:
    return conn.execute("select listar_mercados() as r").fetchone()["r"]


def import_prices(conn: psycopg.Connection, market_key: str, hora_dato: str,
                  filas: list[dict], nombre_archivo: str) -> dict:
    """Plan B: guarda un CSV ya validado en el navegador. La BD vuelve a validar y solo acepta mercados csv."""
    return conn.execute(
        "select importar_precios(%s, %s::timestamptz, %s::jsonb, %s) as r",
        (market_key, hora_dato, Jsonb(filas), nombre_archivo),
    ).fetchone()["r"]


def price_table(conn: psycopg.Connection, market_key: str) -> list[dict]:
    return conn.execute("select tabla_precios(%s) as r", (market_key,)).fetchone()["r"]


def recompute(conn: psycopg.Connection, market_key: str) -> dict:
    """Recalcula las recomendaciones solo si cambiaron los datos o los ajustes."""
    with conn.transaction():
        return conn.execute("select recalcular_recomendaciones(%s) as r", (market_key,)).fetchone()["r"]


def recommendations_summary(conn: psycopg.Connection, market_key: str) -> dict:
    return conn.execute("select resumen_recomendaciones(%s) as r", (market_key,)).fetchone()["r"]


def explain(conn: psycopg.Connection, market_key: str, item_id: int) -> dict | None:
    return conn.execute("select explicar_objeto(%s, %s) as r", (market_key, item_id)).fetchone()["r"]


def read_settings(conn: psycopg.Connection) -> dict:
    return conn.execute("select leer_ajustes() as r").fetchone()["r"]


def save_settings(conn: psycopg.Connection, ajustes: dict) -> dict:
    return conn.execute("select guardar_ajustes(%s::jsonb) as r", (Jsonb(ajustes),)).fetchone()["r"]


def price_history(conn: psycopg.Connection, market_key: str, item_id: int, dias: int) -> dict:
    return conn.execute("select historial_objeto(%s, %s, %s) as r", (market_key, item_id, dias)).fetchone()["r"]


def inventory(conn: psycopg.Connection, market_key: str) -> dict:
    return conn.execute("select inventario_valorado(%s) as r", (market_key,)).fetchone()["r"]


def inventory_action(conn: psycopg.Connection, c: dict) -> dict:
    """Agregar, editar, borrar o importar lotes. La BD valida que todo sea del mismo mercado."""
    mk = c["mercado"]
    if c["accion"] == "agregar":
        sql, args = "select agregar_inventario(%s, %s, %s, %s, %s) as r", \
            (mk, c["item_id"], c["cantidad"], c.get("coste"), c.get("nota"))
    elif c["accion"] == "editar":
        sql, args = "select editar_inventario(%s, %s, %s, %s, %s) as r", \
            (mk, c["id"], c["cantidad"], c.get("coste"), c.get("nota"))
    elif c["accion"] == "borrar":
        sql, args = "select borrar_inventario(%s, %s) as r", (mk, c["id"])
    else:
        sql, args = "select importar_inventario(%s, %s::jsonb, %s) as r", \
            (mk, Jsonb(c["filas"]), c.get("reemplazar") is True)
    with conn.transaction():
        return conn.execute(sql, args).fetchone()["r"]


def sales(conn: psycopg.Connection, market_key: str) -> dict:
    lista = conn.execute("select ventas_listado(%s) as r", (market_key,)).fetchone()["r"]
    evaluacion = conn.execute("select evaluar_recomendaciones(%s) as r", (market_key,)).fetchone()["r"]
    return {**lista, "evaluacion": evaluacion}


def sales_action(conn: psycopg.Connection, c: dict) -> dict:
    """Registrar o borrar una venta. La BD valida mercado, objeto, lote y fechas."""
    with conn.transaction():
        if c["accion"] == "registrar":
            return conn.execute(
                "select registrar_venta(%s, %s, %s, %s, %s::timestamptz, %s, %s, %s, %s, %s) as r",
                (c["mercado"], c["item_id"], c["cantidad"], c["precio"], c["vendido_en"], c.get("comision"),
                 c.get("deposito"), c.get("lote_id"), c.get("descontar") is True, c.get("nota")),
            ).fetchone()["r"]
        return conn.execute("select borrar_venta(%s, %s) as r", (c["mercado"], c["id"])).fetchone()["r"]


def search_catalog(conn: psycopg.Connection, market_key: str, q: str) -> list[dict]:
    return conn.execute("select buscar_catalogo(%s, %s, 20) as r", (market_key, q)).fetchone()["r"]


def item_sheet(conn: psycopg.Connection, market_key: str, item_id: int) -> dict | None:
    return conn.execute("select ficha_objeto(%s, %s) as r", (market_key, item_id)).fetchone()["r"]


def categories(conn: psycopg.Connection, market_key: str) -> list[dict]:
    return conn.execute("select categorias_mercado(%s) as r", (market_key,)).fetchone()["r"]


def main_market(conn: psycopg.Connection) -> str | None:
    """Mercado principal guardado en la base de datos (TSM desde 0020), o None."""
    fila = conn.execute("select mercado_principal() as r").fetchone()
    return fila["r"] if fila else None


PARAMS_MERCADO = ("q", "categoria", "subcategoria", "calidad", "profesion", "nivel_min", "nivel_max",
                  "precio_min", "precio_max", "solo_ofertas", "orden", "dir", "pagina", "por_pagina")


def market_page(conn: psycopg.Connection, market_key: str, params: dict) -> dict:
    """Una página de la tabla del Mercado sobre todo el catálogo (filtros, orden y paginación en SQL)."""
    return conn.execute("select mercado_pagina(%s, %s) as r", (market_key, Jsonb(params))).fetchone()["r"]


def recipes(conn: psycopg.Connection, market_key: str, *, profesion: str | None = None,
            objeto: int | None = None, base: str = "mediana"):
    """Profesiones (sin filtros), recetas de una profesión con su coste, o fabricación/usos de un objeto."""
    if objeto is not None:
        sql, args = "select recetas_objeto(%s, %s, %s) as r", (market_key, objeto, base)
    elif profesion is not None:
        sql, args = "select recetas_profesion(%s, %s, %s) as r", (market_key, profesion, base)
    else:
        sql, args = "select profesiones_recetas(%s) as r", (market_key,)
    return conn.execute(sql, args).fetchone()["r"]


def add_to_catalog(conn: psycopg.Connection, market_key: str, item_id: int, http_get) -> bool:
    """Alta por ID: pide el objeto a AHledger y lo guarda en el catálogo. Solo mercados reales."""
    m = conn.execute("select game_type, is_demo from markets where key = %s", (market_key,)).fetchone()
    if not m or m["is_demo"]:
        return False
    try:
        r = http_get(f"https://api.ahledger.com/v1/items/{item_id}?game={m['game_type']}")
    except Exception:
        return False
    if r.status_code != 200:
        return False
    obj = r.json()
    if not isinstance(obj, dict) or obj.get("id") != item_id or not str(obj.get("name") or "").strip():
        return False
    conn.execute("select guardar_catalogo(%s, %s::jsonb, 'ahledger')", (m["game_type"], Jsonb([obj])))
    return True


def market_version(conn: psycopg.Connection, market_key: str) -> dict | None:
    return conn.execute("select version_mercado(%s) as r", (market_key,)).fetchone()["r"]


def set_favorite(conn: psycopg.Connection, market_key: str, item_id: int, favorito: bool) -> dict:
    return conn.execute("select marcar_favorito(%s, %s, %s) as r",
                        (market_key, item_id, favorito)).fetchone()["r"]


def generate_demo(conn: psycopg.Connection, dias: int) -> dict:
    """Regenera los datos FICTICIOS del mercado demo (y solo de ese mercado)."""
    return conn.execute("select generar_demo(%s) as r", (dias,)).fetchone()["r"]


def request_update(conn: psycopg.Connection, market_key: str) -> dict:
    """Botón manual: adelanta la consulta y, si procede, dispara la Edge Function vía pg_net."""
    with conn.transaction():
        r = conn.execute("select solicitar_actualizacion(%s) as r", (market_key,)).fetchone()["r"]
        if r.get("ok"):
            conn.execute("select disparar_si_corresponde()")
    return r
