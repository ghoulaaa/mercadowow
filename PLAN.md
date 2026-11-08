# Plan de implementación — Mercado WoW Forever (US / PvP / Horda)

Fecha del plan: 2026-11-07. Las fuentes de la sección 1 se comprobaron ese mismo día con peticiones reales.

---

## 1. Fuentes verificadas (antes de escribir código)

### 1.1 Fuente principal: archivos públicos de TradeSkillMaster ✅ VERIFICADA

| Dato | Valor comprobado |
|---|---|
| URL del mercado exacto | `https://public-data.tradeskillmaster.com/forever/us/realm/pvp-horde/items.csv` |
| Respuesta | HTTP 200, unos 224 KB, unos 3.730 objetos |
| Columnas | `itemId, name, marketValue, minBuyout, recent, historical, updatedAt` |
| Unidades | cobre (1 oro = 100 plata = 10.000 cobre) |
| Hora del dato | `updatedAt` = hora del escaneo original (por ejemplo `2026-11-07T22:16:24Z`) |
| Cabeceras | `ETag`, `Last-Modified`, `Cache-Control: max-age=14400` (4 h) |
| Petición condicional | `If-None-Match` con el ETag devuelve **304 No modificado** ✅ (probado) |
| Cadencia de TSM | Los archivos de mercado cambian «cada pocas horas» según TSM, no cada hora |
| Autorización | Los Términos de TSM prohíben bots y scrapers **salvo** por las vías que TSM ofrece, y nombran los archivos públicos de precios como una de ellas. Licencia personal y no transferible: encaja con un uso personal. |
| Separación de mercados | El slug `pvp-horde` es propio de este mercado. `pvp-alliance` y `normal-horde` existen y son **otros** mercados. `pve-horde` da 404. |

**Lo que este archivo NO trae** (y por lo tanto la app NO inventará):
- ❌ Cantidad en venta ni número de subastas: no hay «oferta disponible».
- ❌ Ventas, tasa de venta ni unidades vendidas al día del mercado PvP Horda.
- ❌ Iconos, categoría ni precio de venta al vendedor (este último hace falta para calcular el depósito).
- ⚠️ `historical` y `recent` son agregados propios de TSM. Su definición exacta (ventana de días) hay que confirmarla en la documentación de TSM antes de mostrarlos como «mediana de X días».

### 1.2 Archivo regional de TSM ⚠️ NO es el mismo mercado
`https://public-data.tradeskillmaster.com/forever/us/region/items.csv` trae `avgSalePrice, saleRate, soldPerDay`, pero **agrega toda la región US de Forever** (todas las facciones y reglas). Mezclarlo violaría el requisito de separar mercados.
**Decisión:** no se usa en el motor de recomendaciones. Como mucho se muestra aparte, con la etiqueta «Referencia regional (no es PvP Horda)», y queda desactivado por defecto.

### 1.3 API de Blizzard (Battle.net) 🧪 EXPERIMENTAL, opcional
- Según desarrolladores externos (foro de Blizzard, 6 de noviembre de 2026), funcionan los namespaces `dynamic-forever-us` y `static-forever-us`, y las rutas `/data/wow/ruleset/{id}/auctions/` y `/data/wow/ruleset/{id}/auctions/{houseId}`. **No hay documentación oficial de Blizzard.**
- Problemas conocidos: el `ruleset` no filtra (devuelve las mismas subastas con 1, 2 y 3), hay 15 casas y **no está documentado qué ID corresponde a «Horde» en PvP**, algunos objetos de `/data/wow/item/{id}` dan 404 y las respuestas grandes pesan unos 9 MB.
- Requiere credenciales gratuitas de develop.battle.net (client id y secret, guardadas solo en el servidor).
- **Qué aportaría:** iconos, categoría, precio de vendedor (depósito) y, si se valida el ID de la casa, la cantidad real en venta.
- **Regla:** no se activa para la oferta disponible hasta validar el ID de la casa comparando su precio mínimo con el `minBuyout` de TSM en varias horas. Mientras tanto se usa solo para metadatos de objetos (iconos y categorías), que no dependen del mercado.

