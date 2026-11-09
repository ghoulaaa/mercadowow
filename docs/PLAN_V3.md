# Plan V3 — Una sola pantalla de Mercado (2026-11-09)

Rediseño pedido el 2026-11-09. Barra lateral con los controles, tabla central con iconos y precios y detalle a la
derecha (panel superpuesto en el móvil). Se modifica la app existente: Supabase, la consulta horaria, AHledger, el
motor, el historial y las recetas **se conservan**.

## 1. Qué desaparece de la interfaz (y qué no se pierde)

| Hoy | Después |
|---|---|
| Pestañas superiores (Inicio, Base de datos, Historial, Profesiones, Rentabilidad, Favoritos, Mi inventario, Oportunidades, Fuentes) | Se eliminan. Solo queda **Mercado** en la barra lateral. |
| Historial completo | Dentro del detalle del objeto (gráfico 24 h / 7 d / 30 d / 90 d). |
| Recetas y profesiones | Dentro del detalle (apartado desplegable) y como filtro «Profesión relacionada». |
| Calculadora, reglas de comisión, inventario, ventas, favoritos, oportunidades, importación CSV | **Se retiran de la interfaz**, como pide la especificación. Sus tablas y datos siguen en Supabase, **no se borra nada**, y se pueden volver a mostrar si algún día se piden. |
| Textos de bienvenida, explicaciones y avisos persistentes | Se quitan. Quedan ayudas al pasar el cursor, la antigüedad del dato, los errores y la atribución en un pie discreto. |

## 2. Catálogo: qué se puede verificar (comprobado hoy)

| Fuente | ¿Sirve para «todos los objetos de Forever»? |
|---|---|
| **Wowhead** (`wowhead.com/forever/database`) | **No como fuente de datos.** Es una web, no una API, y no da permiso de extracción masiva. Se usa **solo para enlaces**. |
| **AHledger** `/v1/items/{id}?game=forever` | Da nombre, icono, calidad, clase, subclase, nivel y venta al NPC de **cualquier ID que se le pida**, aunque no esté a la venta (comprobado con Thunderfury, 19019). **No lista todos los IDs**, y recorrer todos los números posibles sería una extracción masiva sin permiso confirmado: no se hace. |
| **AHledger** (escaneos y recetas) | Hoy hay 5.006 objetos vistos en la subasta. Las 2.227 recetas citan 2.614 objetos, **1.562 de ellos todavía fuera del catálogo** (resultados y materiales que quizá nunca salen a la venta). Es un método permitido y verificable. |
| **API oficial de Blizzard**, namespace `static-forever-us` | Existe pero **no está documentada oficialmente**. Según informes de la comunidad (5 y 6 de noviembre de 2026), `/data/wow/item/{id}` responde para muchos objetos pero da 404 en ~43 % de los IDs probados. Si funciona la búsqueda de objetos (`/data/wow/search/item`), permitiría recorrer el catálogo con paginación y traer **nombres en español verificados** y la **vinculación** (prueba de «No subastable»). Hace falta un cliente gratuito de desarrollador de Battle.net, **que debes crear tú**. Además, Blizzard publica las **subastas oficiales de Forever** (`dynamic-forever-us`). |
| **Importación verificable** | Un CSV de IDs, validado contra AHledger antes de añadirse, para completar lo que falte. |

**Estados de precio, solo con pruebas:**
- «Sin ofertas»: el objeto se ha visto en la subasta, pero no está en el último escaneo.
- «Sin datos»: nunca se ha visto en la subasta.
- «No subastable»: solo cuando la fuente diga que se liga al recogerlo (hoy solo lo daría Blizzard).
- Un precio desconocido nunca se muestra como 0.

**Cobertura:** la página dirá cuántos objetos tiene el catálogo y de qué fuente viene cada uno. No dirá «catálogo completo» mientras ninguna fuente permita comprobarlo.

## 3. Hitos (uno por entrega)

1. **V1 · Pantalla única** ✅ (2026-11-09; `app.js`, `index.html` y `styles.css` reescritos; las rutas antiguas abren el objeto o el Mercado). Pendiente para V2: `/api/precios` trae ~3 MB y tarda ~9 s en local (1,5 s en la base de datos), y se arregla con la paginación.
   - Barra lateral de 240 px (desplegable en el móvil) con «Mercado», el selector de mercado (región, tipo y facción) y los filtros.
   - En el centro, el buscador y la tabla; el detalle a la derecha, o superpuesto en el móvil y fácil de cerrar.
   - Fuera las pestañas superiores, las secciones retiradas, los textos sobrantes y el aviso fijo «Actualización solicitada».
   - Indicador compacto «Datos: hace N min» y botón de actualizar con icono.
