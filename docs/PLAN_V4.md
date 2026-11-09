# Plan V4 — Catálogo, materiales de profesiones, precios TSM y mapa (2026-11-09)

Se mantiene la aplicación de una sola sección «Mercado» (plan V3), con su barra lateral, la tabla
paginada en el servidor, el detalle y la consulta horaria en Supabase.

## 1. Fuentes comprobadas hoy

| Fuente | Qué permite | Qué no |
|---|---|---|
| **TSM, archivo público** `public-data.tradeskillmaster.com/forever/us/realm/pvp-horde/items.csv` | **Está permitido:** sus términos prohíben los bots salvo en «funciones previstas para ello», y citan los archivos públicos de precios como una de ellas. La página de datos públicos los describe sin clave, sin registro y sin límites. **Lo usamos desde el hito 2:** 5.048 filas y `ETag`, con un dato nuevo cada ~3 h. Columnas: `itemId`, `name`, `marketValue`, `minBuyout`, `recent`, `historical`, `updatedAt` (hora del escaneo), en cobre. Muestra: Linen Cloth (2589), compra mínima 26c y valor de mercado 24c, escaneo del 09/11 19:16 UTC. | **No hay cantidad publicada, número de subastas ni ventas.** La página `tradeskillmaster.com/forever/us/pvp-horde` no muestra precios por objeto (el «heatmap» es de pago). |
| **Wowhead** (`/forever/items`) | Enlaces a las fichas. | **No tiene API pública** y no se pudo confirmar ningún permiso de extracción: sus términos no se leen sin JavaScript, y `robots.txt` bloquea `/forever/list`. **No se extrae nada de Wowhead.** |
| **AHledger** `/v1/items`, `/v1/crafting` (con atribución) | Ficha de cada ID con `game=forever`: nombre, calidad, clase, subclase, nivel e icono oficial. También las 2.227 recetas de 11 profesiones. | Sin pila, sin vinculación y sin nombres en español. **Pesca no tiene recetas** en la fuente. |
| **API oficial de Blizzard** (`static-forever-us`, sin documentar) | Podría dar la vinculación (prueba de «No subastable»), los nombres en español y los iconos de profesiones. | Necesita un cliente de desarrollador que **debes crear tú**. Además, falla en parte de los IDs según informes de la comunidad. |

**Estado actual:**
- **Catálogo:** 5.642 objetos verificados con AHledger, 0 fallidos, y la cola de las recetas a punto de terminar.
- **Precios TSM:** 4.974 objetos.
- **Iconos:** faltan en 229 objetos y la calidad en 165; la fuente no los da.

**Materiales:** las recetas usan **580 materiales**, de los cuales **220 los usan varias profesiones**. Las familias salen de la subclase oficial de Blizzard, no de los nombres. Los más numerosos de «Objetos comerciales» son:

| Familia (subclase) | Materiales |
|---|---|
| Otros | 79 |
| Cocina | 70 |
| Cuero | 58 |
| Metal y piedra | 42 |
| Piezas | 34 |
| Hierbas | 34 |
| Encantamiento | 28 |
| Tela | 21 |
| Elemental | 16 |

El resto son consumibles (viales, pociones, comida), objetos de misión, etc.

## 2. Decisiones

- **El precio principal pasa a ser el de TSM** (mercado `tsm:forever:us:pvp-horde`).
  - La columna principal es «Compra mínima» (`minBuyout`). Si falta, no se sustituye: el valor de mercado se muestra con su propio nombre.
  - AHledger sigue en el selector «Fuente», con su nombre visible, para quien quiera la cantidad y la mediana. **Nunca se mezclan las dos fuentes.**
