# Mercado WoW Forever (US · PvP · Horda)

App web personal para decidir qué objetos **VENDER**, **GUARDAR** o dejar **EN OBSERVACIÓN**.
El plan completo y las fuentes verificadas están en [PLAN.md](PLAN.md).

> **Estado: Hitos 1 y 2 terminados.** Supabase descarga los datos reales de TSM cada hora.
> Los datos y la consulta horaria a TSM viven en **Supabase**. La página web corre en tu PC.

## Instalar (una sola vez, en Windows)

1. Instala **Python 3.12+** ([python.org](https://www.python.org/downloads/)) marcando **«Add python.exe to PATH»**.
2. Instala **Node.js LTS** ([nodejs.org](https://nodejs.org)). Se usa para desplegar la función en Supabase.
3. Doble clic en **`instalar.bat`**.
4. Sigue **[docs/SUPABASE.md](docs/SUPABASE.md)**: crea el proyecto, rellena `.env` y ejecuta **`configurar.bat`**.

## Uso diario

- Doble clic en **`iniciar.bat`** y abre **http://127.0.0.1:8000**.
- La consulta horaria **no depende de tu PC**: la hace Supabase.

## Configuración (`.env`)

| Variable | Qué es |
|---|---|
| `DATABASE_URL` | Cadena «Session pooler» de Supabase con tu contraseña. **Secreta.** |
| `SUPABASE_URL` | `https://xxxx.supabase.co` |
| `HOST` / `PUERTO` | Dónde escucha la página local (`127.0.0.1:8000`) |
| `MERCADO` | `tsm:forever:us:pvp-horde` |
| `RUTA_LOGS` | Registro de la página local |

Los ajustes de la consulta (intervalo de 60 min, protección de 5 min del botón manual, reintentos 5 → 10 → 20 → 40 → 60 min) están en la tabla `settings` de la base de datos.

## Pruebas

Doble clic en **`pruebas.bat`**. Ejecuta dos grupos de pruebas:
- **Python** (`tests/`): configuración, estado, botón manual y que la contraseña nunca llegue al navegador.
- **Node + PGlite** (`supabase/pruebas/`): el SQL real contra un Postgres en memoria. Cubre la descarga, el 304, los duplicados, los fallos y reintentos, la separación de mercados y la protección del botón.

## Estructura

```
app/                      página web local (Python/FastAPI)
  configurar.py           configura Supabase de principio a fin
db/migraciones/           esquema SQL (0001 Postgres estándar, 0002 específico de Supabase)
supabase/functions/
  actualizar-mercado/     Edge Function: descarga TSM con ETag y guarda
supabase/pruebas/         pruebas de la función y del SQL
tests/                    pruebas del servidor Python
docs/SUPABASE.md          guía de creación del proyecto
```
