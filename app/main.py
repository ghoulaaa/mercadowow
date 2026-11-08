"""Servidor web (FastAPI): interfaz y API. Los datos viven en Supabase."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from logging.handlers import RotatingFileHandler
from pathlib import Path

import httpx
from fastapi import BackgroundTasks, FastAPI, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from app import __version__
from app import db
from app.config import Settings, load_settings

STATIC_DIR = Path(__file__).resolve().parent / "static"
log = logging.getLogger("mercado")


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


def _iso(value) -> str | None:
    return value.isoformat().replace("+00:00", "Z") if value is not None else None


def build_status(settings: Settings, row: dict | None, pendientes: list[str]) -> dict:
    """Convierte la fila de la BD en la respuesta pública. Nunca incluye credenciales."""
    base = {
        "app_version": __version__,
        "base_de_datos": {"proveedor": "Supabase", "proyecto": settings.project_ref,
                          "migraciones_pendientes": pendientes},
    }
    if row is None:
        base["mercado"] = {"clave": settings.market, "nombre": settings.market_label}
        base["actualizacion"] = {"configurada": False}
        return base
    base["hora_servidor"] = _iso(row["hora_bd"])
    base["mercado"] = {
        "clave": row["key"], "nombre": row["label"],
        "proveedor": row["provider"].upper(), "ficticio": row["is_demo"],
        "fuente": row["source_url"],
    }
    base["actualizacion"] = {
        "configurada": bool(row["programada"]),
        "en_curso": bool(row["en_curso"]),
        "hora_dato_original": _iso(row["last_source_updated_at"]),
        "ultima_consulta_ok": _iso(row["last_success_at"]),
        "ultimo_dato_nuevo": _iso(row["last_new_data_at"]),
        "ultimo_intento": _iso(row["last_attempt_at"]),
        "proxima": _iso(row["next_attempt_at"]),  # null = en cuanto se pueda
        "fallos_seguidos": row["consecutive_failures"],
        "ultimo_error": row["last_error"],
        "ultimo_error_hora": _iso(row["last_error_at"]),
        "versiones_guardadas": row["versiones"],
        "objetos": row["objetos"],
    }
    base["registro"] = [
        {"hora": _iso(r["finished_at"]), "estado": r["status"], "http": r["http_status"],
         "filas": r["rows_received"], "mensaje": r["message"]}
        for r in row["registro"]
    ]
    return base


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
    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

    @app.get("/", include_in_schema=False)
    def index() -> FileResponse:
        return FileResponse(STATIC_DIR / "index.html")

    @app.get("/api/estado")
    def estado():
        try:
            with db.connect(settings.database_url) as conn:
                pendientes = db.pending_migrations(conn)
                row = None if pendientes else db.market_status(conn, settings.market)
        except Exception as exc:  # sin conexión: el panel lo muestra en vez de romperse
            log.warning("No se pudo leer el estado: %s", exc)
            return JSONResponse(status_code=503, content={
                "error": "No se pudo conectar con Supabase",
                "detalle": type(exc).__name__,
            })
        return build_status(settings, row, pendientes)

    def _invocar_funcion() -> None:
        try:
            r = httpx.post(settings.function_url, json={}, timeout=90)
            log.info("Actualización manual: HTTP %s %s", r.status_code, r.text[:300])
        except httpx.HTTPError as exc:
            # El programador de Supabase la recogerá en ≤5 min igualmente.
            log.warning("No se pudo invocar la función: %s", exc)

    @app.post("/api/actualizar")
    def actualizar(tareas: BackgroundTasks):
        try:
            with db.connect(settings.database_url) as conn:
                r = db.request_update(conn, settings.market)
        except Exception as exc:
            log.warning("Fallo al pedir actualización: %s", exc)
            raise HTTPException(503, "No se pudo conectar con Supabase") from exc
        if not r.get("ok"):
            mensajes = {
                "en_curso": "Ya hay una actualización en curso.",
                "espera": f"Espera {r.get('segundos', 0)} s antes de volver a pedirla.",
                "mercado_sin_fuente": "Este mercado no tiene descarga automática.",
            }
            return JSONResponse(status_code=429 if r.get("motivo") == "espera" else 409,
                                content={**r, "mensaje": mensajes.get(r.get("motivo"), "No disponible")})
        tareas.add_task(_invocar_funcion)
        return JSONResponse(status_code=202, content={"ok": True, "mensaje": "Actualización solicitada."})

    return app
