# MercadoWoW Crafting Sniper · avisos a Discord

El Crafting Sniper analiza todas las recetas con los precios del último escaneo y avisa por Discord de las
oportunidades de fabricación que cumplen tu configuración. Funciona en el servidor (Supabase): no hace falta
tener la página abierta. **Solo analiza y avisa**: no compra, no vende ni hace nada dentro del juego.

## Cómo funciona

1. **Cada 5 minutos**, `pg_cron` ejecuta `disparar_sniper()`. Solo llama a la Edge Function si el sniper está
   activo, hay algún webhook activo, nadie más está analizando, y llegó un escaneo nuevo o pasó el intervalo
   configurado.
2. La Edge Function (tarea `sniper`) calcula **con el mismo motor que la página** (`app/static`, copiado con
   `npm run motor`): coste con el material más barato entre subasta, NPC o fabricarlo; venta; comisión;
   ganancia neta; ROI; margen y precio de equilibrio.
3. Para cada receta con ganancia añade:
   - **Clasificación por ROI**: rentable, ganga, épica, legendaria y excepcional, con umbrales configurables.
   - **MercadoWoW Score (0–100)**. Rentabilidad conservadora 30 · demanda 25 · estabilidad 15 · materiales 15 ·
     competencia 10 · actualidad 5. Lo que no se sabe puntúa 0 y se indica.
   - **Protección contra falsas gangas**:
     - Precio actual frente a su mediana de 24 h, 7 y 30 días: más del doble de la de 7 o 30 días bloquea el aviso.
     - Escaneo demasiado viejo.
     - Producto sin ventas registradas.
     - Materiales publicados insuficientes.
     - Precio sospechoso frente a su histórico o a lo que paga el NPC.
   - **Escenario conservador**: venta al menor entre el precio actual y sus medianas, y un 5 % más barato. Si en
     ese escenario no gana, no se avisa.
4. Envía como mucho N avisos por análisis y **no repite** una oportunidad salvo que:
   - sea nueva;
   - vuelva tras desaparecer;
   - suba de clase;
   - la ganancia suba un X %;
   - el coste baje un Y %;
   - o haya pasado el intervalo de repetición.
5. Respeta los límites de Discord: espera lo que pida un `429` y reintenta una vez, y deja ~0,7 s entre envíos.

Datos que no existen no se inventan: las ventas son las que publica la fuente (AHledger del reino o TSM de
toda la región, marcadas como «región»). La fuente solo publica el precio mínimo por unidad, no la profundidad
del mercado, así que los costes de muchas unidades son estimaciones y así se indica.

## Instalación (una vez)

1. **Migraciones**: `0045_sniper.sql` (tablas y funciones) y `0046_sniper_cron.sql` (tarea programada).
   Se aplican con `configurar.bat` o con:
   ```
   .\.venv\Scripts\python.exe -c "from app import config, db; s=config.load_settings(); c=db.connect(s.database_url); print(db.apply_migrations(c))"
   ```
2. **Edge Function** con la tarea nueva (lleva el motor copiado en `motor/`):
   ```
   npm run motor
   npx supabase functions deploy actualizar-mercado --remote=<proyecto> --no-verify-jwt --use-api --yes
   ```
3. **Vercel**: `npm run vercel` y subir los cambios (la ruta `/api/sniper` va en `api/index.js`).

## Configurar Discord

1. En Discord: *Ajustes del servidor → Integraciones → Webhooks → Nuevo webhook*. Elige el canal y pulsa
   *Copiar URL del webhook*.
2. En MercadoWoW: *Fabricación → Sniper → Alertas Discord*. Pega la URL en «Añadir webhook».
   - La URL se valida: solo se aceptan direcciones `https://discord.com/api/webhooks/…`.
   - Se guarda **cifrada en Supabase Vault**.
   - Nunca se vuelve a mostrar: la página solo ve una pista (`discord.com/api/webhooks/1234…5678/••••`).
3. Pulsa **Probar**. Llega un mensaje de prueba sin cifras.
4. Ajusta lo que quieras avisar y activa **Avisos automáticos**. Puedes configurar:
   - ROI mínimo, beneficio mínimo, Score mínimo y riesgo máximo;
   - profesiones, y objetos incluidos o excluidos (por ID);
   - frecuencia, espera entre repeticiones y mejora necesaria para repetir;
   - comisión, escenario conservador y umbrales de cada clase;
   - mención de un rol (por su ID, nunca `@everyone`) desde la clase elegida.
5. Puedes tener varios webhooks y elegir las profesiones de cada uno (por ejemplo, uno para Alquimia).

## Apariencia del mensaje (migración 0047)

Cada oportunidad es **un solo embed**:

| Parte | Contenido |
|---|---|
| Autor | Clase de la oportunidad (p. ej. «GANGA LEGENDARIA»; «· ENVÍO MANUAL» si se envió a mano) |
| Título | Nombre del objeto, con enlace a su ficha en MercadoWoW |
| Descripción | Profesión (en detallado: nivel, mercado y por qué se avisa) |
| Miniatura | Icono real del objeto (catálogo de MercadoWoW, servido por Blizzard). Sin icono: el de «objeto desconocido» de Blizzard |
| Fila 1 | Fabricación · Venta · Beneficio neto |
| Fila 2 | ROI · Stock material (fabricaciones posibles con lo publicado) · Riesgo |
| Materiales | Cantidad × nombre · coste total |
| Enlaces | MercadoWoW y Wowhead Forever |
| Pie | «MercadoWoW · Actualización automática» y la hora (la pone Discord en la zona de cada uno) |

