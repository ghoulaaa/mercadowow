"""Punto de arranque: `python -m app`."""

import sys

import uvicorn

from app.config import load_settings
from app.main import create_app


def main() -> None:
    try:
        settings = load_settings()
    except ValueError as exc:
        print(f"\nError en la configuración (.env): {exc}\n", file=sys.stderr)
        sys.exit(2)

    print(f"\n  Mercado WoW Forever — {settings.market_label}")
    print(f"  Datos en Supabase (proyecto {settings.project_ref})")
    print(f"  Abre en el navegador: http://{settings.host}:{settings.port}")
    print("  Para detenerlo: cierra esta ventana o pulsa Ctrl+C\n")
    uvicorn.run(create_app(settings), host=settings.host, port=settings.port, log_level="warning")


if __name__ == "__main__":
    main()
