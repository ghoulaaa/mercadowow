"""Pruebas del servidor Python: configuración, estado y botón manual.

La lógica SQL y la actualización horaria se prueban en supabase/pruebas (Node + PGlite).
Aquí la base de datos se sustituye por respuestas preparadas.
"""

from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient

from app import db
from app.config import load_settings, parse_env_file
from app.main import build_status, create_app

URL_OK = "postgresql://postgres.abcd:secreta123@aws-0-us-east-1.pooler.supabase.com:5432/postgres"
BASE_ENV = {"DATABASE_URL": URL_OK, "SUPABASE_URL": "https://abcd.supabase.co"}


def settings(tmp_path, **extra):
    return load_settings(env_file=tmp_path / "no.env",
                         environ={**BASE_ENV, "RUTA_LOGS": str(tmp_path / "logs"), **extra})


# ---------- configuración ----------

def test_valores_por_defecto(tmp_path):
    s = settings(tmp_path)
    assert (s.host, s.port, s.market) == ("127.0.0.1", 8000, "tsm:forever:us:pvp-horde")
    assert s.project_ref == "abcd"
    assert s.function_url == "https://abcd.supabase.co/functions/v1/actualizar-mercado"


def test_la_contrasena_no_aparece_al_imprimir_la_configuracion(tmp_path):
    assert "secreta123" not in repr(settings(tmp_path))


def test_lee_archivo_env_y_la_variable_de_entorno_gana(tmp_path):
    env = tmp_path / ".env"
    env.write_text(f'# comentario\nPUERTO=9001\nHOST="0.0.0.0"\nDATABASE_URL={URL_OK}\n'
                   "SUPABASE_URL=https://abcd.supabase.co/\n", encoding="utf-8")
    s = load_settings(env_file=env, environ={"PUERTO": "9002"})
    assert s.port == 9002
    assert s.host == "0.0.0.0"
    assert s.supabase_url == "https://abcd.supabase.co"   # barra final quitada


def test_supabase_url_con_rest_v1_se_acepta(tmp_path):
    s = settings(tmp_path, SUPABASE_URL="https://abcd.supabase.co/rest/v1/")
    assert s.function_url == "https://abcd.supabase.co/functions/v1/actualizar-mercado"


def test_env_con_bom_de_windows(tmp_path):
    env = tmp_path / ".env"
    env.write_bytes("﻿PUERTO=8123\n".encode("utf-8"))
    assert parse_env_file(env) == {"PUERTO": "8123"}


@pytest.mark.parametrize("env, msg", [
    ({"MERCADO": "tsm:retail:us:area-52"}, "no es un mercado conocido"),
    ({"MERCADO": "tsm:forever:us:pvp-alliance"}, "no es un mercado conocido"),
    ({"PUERTO": "abc"}, "número entero"),
    ({"PUERTO": "70000"}, "fuera de rango"),
    ({"DATABASE_URL": ""}, "Falta DATABASE_URL"),
    ({"DATABASE_URL": "sqlite:///data/mercado.db"}, "postgresql://"),
    ({"DATABASE_URL": URL_OK.replace("secreta123", "[YOUR-PASSWORD]")}, "contraseña"),
    ({"DATABASE_URL": URL_OK.replace("postgres.abcd", "postgres.xxxxxxxx")}, "todavía es el ejemplo"),
    ({"DATABASE_URL": URL_OK.replace("secreta123", "[secreta123]")}, "corchetes"),
    ({"SUPABASE_URL": "https://otro.supabase.co"}, "proyecto 'abcd'"),
    ({"SUPABASE_URL": ""}, "Falta SUPABASE_URL"),
    ({"SUPABASE_URL": "https://evil.example.com"}, "supabase.co"),
])
def test_configuracion_invalida_se_rechaza(tmp_path, env, msg):
    with pytest.raises(ValueError, match=msg):
        settings(tmp_path, **env)


def test_migraciones_en_orden():
    nombres = [p.name for p in db.migration_files()]
    assert nombres == sorted(nombres)
    assert nombres[:2] == ["0001_esquema.sql", "0002_supabase.sql"]


# ---------- estado y botón (base de datos simulada) ----------