### 1.4 Comisión y depósito ⚠️ NO publicados oficialmente por Blizzard
- Comisión de la casa de subastas de facción (Horda): **5 %** según guías de terceros (regla de Classic). La casa neutral, 15 %. Blizzard no ha publicado cifras para Forever.
- Depósito: fórmula de Classic según el precio de vendedor y la duración (2 h, 8 h o 24 h). Hay un **mínimo actual de 1 plata**, con un cambio anunciado a 1 cobre (sin fecha).
- **Decisión:** comisión, porcentajes de depósito y mínimo serán **configurables**. La interfaz los mostrará como «valor asumido, no verificado oficialmente» hasta que tú los confirmes en el juego.

### 1.5 Otras webs (AHledger, ForeverMastery, BootyBayBroker…)
No documentan una API pública ni condiciones de uso automatizado. **No se usan.**

### 1.6 Consecuencias directas para la app
1. «Oferta disponible» y liquidez: se muestran como **«sin dato»** con la fuente actual. El motor nunca las simula.
2. Al principio **no hay historial propio**. Las medianas de 7, 14 y 30 días aparecen a medida que la app acumula observaciones. Los primeros 7 días casi todo estará EN OBSERVACIÓN (es lo honesto).
3. Consultar cada 60 min es correcto y barato gracias al ETag: la mayoría de las consultas devolverán 304 y **no** crearán una observación nueva.
4. Sin credenciales de Blizzard: sin iconos reales (marcador genérico), categoría «Sin clasificar» o asignada a mano, y depósito introducido a mano.

---

## 2. Arquitectura

> **Cambio del 2026-11-07:** a petición tuya, la base de datos **no está en el PC**: está en **Supabase** (Postgres).
> La consulta horaria también corre en Supabase (pg_cron + Edge Function `actualizar-mercado`), así que el historial crece aunque el PC esté apagado.
> La página web sigue en el PC. El esquema real está en `db/migraciones/`, y la guía en `docs/SUPABASE.md`.
> El árbol de abajo es el diseño original con SQLite y queda solo como referencia.

```
mercadowow/
├─ app/
│  ├─ main.py            # servidor web (FastAPI) + arranque del programador
│  ├─ config.py          # variables de entorno (.env)
│  ├─ db.py              # SQLite, migraciones, copias de seguridad
│  ├─ providers/
│  │  ├─ tsm.py          # descarga CSV con ETag, caché y reintentos
│  │  ├─ blizzard.py     # (opcional) metadatos de objetos
│  │  └─ demo.py         # datos FICTICIOS, mercado "demo" separado
│  ├─ scheduler.py       # tarea horaria, bloqueo anti-duplicados
│  ├─ engine/
│  │  ├─ stats.py        # medianas, tendencia, volatilidad, extremos
│  │  ├─ fees.py         # comisión, depósito, ingreso neto
│  │  └─ rules.py        # VENDER / GUARDAR / EN OBSERVACIÓN + explicación
│  ├─ api/               # rutas JSON + eventos en vivo (SSE)
│  └─ static/            # interfaz: HTML + CSS + JS sin compilación
├─ tests/                # pytest
├─ data/                 # mercado.db (no se sube a git)
├─ backups/
├─ .env.example
├─ iniciar.bat / instalar.bat / registrar_tarea.ps1
├─ Dockerfile (opcional)
└─ README.md
```

