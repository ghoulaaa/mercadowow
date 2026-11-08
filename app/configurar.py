"""Configura Supabase de principio a fin: `python -m app.configurar`.

1. Comprueba la conexión a la base de datos.
2. Aplica las migraciones pendientes (tablas, funciones, seguridad, programación).
3. Despliega la Edge Function con la CLI de Supabase (pide iniciar sesión si hace falta).
4. Activa la programación y lanza la primera consulta real a TSM.

Se puede ejecutar varias veces sin problema: lo ya hecho no se repite.
"""

from __future__ import annotations

import shutil
import subprocess
import sys

import httpx

from app import db
from app.config import BASE_DIR, FUNCION, load_settings

CLI = "supabase@3.0.0"


def paso(n: int, texto: str) -> None:
    print(f"\n[{n}/4] {texto}")


def npx(*args: str) -> int:
    exe = shutil.which("npx") or shutil.which("npx.cmd")
    if exe is None:
        print("  [ERROR] No se encontró Node.js (npx). Instálalo desde nodejs.org.")
        return 127
    return subprocess.call([exe, "--yes", CLI, *args], cwd=BASE_DIR)


def desplegar(project_ref: str) -> bool:
    # --yes: quien ejecuta configurar.bat ya está pidiendo desplegar (la CLI 3 pide confirmación).
    base = ["functions", "deploy", FUNCION, f"--remote={project_ref}", "--no-verify-jwt", "--yes"]
    if npx(*base, "--use-api") == 0 or npx(*base) == 0:
        return True
    print("\n  Hace falta iniciar sesión en Supabase. Se abrirá el navegador:")
    if npx("login") != 0:
        return False
    return npx(*base, "--use-api") == 0 or npx(*base) == 0


def main() -> int:
    try:
        s = load_settings()
    except ValueError as exc:
        print(f"\n[ERROR] Configuración: {exc}")
        return 2

    paso(1, f"Conectando con Supabase (proyecto {s.project_ref})…")
    try:
        conn = db.connect(s.database_url)
    except Exception as exc:
        print(f"  [ERROR] No se pudo conectar: {type(exc).__name__}: {exc}")
        print("  Revisa DATABASE_URL en .env (usa la cadena «Session pooler») y tu contraseña.")
        return 1
    with conn:
        version = conn.execute("show server_version").fetchone()["server_version"]
        print(f"  OK · Postgres {version}")

        paso(2, "Aplicando migraciones…")
        aplicadas = db.apply_migrations(conn)
        print("  " + (f"Aplicadas: {', '.join(aplicadas)}" if aplicadas else "Nada pendiente"))

        paso(3, f"Desplegando la Edge Function «{FUNCION}»…")
        if not desplegar(s.project_ref):
            print("  [ERROR] No se pudo desplegar. Mira el mensaje de arriba o la guía docs/SUPABASE.md.")
            return 1
        try:
            r = httpx.get(s.function_url, timeout=30)
        except httpx.HTTPError as exc:
            print(f"  [ERROR] La función no responde: {exc}")
            return 1
        if r.status_code != 405:  # nuestra función solo acepta POST
            print(f"  [ERROR] Respuesta inesperada de la función: HTTP {r.status_code}")
            return 1
        print("  OK · La función responde")

        paso(4, "Activando la consulta automática y lanzando la primera…")
        conn.execute(
            "insert into settings (key, value) values ('url_funcion', %s) "
            "on conflict (key) do update set value = excluded.value",
            (s.function_url,),
        )
        r = httpx.post(s.function_url, json={}, timeout=120)
        print(f"  Respuesta: HTTP {r.status_code} · {r.text[:400]}")
        estado = db.market_status(conn, s.market)

    a = estado["actualizacion"]
    print("\n=== Resumen ===")
    print(f"  Mercado:                {estado['mercado']['nombre']}")
    print(f"  Hora del dato original: {a['hora_dato_original']}")
    print(f"  Objetos guardados:      {a['objetos']}")
    print(f"  Próxima consulta:       {a['proxima']}")
    print("\nListo. Supabase consultará TSM solo, aunque tu PC esté apagado.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
