# Plan v2 — «Casa de Subastas — WoW Forever»

Fecha: 2026-11-08. Antes de programar se comprobaron las fuentes con peticiones reales. Este documento cubre los pasos 1–6 de «Desarrollo por etapas»: fuentes, datos disponibles, arquitectura, esquema, actualización y MVP.

---

## 1. Fuentes verificadas

### 1.1 AHledger — API pública ✅ VERIFICADA (fuente recomendada para mercado, catálogo y recetas)

Documentación: https://ahledger.com/developers. Base: `https://api.ahledger.com`.

| Comprobación | Resultado real (2026-11-08) |
|---|---|
| Acceso | Sin clave, 300 peticiones/min por dirección. Las claves gratuitas solo suben el límite. |
| Licencia | Uso libre, personal o comercial, con dos condiciones: **citar «Prices from AHledger» con enlace** donde se muestren los datos, y no presentar los datos como escaneo propio ni revenderlos como feed. |
| `GET /v1/markets` | ✅ 26 mercados. Para Horda US: `forever.normal.horde.us`, **`forever.pvp.horde.us`**, `forever.rp.horde.us` y `forever.rppvp.horde.us`. |
| `GET /v1/items/7082?game=forever` | ✅ Essence of Air · `UNCOMMON` · Trade Goods › Elemental · nivel 55 · valor de venta al NPC **400 cobres (4 platas)** · icono oficial `render.worldofwarcraft.com/classic1x-us/icons/56/spell_nature_earthbind.jpg`. |
| `GET /v1/prices/{mercado}/{id}?range=7d` | ✅ Linen Cloth (2589) en PvP Horda: mínimo 13c, **mediana** 28c, **cantidad 19.756**, **511 subastas**, medianas de 7, 30 y 90 días, 69 puntos horarios desde el 05/11. Essence of Air: **sin anuncios ahora** (`latest` vacío), así que se mostrará «Sin datos disponibles». |
| `GET /v1/pricetable/{mercado}` | ✅ 3.613 objetos, escaneo de **05:31 UTC de hoy**, 147 KB y `ETag` (si no cambia, responde 304). Cada fila trae mediana, mínimo, cantidad, medianas de 7 y 30 días, mínimo y máximo de 30 días y ventas estimadas por día. |
| `GET /v1/tooltip/{mercado}?items=` | ✅ Hasta 100 objetos por llamada, con nombre, calidad, icono, nivel y clase: sirve para montar el catálogo en unas 37 llamadas. |
| `GET /v1/crafting/{mercado}?profession=` | ✅ Alquimia: 195 recetas con reactivos y cantidades. Essence of Air se usa en **Transmute: Air to Fire** (1×) y **Alchemist's Stone** (8×). |
| `/v1/disenchant`, `/deals`, `/signals`, `/timing`, `/structure`, `/economy` | Documentados; se usarán más adelante. |
| Ventas estimadas (`salesPerDay`) | Son una **estimación** que AHledger deduce de escaneos tomados cada 20–60 min. Su glosario lo dice: un escaneo no distingue una venta de una cancelación. Se mostrarán como «estimación de AHledger», nunca como ventas confirmadas. |
| Lo que **no** existe | Búsqueda por nombre (`/v1/search` → 404), listado completo del catálogo (`/v1/items` → 404) y anuncios individuales con vendedor y tiempo restante. |

### 1.2 TradeSkillMaster ✅ (fuente actual, se mantiene como segunda fuente)
- CSV público `forever/us/realm/pvp-horde/items.csv`: mínimo, valor de mercado y valor histórico. No trae cantidad, subastas ni ventas.
- Hoy su último escaneo era de las 01:16 UTC, frente a las 05:31 de AHledger.
- Ya está integrado y funcionando cada hora. Se conserva como **mercado aparte** (los proveedores nunca se mezclan).

### 1.3 Wowhead ⚠️ solo enlaces
- No hay una API pública para el catálogo y Wowhead desaconseja el scraping. Sus fichas se generan con JavaScript, así que una petición simple no devuelve los datos. No se hará extracción masiva.
- Uso permitido: un enlace «Ver en Wowhead» del tipo `https://www.wowhead.com/forever/item=7082` (comprobado: la página existe y es de la versión Forever).
- Lo que **solo** tiene Wowhead se mostrará como «No disponible desde fuentes autorizadas · Ver en Wowhead»: criaturas que lo sueltan, probabilidades, zonas, vendedores NPC, misiones, descripción y tamaño de pila.