Desde *Alertas Discord → Apariencia del mensaje*, con **vista previa en vivo** (con una oportunidad real
del último análisis), se puede cambiar:
- nombre y avatar del webhook (Discord no admite «discord» ni «clyde» en el nombre);
- modo **compacto** o **detallado** (añade Score y confianza, ventas al día, escenario conservador y avisos);
- mostrar u ocultar icono, materiales, medianas de 7 y 30 días y enlaces;
- monedas `125g 40s 20c`, `125o 40p 20c` o los **emojis del servidor** (`<:oro:id>`; si falta alguno, se usa la letra);
- el color de la barra lateral de cada clase (por defecto: verde #1EFF00, azul #0070DD, morado #A335EE,
  naranja #FF8000 y dorado #FFD700).

La vista previa no carga avatares ni emojis externos (la página solo muestra imágenes de Blizzard); en Discord sí.
Lo que bloquearía un aviso automático (escaneo viejo, sin ventas, precio disparado) siempre sale en «⚠️ A tener
en cuenta»: solo puede llegar en un envío manual.

## Tarjeta gráfica (migración 0048)

Con *Diseño de Webhook → Estilo: Tarjeta gráfica* (el estilo por defecto), cada aviso lleva **dos imágenes PNG
apaisadas** (como mucho 4:3, porque Discord encaja la imagen de un embed en ~400 × 300 px y una tarjeta alta se
encogería hasta no leerse):

1. `mercadowow-alert.png` — **resumen**: clase, icono y nombre, beneficio neto, ROI, coste, venta, Score, riesgo,
   stock, fuente de los precios y hora. Va en el primer embed, con el título enlazado y los enlaces clicables.
2. `mercadowow-detalle.png` — **detalle**: materiales (cantidad y coste total) e historial del precio. Va en un
   segundo embed sin enlace (si no, Discord juntaría las dos imágenes en una galería pequeña). Solo se adjunta si
   hay materiales visibles o gráfico; si falla al dibujarse, se envía el resumen solo.

Las cifras van en las imágenes, sin repetirlas en texto. En modo detallado, la fabricación recomendada va en la
descripción del embed (texto). La vista previa de la página las muestra al tamaño real de Discord (400 px).

- **Un solo generador** (`app/static/tarjeta.js`) dibuja la tarjeta en SVG: la página lo usa para la vista previa
  y la Edge Function lo convierte en PNG con resvg (`tarjeta_png.ts`). La vista previa es la misma imagen que llega
  a Discord.
- Contenido: cabecera de la clase, icono real y calidad, coste, venta y beneficio neto, barras de ROI (escala
  configurable) y Score, riesgo, stock en subasta y fabricable, reparto del precio de venta, materiales con icono,
  **fabricación recomendada** (veces, inversión, ingreso, comisión y depósito, beneficio y precio mínimo; limitada
  por la demanda, los materiales publicados y el presupuesto opcional) y el **gráfico del precio** de 24 h, 7, 14 o
  30 días.
- El gráfico usa **solo el historial real** (`price_hourly`, mínimo por hora). Con menos de 3 puntos dice
  «Historial insuficiente»; nunca se rellenan huecos.
- El pie indica la fuente: «Prices from AHledger» o «Precios: TradeSkillMaster».
- Opciones: tema oscuro o negro, ancho 800/1000/1200 px, periodo del gráfico, escala del ROI, presupuesto,
  y mostrar u ocultar gráfico, barras, Score, riesgo y fondo de la clase. La hora sale en tu zona horaria.
- Cada tarjeta se dibuja en una **petición aparte** de la Edge Function (`{"tarea":"tarjeta"}`), protegida por un
  token interno que solo conoce la base de datos (`sniper_token()`); así cada imagen tiene su propio límite de CPU.
- La fuente Inter y el motor resvg se descargan de jsDelivr con versión fija y se **comprueba su SHA-256**. Los
  iconos solo se aceptan de `render.worldofwarcraft.com` (JPG/PNG, < 200 KB) y se guardan en caché.
- Si la tarjeta no se puede dibujar (fallo o tiempo agotado), se envía el **mensaje de texto** de siempre. En el
  historial de avisos queda registrado si se usó la tarjeta.

No incluido (por ahora): historial del coste de los materiales en el gráfico, tipografía o logotipo propios e
imagen de fondo.

## Seguridad

- La URL del webhook solo se lee en la Edge Function (servidor) y nunca aparece en la página, en las
  respuestas de la API, en los registros ni en los mensajes de error.
- Todas las acciones exigen haber iniciado sesión en MercadoWoW. Las pruebas, envíos manuales y «Analizar
  ahora» están limitadas a una petición cada 10 segundos.
- Todo se valida en SQL: URL de Discord, rangos numéricos, umbrales ordenados, mercado existente y listas de IDs.
- Las tablas del sniper no son accesibles con las claves públicas de Supabase (RLS activado y permisos revocados).

## Pruebas

- `npm test`. Comprueba:
  - el motor (`netlify/pruebas/sniper_motor.test.ts`);
  - la tarea con Postgres simulado y un Discord falso (`supabase/pruebas/sniper.test.ts`): envío, no repetir,
    falsas gangas, 429, prueba, envío manual y turno;
  - que la copia del motor coincide con la de la página.
