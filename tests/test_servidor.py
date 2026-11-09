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
    assert (s.host, s.port, s.market) == ("127.0.0.1", 8000, "ahledger:forever:us:pvp-horde")
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
    assert nombres[:17] == ["0001_esquema.sql", "0002_supabase.sql", "0003_web.sql", "0004_demo_csv.sql",
                           "0005_tabla.sql", "0006_motor.sql", "0007_inventario.sql", "0008_ventas.sql",
                           "0009_ahledger.sql", "0010_catalogo.sql", "0011_catalogo_cron.sql",
                           "0012_busqueda_mercado.sql", "0013_textos_fuente.sql", "0014_tasas.sql",
                           "0015_recetas.sql", "0016_recetas_cron.sql", "0017_mercado_pagina.sql"]


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


MERCADOS = [{"clave": "ahledger:forever:us:pvp-horde"}, {"clave": "tsm:forever:us:pvp-horde"},
            {"clave": "csv:forever:us:pvp-horde"}, {"clave": "demo:forever:us:demo"}]


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


def test_boton_manual_usa_el_mercado_pedido(cliente, monkeypatch):
    pedidos = []
    monkeypatch.setattr(db, "request_update", lambda conn, key: pedidos.append(key) or {"ok": True})
    cliente.post("/api/actualizar", json={"mercado": "tsm:forever:us:pvp-horde"})
    cliente.post("/api/actualizar")
    assert pedidos == ["tsm:forever:us:pvp-horde", "ahledger:forever:us:pvp-horde"]
    assert cliente.post("/api/actualizar", json={"mercado": 5}).status_code == 400


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
    assert s["mercados"] == MERCADOS and s["mercado_principal"] == "ahledger:forever:us:pvp-horde"
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


@pytest.mark.parametrize("cuerpo, codigo", [
    ({"mercado": "x", "accion": "volar"}, 400),
    ({"accion": "agregar", "item_id": 1, "cantidad": 1}, 400),
    ({"mercado": "x", "accion": "agregar", "item_id": 1, "cantidad": "1"}, 400),
    ({"mercado": "x", "accion": "agregar", "item_id": 1, "cantidad": 1, "coste": 12.5}, 400),
    ({"mercado": "x", "accion": "editar", "id": True, "cantidad": 1}, 400),
    ({"mercado": "x", "accion": "importar", "filas": "no"}, 400),
    ({"mercado": "x", "accion": "agregar", "item_id": 1, "cantidad": 3, "coste": None}, 200),
    ({"mercado": "x", "accion": "borrar", "id": 4}, 200),
])
def test_inventario_valida(cliente, monkeypatch, cuerpo, codigo):
    monkeypatch.setattr(db, "inventory_action", lambda conn, c: {"ok": True})
    assert cliente.post("/api/inventario", json=cuerpo).status_code == codigo


def test_inventario_e_historial_lectura(cliente, monkeypatch):
    monkeypatch.setattr(db, "recompute", lambda conn, key: {"estado": "al_dia"})
    monkeypatch.setattr(db, "inventory", lambda conn, key: {"filas": [], "totales": {"lotes": 0}})
    monkeypatch.setattr(db, "price_history", lambda conn, key, i, d: {"id": i, "dias": d})
    assert cliente.get("/api/inventario").json()["totales"] == {"lotes": 0}
    assert cliente.get("/api/historial", params={"id": 5, "dias": 7}).json() == {"id": 5, "dias": 7}
    assert cliente.get("/api/historial", params={"id": 5, "dias": 90}).status_code == 422


VENTA = {"mercado": "x", "accion": "registrar", "item_id": 1, "cantidad": 2, "precio": 950,
         "vendido_en": "2026-11-10T12:00:00Z"}


