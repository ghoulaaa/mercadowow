"""Servidor web local (FastAPI). Es la alternativa a Netlify para usar la página en tu PC.

Escucha solo en 127.0.0.1, así que no pide contraseña. Los datos viven en Supabase.
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from logging.handlers import RotatingFileHandler
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from app import __version__
from app import db
from app.config import Settings, load_settings

STATIC_DIR = Path(__file__).resolve().parent / "static"
log = logging.getLogger("mercado")
SIN_CACHE = {"Cache-Control": "no-store"}


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


def build_status(settings: Settings, estado: dict | None, pendientes: list[str]) -> dict:
    """Respuesta pública del panel. Nunca incluye credenciales."""
    base_de_datos = {"proveedor": "Supabase", "proyecto": settings.project_ref,
                     "migraciones_pendientes": pendientes}
    if estado is None:
        return {
            "app_version": __version__,
            "mercado": {"clave": settings.market, "nombre": settings.market_label},
            "actualizacion": {"configurada": False},
            "registro": [],
            "base_de_datos": base_de_datos,
        }
    return {**estado, "app_version": __version__, "base_de_datos": base_de_datos}


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
    def estado():
        try:
            with db.connect(settings.database_url) as conn:
                pendientes = db.pending_migrations(conn)
                datos = None if pendientes else db.market_status(conn, settings.market)
        except Exception as exc:  # sin conexión: el panel lo muestra en vez de romperse
            log.warning("No se pudo leer el estado: %s", exc)
            return JSONResponse(status_code=503, headers=SIN_CACHE, content={
                "error": "No se pudo conectar con Supabase",
                "detalle": type(exc).__name__,
            })
        return JSONResponse(build_status(settings, datos, pendientes), headers=SIN_CACHE)

    @app.post("/api/actualizar")
    def actualizar():
        try:
            with db.connect(settings.database_url) as conn:
                r = db.request_update(conn, settings.market)
        except Exception as exc:
            log.warning("Fallo al pedir actualización: %s", exc)
            return JSONResponse(status_code=503, content={"error": "No se pudo conectar con Supabase"})
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

    # La misma carpeta que publica Netlify: index.html, app.js, styles.css.
    app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")
    return app
