# Guía: crear y conectar tu proyecto Supabase

Tiempo aproximado: 10 minutos. Hay que crear la cuenta y el proyecto a mano: Claude no puede crear cuentas ni escribir contraseñas.

## Cómo queda montado

```
 Supabase (en la nube, 24 h)                         Tu PC
 ┌──────────────────────────────────────┐            ┌───────────────────────┐
 │ pg_cron: cada 5 min, ¿toca consultar?│            │ iniciar.bat           │
 │      │ sí (cada 60 min o tras fallo) │            │  página web local     │
 │      ▼                               │  lee datos │  127.0.0.1:8000       │
 │ Edge Function «actualizar-mercado»   │◄───────────┤  botón "Actualizar"   │
 │      │ descarga CSV de TSM (ETag)    │            └───────────────────────┘
 │      ▼                               │
 │ Base de datos Postgres               │
 └──────────────────────────────────────┘
```

- **Los datos se guardan en Supabase**, no en tu PC.
- **La consulta horaria también corre en Supabase**: el historial sigue creciendo aunque apagues el PC.
- La **página web** sigue corriendo en tu PC por ahora: solo la ves mientras `iniciar.bat` está abierto.

## Paso 1 — Crear la cuenta y el proyecto

1. Entra en **https://supabase.com** y pulsa **Start your project**. Puedes registrarte con GitHub o con tu correo.
2. Pulsa **New project** y rellena:
   - **Name**: `mercadowow`
   - **Database Password**: pulsa **Generate a password** o inventa una **solo con letras y números** (los símbolos como `@ # / ?` complican la cadena de conexión). **Guárdala en un gestor de contraseñas**: Supabase no la vuelve a mostrar.
   - **Region**: la más cercana a ti (por ejemplo *South America (São Paulo)* o *East US*).
   - **Plan**: *Free*.
3. Pulsa **Create new project** y espera 1 o 2 minutos a que termine.

## Paso 2 — Copiar los datos de conexión al archivo `.env`

Abre el archivo **`.env`** de la carpeta `mercadowow` con el Bloc de notas. **No pegues estos datos en el chat.**

**DATABASE_URL**
1. En el panel del proyecto, pulsa el botón **Connect** (arriba).
2. En la pestaña **Connection String**, elige el método **Session pooler** (no "Direct connection": esa no funciona en muchas redes domésticas).
3. Copia la cadena. Se parece a:
   `postgresql://postgres.abcdefgh:[YOUR-PASSWORD]@aws-0-sa-east-1.pooler.supabase.com:5432/postgres`
4. Pégala en `.env` después de `DATABASE_URL=` y **cambia `[YOUR-PASSWORD]` por tu contraseña** (sin los corchetes).

**SUPABASE_URL**
1. Ve a **Project Settings** (engranaje) → **Data API** (en algunas versiones se llama **API**).
2. Copia la **Project URL**, de la forma `https://abcdefgh.supabase.co`.
3. Pégala en `.env` después de `SUPABASE_URL=`.

Guarda el archivo.

## Paso 3 — Ejecutar `configurar.bat`

Haz doble clic en **`configurar.bat`**. El script hace esto:

1. Comprueba la conexión con tu base de datos.
2. Crea las tablas, las funciones, la seguridad y la tarea programada.
3. Despliega la función que descarga los precios. **La primera vez se abrirá el navegador** para que autorices la herramienta de Supabase (*Supabase CLI*) en tu cuenta. Acéptalo y vuelve a la ventana negra.
4. Activa la consulta automática y hace la **primera descarga real** de TSM.

Al final verás un resumen con la hora del dato y el número de objetos guardados (unos 3.700). Puedes ejecutarlo otra vez cuando quieras: no repite lo que ya está hecho.

## Paso 4 — Ver el estado

Doble clic en **`iniciar.bat`** y abre **http://127.0.0.1:8000**. Verás la hora del dato original, la última consulta, la próxima y el registro de consultas.

## Límites del plan gratuito (a tener en cuenta)

| Límite | Valor | Efecto en esta app |
|---|---|---|
| Tamaño de la base de datos | 500 MB | Con unos 3.700 objetos se estiman unos 100 MB por mes de datos horarios. En el Hito 8 se compactarán a diarios para no pasarse. *Estimación, no medida.* |
| Pausa por inactividad | Los proyectos gratuitos se pausan tras unos 7 días «sin actividad» | **No está verificado** si las tareas programadas internas cuentan como actividad. Si el proyecto se pausa, la página mostrará el dato como ANTIGUO y habrá que reactivarlo desde el panel. Abrir la página local de vez en cuando también cuenta como actividad (consulta la base de datos). |
| Invocaciones de Edge Functions | 500 000 al mes | Esta app usa unas 750 al mes (1 por hora + reintentos). |

## Seguridad

- La contraseña solo está en tu `.env`, que no se sube a ningún sitio (`.gitignore`).
- Las tablas tienen RLS activado y sin permisos para las claves públicas: nadie puede leerlas por la API pública de Supabase.
- La función `actualizar-mercado` no pide clave, pero **solo descarga cuando la base de datos dice que toca**. Llamarla de más no provoca consultas extra a TSM.

## Si algo falla

| Mensaje | Qué hacer |
|---|---|
| `Falta DATABASE_URL` / `Falta SUPABASE_URL` | Revisa el Paso 2 y guarda `.env` |
| `falta poner tu contraseña` | Sustituye `[YOUR-PASSWORD]` en `DATABASE_URL` |
| `No se pudo conectar` / `password authentication failed` | Contraseña incorrecta: puedes cambiarla en Project Settings → Database → Reset database password |
| `No se encontró Node.js` | Instala Node.js LTS desde https://nodejs.org y vuelve a ejecutar `configurar.bat` |
| La página dice «Sin conexión con la base de datos» | Comprueba internet y que el proyecto no esté pausado en el panel de Supabase |