- **Cada métrica guarda su nombre y su significado,** con la definición de TSM que se verifique en el hito 1. Ya se guarda la hora original del escaneo y la de importación.
- **Mapa de materiales con TSM:** **todos los bloques tienen el mismo tamaño**, porque TSM no publica cantidades y no se deduce volumen de los anuncios. Con AHledger, el tamaño será la cantidad publicada.
- **Variaciones:** solo entre escaneos de la misma métrica y mercado. Hoy hay ~2 días de historial TSM; «7 d» dirá «Sin historial» hasta el 14/11.

## 3. Hitos (uno por entrega)

1. **W1 · Precios TSM trazables** ✅ (2026-11-09; migración 0020):
   - **Ceros de TSM:** el archivo usa `minBuyout = 0` y `recent = 0` cuando no hay anuncios (652 de 5.048 filas). Antes se mostraban como «0c»; ahora se guardan como «sin dato», en la Edge Function y en los datos ya guardados.
   - **Comparación:** el escaneo guardado del 09/11 19:16:24 UTC coincide con el CSV de TSM: 5.048 filas × 4 métricas, 0 diferencias.
   - **Precio y estados:** el precio de la tabla es solo la compra mínima. «Sin ofertas» guarda la última compra mínima vista, con el valor de mercado aparte; variación y minigráfico usan la misma métrica.
   - **Métricas:** tabla `metricas`, con las definiciones de la ayuda de TSM.
   - **Fuente:** `mercado_principal()` es TSM, y la atribución de TSM va en el pie.
   - TSM como fuente por defecto.
   - Columnas separadas: compra mínima, valor de mercado, `recent`, histórico y venta al NPC.
   - Ficha de métricas (nombre, significado y fuente).
   - Comprobación de una muestra de precios contra el CSV de TSM con el mismo `updatedAt`, y de la conversión 1o = 100p = 10.000c.
2. **W2 · Materiales y profesiones** ✅ (2026-11-09; migración 0021):
   - **Materiales:** 565 materiales en 13 familias, según la subclase oficial.
   - **Profesiones:** 12, contando Pesca por sus objetos de receta oficiales.
   - **Roles por profesión:** material, receta (clase «Recipe» con la subclase de la profesión) y producto, con contadores que respetan la categoría y los filtros.
   - **Detalle:** «Lo usan» y «Lo fabrican», con recetas y nivel mínimo. Un objeto puede tener varios roles sin repetirse.
   - **Compatibilidad:** `profesiones` sigue siendo la lista de nombres (para la página anterior) y los contadores van en `profesiones_roles`.
   - **Iconos de profesiones:** el del material más usado. No hay iconos oficiales sin la API de Blizzard.
   - Relaciones desde las recetas: profesiones que consumen cada material, recetas, cantidad, productos y nivel.
   - En la barra lateral: «Materiales de profesiones» con subfiltro por familia, y profesiones desplegables con «Materiales / Recetas / Productos» y contadores coherentes.
   - Separar materiales, recetas (objetos de clase «Receta») y productos terminados.
   - Las herramientas (martillo, etc.) no vienen en los datos de recetas: se indicará como límite.
3. **W3 · Mapa de materiales:**
   - Selector «Lista / Mapa» dentro de Mercado: treemap por familias, con icono, nombre abreviado y variación con signo.
   - Colores para subidas, bajadas y estabilidad, y aspecto propio para «Sin historial».
   - Periodo elegible.
   - Al pasar el cursor o enfocar, información del bloque; al pulsar, se abre el detalle.
4. **W4 · Catálogo e iconos:**
   - Informe por categoría: duplicados eliminados, errores, iconos y calidades que faltan, y cobertura pendiente.
   - Marcador neutro y caché de iconos.
   - **Opcional, si creas el cliente de Battle.net:** vinculación («No subastable»), nombres en español, tamaño de pila si la API lo da, e iconos de profesiones.
5. **W5 · Verificación y resumen de entrega:**
   - Cobertura de catálogo y familias, IDs únicos, relaciones con varias profesiones y filtros.
   - Muestra de precios contra TSM, actualización horaria sin duplicados y variaciones del mapa.
