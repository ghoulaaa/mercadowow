"""Pruebas del servidor Python: configuración, estado y botón manual.

La lógica SQL y la actualización horaria se prueban en supabase/pruebas (Node + PGlite).
Aquí la base de datos se sustituye por respuestas preparadas.
"""

from datetime import datetime, timezone

import psycopg
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
    assert nombres[:6] == ["0001_esquema.sql", "0002_supabase.sql", "0003_web.sql", "0004_demo_csv.sql",
                           "0005_tabla.sql", "0006_motor.sql"]


# ---------- estado y botón (base de datos simulada) ----------

# Forma que devuelve la función SQL estado_mercado (probada en netlify/pruebas con PGlite).
ESTADO = {
    "hora_servidor": "2026-11-08T03:00:00+00:00",
    "mercado": {"clave": "tsm:forever:us:pvp-horde", "nombre": "WoW Forever · US · PvP · Horda",
                "proveedor": "TSM", "ficticio": False, "fuente": "https://x/items.csv"},
    "actualizacion": {"configurada": True, "en_curso": False,
                      "hora_dato_original": "2026-11-07T22:16:24+00:00", "proxima": None,
                      "fallos_seguidos": 0, "versiones_guardadas": 1, "objetos": 3728},
    "registro": [{"hora": "2026-11-08T02:09:24+00:00", "estado": "nuevo_dato", "http": 200,
                  "filas": 3728, "mensaje": None}],
}


class ConexionFalsa:
    """Imita psycopg: devuelve respuestas preparadas y anota cada SQL ejecutado."""

    def __init__(self, respuestas=None):
        self.sql, self.respuestas = [], list(respuestas or [])

    def __enter__(self): return self
    def __exit__(self, *a): return False

    def transaction(self): return self

    def execute(self, sql, params=None):
        self.sql.append(sql)
        r = self.respuestas.pop(0) if self.respuestas else None
        return type("Cursor", (), {"fetchone": lambda _s: r})()


MERCADOS = [{"clave": "tsm:forever:us:pvp-horde"}, {"clave": "csv:forever:us:pvp-horde"},
            {"clave": "demo:forever:us:demo"}]


@pytest.fixture
def cliente(tmp_path, monkeypatch):
    monkeypatch.setattr(db, "connect", lambda url: ConexionFalsa())
    monkeypatch.setattr(db, "pending_migrations", lambda conn: [])
    monkeypatch.setattr(db, "market_status",
                        lambda conn, key: dict(ESTADO) if key in {m["clave"] for m in MERCADOS} else None)
    monkeypatch.setattr(db, "list_markets", lambda conn: MERCADOS)
    with TestClient(create_app(settings(tmp_path))) as c:
        yield c


def test_pagina_y_estado(cliente):
    inicio = cliente.get("/")
    assert inicio.status_code == 200 and 'src="app.js"' in inicio.text
    for archivo in ("/app.js", "/styles.css"):          # mismas rutas que en Netlify
        assert cliente.get(archivo).status_code == 200
    r = cliente.get("/api/estado")
    assert r.headers["cache-control"] == "no-store"
    s = r.json()
    assert s["mercado"]["clave"] == "tsm:forever:us:pvp-horde"
    assert s["actualizacion"]["objetos"] == 3728
    assert s["base_de_datos"] == {"proveedor": "Supabase", "proyecto": "abcd", "migraciones_pendientes": []}
    assert "autenticado" not in s     # en local no hay sesión: no se muestra «Salir»


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
    monkeypatch.setattr(db, "pending_migrations", lambda conn: ["0003_web"])
    with TestClient(create_app(settings(tmp_path))) as c:
        s = c.get("/api/estado").json()
    assert s["base_de_datos"]["migraciones_pendientes"] == ["0003_web"]
    assert s["actualizacion"] == {"configurada": False}


@pytest.mark.parametrize("respuesta, codigo", [
    ({"ok": False, "motivo": "espera", "segundos": 120}, 429),
    ({"ok": False, "motivo": "en_curso"}, 409),
    ({"ok": True}, 202),
])
def test_boton_manual(cliente, monkeypatch, respuesta, codigo):
    monkeypatch.setattr(db, "request_update", lambda conn, key: respuesta)
    assert cliente.post("/api/actualizar").status_code == codigo


@pytest.mark.parametrize("respuesta, dispara", [
    ({"ok": True}, True),
    ({"ok": False, "motivo": "espera", "segundos": 60}, False),
])
def test_request_update_solo_dispara_si_se_acepta(respuesta, dispara):
    conn = ConexionFalsa([{"r": respuesta}])
    assert db.request_update(conn, "tsm:forever:us:pvp-horde") == respuesta
    assert any("disparar_si_corresponde" in s for s in conn.sql) is dispara


def test_estado_de_otro_mercado_y_mercado_inexistente(cliente):
    s = cliente.get("/api/estado", params={"mercado": "demo:forever:us:demo"}).json()
    assert s["mercados"] == MERCADOS and s["mercado_principal"] == "tsm:forever:us:pvp-horde"
    assert cliente.get("/api/estado", params={"mercado": "no-existe"}).status_code == 404