2. **V2 · Catálogo en la tabla** ✅ (2026-11-09; migración 0017 `mercado_pagina`, `/api/mercado` y `mercado.js`):
   - **Velocidad:** cada página tarda 0,3–0,5 s en la base de datos y pesa ~58 KB (antes, 3 MB y ~9 s).
   - **Cobertura:** 5.042 objetos, de ellos 4.350 con ofertas. «Sin datos» solo aparece si nunca se vio en ese mercado; «No subastable» no se muestra porque ninguna fuente actual lo prueba.
   - **Ficha (`ficha_objeto`):** ahora incluye el estado y la hora del escaneo, así que el detalle ya no depende de la tabla.
   - La tabla recorre **todo el catálogo**, con y sin ofertas, paginada en el servidor.
   - Árbol de categorías generado de los datos de Forever («Todos los objetos», categorías y subcategorías desplegables, con icono y contador).
   - Filtros de calidad (colores con nombre), nivel, precio, profesión relacionada y «Solo con ofertas» (desactivado al empezar), más «Limpiar filtros».
   - Columnas: icono y nombre por calidad, precio mínimo, cantidad, variación con flecha y minigráfico.
   - Orden por nombre, precio, cantidad y variación.
   - Estados «Sin ofertas» y «Sin datos».
3. **V3 · Detalle compacto y buscador** ✅ (2026-11-09; migración 0018):
   - **«Esperar» en vez de «En observación»:** el código interno sigue siendo OBSERVACION; solo cambia el nombre en la página.
   - **Etiqueta solo con evidencia:** el campo `evidencia` vale false con historial corto, sin precios, fuera del último escaneo, precio extremo o dato antiguo. En esos casos la página muestra «Sin datos suficientes».
     - Hoy les pasa a todos los objetos de AHledger porque solo hay ~1,6 días de historial; el motor pide 7 días y 10 observaciones.
   - **Ficha:** muestra el mínimo y el máximo de 30 días observados.
   - **Buscador:** comprobado con teclado («linen»: 10 sugerencias; la 11.ª pulsación de Tab sale al siguiente control, y Escape no toca el texto).
   - Icono grande, calidad, ID copiable, tipo y nivel.
   - Precio actual, mínimo y mediana, cantidad, y gráfico de 24 h, 7 d, 30 d y 90 d con los huecos marcados.
   - Etiqueta «Vender», «Guardar» o «Esperar» («EN OBSERVACIÓN» pasa a llamarse «Esperar») y «Ver motivo» desplegable.
   - Desplegables con propiedades, recetas y profesiones; enlace discreto a Wowhead.
   - Sugerencias del buscador con icono y calidad (el manejo de Tab, flechas y Escape ya cumple la especificación).
4. **V4 · Ampliar y medir el catálogo** ✅ (2026-11-09; migración 0019):
   - **Cola del catálogo:** junta los objetos vistos en subasta, los de las recetas y los IDs importados.
   - **Verificación:** cada ID se comprueba con AHledger antes de entrar. Si la fuente no lo tiene, queda contado como «sin ficha en la fuente».
   - **Cobertura medida al aplicar:** 6.602 objetos conocidos, de ellos 5.041 vistos en subasta y 2.614 citados en recetas (1.561 solo por recetas). En el catálogo había 5.042, con 1.560 pendientes; pg_cron los completa en lotes de 150 cada 5 min.
   - **Importación:** panel «Catálogo» en la barra lateral, que acepta IDs, un CSV con columna itemId o enlaces de Wowhead.
   - **Blizzard:** no se ha hecho porque no hay credenciales; queda opcional.
   - Alta de los 1.562 objetos de las recetas desde AHledger.
   - Importación verificable por CSV.
   - Recuento de cobertura por fuente.
   - **Opcional, si creas el cliente de Battle.net:** probar la búsqueda de `static-forever-us`. Si permite recorrer el catálogo, traer todos los IDs, los nombres en español y la vinculación, informando de cuántos da 404.
5. **V5 · Estados y repaso final** ✅ (2026-11-09):
   - **Caída simulada** deteniendo el servidor local: el indicador pasa a «Sin conexión», con un único aviso y conservando la tabla y el detalle. Al volver el servidor se recupera en 13 s con el aviso «Conexión recuperada»; el detalle se refresca sin cerrar los apartados desplegados.
   - **Carga:** la tabla se atenúa con aria-busy y un indicador giratorio mientras llega la página siguiente. Una respuesta de error ya no se descarta en silencio.
   - **Criterios de entrega comprobados:**
     - una sola sección («Mercado»);
     - controles en la barra lateral;
     - objeto sin ofertas encontrado por el buscador y por la tabla;
     - sin párrafos explicativos ni «tiempo real»;
     - sin desbordes a 375 px.
   - **Iconos:** son los que AHledger asigna a cada ID con `game=forever`, servidos desde el CDN de Blizzard por la ruta `classic1x`.
   - Esqueletos de carga y aviso breve sin conexión, conservando el último dato.
   - Diferenciar la hora del dato de la hora de la consulta y evitar peticiones duplicadas.
   - Comprobación completa en PC y móvil con la lista de criterios de entrega.