**Tecnologías** (ligeras y sin servicios extra):
- **Python 3.14** (ya instalado) + **FastAPI** + **uvicorn** + **httpx**. Un solo proceso.
- **SQLite** en modo WAL. Sin Redis, sin colas y sin Node en ejecución.
- Interfaz: HTML/CSS/JS sencillo + **uPlot** (gráficos, unos 40 KB, guardado en el proyecto) para no depender de un CDN.
- Actualización en vivo del panel con **Server-Sent Events**: el panel se refresca solo, sin recargar la página.
- Sin IA ni modelos locales.

**Esquema de datos** (todas las tablas llevan `market_id`; ningún dato existe sin mercado):
- `markets` (id, provider, game_type, region, slug, is_demo)
- `items` (item_id, name, category, icon_url, vendor_price, metadata_source)
- `snapshots` (market_id, source_etag, source_updated_at, fetched_at, row_count): un registro por versión **nueva** del archivo.
- `price_hourly` (market_id, item_id, hour, market_value, min_buyout, recent, historical): agregado por hora.
- `price_daily`: compactación de lo que tenga más de N días.
- `fetch_log` (inicio, fin, resultado, código HTTP, error, intento)
- `inventory`, `favorites`, `sales` (ventas reales registradas por ti), `recommendation_log` (una instantánea diaria de cada recomendación, para evaluar después)
- `settings` (umbrales del motor, comisión, depósito, retención)

---

## 3. Motor de recomendaciones (reglas transparentes)

Precio de referencia de venta = `minBuyout` (lo que tendrías que igualar o mejorar). Si falta, se usa `marketValue` y se indica.

**Paso 0, calidad de datos**
- Dato antiguo: `updatedAt` con más de X horas (por defecto 8) → **EN OBSERVACIÓN** («datos antiguos»).
- Historial propio con menos de 7 días o menos de N observaciones distintas → **EN OBSERVACIÓN**. Se muestra igualmente la comparación con `historical` de TSM como dato informativo.
- Precio extremo: `minBuyout` mayor que K × mediana de 30 días o muy distinto de `marketValue` → aviso «posible precio extremo o mercado con poca oferta (inferido)» y la confianza baja.

**VENDER** (todas las condiciones, configurables)
- Precio actual ≥ +15 % sobre la mediana de 7 días **y** ≥ +10 % sobre la de 30 días.
- La subida se mantiene en al menos 2 observaciones (no es un pico aislado).
- Ingreso neto > 0 después de comisión y depósito.
- Si la tendencia de 7 días sigue subiendo con fuerza, se añade la nota «podría seguir subiendo; riesgo de esperar».

**GUARDAR** (un precio bajo por sí solo NO basta)
- Precio actual ≤ −15 % frente a la mediana de 30 días.
- **Además** hay evidencia de recuperación: en el historial disponible el precio volvió a estar cerca de la mediana después de caídas parecidas.
- La tendencia de 14 días no es una caída continua. Si lo es, se considera un descenso estructural → EN OBSERVACIÓN.
- Horizonte orientativo = mediana del tiempo que tardó en recuperarse en el pasado, o «no estimable».

**EN OBSERVACIÓN**: todo lo demás (señales contradictorias, historial corto, datos antiguos).

**Cada recomendación explica** cifras (precio actual, medianas, % de diferencia), fecha del dato, riesgos (sin dato de liquidez, comisión asumida…) y horizonte. Nunca dice «subirá» ni «se venderá».

**Liquidez y oferta**: con TSM solo, se marcan «sin dato» y la confianza máxima queda limitada a Media. Si un objeto desaparece del archivo, no se interpreta como venta.

**Confianza** (Alta / Media / Baja, con puntuación 0–100 visible y desglosada): días de historial, número de observaciones, antigüedad del dato, precios extremos, datos de liquidez disponibles o no. Se rotula como «índice de calidad de datos, no es una probabilidad».

