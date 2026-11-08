"""Configuración leída de variables de entorno y del archivo .env.

Orden de prioridad: variable de entorno real > archivo .env > valor por defecto.
Las credenciales (DATABASE_URL) solo viven aquí, en el servidor; nunca se envían
al navegador ni se escriben en los registros.
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlsplit

BASE_DIR = Path(__file__).resolve().parent.parent
GUIA = "docs/SUPABASE.md"
FUNCION = "actualizar-mercado"

# Mercados reales conocidos. Un mercado nuevo exige añadirlo aquí y en la base de
# datos a propósito: nada se mezcla por accidente.
KNOWN_MARKETS = {
    "ahledger:forever:us:pvp-horde": "WoW Forever · US · PvP · Horda (AHledger)",
    "tsm:forever:us:pvp-horde": "WoW Forever · US · PvP · Horda (TSM)",
}
MERCADO_POR_DEFECTO = "ahledger:forever:us:pvp-horde"


def parse_env_file(path: Path) -> dict[str, str]:
    """Lee un archivo .env sencillo (CLAVE=valor). Ignora líneas vacías y comentarios."""
    values: dict[str, str] = {}
    if not path.is_file():
        return values
    for raw in path.read_text(encoding="utf-8-sig").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        values[key.strip()] = value
    return values


def _resolve(path_value: str) -> Path:
    path = Path(path_value)
    return path if path.is_absolute() else (BASE_DIR / path).resolve()


def _to_int(name: str, value: str) -> int:
    try:
        return int(value)
    except ValueError as exc:
        raise ValueError(f"{name} debe ser un número entero (valor recibido: {value!r})") from exc


def _check_database_url(url: str) -> str:
    if not url:
        raise ValueError(f"Falta DATABASE_URL en .env. Sigue la guía {GUIA}.")
    if not url.startswith(("postgresql://", "postgres://")):
        raise ValueError("DATABASE_URL debe empezar por postgresql:// (cadena de conexión de Supabase)")
    if "[YOUR-PASSWORD]" in url or "[TU-CONTRASEÑA]" in url:
        raise ValueError("En DATABASE_URL falta poner tu contraseña en lugar de [YOUR-PASSWORD]")
    if "xxxxxxxx" in url:
        raise ValueError("DATABASE_URL todavía es el ejemplo (postgres.xxxxxxxx): copia la cadena real de Supabase")
    if re.search(r":\[[^@]*\]@", url):
        raise ValueError("En DATABASE_URL quita los corchetes [ ] alrededor de la contraseña")
    return url


def _check_same_project(database_url: str, supabase_url: str) -> None:
    """La base de datos y la URL del proyecto deben ser del MISMO proyecto Supabase."""
    m = re.match(r"^postgres(?:ql)?://postgres\.([a-z0-9]+):", database_url)
    ref = re.match(r"https://([a-z0-9]+)\.supabase\.co", supabase_url).group(1)
    if m and m.group(1) != ref:
        raise ValueError(
            f"DATABASE_URL es del proyecto {m.group(1)!r} pero SUPABASE_URL es del proyecto {ref!r}"
        )


def _check_supabase_url(url: str) -> str:
    if not url:
        raise ValueError(f"Falta SUPABASE_URL en .env. Sigue la guía {GUIA}.")
    url = url.rstrip("/")
    # El panel a veces muestra la URL de la API REST: nos quedamos con la base del proyecto.
    url = re.sub(r"/rest/v1$", "", url)
    if not re.fullmatch(r"https://[a-z0-9]+\.supabase\.co", url):
        raise ValueError(f"SUPABASE_URL debe tener la forma https://xxxx.supabase.co (recibido: {url!r})")
    return url


@dataclass(frozen=True)
class Settings:
    host: str
    port: int
    market: str
    database_url: str = field(repr=False)   # nunca se imprime
    supabase_url: str
    log_dir: Path

    @property
    def market_label(self) -> str:
        return KNOWN_MARKETS[self.market]

    @property
    def project_ref(self) -> str:
        return urlsplit(self.supabase_url).hostname.split(".")[0]

    @property
    def function_url(self) -> str:
        return f"{self.supabase_url}/functions/v1/{FUNCION}"


def load_settings(env_file: Path | None = None, environ: dict[str, str] | None = None) -> Settings:
    env_file = env_file if env_file is not None else BASE_DIR / ".env"
    merged = parse_env_file(env_file)
    merged.update(environ if environ is not None else os.environ)

    def get(name: str, default: str = "") -> str:
        return merged.get(name, default).strip() or default

    market = get("MERCADO", MERCADO_POR_DEFECTO)
    if market not in KNOWN_MARKETS:
        raise ValueError(
            f"MERCADO={market!r} no es un mercado conocido. Opciones: {', '.join(KNOWN_MARKETS)}"
        )

    port = _to_int("PUERTO", get("PUERTO", "8000"))
    if not 1 <= port <= 65535:
        raise ValueError(f"PUERTO fuera de rango: {port}")

    database_url = _check_database_url(get("DATABASE_URL"))
    supabase_url = _check_supabase_url(get("SUPABASE_URL"))
    _check_same_project(database_url, supabase_url)

    return Settings(
        host=get("HOST", "127.0.0.1"),
        port=port,
        market=market,
        database_url=database_url,
        supabase_url=supabase_url,
        log_dir=_resolve(get("RUTA_LOGS", "logs")),
    )
