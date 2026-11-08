# Publicar la web en Netlify (solo lectura)

La versión de Netlify es **pública y de solo lectura**: cualquiera con la URL ve el estado del mercado,
pero no puede pedir actualizaciones (el botón «Actualizar ahora» no aparece).
La consulta horaria a TSM la sigue haciendo Supabase, igual que antes.
La versión local (`iniciar.bat`) no cambia y conserva el botón.

## Qué se publica

| Pieza | Dónde |
|---|---|
| Página | `app/static/` (HTML y CSS, sin compilación) |
| `GET /api/estado` | Netlify Function `netlify/functions/estado.mts`. Lee Supabase dentro de una transacción `read only` y la CDN la guarda 60 s. |
| Configuración | `netlify.toml` |

## Pasos (una sola vez)

1. Entra en [app.netlify.com](https://app.netlify.com) → **Add new site → Import an existing project → GitHub** y elige `ghoulaaa/mercadowow`.
2. Deja la configuración que propone: la lee de `netlify.toml`. No hace falta comando de compilación.
3. Antes del primer despliegue, en **Site configuration → Environment variables**, añade:

   | Variable | Valor | Notas |
   |---|---|---|
   | `DATABASE_URL` | La misma cadena de Supabase que tienes en `.env` | Márcala como **secreta**. Recomendado: la cadena **Transaction pooler** (puerto `6543`), que aguanta mejor las conexiones cortas de las funciones. La Session pooler (`5432`) también funciona. |
   | `SUPABASE_URL` | `https://xxxx.supabase.co` | Solo para mostrar el nombre del proyecto |
   | `MERCADO` | `tsm:forever:us:pvp-horde` | Opcional (es el valor por defecto) |

4. **Deploy**. A partir de ahí, cada `git push` a `main` vuelve a publicar la web.

## Comprobar

- `https://TU-SITIO.netlify.app/` debe mostrar «Recibiendo datos reales de TSM» y el aviso «Versión pública de solo lectura».
- `https://TU-SITIO.netlify.app/api/estado` devuelve JSON con `"solo_lectura": true` y **ninguna** contraseña.

## Seguridad

- `DATABASE_URL` solo vive en las variables de Netlify; nunca llega al navegador.
- La función solo acepta `GET` y abre la conexión en modo `read only`.
- **Mejora pendiente:** usar un usuario de Postgres de solo lectura, en vez del usuario `postgres`, para la variable de Netlify.
- **Cuando lleguen el inventario y las ventas (hitos 6 y 7)** habrá que proteger esta web con contraseña o con inicio de sesión: esos datos son personales.

## Pruebas

`npm test` incluye `netlify/pruebas/estado.test.ts`, que ejecuta la función contra el esquema real en PGlite
(forma de la respuesta, separación de mercados y que no se filtre ninguna credencial).
