"""Servidor web local (FastAPI). Es la alternativa a Netlify para usar la página en tu PC.

Escucha solo en 127.0.0.1, así que no pide contraseña. Los datos viven en Supabase.
"""

from __future__ import annotations

import logging
import mimetypes
from contextlib import asynccontextmanager
from logging.handlers import RotatingFileHandler
from pathlib import Path

import httpx
import psycopg
from psycopg.types.json import Jsonb
from fastapi import Body, FastAPI, Query
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from app import __version__
from app import db, fuentes
from app.config import Settings, load_settings

STATIC_DIR = Path(__file__).resolve().parent / "static"
# Windows a veces registra .js como text/plain y el navegador rechaza los módulos.
mimetypes.add_type("text/javascript", ".js")
log = logging.getLogger("mercado")
SIN_CACHE = {"Cache-Control": "no-store"}
SIN_CONEXION = {"error": "No se pudo conectar con Supabase"}


def setup_logging(log_dir: Path) -> None:
    log_dir.mkdir(parents=True, exist_ok=True)
    if any(isinstance(h, RotatingFileHandler) for h in log.handlers):
        return
    handler = RotatingFileHandler(
        log_dir / "app.log", maxBytes=1_000_000, backupCount=5, encoding="utf-8"
    )
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s"))
    log.addHandler(handler)
    log.setLevel(logging.INFO)


def build_status(settings: Settings, estado: dict | None, pendientes: list[str],
                 mercados: list[dict] | None = None) -> dict:
    """Respuesta pública del panel. Nunca incluye credenciales."""
    base_de_datos = {"proveedor": "Supabase", "proyecto": settings.project_ref,
                     "migraciones_pendientes": pendientes}
    if estado is None:
        return {
            "app_version": __version__,
            "mercado": {"clave": settings.market, "nombre": settings.market_label},
            "actualizacion": {"configurada": False},
            "registro": [],
            "mercados": [],
            "mercado_principal": settings.market,
            "base_de_datos": base_de_datos,
        }
    return {**estado, "app_version": __version__, "mercados": mercados or [],
            "mercado_principal": settings.market, "base_de_datos": base_de_datos}