T = datetime(2026, 11, 7, 22, 16, 24, tzinfo=timezone.utc)
FILA = {
    "key": "tsm:forever:us:pvp-horde", "label": "WoW Forever · US · PvP · Horda",
    "provider": "tsm", "is_demo": False, "source_url": "https://x/items.csv",
    "last_source_updated_at": T, "last_success_at": T, "last_attempt_at": T,
    "last_new_data_at": T, "last_error": None, "last_error_at": None,
    "consecutive_failures": 0, "next_attempt_at": None, "en_curso": False,
    "versiones": 1, "objetos": 3728, "programada": True, "hora_bd": T,
    "registro": [{"finished_at": T, "status": "nuevo_dato", "http_status": 200,
                  "rows_received": 3728, "message": None}],
}


class ConexionFalsa:
    def __enter__(self): return self
    def __exit__(self, *a): return False


@pytest.fixture
def cliente(tmp_path, monkeypatch):
    monkeypatch.setattr(db, "connect", lambda url: ConexionFalsa())
    monkeypatch.setattr(db, "pending_migrations", lambda conn: [])
    monkeypatch.setattr(db, "market_status", lambda conn, key: dict(FILA))
    with TestClient(create_app(settings(tmp_path))) as c:
        yield c


def test_pagina_y_estado(cliente):
    assert cliente.get("/").status_code == 200
    s = cliente.get("/api/estado").json()
    assert s["mercado"]["clave"] == "tsm:forever:us:pvp-horde"
    assert s["mercado"]["ficticio"] is False
    a = s["actualizacion"]
    assert a["hora_dato_original"] == "2026-11-07T22:16:24Z"
    assert a["proxima"] is None
    assert s["base_de_datos"] == {"proveedor": "Supabase", "proyecto": "abcd", "migraciones_pendientes": []}


def test_el_estado_nunca_incluye_credenciales(cliente):
    texto = cliente.get("/api/estado").text
    assert "secreta123" not in texto and "postgresql://" not in texto


def test_sin_conexion_responde_503_sin_romperse(tmp_path, monkeypatch):
    def falla(url):
        raise OSError("sin red")
    monkeypatch.setattr(db, "connect", falla)
    with TestClient(create_app(settings(tmp_path))) as c:
        r = c.get("/api/estado")
    assert r.status_code == 503
    assert r.json()["error"] == "No se pudo conectar con Supabase"
    assert "secreta123" not in r.text


def test_migraciones_pendientes_se_avisan(tmp_path, monkeypatch):
    monkeypatch.setattr(db, "connect", lambda url: ConexionFalsa())
    monkeypatch.setattr(db, "pending_migrations", lambda conn: ["0001_esquema"])
    with TestClient(create_app(settings(tmp_path))) as c:
        s = c.get("/api/estado").json()
    assert s["base_de_datos"]["migraciones_pendientes"] == ["0001_esquema"]
    assert s["actualizacion"] == {"configurada": False}


@pytest.mark.parametrize("respuesta, codigo", [
    ({"ok": False, "motivo": "espera", "segundos": 120}, 429),
    ({"ok": False, "motivo": "en_curso"}, 409),
])
def test_boton_manual_protegido(cliente, monkeypatch, respuesta, codigo):
    llamadas = []
    monkeypatch.setattr(db, "request_update", lambda conn, key: respuesta)
    monkeypatch.setattr("app.main.httpx.post", lambda *a, **k: llamadas.append(a))
    r = cliente.post("/api/actualizar")
    assert r.status_code == codigo
    assert llamadas == []          # no se invoca la función


def test_boton_manual_aceptado_invoca_la_funcion(cliente, monkeypatch):
    llamadas = []

    class R:
        status_code, text = 200, "{}"

    monkeypatch.setattr(db, "request_update", lambda conn, key: {"ok": True})
    monkeypatch.setattr("app.main.httpx.post", lambda url, **k: llamadas.append(url) or R())
    r = cliente.post("/api/actualizar")
    assert r.status_code == 202
    assert llamadas == ["https://abcd.supabase.co/functions/v1/actualizar-mercado"]


def test_build_status_sin_fila():
    s = build_status(load_settings(environ=BASE_ENV), None, [])
    assert s["actualizacion"] == {"configurada": False}