### 1.4 API de Blizzard 🧪 opcional
- Tiene namespaces `static-forever-us` y `dynamic-forever-us`. Podría aportar nombres en español (`es_MX`), descripción, nivel requerido y búsqueda por nombre.
- Requiere credenciales gratuitas de develop.battle.net, que tendrías que crear tú.
- No es necesaria para el MVP. Mientras no haya traducción verificada, se mantiene el **nombre en inglés**, como pide la especificación.

### 1.5 Comisiones y depósitos ⚠️ sin confirmación oficial
- AHledger calcula con un «5 % house cut». Las guías hablan de 5 % en la casa de facción y 15 % en la neutral, con un depósito de 5 %, 20 % o 60 % del valor de venta al NPC (2, 8 o 24 h) y un mínimo de 1 plata.
- Todo irá en la tabla `auction_fee_rules`, con su fecha y la etiqueta «sin verificar» hasta que lo confirmes en el juego.
- **Novedad:** como AHledger da el valor de venta al NPC, el depósito ya se puede calcular de verdad, en lugar de usar solo el mínimo.

### 1.6 Lo que dice la imagen de referencia y no se confirma
La imagen es solo una referencia de diseño, y algunos de sus datos son ficticios o no se pudieron comprobar:
- Valor del vendedor de 4 oros → el real es **4 platas**.
- «Poción de Velocidad», «Gyrocongelador» y «Encantar: Agilidad» como usos → no aparecen en los datos verificados.
- Anuncios con vendedor y tiempo restante → ninguna fuente autorizada los publica.
- Precios de unos 13 oros → Essence of Air **no tiene anuncios ahora mismo** en PvP Horda.

---

## 2. Qué datos hay y cuáles faltan

| Bloque de la especificación | Disponible | Fuente | Falta / cómo se trata |
|---|---|---|---|
| Buscar por nombre, parcial o ID | ✅ | Catálogo propio construido con AHledger | La búsqueda la hace nuestra base de datos (AHledger no tiene búsqueda). Un objeto que nunca se ha puesto a la venta en el mercado se añade por ID. |
| Icono, calidad, clase y subclase, nivel | ✅ | AHledger (iconos oficiales de Blizzard) | Si un icono falla, se muestra un marcador neutro. |
| Nivel requerido | ⚠️ | AHledger (`requiredLevel`, a veces null) | «Desconocido» cuando falte. |
| Descripción, tamaño de pila, vinculación, estadísticas | ❌ | — (Blizzard opcional) | Enlace a Wowhead. |
| Valor de venta al NPC | ✅ | AHledger `vendorSell` | Se muestra separado del precio de subasta. |
| Precio de compra al NPC | ❌ | — | Enlace a Wowhead. |
| Mínimo, mediana, cantidad, nº de subastas | ✅ | AHledger | TSM aporta mínimo y valor de mercado, en su propio mercado. |
| Promedio | ❌ | — | No se calcula a partir de la mediana: se mostrará «no publicado». |
| Medianas de 7, 30 y 90 días, mínimo y máximo de 30 días | ✅ | AHledger | |
| Historial de 24 h, 7, 30 y 90 días con cantidad | ✅ | AHledger `prices` (horario 24 h/7 d, diario 30/90 d) | Hay datos desde el 05/11 (lanzamiento). Los huecos se dejan sin unir. |
| Anuncios individuales (vendedor, tiempo, puja) | ❌ | — | Se muestra una tabla de estadísticas agregadas, como pide la especificación. |
| Liquidez | ⚠️ | AHledger `salesPerDay` (estimación) | Rotulada como estimación. Entra en el motor con peso limitado. |
| Recetas, reactivos y cantidades, profesión, nivel | ✅ | AHledger `crafting` | Solo las recetas que AHledger lista. |
| Criaturas, zonas, NPC, misiones, probabilidades | ❌ | — | Enlace a Wowhead, sin inventar nada. |
| Desencantamiento | ⚠️ | AHledger `disenchant` (valor esperado) | Más adelante. |
| Inventario, ventas, motor, explicaciones | ✅ | Ya existe (hitos 5–7) | El estado «EN OBSERVACIÓN» pasa a llamarse **ESPERAR**. |