@pytest.mark.parametrize("cuerpo, codigo", [
    ({**VENTA, "accion": "volar"}, 400),
    ({k: v for k, v in VENTA.items() if k != "mercado"}, 400),
    ({**VENTA, "precio": "950"}, 400),
    ({**VENTA, "cantidad": True}, 400),
    ({**VENTA, "comision": 1.5}, 400),
    ({**VENTA, "vendido_en": None}, 400),
    ({"mercado": "x", "accion": "borrar"}, 400),
    (VENTA, 200),
    ({**VENTA, "comision": 0, "deposito": None, "lote_id": 3, "descontar": True}, 200),
    ({"mercado": "x", "accion": "borrar", "id": 9}, 200),
])
def test_ventas_valida(cliente, monkeypatch, cuerpo, codigo):
    monkeypatch.setattr(db, "sales_action", lambda conn, c: {"ok": True})
    assert cliente.post("/api/ventas", json=cuerpo).status_code == codigo


def test_ventas_lectura(cliente, monkeypatch):
    monkeypatch.setattr(db, "recompute", lambda conn, key: {"estado": "al_dia"})
    monkeypatch.setattr(db, "sales", lambda conn, key: {"ventas": [], "evaluacion": {"resumen": []}})
    assert cliente.get("/api/ventas").json()["evaluacion"] == {"resumen": []}


def test_catalogo_busca_y_da_de_alta_por_id(cliente, monkeypatch):
    catalogo = {}
    monkeypatch.setattr(db, "search_catalog", lambda conn, mk, q: [v for k, v in catalogo.items() if str(k) == q or q in v["nombre"].lower()])
    altas = []

    def alta(conn, mk, item_id, http_get):
        altas.append(item_id)
        if item_id == 7082:
            catalogo[7082] = {"id": 7082, "nombre": "Essence of Air"}
            return True
        return False
    monkeypatch.setattr(db, "add_to_catalog", alta)
    assert cliente.get("/api/catalogo", params={"q": ""}).json() == {"q": "", "resultados": []}
    assert cliente.get("/api/catalogo", params={"q": "7082"}).json()["resultados"][0]["nombre"] == "Essence of Air"
    cliente.get("/api/catalogo", params={"q": "7082"})
    assert altas == [7082]                        # la segunda vez ya estaba
    assert cliente.get("/api/catalogo", params={"q": "essence"}).json()["resultados"]
    assert altas == [7082]                        # un texto no dispara altas


def test_objeto_y_categorias(cliente, monkeypatch):
    monkeypatch.setattr(db, "item_sheet", lambda conn, mk, i: {"id": i, "en_catalogo": True} if i == 7082 else None)
    monkeypatch.setattr(db, "add_to_catalog", lambda *a: False)
    monkeypatch.setattr(db, "categories", lambda conn, mk: [{"clase": "Trade Goods", "n": 1, "subclases": []}])
    assert cliente.get("/api/objeto", params={"id": 7082}).json()["id"] == 7082
    assert cliente.get("/api/objeto", params={"id": 5}).status_code == 404
    assert cliente.get("/api/objeto", params={"id": "x"}).status_code == 422
    assert cliente.get("/api/categorias").json()[0]["clase"] == "Trade Goods"


def test_add_to_catalog_valida_la_respuesta_de_ahledger():
    class Conn:
        def __init__(self, mercado):
            self.mercado, self.sql = mercado, []

        def execute(self, sql, params=None):
            self.sql.append(sql)
            m = self.mercado
            return type("C", (), {"fetchone": lambda _s: m})()

    class Resp:
        def __init__(self, status, cuerpo):
            self.status_code, self._c = status, cuerpo

        def json(self):
            return self._c

    real = {"game_type": "forever", "is_demo": False}
    c = Conn(real)
    assert db.add_to_catalog(c, "ahl", 7082, lambda url: Resp(200, {"id": 7082, "name": "Essence of Air"})) is True
    assert any("guardar_catalogo" in s for s in c.sql)
    assert db.add_to_catalog(Conn(real), "ahl", 7082, lambda url: Resp(200, {"id": 1, "name": "Otro"})) is False
    assert db.add_to_catalog(Conn(real), "ahl", 7082, lambda url: Resp(404, None)) is False
    assert db.add_to_catalog(Conn({"game_type": "forever", "is_demo": True}), "demo", 7082, lambda url: 1 / 0) is False


class _Resp:
    def __init__(self, status, cuerpo):
        self.status_code, self._c = status, cuerpo

    def json(self):
        return self._c