def _error_validacion(exc: Exception) -> JSONResponse | None:
    """Los `raise exception` de las funciones SQL son errores de validación: se muestran tal cual."""
    if isinstance(exc, psycopg.errors.RaiseException):
        return JSONResponse(status_code=422, content={"error": exc.diag.message_primary})
    return None


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or load_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        setup_logging(settings.log_dir)
        log.info("Inicio: mercado=%s proyecto=%s", settings.market, settings.project_ref)
        yield
        log.info("Apagado")

    app = FastAPI(title="Mercado WoW Forever", version=__version__, lifespan=lifespan)
    app.state.settings = settings

    @app.get("/api/estado")
    def estado(mercado: str | None = Query(default=None, max_length=100)):
        clave = mercado or settings.market
        try:
            with db.connect(settings.database_url) as conn:
                pendientes = db.pending_migrations(conn)
                datos = mercados = None
                if not pendientes:
                    datos = db.market_status(conn, clave)
                    mercados = db.list_markets(conn)
        except Exception as exc:  # sin conexión: el panel lo muestra en vez de romperse
            log.warning("No se pudo leer el estado: %s", exc)
            return JSONResponse(status_code=503, headers=SIN_CACHE,
                                content={**SIN_CONEXION, "detalle": type(exc).__name__})
        if not pendientes and datos is None:
            return JSONResponse(status_code=404, content={"error": f"Mercado {clave} no registrado"})
        return JSONResponse(build_status(settings, datos, pendientes, mercados), headers=SIN_CACHE)

    @app.post("/api/actualizar")
    def actualizar(cuerpo: dict | None = Body(default=None)):
        mercado = (cuerpo or {}).get("mercado") or settings.market
        if not isinstance(mercado, str) or len(mercado) > 100:
            return JSONResponse(status_code=400, content={"error": "Mercado no válido"})
        try:
            with db.connect(settings.database_url) as conn:
                r = db.request_update(conn, mercado)
        except Exception as exc:
            log.warning("Fallo al pedir actualización: %s", exc)
            return JSONResponse(status_code=503, content=SIN_CONEXION)
        if not r.get("ok"):
            mensajes = {
                "en_curso": "Ya hay una actualización en curso.",
                "espera": f"Espera {r.get('segundos', 0)} s antes de volver a pedirla.",
                "mercado_sin_fuente": "Este mercado no tiene descarga automática.",
            }
            return JSONResponse(status_code=429 if r.get("motivo") == "espera" else 409,
                                content={**r, "mensaje": mensajes.get(r.get("motivo"), "No disponible")})
        log.info("Actualización manual solicitada")
        return JSONResponse(status_code=202, content={"ok": True, "mensaje": "Actualización solicitada."})

    @app.post("/api/importar")
    def importar(cuerpo: dict = Body(...)):
        if not isinstance(cuerpo.get("mercado"), str) or not isinstance(cuerpo.get("hora_dato"), str) \
                or not isinstance(cuerpo.get("filas"), list):
            return JSONResponse(status_code=400, content={"error": "Faltan mercado, hora_dato o filas"})
        try:
            with db.connect(settings.database_url) as conn:
                r = db.import_prices(conn, cuerpo["mercado"], cuerpo["hora_dato"], cuerpo["filas"],
                                     str(cuerpo.get("nombre_archivo") or "sin nombre"))
        except Exception as exc:
            if (resp := _error_validacion(exc)) is not None:
                return resp
            log.warning("Fallo al importar: %s", exc)
            return JSONResponse(status_code=503, content=SIN_CONEXION)
        log.info("Importación CSV: %s", r)
        return r

    @app.get("/api/precios")
    def precios(mercado: str | None = Query(default=None, max_length=100)):
        clave = mercado or settings.market
        try:
            with db.connect(settings.database_url) as conn:
                version = db.market_version(conn, clave)
                if version is None:
                    return JSONResponse(status_code=404, content={"error": f"Mercado {clave} no registrado"})
                motor = db.recompute(conn, clave)
                objetos = db.price_table(conn, clave)
                resumen = db.recommendations_summary(conn, clave)
        except Exception as exc:
            log.warning("Fallo al leer precios: %s", exc)
            return JSONResponse(status_code=503, content=SIN_CONEXION)
        return JSONResponse({"mercado": clave, "version": version, "motor": motor, "resumen": resumen,
                             "objetos": objetos}, headers=SIN_CACHE)

    @app.get("/api/explicacion")
    def explicacion(id: int = Query(gt=0), mercado: str | None = Query(default=None, max_length=100)):
        clave = mercado or settings.market
        try:
            with db.connect(settings.database_url) as conn:
                db.recompute(conn, clave)
                r = db.explain(conn, clave, id)
        except Exception as exc:
            if (resp := _error_validacion(exc)) is not None:
                return resp
            log.warning("Fallo al explicar: %s", exc)
            return JSONResponse(status_code=503, content=SIN_CONEXION)
        if r is None:
            return JSONResponse(status_code=404, content={"error": "Objeto sin recomendación en este mercado"})
        return JSONResponse(r, headers=SIN_CACHE)

    @app.get("/api/historial")
    def historial(id: int = Query(gt=0), dias: int = Query(default=30, ge=1, le=60),
                  mercado: str | None = Query(default=None, max_length=100)):
        try:
            with db.connect(settings.database_url) as conn:
                return JSONResponse(db.price_history(conn, mercado or settings.market, id, dias), headers=SIN_CACHE)
        except Exception as exc:
            log.warning("Fallo al leer historial: %s", exc)
            return JSONResponse(status_code=503, content=SIN_CONEXION)

    @app.get("/api/inventario")
    def inventario_leer(mercado: str | None = Query(default=None, max_length=100)):
        clave = mercado or settings.market
        try:
            with db.connect(settings.database_url) as conn:
                db.recompute(conn, clave)
                return JSONResponse(db.inventory(conn, clave), headers=SIN_CACHE)
        except Exception as exc:
            if (resp := _error_validacion(exc)) is not None:
                return resp
            log.warning("Fallo al leer inventario: %s", exc)
            return JSONResponse(status_code=503, content=SIN_CONEXION)

    @app.post("/api/inventario")
    def inventario_cambiar(c: dict = Body(...)):
        def entero(v):
            return isinstance(v, int) and not isinstance(v, bool)

        coste_ok = c.get("coste") is None or entero(c.get("coste"))
        accion = c.get("accion")
        validos = {
            "agregar": entero(c.get("item_id")) and entero(c.get("cantidad")) and coste_ok,
            "editar": entero(c.get("id")) and entero(c.get("cantidad")) and coste_ok,
            "borrar": entero(c.get("id")),
            "importar": isinstance(c.get("filas"), list),
        }
        if not isinstance(c.get("mercado"), str) or accion not in validos:
            return JSONResponse(status_code=400, content={"error": "Falta mercado o la acción es desconocida"})
        if not validos[accion]:
            return JSONResponse(status_code=400, content={"error": "Datos del lote no válidos"})
        try:
            with db.connect(settings.database_url) as conn:
                return db.inventory_action(conn, c)
        except Exception as exc:
            if (resp := _error_validacion(exc)) is not None:
                return resp
            log.warning("Fallo en inventario: %s", exc)
            return JSONResponse(status_code=503, content=SIN_CONEXION)

    @app.get("/api/ventas")
    def ventas_leer(mercado: str | None = Query(default=None, max_length=100)):
        clave = mercado or settings.market
        try:
            with db.connect(settings.database_url) as conn:
                db.recompute(conn, clave)
                return JSONResponse(db.sales(conn, clave), headers=SIN_CACHE)
        except Exception as exc:
            if (resp := _error_validacion(exc)) is not None:
                return resp
            log.warning("Fallo al leer ventas: %s", exc)
            return JSONResponse(status_code=503, content=SIN_CONEXION)

    @app.post("/api/ventas")
    def ventas_cambiar(c: dict = Body(...)):
        def entero(v):
            return isinstance(v, int) and not isinstance(v, bool)

        def opcional(v):
            return v is None or entero(v)

        accion = c.get("accion")
        if not isinstance(c.get("mercado"), str) or accion not in ("registrar", "borrar"):
            return JSONResponse(status_code=400, content={"error": "Falta mercado o la acción es desconocida"})
        ok = (entero(c.get("item_id")) and entero(c.get("cantidad")) and entero(c.get("precio"))
              and isinstance(c.get("vendido_en"), str) and opcional(c.get("comision"))
              and opcional(c.get("deposito")) and opcional(c.get("lote_id"))) if accion == "registrar" \
            else entero(c.get("id"))
        if not ok:
            return JSONResponse(status_code=400, content={"error": "Datos de la venta no válidos"})
        try:
            with db.connect(settings.database_url) as conn:
                return db.sales_action(conn, c)
        except Exception as exc:
            if (resp := _error_validacion(exc)) is not None:
                return resp
            log.warning("Fallo en ventas: %s", exc)
            return JSONResponse(status_code=503, content=SIN_CONEXION)

    def _http_get(url: str):
        return httpx.get(url, timeout=20, headers={"User-Agent": "mercadowow/0.1 (uso personal)"})

    @app.get("/api/historial-fuente")
    def historial_fuente(id: int = Query(gt=0), rango: str = Query(default="7d"),
                         mercado: str | None = Query(default=None, max_length=100)):
        clave = mercado or settings.market
        if rango not in fuentes.RANGOS:
            return JSONResponse(status_code=400, content={"error": f"rango debe ser {', '.join(fuentes.RANGOS)}"})
        try:
            with db.connect(settings.database_url) as conn:
                m = conn.execute("select provider, source_url from markets where key = %s", (clave,)).fetchone()
                if m is None:
                    return JSONResponse(status_code=404, content={"error": f"Mercado {clave} no registrado"})
                if m["provider"] == "ahledger":
                    datos = fuentes.historial_ahledger(_http_get, m["source_url"], id, rango)
                else:
                    dias = {"24h": 1, "7d": 7, "30d": 30, "90d": 60}[rango]
                    datos = fuentes.historial_propio(db.price_history(conn, clave, id, dias), rango)
        except fuentes.ErrorFuente as exc:
            return JSONResponse(status_code=502, content={"error": str(exc)})
        except Exception as exc:
            log.warning("Fallo al leer historial de la fuente: %s", exc)
            return JSONResponse(status_code=503, content=SIN_CONEXION)
        return JSONResponse(datos, headers={"Cache-Control": "private, max-age=300"})

    @app.get("/api/catalogo")
    def catalogo(q: str = Query(default="", max_length=200), mercado: str | None = Query(default=None, max_length=100)):
        clave, texto = mercado or settings.market, q.strip()[:80]
        if not texto:
            return {"q": texto, "resultados": []}
        try:
            with db.connect(settings.database_url) as conn:
                res = db.search_catalog(conn, clave, texto)
                if texto.isdigit() and len(texto) <= 9 and not any(r["id"] == int(texto) for r in res):
                    if db.add_to_catalog(conn, clave, int(texto), _http_get):
                        res = db.search_catalog(conn, clave, texto)
        except Exception as exc:
            log.warning("Fallo al buscar en el catálogo: %s", exc)
            return JSONResponse(status_code=503, content=SIN_CONEXION)
        return JSONResponse({"q": texto, "resultados": res}, headers=SIN_CACHE)

    @app.get("/api/objeto")
    def objeto(id: int = Query(gt=0), mercado: str | None = Query(default=None, max_length=100)):
        clave = mercado or settings.market
        try:
            with db.connect(settings.database_url) as conn:
                f = db.item_sheet(conn, clave, id)
                if not (f and f.get("en_catalogo")) and db.add_to_catalog(conn, clave, id, _http_get):
                    f = db.item_sheet(conn, clave, id)
        except Exception as exc:
            log.warning("Fallo al leer la ficha: %s", exc)
            return JSONResponse(status_code=503, content=SIN_CONEXION)
        if f is None:
            return JSONResponse(status_code=404, content={"error": "Ese objeto no existe en el catálogo ni en AHledger"})
        return JSONResponse(f, headers=SIN_CACHE)

    @app.get("/api/categorias")
    def categorias(mercado: str | None = Query(default=None, max_length=100)):
        try:
            with db.connect(settings.database_url) as conn:
                return JSONResponse(db.categories(conn, mercado or settings.market), headers=SIN_CACHE)
        except Exception as exc:
            log.warning("Fallo al leer categorías: %s", exc)
            return JSONResponse(status_code=503, content=SIN_CONEXION)

    @app.get("/api/recetas")
    def recetas(mercado: str | None = Query(default=None, max_length=100),
                profesion: str | None = Query(default=None, max_length=40),
                objeto: int | None = Query(default=None, gt=0),
                base: str = Query(default="mediana", pattern="^(mediana|minimo)$")):
        clave = mercado or settings.market
        try:
            with db.connect(settings.database_url) as conn:
                r = db.recipes(conn, clave, profesion=profesion, objeto=objeto, base=base)
        except Exception as exc:
            if (resp := _error_validacion(exc)) is not None:
                return resp
            log.warning("Fallo al leer recetas: %s", exc)
            return JSONResponse(status_code=503, content=SIN_CONEXION)
        return JSONResponse(r, headers=SIN_CACHE)

    @app.get("/api/tasas")
    def tasas_leer():
        try:
            with db.connect(settings.database_url) as conn:
                r = conn.execute("select leer_tasas('forever') as r").fetchone()["r"]
        except Exception as exc:
            log.warning("Fallo al leer tasas: %s", exc)
            return JSONResponse(status_code=503, content=SIN_CONEXION)
        return JSONResponse(r, headers=SIN_CACHE)

    @app.post("/api/tasas")
    def tasas_guardar(c: dict = Body(...)):
        if not (isinstance(c.get("id"), int) and not isinstance(c.get("id"), bool)) or not isinstance(c.get("cambios"), dict):
            return JSONResponse(status_code=400, content={"error": "Faltan id o cambios"})
        try:
            with db.connect(settings.database_url) as conn, conn.transaction():
                r = conn.execute("select guardar_tasa(%s::smallint, %s::jsonb) as r",
                                 (c["id"], Jsonb(c["cambios"]))).fetchone()["r"]
        except Exception as exc:
            if (resp := _error_validacion(exc)) is not None:
                return resp
            log.warning("Fallo al guardar tasa: %s", exc)
            return JSONResponse(status_code=503, content=SIN_CONEXION)
        log.info("Regla de comisión/depósito cambiada: %s", c)
        return r

    @app.get("/api/ajustes")
    def ajustes_leer():
        try:
            with db.connect(settings.database_url) as conn:
                return JSONResponse(db.read_settings(conn), headers=SIN_CACHE)
        except Exception as exc:
            log.warning("Fallo al leer ajustes: %s", exc)
            return JSONResponse(status_code=503, content=SIN_CONEXION)

    @app.post("/api/ajustes")
    def ajustes_guardar(cuerpo: dict = Body(...)):
        try:
            with db.connect(settings.database_url) as conn:
                r = db.save_settings(conn, cuerpo)
        except Exception as exc:
            if (resp := _error_validacion(exc)) is not None:
                return resp
            log.warning("Fallo al guardar ajustes: %s", exc)
            return JSONResponse(status_code=503, content=SIN_CONEXION)
        log.info("Ajustes del motor cambiados: %s", cuerpo)
        return r

    @app.get("/api/version")
    def version(mercado: str | None = Query(default=None, max_length=100)):
        clave = mercado or settings.market
        try:
            with db.connect(settings.database_url) as conn:
                v = db.market_version(conn, clave)
        except Exception as exc:
            log.warning("Fallo al leer versión: %s", exc)
            return JSONResponse(status_code=503, content=SIN_CONEXION)
        if v is None:
            return JSONResponse(status_code=404, content={"error": f"Mercado {clave} no registrado"})
        return JSONResponse(v, headers=SIN_CACHE)

    @app.post("/api/favorito")
    def favorito(cuerpo: dict = Body(...)):
        mercado, item, fav = cuerpo.get("mercado"), cuerpo.get("id"), cuerpo.get("favorito")
        if not isinstance(mercado, str) or not isinstance(fav, bool) \
                or not isinstance(item, int) or isinstance(item, bool):
            return JSONResponse(status_code=400, content={"error": "Faltan mercado, id o favorito"})
        try:
            with db.connect(settings.database_url) as conn:
                return db.set_favorite(conn, mercado, item, fav)
        except Exception as exc:
            if (resp := _error_validacion(exc)) is not None:
                return resp
            log.warning("Fallo al marcar favorito: %s", exc)
            return JSONResponse(status_code=503, content=SIN_CONEXION)

    @app.post("/api/demo")
    def demo(cuerpo: dict | None = Body(default=None)):
        dias = (cuerpo or {}).get("dias", 30)
        if not isinstance(dias, int) or not 1 <= dias <= 60:
            return JSONResponse(status_code=400, content={"error": "dias debe estar entre 1 y 60"})
        try:
            with db.connect(settings.database_url) as conn:
                return db.generate_demo(conn, dias)
        except Exception as exc:
            if (resp := _error_validacion(exc)) is not None:
                return resp
            log.warning("Fallo al generar demo: %s", exc)
            return JSONResponse(status_code=503, content=SIN_CONEXION)

    # La misma carpeta que publica Netlify: index.html, app.js, styles.css…
    # «no-cache» = el navegador revalida cada archivo: tras una actualización nunca mezcla
    # una página nueva con un JavaScript viejo (Netlify ya lo hace así por defecto).
    class EstaticosSinCache(StaticFiles):
        async def get_response(self, path, scope):
            resp = await super().get_response(path, scope)
            resp.headers["Cache-Control"] = "no-cache"
            return resp

    app.mount("/", EstaticosSinCache(directory=STATIC_DIR, html=True), name="static")
    return app
