# Plan V5 — Funciones al estilo TSM (2026-11-10)

Basado en el informe [reports/Funcionalidades del addon TSM.md](../reports/Funcionalidades%20del%20addon%20TSM.md).
Se mantiene la sección única «Mercado». Todo lo nuevo aparece en el detalle del objeto, en la
barra lateral (filtros) o como columnas opcionales de la tabla. Las fórmulas son una **adaptación
propia** de la lógica de TSM a precios agregados, no el código de TSM, así que se rotulan como
«sugerencia» o «estimación» y con su motivo.

## 1. Datos disponibles (medidos hoy)

| Dato | Estado |
|---|---|
| Precios TSM del reino (`minBuyout`, `marketValue`, `recent`, `historical`) | ✅ Cada hora, ~5.100 objetos |
| Venta al NPC (`venta_npc`) | ✅ 6.078 de 6.699 objetos (4.188 de ellos con ofertas ahora) |
| Comisión y depósito | ✅ Tabla configurable, todavía marcada «sin verificar» |
| Recetas y materiales | ✅ 2.227 recetas (AHledger) |
| **Archivo regional de TSM** (`avgSalePrice`, `saleRate`, `soldPerDay`) | ⚠️ Existe para Forever US (5.641 objetos; 2.723 con ventas por día > 0), pero **no se importa todavía**. Son datos de **toda la región**, no de PvP Horda. |
| Precio de **compra** al NPC (viales, hilos…) | ❌ Ninguna fuente permitida lo da. 164 materiales nunca han estado a la venta. Se puede **importar a mano** con un CSV verificable. |
| Anuncios individuales (vendedor, tiempo restante) | ❌ No existen en ninguna fuente pública: no se puede saber si la subasta más barata es tuya. |
| Historial para el mapa por día de la semana × hora | ⏳ Hacen falta ~3 semanas de datos (hacia el 1 de diciembre). |
| Tabla de rendimientos de desencantamiento | ⚠️ Solo hay una tabla de la comunidad marcada como antigua: hay que verificarla antes de usarla. |

## 2. Hitos (uno por entrega)

1. **X1 · «Qué hacer con este objeto»** ✅ (2026-11-10; `subasta.js`, migración 0024). Comprobado con objetos reales:
   - Peacebloom: «Publicar a 37c» (1c por debajo de 38c).
   - Silksand Wraps, sin ofertas: «Publicar a 5o».
   - Purple Lotus (8p 97c frente a 31p 57c de valor de mercado) y Linen Cloth (suelo del NPC): «Esperar».

   Al guardar la banda, el bloque se recalcula al momento, sin volver a pedir la ficha. Lo que se hizo:
   - **Banda de precios** configurable, con los ajustes por defecto del preset de la comunidad:
     - mínimo = max(80 % del valor de mercado, 1,5 × venta al NPC);
     - normal = 100 % del valor de mercado;
     - máximo = max(300 % del valor de mercado, 30 × venta al NPC).
   - **Precio de publicación sugerido** con la lógica de Auctioning (undercut de 1c), siempre con su motivo:
     - sin competencia, al precio normal;
     - competencia por debajo del mínimo, «Esperar»;
     - por encima del máximo, al máximo;
     - en otro caso, 1c por debajo de la compra mínima.
   - **Puja sugerida.**
   - **Neto tras comisión y depósito,** comparado con la venta al NPC, para responder «subastar o vender al NPC».
   - **Aviso visible:** la página no puede saber si la subasta más barata es tuya.
   - **Ajustes de la banda** en un desplegable de la barra lateral, guardados en Supabase.