def test_historial_ahledger_en_python():
    from app import fuentes
    pedidas = []
    cuerpo = {"market": "forever.pvp.horde.us", "latest": {"minBuyout": 13, "median": 28, "median90d": None},
              "series": [{"t": "2026-11-08T05:00:00.000Z", "min": 13, "median": 28, "quantity": 19400}],
              "sales": {"estimatedPerDay": 13893.1, "windowDays": 7}}
    h = fuentes.historial_ahledger(lambda url: pedidas.append(url) or _Resp(200, cuerpo),
                                   "https://api.ahledger.com/v1/pricetable/forever.pvp.horde.us", 2589, "30d")
    assert pedidas == ["https://api.ahledger.com/v1/prices/forever.pvp.horde.us/2589?range=30d"]
    assert h["puntos"] == [[1794114000000, 13, 28]] and h["cantidad"] == [[1794114000000, 19400]]
    assert h["paso_ms"] == 86_400_000 and h["ultimo"]["mediana90d"] is None
    assert h["atribucion"]["texto"] == "Prices from AHledger"
    with pytest.raises(fuentes.ErrorFuente):
        fuentes.historial_ahledger(lambda url: _Resp(200, {**cuerpo, "market": "otro"}),
                                   "https://api.ahledger.com/v1/pricetable/forever.pvp.horde.us", 1, "7d")
    vacio = fuentes.historial_ahledger(lambda url: _Resp(404, None),
                                       "https://api.ahledger.com/v1/pricetable/forever.pvp.horde.us", 1, "7d")
    assert vacio["puntos"] == [] and vacio["ultimo"] is None


def test_historial_fuente_endpoint(cliente):
    assert cliente.get("/api/historial-fuente", params={"id": 1, "rango": "1y"}).status_code == 400
    assert cliente.get("/api/historial-fuente", params={"id": 0}).status_code == 422


def test_paginas_nuevas_se_sirven(cliente):
    for archivo in ("/autocompletar.js", "/ruta.js", "/grafico.js"):
        r = cliente.get(archivo)
        assert r.status_code == 200 and "javascript" in r.headers["content-type"]
    html = cliente.get("/").text
    for id_ in ('id="buscador"', 'role="combobox"', 'id="lateral"', 'id="arbol-cat"', 'id="panel-ficha"', 'id="tbody"'):
        assert id_ in html


def test_una_sola_vista_de_mercado(cliente):
    """V3: sin pestañas superiores ni secciones retiradas en la página."""
    html = cliente.get("/").text
    for retirado in ('id="nav-secciones"', 'class="accesos"', 'data-vista=', 'id="form-calc"', 'id="inv-tbody"',
                     'href="#/inventario"', 'href="#/rentabilidad"', "Actualización solicitada"):
        assert retirado not in html
    seccion = html.split('class="lat-nav"', 1)[1].split("</nav>", 1)[0]
    assert html.count('aria-label="Sección"') == 1 and seccion.count("<a ") == 1 and 'aria-current="page"' in seccion


@pytest.mark.parametrize("cuerpo", [{"id": "1", "cambios": {}}, {"id": True, "cambios": {}}, {"id": 1}, {"id": 1, "cambios": []}])
def test_tasas_valida(cliente, cuerpo):
    assert cliente.post("/api/tasas", json=cuerpo).status_code == 400


@pytest.mark.parametrize("q", ["?base=media", "?objeto=0", "?objeto=abc", "?profesion=" + "x" * 41])
def test_recetas_valida(cliente, q):
    assert cliente.get("/api/recetas" + q).status_code == 422


def test_mercado_valida(cliente):
    assert cliente.get("/api/mercado", params={"solo_ofertas": "quizas"}).status_code == 400


def test_mercado_js_se_sirve(cliente):
    assert "javascript" in cliente.get("/mercado.js").headers["content-type"]


def test_profesiones_se_sirve(cliente):
    assert "javascript" in cliente.get("/recetas.js").headers["content-type"]


def test_calculadora_se_sirve(cliente):
    # La calculadora ya no está en la página (V3), pero su módulo se conserva.
    assert "javascript" in cliente.get("/rentabilidad.js").headers["content-type"]


def test_build_status_sin_datos():
    s = build_status(load_settings(environ=BASE_ENV), None, [])
    assert s["actualizacion"] == {"configurada": False}
    assert s["registro"] == []