**Cálculos de dinero** (`fees.py`)
- Ingreso bruto = precio × cantidad.
- Comisión = bruto × 5 % (configurable).
- Depósito = máx(mínimo, % × precio de vendedor × cantidad). Se **recupera** si se vende y se **pierde** si expira.
- Pérdida esperada por depósitos = depósito × relistados esperados. Al principio es una suposición configurable y etiquetada; luego se ajusta con tus ventas reales registradas.
- Ingreso neto estimado = bruto − comisión − pérdida esperada por depósitos.
- Con coste de adquisición: beneficio neto y margen. **Sin coste: se muestra «coste desconocido»**, nunca un beneficio.

**Evaluación**: registras ventas reales (objeto, cantidad, precio, fecha). La pantalla «¿Acertó?» compara la recomendación del día con el precio de 7 y 14 días después y con tus ventas reales.

---

## 4. Actualización automática

- Tarea dentro del servidor cada 60 min (con un pequeño desfase aleatorio), funcione o no el navegador.
- **Anti-duplicados**: bloqueo de instancia única (archivo con PID) y una fila «en curso» en SQLite con caducidad. Si ya hay una consulta corriendo, la nueva se descarta y queda registrado.
- **Botón manual**: solo permite 1 consulta cada 5 min. Si hay una en curso, responde «ya se está actualizando».
- **Caché**: ETag y Last-Modified. Una respuesta 304 actualiza «última consulta correcta», pero **no** crea una observación.
- Si cambia el ETag pero `updatedAt` es igual al anterior, tampoco se crea observación.
- **Reintentos**: 3 intentos con espera creciente (30 s, 2 min, 8 min) y respeto de `Retry-After`. Los errores quedan en `fetch_log` y en `logs/app.log` (rotativo).
- **Fallo**: se conserva el último dato válido y se muestra su antigüedad en rojo.
- **Panel de estado**: proveedor, mercado, hora del dato original, última consulta correcta, próxima actualización y último error.
- **Aviso visible**: «Las actualizaciones solo ocurren con el PC encendido, conectado y sin suspensión.»

---

## 5. Interfaz

- Tema oscuro con colores de calidad de objeto al estilo WoW, adaptable a PC y móvil.
- **Panel**: tarjetas de «Oportunidades de venta», «Para guardar», «Alertas» (datos antiguos, precios extremos, fallos) y «Estado de actualización».
- **Tabla**: icono, nombre, precio unitario (formato **12o 34p 56c**), referencia histórica, variación de 24 h y 7 días («—» si no hay historial), oferta («sin dato»), recomendación y confianza.
- Búsqueda, filtros por categoría y recomendación, favoritos (★), orden por ingreso neto estimado.
- **Detalle**: gráfico histórico (min buyout, market value y medianas), explicación completa y cálculo de ingreso.
- **Inventario**: alta manual con autocompletado e importación CSV (`itemId o nombre, cantidad, coste_unitario opcional`) con informe de filas rechazadas.
- **Importación CSV de precios** como plan B si TSM deja de estar disponible. Se rotula la fuente como «importación manual».
- **Modo demo**: mercado `demo` aparte, con una franja permanente «DATOS FICTICIOS».

---

## 6. Retención, copias y consumo

- Datos horarios: 30 días (configurable). Después se compactan en diarios (mediana, mínimo y máximo), que se guardan 365 días.
- Instantáneas de recomendaciones: una diaria por objeto del inventario o favorito.
- Copia de seguridad diaria con la API de backup de SQLite en `backups/`, conservando las últimas 7. Incluye script de restauración.

**Estimaciones (NO medidas todavía)**, con unos 3.730 objetos y unas 6–8 versiones nuevas al día:

| Recurso | Estimación |
|---|---|
| Tráfico | unos 224 KB por versión nueva × 6–8 ≈ **1,5–2 MB/día**; los 304 ≈ 1 KB cada uno |
| Disco | **Medido** (2026-11-07, PGlite/Postgres 17, SQL real, CSV real de 3.728 objetos): **0,48 MB por versión nueva** (135 B por fila) y **0,43 MB por día compactado**. Con 4–8 versiones al día: 58–115 MB con 30 días de datos horarios; sin compactar, se llega a 500 MB en 4–8 meses. Con compactación: unos 215–275 MB al año. La cadencia real de TSM está sin medir. |
| RAM | unos 60–120 MB el proceso Python en reposo |
| CPU | casi 0 % en reposo; 1–3 s de CPU al procesar una versión nueva |

