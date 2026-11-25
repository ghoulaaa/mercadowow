# Informe diario del mercado (MercadoWoW · Market Intelligence)

Cada día, a la hora elegida y en la zona horaria elegida, MercadoWoW calcula un informe de las **últimas 24 horas**
de la casa de subastas frente a las 24 horas anteriores, lo dibuja como **una imagen PNG** y lo envía a Discord.
Solo analiza y avisa: nada compra, vende ni actúa en el juego.

## Dónde se configura

*Fabricación → Informes* («Informes y Webhooks»):

- activar o desactivar el envío automático, mercado, hora y zona horaria (el próximo envío se muestra arriba);
- webhooks que lo reciben (los mismos del Crafting Sniper; se añaden en *Sniper → Alertas Discord*, donde la URL se
  guarda cifrada en Supabase Vault y no se vuelve a mostrar). Sin ninguno marcado, va a todos los activos;
- secciones visibles, descuento mínimo de las gangas, ROI mínimo de los crafteos, beneficio mínimo, liquidez mínima
  (ventas al día) y objetos por sección (3–5);
- nombre del webhook (por defecto «MercadoWoW | Market Intelligence») y avatar opcional;
- botones: **Generar informe ahora** (vista previa, sin enviar), **Enviar informe a Discord**, **Probar webhook**,
  **Descargar PNG** y **Guardar configuración**; historial de los últimos informes con su estado.

La vista previa de la página y la imagen de Discord salen del **mismo código** (`app/static/informe.js`).

## Cómo funciona

1. `pg_cron` revisa cada 15 minutos `informe_toca()`: activo, con webhooks, pasada la hora de hoy en su zona, sin
   informe enviado hoy, menos de 3 intentos fallidos (el último hace más de 20 min) y nadie generándolo.
2. La Edge Function (`{"tarea": "informe"}`) lee los datos (`informe_base`, SQL), calcula el informe
   (`analizarInforme`), lo guarda en `informes` (los datos, no la imagen) y pide el PNG en otra petición
   (`{"tarea": "informe_png"}`, con el token interno, para que tenga su propio tiempo de CPU).
3. Lo envía a cada webhook como multipart (`payload_json` + `files[0]`), con la imagen dentro del embed mediante
   `attachment://mercadowow-report.png`, color dorado, enlace al panel y el resumen del día. Discord muestra la
   imagen reducida dentro del mensaje; al pulsarla se ve a tamaño completo.
4. El resultado queda en el historial: enviado, enviado a medias (algún webhook falló) o error (con el motivo, sin
   la URL). Un fallo se reintenta en la siguiente vuelta, como mucho 3 veces al día. Se guardan los 90 últimos.

La imagen mide 1600 de ancho en el dibujo y se exporta a **1200 px** de ancho (el render tarda la mitad y cabe en el
tiempo de CPU de la Edge Function); el alto depende del contenido.

## Secciones y criterios

Precios por **unidad**, en cobre, siempre con oro, plata y cobre. Solo se usan los **escaneos válidos**: una hora con
menos del 90 % de los objetos habituales o menos del 60 % de las unidades habituales se descarta (y el pie lo dice).

| Sección | Qué muestra | Criterio |
|---|---|---|
| Indicadores | Unidades publicadas (máximo del día), su variación media frente a ayer, oro movido al día y unidades vendidas al día | El proveedor no da el número de subastas: se usan **unidades publicadas**. Ventas y oro son **estimaciones** (ventas/día del proveedor × precio). |
| Actividad 24 h | Unidades publicadas en cada escaneo válido, con máximo, mínimo y último | Sin escaneo no hay punto: nada se rellena. Menos de 3 escaneos: «Datos insuficientes». |
| Mayor volumen de oro | Los objetos que más oro mueven al día | Ventas/día ≥ liquidez mínima (y ≥ 0,5). Precio: mediana de 24 h sin pasar de la mediana de 30 días (un anuncio inflado no mueve oro). |
| Más comercializados | Más unidades vendidas al día | Igual; la variación solo si la comparación es fiable. |
| Mayores subidas / caídas | Mediana de 24 h frente a la de las 24 h anteriores | Comparación **fiable**: escaneos suficientes en ambas ventanas, al menos 3 unidades publicadas, precio anterior ≥ 1 plata, ventas/día ≥ liquidez mínima, al menos un 5 % de cambio y **como mucho 20 veces** (más se trata como anomalía o manipulación). En caídas, «posible compra» si se vende a diario y está por debajo del 80 % de su mediana de 30 días. |
| Arbitraje entre facciones | Mismo objeto en Horda y Alianza | Solo si se registra la otra facción con el mismo proveedor y escaneos recientes. Hoy solo se registra la Horda: la sección lo dice. Usa el precio típico de cada lado, exige ≥ 1,5 veces y descuenta un 15 % de comisión (casa neutral; valor sin verificar). Nunca se presenta como beneficio garantizado. |
| Gangas del día | Compra mínima actual frente a su referencia | Referencia = la menor de la mediana de 7 días (MercadoWoW) y la de 30 días (proveedor). Descuento ≥ mínimo, liquidez ≥ mínima, beneficio neto ≥ mínimo tras 5 % de comisión y depósito, y la mediana del día ≥ 60 % de la referencia (si todo el mercado del objeto cayó, no es una ganga puntual). Reventa recomendada: referencia − 5 %. Confianza **alta**: ≥ 2 ventas/día, ≥ 12 escaneos, medianas de 7 y 30 días coherentes (±30 %) y precio del día ≥ 85 % de la referencia; si no, **media**. |
| Mejores crafteos | Las recetas más rentables del día | El mismo cálculo y las mismas protecciones que el Crafting Sniper (coste con materiales a precio de subasta, comisión y depósito, escenario conservador, demanda, Score). ROI y beneficio ≥ mínimos, riesgo como mucho medio. |
| Categorías | Mediana de la variación de cada objeto, cuántos suben (> 2 %) y bajan (< −2 %) | Categorías del catálogo (clase/subclase de Blizzard); barras = «Metal & Stone» cuyo nombre acaba en «Bar». Menos de 3 objetos: «Sin datos». |
| Datos interesantes | Hasta 4 hechos del día | Solo los que existen en los datos (mayor subida, mejor ganga, categoría más movida, hora punta, objeto con más oro, mejor crafteo). |

El resumen del encabezado se escribe a partir de esas cifras (sin plantillas fijas ni IA).

## Seguridad

- La URL del webhook solo se lee en la Edge Function y nunca llega a la página, la API, los registros ni los errores.
- El PNG solo lo dibuja la Edge Function con el token interno (`sniper_token()`); la página lo descarga a través de
  `/api/informes?png=ID`, que exige haber iniciado sesión.
- Fuentes (Inter, Cinzel) y resvg se descargan de jsDelivr en versiones fijas y se comprueba su SHA-256. Los iconos
  solo se aceptan de `render.worldofwarcraft.com` y `ahledger.com/icons/`.
- Las tablas y funciones no son accesibles con las claves públicas de Supabase.

## Pruebas

`supabase/pruebas/informe.test.ts` (PGlite y un Discord falso): cálculos con datos conocidos, horas incompletas,
nada inventado, envío con imagen adjunta, una vez al día a su hora, reintentos limitados y validación.