---

## 3. Arquitectura: se mantiene la actual

La especificación propone Next.js, Tailwind y Prisma «si no existe una arquitectura definida». **Ya existe una, desplegada y probada**: página estática + funciones de Netlify (TypeScript) + Supabase Postgres + tarea horaria con pg_cron y Edge Function. Reescribirla costaría mucho y no mejora nada para un uso personal.

**Se mantiene. El cambio está en la interfaz:**
- Una aplicación de una sola página con rutas por `#` (Inicio, Base de datos, Objeto, Mercado, Historial, Profesiones, Rentabilidad, Favoritos, Inventario, Oportunidades, Fuentes).
- Módulos de JavaScript sin paso de compilación, igual que ahora.
- En escritorio, 3 columnas (17 % / 43 % / 40 %). En móvil, los filtros van en un panel desplegable y la ficha en una vista propia.
- Gráficos con el SVG propio, ya validado para daltonismo, ampliado con periodos y cantidad.
- La política de seguridad del navegador (CSP) se amplía solo para mostrar los iconos de `render.worldofwarcraft.com`.

---

## 4. Cambios en la base de datos (migraciones 0009 en adelante)

Se amplía lo que ya existe; no se rehace.

- **`markets`**: nuevo mercado `ahledger:forever:us:pvp-horde` (proveedor `ahledger`), separado de TSM, CSV y DEMO. Se añaden las columnas `region`, `ruleset` y `faction` (Horda, Alianza o neutral) y su estado.
- **`items`** (catálogo, clave = ID + versión del juego):
  - versión del juego, nombre original y traducción, calidad, clase y subclase, nivel, nivel requerido;
  - valor de venta y de compra al NPC, `icon_url` y `wowhead_url`;
  - fuente y fecha de verificación.
  - Hoy `items` está ligada a cada mercado; pasará a ser un catálogo común, y se mantendrá una relación objeto ↔ mercado.
- **`price_hourly`**: nuevas columnas `median`, `quantity`, `auctions` (null si la fuente no lo da) y `sales_per_day_est`.
- **Historial ampliado**: tabla `price_history_ext` con la serie de AHledger (24 h, 7, 30 y 90 días), guardada en caché por objeto y con su procedencia.
- **Nuevas tablas**:
  - `recipes` y `recipe_materials` (de AHledger `crafting`);
  - `item_sources` (vacía salvo datos verificados, con un enlace por defecto);
  - `auction_fee_rules` (tipo de casa de subastas, duración, % de depósito, mínimo, comisión, vigencia y estado de verificación);
  - `alerts` (objeto, mercado, condición, umbral y estado);
  - `sync_log` por proveedor.

---

## 5. Actualización de precios

- La **Edge Function** pasa a tener un adaptador por proveedor (TSM y AHledger), con el mismo sistema anti-duplicados, reintentos y registro.
- **AHledger:**
  - cada 60 min, `pricetable` con `If-None-Match`: un 304 no crea ninguna observación;
  - si llega una tabla nueva, se guarda una versión con mediana, mínimo, cantidad y ventas estimadas de unos 3.600 objetos;
  - el catálogo y las recetas se refrescan una vez al día;
  - el historial largo de un objeto se pide al abrir su ficha y se guarda según el `Cache-Control`.
- La hora del dato es la del escaneo original (cabecera de la tabla y `observedAt`). Se guarda aparte de la hora de consulta.
- AHledger depende de los jugadores que escanean con su addon: si un día no hay escaneos, la app lo dirá («sin escaneos desde…») y bajará la confianza.

---

## 6. MVP (primera entrega del rediseño)

Cumple el punto 17 de la especificación: buscar un objeto real → abrir su ficha → elegir un mercado disponible → ver su precio e historial → calcular la rentabilidad de venta.

