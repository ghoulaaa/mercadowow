# Guía: publicar la página en Netlify

Así la página funciona desde cualquier lugar (también el móvil) sin tener el PC encendido.

```
 Navegador ──► Netlify ──────────────────────► Supabase
               · página (app/static)            · base de datos
               · funciones /api/* (con clave)   · consulta horaria a TSM
```

## 1. Configuración del sitio

El archivo `netlify.toml` ya rellena casi todo. En la pantalla de Netlify debe quedar así:

| Campo | Valor |
|---|---|
| Branch to deploy | `main` |
| Base directory | *(vacío)* |
| Build command | *(vacío)* |
| Publish directory | `app/static` |
| Functions directory | `netlify/functions` |

## 2. Variables de entorno

Pulsa **Add environment variables → Add a single variable** (o, con el sitio ya creado, ve a **Site configuration → Environment variables**). Añade estas tres y marca **«Contains secret values»** en las dos secretas:

| Variable | Valor | ¿Secreta? |
|---|---|---|
| `DATABASE_URL` | La misma línea de tu `.env` (cadena «Session pooler» con la contraseña) | **Sí** |
| `SUPABASE_URL` | La misma de tu `.env` (`https://xxxx.supabase.co`) | No |
| `CLAVE_ACCESO` | Una contraseña **nueva** para entrar a la página. Mínimo 12 caracteres; mejor una frase larga. **No reutilices la de Supabase.** | **Sí** |

Sin `CLAVE_ACCESO` (o con menos de 12 caracteres) la página se queda cerrada: no muestra datos a nadie.

## 3. Desplegar

Pulsa **Deploy**. En 1 o 2 minutos Netlify te da una dirección del tipo `https://nombre-raro.netlify.app`. Ábrela, escribe tu `CLAVE_ACCESO` y verás el panel.

Cada vez que se suba un cambio a GitHub (rama `main`), Netlify vuelve a publicar solo.

## Seguridad

- La contraseña de la base de datos solo está en Netlify (servidor) y en tu `.env`. Nunca llega al navegador.
- La sesión es una cookie firmada, `HttpOnly`, `Secure` y `SameSite=Strict`, que dura 30 días. Si cambias `CLAVE_ACCESO`, todas las sesiones abiertas se cierran.
- Tras **10 intentos fallidos desde una misma IP (o 50 en total) en 15 minutos**, el acceso se bloquea 15 minutos.
- La página lleva `noindex`: los buscadores no la indexan.

## Si algo falla

| Lo que ves | Qué hacer |
|---|---|
| «Falta CLAVE_ACCESO en Netlify» | Añade la variable y vuelve a desplegar (**Deploys → Trigger deploy**) |
| «No se pudo conectar con Supabase» | Revisa `DATABASE_URL` en Netlify y que el proyecto de Supabase no esté pausado |
| «Faltan migraciones en Supabase» | Ejecuta `configurar.bat` en tu PC |
| Página en blanco o 404 | Comprueba que *Publish directory* sea `app/static` |