En el hito final se **medirán** de verdad (RSS y CPU con psutil, tamaño de la base de datos) y se publicarán separadas de estas estimaciones.

---

## 7. Hitos (uno por sesión de trabajo)

| # | Hito | Resultado verificable |
|---|---|---|
| **1** ✅ | Esqueleto + configuración + base de datos (rehecho para Supabase) + `iniciar.bat` | Página local con el estado; pruebas de configuración |
| **2** ✅ | Conector TSM en Supabase: ETag, reintentos, registro, pg_cron, anti-duplicados | 2026-11-08: primera descarga real (3.728 objetos) y disparo automático de pg_cron verificado (respuesta 304, sin observación nueva) |
| **3** ✅ | Datos demo separados + importación CSV de precios | 2026-11-08: tres mercados (TSM, importación manual, DEMO). La BD impide mezclarlos (trigger de origen + clave compuesta). Demo con 16 objetos [FICTICIO] generado en Supabase |
| **4** ✅ | Interfaz: panel, tabla, formato oro/plata/cobre, filtros, favoritos, estado en vivo | 2026-11-08: tabla de 3.829 objetos (95 ms en Supabase). Refresco en vivo verificado sin recargar la página. **Cambio respecto al plan:** en vez de SSE se consulta una «huella» mínima cada 30 s (cada 5 s tras pulsar Actualizar), porque las funciones de Netlify no mantienen conexiones abiertas; solo con la pestaña visible |
| **5** | Motor: estadísticas, comisión y depósito, reglas, confianza, explicaciones | Tests con casos de VENDER, GUARDAR y OBSERVACIÓN |
| **6** | Inventario (manual + CSV), beneficio y margen, detalle con gráfico | Sin coste → no se muestra beneficio (con test) |
| **7** | Ventas reales + evaluación «¿Acertó?» | Informe de aciertos con tus ventas registradas |
| **8** | Retención, compactación (límite de 500 MB del plan gratuito), copias, logs | Compactación y restauración probadas |
| **9** | *(Opcional)* Blizzard API: iconos y categorías; validación experimental de la oferta | Solo si das de alta las credenciales |
| **10** | Arranque automático en Windows (Programador de tareas), Docker opcional, README, medición real de consumo | Documento con medidas reales |

### Pruebas obligatorias (pytest)
- Separación de mercados: datos de `pvp-alliance` o `demo` nunca aparecen en `pvp-horde`.
- Unidades: 1 → `1c`, 10 000 → `1o`, 123 456 → `12o 34p 56c`, y valores negativos y nulos.
- Beneficio: con coste, sin coste, comisión y depósito recuperable frente a perdido.
- Datos antiguos → EN OBSERVACIÓN.
- Fallo de conexión (simulado) → reintentos, se conserva el último dato y se marca la antigüedad.
- Respuesta 304 o mismo `updatedAt` → sin observación nueva.
- Dos consultas simultáneas o botón pulsado varias veces → solo se ejecuta una.

---

## 8. Decisiones pendientes para ti
1. **¿Credenciales de Blizzard?** (gratis, en develop.battle.net). Dan iconos, categorías y depósito correcto. Se pueden decidir en el hito 9.
2. **Comisión y depósito reales**: confirma en el juego cuánto cobra la casa de subastas de la Horda (5 % asumido).
3. **Puerto y acceso**: solo desde este PC (`127.0.0.1`, recomendado) o también desde el móvil en tu red Wi-Fi (`0.0.0.0` + contraseña sencilla).
