# Publicar en Vercel

Alternativa a Netlify (ver [NETLIFY.md](NETLIFY.md)). La página y la lógica son las mismas; solo cambia quién las sirve.
Los datos y la consulta horaria siguen en Supabase, así que no dependen del alojamiento.

## Cómo está montado

| Pieza | Archivo |
|---|---|
| Página estática | `app/static` (`outputDirectory` en `vercel.json`) |
| API `/api/*` | **una sola función**, `api/index.js`. El plan Hobby admite 12 funciones como máximo y la API tiene 24 rutas, así que `vercel.json` reescribe `/api/<ruta>` hacia esa función y `vercel/rutas.ts` reparte. |
| Lógica | `netlify/lib/api.ts`, la misma que usa Netlify |
| Cabeceras de seguridad | `vercel.json` (idénticas a `netlify.toml`; una prueba lo comprueba) |
| Qué no se sube | `.vercelignore`: el servidor local (`app/*.py`) **no tiene clave de acceso** y no debe publicarse |

`api/index.js` es un archivo **generado**: empaqueta `vercel/entrada.ts` con sus dependencias. Tras tocar
`netlify/lib/api.ts`, `vercel/` o el núcleo de Supabase hay que regenerarlo:

```
npm run vercel
```

Si se olvida, la prueba «api/index.js está al día con el código» falla.

## Crear el proyecto (una vez)

1. vercel.com → **Add New… → Project** → importar `ghoulaaa/mercadowow`.
2. **Application Preset: Other.** No «FastAPI».
3. **Root Directory:** `./`. «Build and Output Settings» se deja como está (lo fija `vercel.json`).
4. **Environment Variables**, las mismas tres que en Netlify:
   - `DATABASE_URL`: cadena «Session pooler» de Supabase.
   - `SUPABASE_URL`: `https://xxxx.supabase.co`.
   - `CLAVE_ACCESO`: la contraseña de la página (mínimo 12 caracteres).
5. **Deploy.**

Cada «Push origin» a `main` vuelve a publicar.

## Comprobar

- `/` muestra la pantalla de clave.
- `/api/estado` sin sesión responde 401 `no_autenticado`.
- `/api/nada` responde 404.