1. **R1 · Proveedor AHledger** ✅ (2026-11-08): mercado nuevo, sincronización horaria con ETag, mediana, cantidad y ventas estimadas; atribución visible. Primera descarga real: 3.613 objetos en 11,7 s; todos con nombre, 3.500 con icono oficial y 3.526 con calidad. La función recorre TSM y AHledger, y si uno falla el otro sigue.
2. **R2 · Catálogo** ✅ (2026-11-08):
   - Tabla `catalogo` por versión del juego, con procedencia y fecha de verificación.
   - Se completa sola por lotes de 150 objetos cada 5 minutos (pg_cron + Edge Function), respetando el límite de AHledger. Prueba real: 300 objetos en 2 lotes de unos 17 s, sin fallos.
   - Búsqueda por nombre (prefijo antes que «contiene», sin tildes ni mayúsculas) o por ID. Un ID que falta se pide a AHledger y se añade: 7082 Essence of Air.
   - Mientras el catálogo se completa, la búsqueda incluye también los objetos del mercado que aún no tienen ficha.
   - Ficha con enlaces a Wowhead y AHledger, filtros de categoría › subcategoría reales y filtro de calidad.
3. **R3 · Interfaz nueva de 3 columnas** ✅ (2026-11-08): verificada en el navegador con teclas reales (Tab y Shift+Tab, Enter, Esc y salida sin atrapar el foco), con las 3 columnas en escritorio y en móvil la ficha como vista propia. El historial de 24 h, 7, 30 y 90 días sale de AHledger, con la cantidad publicada en un gráfico aparte y los huecos sin escaneos marcados:
   - buscador con autocompletado accesible: Tab y Shift+Tab, ↑↓, Enter, Esc, sin atrapar el foco, sin distinguir tildes ni mayúsculas, descartando respuestas antiguas;
   - ficha del objeto con estadísticas y gráfico de 24 h, 7, 30 y 90 días.
4. **R4 · Calculadora de rentabilidad** ✅ (2026-11-08):
   - Tabla `auction_fee_rules` con los valores iniciales por verificar, la fecha de vigencia y la fuente. Se editan desde la página; la comisión y el mínimo de la casa de facción se copian al motor y al inventario.
   - Accesos desde la ficha («Planificar venta») y desde el inventario («Calcular»).
   - Ejemplo verificado: 20 Essence of Air a 1o 20p, con coste de 80p cada una. Da comisión 1o 20p, depósito 48p (devuelto al vender), neto 22o 80p, beneficio 6o 80p y equilibrio en 84p 22c por unidad.
   - Detalle técnico:
   - reglas de comisión y depósito configurables por tipo de casa de subastas y duración;
   - cálculo en cobre entero, con el depósito de la publicación vendida devuelto y los de publicaciones fallidas anteriores contados como pérdida;
   - precio mínimo para no perder dinero.

**Ejemplo de demostración:** «Essence of Air» (ID 7082), con sus datos verificados. Si no hay anuncios, mostrará «Sin datos disponibles» en lugar de un precio inventado. Cualquier ilustración llevará la etiqueta DEMO.

## 7. Después del MVP (sin recortar el alcance final)

- **R5 · Profesiones** ✅ (2026-11-08): recetas, comparador de objetos y coste de fabricación (incompleto si falta el precio de algún reactivo).
  - Tablas `recipes`, `recipe_materials` y `recipe_sync` (0015). 2.227 recetas de 11 profesiones (7.651 reactivos, 1,6 MB), descargadas de AHledger `/v1/crafting` con `all=true&limit=2000`; con el límite por defecto (500), Peletería salía cortada. Si una lista llega con tantas recetas como el límite, se rechaza para no borrar recetas reales.
  - Se renuevan una vez al día: pg_cron cada hora en el minuto 17 (0016) → Edge Function `{"tarea":"recetas"}`.
  - El coste se calcula al leer con los precios del ÚLTIMO escaneo (mediana o compra mínima). La comisión es la de la casa de facción, con redondeo a cobre entero. Comprobado contra AHledger: los 195 costes de Alquimia coinciden; el neto difiere solo en fracciones de cobre o por la diferencia de escaneo.
  - Ficha del objeto: «Se fabrica con» y «Se usa en». Comparador de hasta 8 objetos en Rentabilidad. «Calcular venta» pasa el coste de fabricación por unidad a la calculadora.
- **R6 · Alertas, Oportunidades y liquidez en el motor:** se introduce la etiqueta ESPERAR.
- **R7 · Fuentes y metodología,** desencantamiento y estructura del mercado.
- **Los antiguos hitos 8–10:** retención y copias de seguridad, Blizzard opcional (español, pila, descripción) y medición final de consumo.