2. **X2 · Oportunidades de compra** ✅ (2026-11-10; migración 0025). Lo que quedó hecho:
   - **Regla de la ganga** (estimación propia, inspirada en el Sniper de TSM): compra mínima ≤ 40 % del valor de mercado si vale menos de 1 o, 50 % de 1 a 10 o, 60 % de 10 a 100 o y 70 % desde 100 o. Además, el histórico debe ser al menos el 80 % del valor de mercado; sin histórico no se marca.
   - **Margen por unidad:** valor de mercado − comisión (ajuste `motor.comision_pct`, 5 %) − compra mínima. Si vender al NPC deja más, venta al NPC − compra mínima. No descuenta el depósito. Sin compra mínima en el último escaneo no hay margen.
   - **Medido en el escaneo del 2026-11-10 01:13 UTC:** 548 gangas y 66 bajo precio de NPC (612 objetos distintos) sobre 6.768.
   - **Límite conocido:** al ordenar por margen en %, suben objetos de pocos cobres (2c → miles de %). El margen en oro es la columna fiable para decidir.

   Plan original (funciones 2 y 3):
   - **Filtro «Oportunidades»** en la barra lateral, con dos tipos:
     - **«Ganga»:** la compra mínima es menor o igual que un porcentaje del valor de mercado. El porcentaje va escalonado por precio, como el Sniper de TSM, y el histórico no puede estar muy por debajo del valor de mercado, para descartar caídas que no se recuperan.
     - **«Bajo precio de NPC»:** la compra mínima es menor que la venta al NPC. Hoy hay 16.
   - **Columna de margen de reventa:** valor de mercado × 0,95 − compra mínima. Para «Bajo precio de NPC», venta al NPC − compra mínima.
   - **Orden** por margen y por margen en %.
   - **Aviso visible:** la compra mínima puede tener horas de retraso respecto al juego.

3. **X3 · Referencia regional** (función 7):
   - **Importación una vez al día** del archivo regional de TSM, en una tabla aparte. Nunca se mezcla con los precios de PvP Horda.
   - **En el detalle,** un bloque «Región US (no es PvP Horda)» con venta media, tasa de venta y ventas por día.
   - **Filtro opcional** «Se vende en la región», por ventas al día.
   - **No entra en el motor de recomendaciones,** como decidió el plan original.

4. **X4 · Recetas al estilo TSM** (función 4):
   - **Coste de cada material:** el más barato entre comprarlo en subasta, fabricarlo (si es fabricable, cortando los ciclos) o comprarlo al NPC (si se conoce).
   - **Valor del producto:** su compra mínima y, si no hay, su valor de mercado. Con un tope opcional del 150 % del valor de mercado para descartar precios absurdos.
   - **Importación verificable** de precios de compra al NPC (CSV de ID y precio), marcados como «introducido por ti».
   - **Si falta un precio,** el coste sigue saliendo «incompleto», como ahora.

5. **X5 · Mapa de toda la casa** (función 5):
   - **El treemap de materiales se amplía a todas las categorías,** por clase › subclase.
   - **Tamaño de los bloques:** uniforme o número de objetos, porque TSM no publica cantidades. Con AHledger, la cantidad publicada.
   - **Al pulsar una categoría** se baja a su subclase y a sus objetos.

6. **X6 · Listas y alertas** (funciones 8 y 9):
   - **Listas propias de objetos** (a partir de la tabla de favoritos), cada una con su banda de precios: así los materiales, el equipo y los consumibles pueden usar ajustes distintos.
   - **Alertas por umbral** («avísame si baja de X»):
     - se comprueban con cada consulta horaria;
     - se ven en la página al abrirla;
     - un aviso fuera de la página (correo o Discord) necesitaría un servicio y credenciales que crearías tú, así que queda opcional.

**Para más adelante:**
- **Mapa día de la semana × hora** (función 6), cuando haya ~3 semanas de historial, hacia el 1 de diciembre.
- **Valor de desencantar** (función 10), solo con una tabla de rendimientos verificada.

**No se copian:** la contabilidad (Ledger), el oro en el tiempo, el inventario, el correo, el almacén, la cancelación de subastas y el sniping en tiempo real. Necesitan datos del addon o anuncios en directo, y la página no tiene ninguno de los dos.