def test_js_se_sirve_como_javascript(cliente):
    for archivo in ("/app.js", "/csv.js", "/moneda.js"):
        assert "javascript" in cliente.get(archivo).headers["content-type"]


def test_importar_valida_el_cuerpo_y_pasa_errores_sql(cliente, monkeypatch):
    assert cliente.post("/api/importar", json={"mercado": "x"}).status_code == 400

    class Diag:
        message_primary = "Solo se puede importar en un mercado de importación manual"

    class ErrorSql(psycopg.errors.RaiseException):
        diag = Diag()

    def falla(*a):
        raise ErrorSql()
    monkeypatch.setattr(db, "import_prices", falla)
    r = cliente.post("/api/importar", json={"mercado": "tsm:forever:us:pvp-horde",
                                            "hora_dato": "2026-11-08T02:00:00Z", "filas": []})
    assert r.status_code == 422
    assert "importación manual" in r.json()["error"]


def test_demo_valida_dias(cliente, monkeypatch):
    monkeypatch.setattr(db, "generate_demo", lambda conn, dias: {"estado": "nuevo_dato", "dias": dias})
    assert cliente.post("/api/demo", json={"dias": 0}).status_code == 400
    assert cliente.post("/api/demo", json={"dias": "5"}).status_code == 400
    assert cliente.post("/api/demo", json={"dias": 7}).json()["dias"] == 7
    assert cliente.post("/api/demo").json()["dias"] == 30


def test_precios_y_version(cliente, monkeypatch):
    monkeypatch.setattr(db, "market_version",
                        lambda conn, key: {"version": 3} if key == "csv:forever:us:pvp-horde" else None)
    monkeypatch.setattr(db, "price_table", lambda conn, key: [{"id": 1, "precio": 5}])
    monkeypatch.setattr(db, "recompute", lambda conn, key: {"estado": "al_dia"})
    monkeypatch.setattr(db, "recommendations_summary", lambda conn, key: {"vender": 0})
    r = cliente.get("/api/precios", params={"mercado": "csv:forever:us:pvp-horde"})
    assert r.status_code == 200 and r.headers["cache-control"] == "no-store"
    assert r.json() == {"mercado": "csv:forever:us:pvp-horde", "version": {"version": 3},
                        "motor": {"estado": "al_dia"}, "resumen": {"vender": 0},
                        "objetos": [{"id": 1, "precio": 5}]}
    assert cliente.get("/api/precios", params={"mercado": "nada"}).status_code == 404
    assert cliente.get("/api/version", params={"mercado": "csv:forever:us:pvp-horde"}).json() == {"version": 3}
    assert cliente.get("/api/version", params={"mercado": "nada"}).status_code == 404


@pytest.mark.parametrize("cuerpo", [
    {"mercado": "x", "id": "1", "favorito": True},
    {"mercado": "x", "id": True, "favorito": True},
    {"mercado": "x", "id": 1, "favorito": "sí"},
    {"id": 1, "favorito": True},
])
def test_favorito_valida(cliente, cuerpo):
    assert cliente.post("/api/favorito", json=cuerpo).status_code == 400


def test_favorito_ok(cliente, monkeypatch):
    monkeypatch.setattr(db, "set_favorite", lambda conn, mk, i, f: {"id": i, "favorito": f})
    assert cliente.post("/api/favorito", json={"mercado": "x", "id": 7, "favorito": True}).json() == \
        {"id": 7, "favorito": True}


def test_explicacion(cliente, monkeypatch):
    monkeypatch.setattr(db, "recompute", lambda conn, key: {"estado": "al_dia"})
    monkeypatch.setattr(db, "explain", lambda conn, key, i: {"id": i} if i == 7 else None)
    assert cliente.get("/api/explicacion", params={"id": 7}).json() == {"id": 7}
    assert cliente.get("/api/explicacion", params={"id": 8}).status_code == 404
    assert cliente.get("/api/explicacion", params={"id": 0}).status_code == 422   # validación de FastAPI
    assert cliente.get("/api/explicacion").status_code == 422


def test_ajustes(cliente, monkeypatch):
    monkeypatch.setattr(db, "read_settings", lambda conn: {"motor.comision_pct": 5})
    assert cliente.get("/api/ajustes").json() == {"motor.comision_pct": 5}

    class Diag:
        message_primary = "El ajuste motor.comision_pct debe estar entre 0 y 50"

    class ErrorSql(psycopg.errors.RaiseException):
        diag = Diag()

    def falla(conn, a):
        raise ErrorSql()
    monkeypatch.setattr(db, "save_settings", falla)
    r = cliente.post("/api/ajustes", json={"motor.comision_pct": 99})
    assert r.status_code == 422 and "entre 0 y 50" in r.json()["error"]


def test_build_status_sin_datos():
    s = build_status(load_settings(environ=BASE_ENV), None, [])
    assert s["actualizacion"] == {"configurada": False}
    assert s["registro"] == []


