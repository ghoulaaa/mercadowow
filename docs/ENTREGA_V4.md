# Entrega del plan V4 — Catálogo, materiales, precios TSM y mapa

Comprobado el 2026-11-10 hacia las 00:00 UTC sobre los datos reales de Supabase y las fuentes
(script de verificación, navegador y 354 + 86 pruebas automáticas).

## 1. Objetos incorporados

| | Cantidad |
|---|---|
| Objetos en el catálogo de WoW Forever | **6.665** |
| IDs únicos (clave: ID + versión del juego) | 6.665 · **0 duplicados** |
| Objetos sin ficha en ninguna fuente (se muestran como «#ID») | 168 |
| Errores de la fuente / pendientes de verificar | 0 / 0 |

Por categoría:

| Categoría | Objetos |
|---|---|
| Armadura | 3.587 |
| Consumibles | 782 |
| Armas | 661 |
| Recetas | 487 |
| Objetos comerciales | 469 |
| Miscelánea | 314 |
| Objetos de misión | 95 |
| Recipientes | 59 |
| Proyectiles | 22 |
| Carcajes | 13 |
| Llaves | 5 |
| Componentes | 3 |
| Sin clasificar (sin ficha) | 168 |

**Procedencia:** todos los objetos vistos en las subastas, todos los materiales y productos de las recetas, y los IDs que se importen desde el panel «Catálogo». Cada ID se verifica con AHledger (`/v1/items?game=forever`).

**Lo que no cubre:**
- **No es el catálogo completo del juego,** y la página no lo afirma. Ninguna fuente permitida publica la lista completa.
- **Wowhead:** no tiene API pública y no se pudo confirmar ningún permiso de extracción, así que solo se enlaza.

## 2. Materiales y profesiones

**Materiales:** 580 en las recetas; 220 los usan varias profesiones. Por ejemplo, Linen Cloth la usan Ingeniería (6 recetas), Herrería (3), Primeros auxilios (2) y Sastrería (1).

**Familias,** según la subclase oficial de cada objeto:

| Familia | Materiales |
|---|---|
| Hierbas | 38 |
| Metales y piedras | 48 |
| Telas | 23 |
| Cueros | 62 |
| Encantamiento | 29 |
| Elementales | 16 |
| Cocina | 72 |
| Piezas y componentes | 46 |
| Consumibles | 76 |
| Reactivos | 12 |
| Otros materiales | 93 |
| De misión | 25 |
| Otros | 40 |

**Profesiones:**

| Profesión | Materiales | Recetas | Productos |
|---|---|---|---|
| Alquimia | 100 | 49 | 193 |
| Herrería | 149 | 45 | 484 |
| Cocina | 112 | 57 | 130 |
| Encantamiento | 76 | 42 | 81 |
| Ingeniería | 199 | 46 | 267 |
| Primeros auxilios | 41 | 12 | 31 |
| Pesca | 0 | 2 | 0 |
| Herboristería | 8 | 0 | 3 |
| Peletería | 174 | 115 | 559 |
| Minería | 27 | 0 | 18 |
| Desuello | 7 | 0 | 3 |
| Sastrería | 129 | 110 | 454 |

**Cómo se obtuvieron:**
- **Relaciones:** desde las 2.227 recetas de AHledger y la clasificación oficial, nunca comparando nombres.
- **Pesca:** existe en Forever por sus objetos de receta, pero no tiene recetas en la fuente.

**Lo que no cubre:**
- **Herramientas:** no vienen en los datos de recetas.
- **Origen por recolección:** que una hierba «se obtiene con Herboristería» no está en ninguna fuente permitida. Solo se muestra «Lo fabrican» cuando hay receta, como Minería con las barras.

## 3. Iconos

| | Cantidad |
|---|---|
| Iconos del servidor de Blizzard | 6.393 |
| Iconos servidos por AHledger (objetos nuevos de Forever) | 104 |
| Sin icono (los 168 objetos sin ficha) | 168 |
| Archivos de icono distintos | 1.998 |

**Verificación:** una muestra de 210 objetos pedidos de nuevo a AHledger tiene **el mismo ID, nombre e icono en los 210**.

**Sin icono:** se muestra un marcador neutro, la inicial del objeto (nunca un emoji). Si una imagen no carga, se ve también ese marcador.

**Iconos de profesiones:** no hay oficiales sin la API de Blizzard. Se usa el icono real del material más usado por cada profesión.

## 4. Precios

- **Fuente:** archivo público de TradeSkillMaster para **WoW Forever · US · PvP · Horda** (`public-data.tradeskillmaster.com/forever/us/realm/pvp-horde/items.csv`). TSM permite expresamente el acceso automático a estos archivos.
- **Último escaneo guardado:** del 09/11/2026 a las 21:16:24 UTC, importado a las 23:58 UTC.
  - 5.093 objetos.
  - Comparado con el CSV de TSM: **0 diferencias** en las 4 métricas (compra mínima, valor de mercado, reciente e histórico).
- **Objetos del catálogo vinculados a precios de TSM:** 5.048.
  - Con ofertas en el último escaneo: 4.396.
  - Sin ofertas ahora, aunque se vieron: 652.
  - Nunca vistos («Sin datos»): 1.617.
  - «No subastable»: 0, porque ninguna fuente actual da la vinculación.
- **Ceros de TSM:** TSM usa 0 cuando no hay anuncios. Se guarda como «sin dato» y nunca se muestra como 0. Quedan 0 ceros guardados.
- **Métricas:** cada una tiene su nombre y significado (tabla `metricas`), su hora original de escaneo y su hora de importación. La tabla muestra solo la compra mínima; el valor de mercado nunca la sustituye.
- **Conversión:** 1 oro = 100 platas = 10.000 cobres, con prueba automática. Todo se guarda en cobre entero.

## 5. Actualización

- **Consulta cada ~60 minutos desde Supabase,** aunque el PC esté apagado, con `ETag`.
  - Si no hay cambios (304), no se guarda nada.
  - En las últimas 24 h hubo 24 consultas: 8 con dato nuevo y 16 «no modificado».
- **Sin duplicados:** 0 escaneos repetidos y 0 filas de precio repetidas.
- **Retraso de TSM:** TSM puede tardar en servir un archivo recién publicado. El del 09/11 a las 22:19 UTC siguió dando «no modificado» a las 23:10 y se recuperó en la consulta siguiente. El dato de la página siempre indica su antigüedad real («Datos: hace X min»).

## 6. Mapa de materiales

- **Contenido:** 580 materiales; en 24 h hay variación para 366.
- **Variaciones comprobadas:** **20 de 20** recalculadas a mano coinciden. Siempre se compara la compra mínima con la compra mínima del mismo mercado.
- **Periodos 3 d y 7 d:** muestran «Sin historial» hasta reunir datos. Los escaneos de TSM empiezan el 07/11 a las 22:16 UTC.
- **Tamaño de los bloques:** uniforme con TSM, porque no publica cantidades. Con AHledger, la cantidad publicada.

## 7. Limitaciones y cobertura pendiente

- **Catálogo completo de Forever:** no es verificable con las fuentes permitidas, y Wowhead no se extrae.
- **Pendiente de la API oficial de Blizzard:**
  - vinculación («No subastable»);
  - nombres en español verificados;
  - tamaño de pila;
  - iconos de profesiones.

  Necesita que crees un cliente de desarrollador de Battle.net. La API de Forever no está documentada y, según la comunidad, falla con parte de los IDs.
- **168 objetos sin ficha en ninguna fuente:** se muestran por su ID.
- **Herramientas de profesión y origen por recolección:** sin datos en las fuentes.
- **Recomendaciones:** «Vender», «Guardar» y «Esperar» aparecerán cuando haya 7 días de historial propio; hoy todos los objetos dicen «Sin datos suficientes».
