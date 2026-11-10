# Qué copiar de TSM y qué descartar

TradeSkillMaster (TSM) tiene dos piezas. La primera es un addon del juego que **decide** qué publicar, comprar, fabricar o vender al NPC a partir de tus objetos y tus reglas. La segunda es una web que **solo enseña el mercado**: precios, un mapa de calor por categorías y una ficha por objeto. Los precios no salen de escaneos dentro del juego. TSM los calcula en sus servidores a partir de las capturas de la API de Blizzard y los reparte de tres formas: su aplicación de escritorio, su web y unos CSV públicos. El CSV que ya importa la página «Casa de Subastas — WoW Forever» lleva cuatro de esas cifras: valor de mercado, compra mínima, valor reciente e histórico. Ese CSV no trae ni la cantidad en venta ni las ventas, y tampoco nada personal. Por eso los módulos de TSM que dependen de tu inventario, tu contabilidad o anuncios en directo (Auctioning real, Sniper, Ledger, Mailing, Warehousing) no se pueden copiar tal cual. Lo que sí se puede copiar es la **lógica de decisión** de esos módulos aplicada a precios agregados. Con datos que la página ya tiene salen una lista de gangas al estilo Shopping/Sniper, un precio de publicación sugerido con la banda mínimo/normal/máximo de Auctioning, la comparación «subastar o vender al NPC» de Vendoring, un cálculo de recetas al estilo TSM Crafting y un mapa de calor de toda la casa de subastas. Dos datos faltan y no se pueden inventar: la liquidez real del reino y el precio de compra al vendedor de los reactivos. Las secciones siguientes explican cómo funciona TSM, enumeran todas sus funciones y terminan con una lista priorizada de qué aplicar, con qué datos y cuáles hay.

## TSM calcula los precios en sus servidores y el addon solo los aplica

El núcleo de precios de TSM es **AuctionDB**. Su compra mínima («DBMinBuyout») es la subasta más barata del reino «as of the last update from Blizzard's API». No es en directo, puede tener más de 30 minutos de retraso y no pasa a la siguiente subasta cuando alguien compra la más barata ([TSM Help: Price Sources](https://support.tradeskillmaster.com/custom-strings/which-price-sources-can-i-use-and-what-do-they-mean)). La aplicación de escritorio descarga esos precios de los servidores de TSM y los mete en el addon sin que el jugador haga nada ([TSM Help: Desktop App](https://support.tradeskillmaster.com/tsm-desktop-application/how-do-i-set-up-the-tsm-desktop-application)). Una reseña antigua de Wowhead decía que en Classic los precios venían de los propios usuarios de TSM ([Wowhead Wrap-Up 186](https://www.wowhead.com/news/wowhead-economy-weekly-wrap-up-186-legendary-stock-tracker-brutosaur-container-323446)). La ayuda oficial actual, que habla de la API de Blizzard, prevalece sobre esa reseña.

**WoW Forever tiene soporte desde TSM 4.15.** El anuncio dice que se podría usar desde el lanzamiento del 4 de noviembre de 2026. La misma versión estrena una aplicación de escritorio rehecha para Windows, Mac y Linux ([TSM 4.15](https://tradeskillmaster.com/news/tsm-4-15-brings-wow-forever-support-plus-new-desktop-app-1180)).

Los cuatro números del CSV que importa la página tienen una definición oficial:

| Columna del CSV | Fuente TSM | Qué significa |
|---|---|---|
| `marketValue` | DBMarket | Media ponderada de 14 días que pesa más los 3 últimos. Mide precios de anuncios, no de ventas. |
| `minBuyout` | DBMinBuyout | La subasta más barata en la última captura. |
| `recent` | DBRecent | El mismo cálculo que DBMarket, pero solo con la última captura y sin media en el tiempo. |
| `historical` | DBHistorical | Media de 60 días de DBMarket. |

Fuente de la tabla: [TSM Help: Price Sources](https://support.tradeskillmaster.com/custom-strings/which-price-sources-can-i-use-and-what-do-they-mean).

El «valor de mercado» no es un promedio simple, y eso importa para leerlo bien. TSM ordena los anuncios por precio y siempre conserva el 15 % más barato. A partir de ahí corta en el primer salto de precio del 20 % o más, y nunca mira más allá del 30 % más barato. Después descarta lo que se aleja más de 1,5 desviaciones típicas y promedia lo que queda. En el ejemplo oficial, 24 subastas con media simple de 25,79 dan un valor de **14,5** ([TSM Help: AuctionDB Market Value](https://support.tradeskillmaster.com/tsm-addon-documentation/auctiondb-market-value)). Así que el valor de mercado describe el tramo barato de la oferta, no el precio medio de lo publicado.

El archivo del reino cambia «cada pocas horas» y el regional una vez al día. Su `updatedAt` es la hora del escaneo original, no la de creación del archivo. No pide clave de API ni tiene límite de peticiones ([TSM Public Pricing Data](https://tradeskillmaster.com/public-data)). El 9 de noviembre de 2026 el CSV de Forever US PvP Horda marcaba `2026-11-09T21:16:24Z` y pesaba unos 310 KB ([CSV del reino](https://public-data.tradeskillmaster.com/forever/us/realm/pvp-horde/items.csv)). El 7 de noviembre el plan del proyecto había medido unos 224 KB y 3.730 objetos (`PLAN.md`). Que el archivo haya crecido así en dos días encaja con una economía recién abierta en la que se publican cada vez más objetos distintos.

Los Términos de TSM prohíben bots y scrapers «except through features we provide for that purpose», como estos archivos públicos ([TSM Terms](https://tradeskillmaster.com/terms)). En la práctica, la página no debe leer las fichas web de TSM de forma automática. Solo debe usar los CSV.

## TSM tiene más de una docena de funciones, y casi todas dependen de datos del addon

TSM organiza todo en **Groups** y **Operations**. Un grupo es una carpeta de objetos en árbol. Una operación es un conjunto de reglas con nombre de un módulo concreto (Auctioning, Shopping, Sniper, Crafting, Mailing, Vendoring o Warehousing) que se asigna a uno o varios grupos ([TSM Groups](https://support.tradeskillmaster.com/tsm-addon-documentation/tsm-addon-groups)). En el código de la versión 4.10, un subgrupo hereda las operaciones de su padre salvo que active «override» ([Groups/Core.lua](https://raw.githubusercontent.com/ichibsah/AddOns/master/TradeSkillMaster/Core/Service/Groups/Core.lua)). Cada regla es un **custom string**, una fórmula de precio como `80% dbmarket`. Admite suma, resta, multiplicación, división y potencias, porcentajes, cantidades en oro como `100g` y funciones como `min`, `max`, `first`, `avg`, `check`, `ifgt`/`iflt`, `round` y `convert`. Un valor que falta («invalid») se propaga en los cálculos, salvo en `min`, `max`, `first` y `avg`, que lo saltan ([TSM Help: Functions](https://support.tradeskillmaster.com/custom-strings/which-functions-can-i-use-and-what-do-they-mean)).

| Módulo o servicio | Qué hace | Qué necesita |
|---|---|---|
| Auctioning | Publica y cancela con una banda de precios (mínimo, normal y máximo), rebaja a la competencia y aplica reglas para cuando queda por debajo del mínimo o por encima del máximo | Escaneo en directo y tus bolsas |
| Shopping | Busca compras por debajo de un precio máximo, con filtros de texto (`/i600`, `/epic`, `/1000g`…), búsquedas de vendedor y desencantamiento, y «Great Deals» | Escaneo en directo |
| Sniper | Repite una búsqueda sin parar para cazar subastas recién publicadas por debajo de `belowPrice` | Escaneo en directo |
| Crafting y Gathering | Calcula coste, valor y beneficio de cada receta, monta una cola de fabricación y reúne materiales | Recetas aprendidas e inventario |
| Destroying | Calcula el valor de desencantar, moler o prospectar («Destroy») y lo hace rápido | Bolsas y tablas de rendimiento |
| Vendoring | Compra y vende al NPC con reglas de umbral | Bolsas |
| Mailing y Warehousing | Mueve objetos entre personajes, banco y banco de hermandad | Inventario |
| Accounting (Ledger) y Dashboard | Registro de ventas, compras, subastas expiradas y canceladas; beneficio por objeto; gráfico de oro | Correo y transacciones del jugador |
| Web: realm y ficha de objeto | Mapa de calor, estadísticas, gráficos y mapas de hora × día | Datos de TSM; lo personal es de pago |
| Web: Groups | Directorio público de grupos para importar | Cadenas de exportación |
| Public data | CSV gratuitos por reino y por región | Ninguno |

Fuentes de la tabla: [TSM Auctioning Ops](https://support.tradeskillmaster.com/tsm-addon-documentation/1072146-tsm-addon-auctioning-operations), [TSM Shopping Ops](https://support.tradeskillmaster.com/tsm-addon-shopping-operations), [TSM Sniper Ops](https://support.tradeskillmaster.com/tsm-addon-documentation/tsm-addon-sniper-operations), [TSM Crafting Ops](https://tradeskillmaster.helpjuice.com/tsm-addon-documentation/1236068-tsm-addon-crafting-operations), [TSM Vendoring Ops](https://support.tradeskillmaster.com/tsm-addon-documentation/tsm-addon-vendoring-operations), [TSM Ledger](https://support.tradeskillmaster.com/en_US/tsm-addon-documentation/tsm-addon-ledger), [TSM Dashboard](https://support.tradeskillmaster.com/en_US/tsm-addon-documentation/tsm-addon-dashboard) y [WoWInterface TSM](https://wowinterface.com/downloads/info24165-TradeSkillMaster.html).

### Auctioning convierte una banda de precios en una decisión con motivo

La operación de Auctioning es la pieza más fácil de trasladar a la página. El código público disponible es de la versión 4.10.19, de hacia 2020-2021. Sus valores por defecto parten de `first(crafting, dbmarket, dbregionmarketavg)`. Sobre esa base fijan un **mínimo** del 25 % (nunca por debajo de 1,5 veces el precio de venta al NPC), un **normal** del 200 % y un **máximo** del 500 % ([Auctioning.lua](https://raw.githubusercontent.com/ichibsah/AddOns/master/TradeSkillMaster/Core/Service/Operations/Auctioning.lua)). Un preset de la comunidad muy citado usa 80/100/300 % de dbmarket ([Wowhead Wrap-Up 315](https://www.wowhead.com/news/token-discussions-tsm-strings-wowhead-economy-weekly-wrap-up-315-337769)). Ese dato sale de un resumen de búsqueda, no del texto completo del artículo.

Al publicar, TSM aplica la primera regla que se cumple:

1. Si no hay competencia, publica al precio normal.
2. Si la subasta más barata menos el undercut (la rebaja) queda por debajo del mínimo, aplica la regla configurada para ese caso o no publica.
3. Si la subasta más barata es tuya, iguala su precio.
4. Si la más barata menos el undercut queda por encima del máximo, publica al máximo.
5. En cualquier otro caso, publica a la más barata menos el undercut.

Al final, el precio nunca baja del mínimo y la puja es `max(buyout × %puja, mínimo)` ([PostScan.lua](https://raw.githubusercontent.com/ichibsah/AddOns/master/TradeSkillMaster/Core/Service/Auctioning/PostScan.lua)). Cada resultado lleva un código de motivo, como `postBelowMin` o `postUndercut`. En Classic el undercut por defecto es **1c** y existen pilas y pujas. En Retail es 0c y redondea a la plata ([TSM Auctioning Ops](https://support.tradeskillmaster.com/tsm-addon-documentation/1072146-tsm-addon-auctioning-operations)).

### Shopping, Sniper y Vendoring son filtros sobre las mismas fuentes de precio

Shopping tiene por defecto un precio máximo de `dbmarket` y no limita la reposición ([Shopping.lua](https://raw.githubusercontent.com/ichibsah/AddOns/master/TradeSkillMaster/Core/Service/Operations/Shopping.lua)). Su búsqueda de vendedor selecciona los objetos con `minBuyout < vendorSell` y exige datos de menos de 12 horas ([VendorSearch.lua](https://raw.githubusercontent.com/ichibsah/AddOns/master/TradeSkillMaster/Core/Service/Shopping/VendorSearch.lua)).

El `belowPrice` por defecto de Sniper multiplica el valor regional por un coeficiente que baja con el precio: 0,8 por encima de 250.000 oro, 0,7 por encima de 100.000 oro, y así hasta 0,05. Nunca queda por debajo del precio de venta al NPC ([Sniper.lua](https://raw.githubusercontent.com/ichibsah/AddOns/master/TradeSkillMaster/Core/Service/Operations/Sniper.lua)). La cadena completa salió truncada en la investigación.

Vendoring vende al NPC solo si el objeto ha expirado al menos 20 veces y, si se configuran, si su valor de mercado y su valor de destrucción no pasan de un umbral ([TSM Vendoring Ops](https://support.tradeskillmaster.com/tsm-addon-documentation/tsm-addon-vendoring-operations)).

### Crafting y Destroying suman materiales y rendimientos

En TSM, el coste de una receta es la suma del «matPrice» de cada reactivo. Si falta el de uno solo, la receta queda sin coste. El valor del objeto fabricado es por defecto «la compra mínima y, si no hay, el valor de mercado». El beneficio es el valor menos el coste ([TSM Help: Missing crafting costs](https://support.tradeskillmaster.com/en_US/addon/why-am-i-missing-crafting-costs-or-profits-in-my-profession-window)).

La fórmula por defecto del coste de material la conocemos por la comunidad, en una versión de 2018: `min(dbmarket, crafting, vendorbuy, convert(dbmarket))` ([r/woweconomy 2018](https://lr.in.psf.lt/r/woweconomy/comments/9516i0/weekly_tradeskillmaster_thread/e4ce0wc/?context=3)). Es decir, cada material vale lo más barato entre comprarlo en la casa de subastas, fabricarlo o comprarlo al NPC. Algunos jugadores la refuerzan con un tope del **150 % del valor de mercado** para que una compra mínima disparatada no infle los cálculos ([The Lazy Goldmaker](https://thelazygoldmaker.com/tsm-discussion-valuing-you-crafting-materials)). La operación de Crafting por defecto pide 100 oro de beneficio mínimo y repone entre 10 y 20 unidades ([TSM #Default Operations](https://support.tradeskillmaster.com/how-do-the-default-operations-work)).

«Destroy» es el valor medio de lo que se obtiene al desencantar, moler o prospectar. Por defecto valora cada resultado con DBMarket ([TSM Tooltip Settings](https://support.tradeskillmaster.com/tsm-addon-settings-tooltip-settings)). Las tablas de desencantamiento de Classic (por ejemplo, armadura verde de nivel 56–60: 75 % Polvo de ilusión, 20 % Esencia eterna superior y 5 % Fragmento brillante grande) existen en la wiki, pero están marcadas como desactualizadas ([Warcraft Wiki](https://warcraft.wiki.gg/wiki/Disenchanting_tables)).

### El Ledger y el Dashboard son contabilidad personal

El Ledger construye su registro a partir del correo: ventas, compras, subastas expiradas y canceladas. Muestra el inventario por ubicación, los ingresos (Ventas, Otros, Reventa con beneficio por objeto), los gastos y las subastas fallidas, con ventanas de 7 y 30 días ([TSM Ledger](https://support.tradeskillmaster.com/en_US/tsm-addon-documentation/tsm-addon-ledger)). El Dashboard dibuja el oro a lo largo del tiempo, en verde o rojo según el saldo final, y debajo resume ventas, gastos y beneficio con media diaria y objeto principal. La versión 4.15 le añade un feed de actividad ([TSM Dashboard](https://support.tradeskillmaster.com/en_US/tsm-addon-documentation/tsm-addon-dashboard); [TSM 4.15](https://tradeskillmaster.com/news/tsm-4-15-brings-wow-forever-support-plus-new-desktop-app-1180)).

## La web de TSM para Forever: mapa de calor visible, ficha gratuita y lo personal de pago

La página del reino [/forever/eu/pvp-horde](https://tradeskillmaster.com/forever/eu/pvp-horde) tiene navegación (Inicio, Noticias, Ledger, Grupos), selectores de región y de versión del juego, un banner de Premium y noticias. Su pieza central es el **Auction House Heatmap**. Es un treemap: primero por clase (Consumibles, Armadura, Reactivos…), después por subclase y al final por objeto. Cada casilla muestra un porcentaje de variación con color verde o rojo, por ejemplo «Potions -15.7%» o «Frog Leg Stew 669.0%». Al pasar el ratón aparece «N Available».

Las dos notas de investigación no coinciden en este punto. Un navegador vio el mapa de calor sin iniciar sesión. Un lector de texto solo vio el armazón de la página y el nombre «Auction House Heatmap» en el banner de Premium ([realm US](https://tradeskillmaster.com/forever/us/pvp-horde)). La explicación más probable es que el mapa se dibuja con JavaScript. En 2024, TSM describió este mapa como tendencia del valor de mercado, con el tamaño de cada casilla proporcional al volumen de subastas, y lo asoció a Premium ([TSM blog p=1072](https://blog.tradeskillmaster.com/?p=1072)). No está documentado ni la ventana temporal de la variación ni el significado exacto de «N Available». Los valores con decimales apuntan a una cantidad media.

La ficha de objeto ([ejemplo 4436](https://tradeskillmaster.com/forever/us/pvp-horde/items/4436)) enseña gratis la cantidad disponible, la compra mínima, el valor de mercado con su tendencia, el precio histórico y cinco cifras regionales: media del valor de mercado, histórico, precio medio de venta, tasa de venta (0,454) y unidades vendidas al día (1,362). También trae un gráfico de unos 5 días, el valor regional con rangos de 1S, 1M, 3M y 6M y dos **mapas de calor de día de la semana × hora**, uno de precio y otro de cantidad.

La cabecera de esa ficha decía «Market 28s» y el bloque de estadísticas «19s». La investigación no resolvió la diferencia.

La actividad personal, el resumen de 7 días del Ledger y los campos de contabilidad son de pago, sobre todo del plan Platinum. Hay tres planes: Free (0 $), Gold (3 $ al mes en pago anual: Ledger básico, alertas por correo, Great Deals) y Platinum (7,50 $ al mes: análisis completo y gráficos de venta y cantidad) ([TSM Premium](https://tradeskillmaster.com/premium)). El reparto es claro: **la investigación de mercado es gratis y la analítica personal es de pago**.

## La página ya cubre lo básico; faltan liquidez y precio de compra al NPC

La página ya sigue a TSM en varias cosas. La tabla `metricas` del repositorio guarda las definiciones oficiales de las cuatro columnas. Un `minBuyout` de 0 se guarda como «sin dato» y no como 0c (`db/migraciones/0020_precios_tsm.sql`). La consulta horaria con ETag respeta la cadencia de TSM. La comisión (5 %) y el depósito están en tablas configurables y marcados como no verificados (`db/migraciones/0014_tasas.sql`). El cálculo de recetas ya da coste, neto tras comisión, margen y «días para vender» (`db/migraciones/0015_recetas.sql`).

El repositorio también contiene datos útiles para copiar a TSM. El catálogo trae calidad, clase, subclase, nivel y **precio de venta al NPC** (`venta_npc`, en `db/migraciones/0010_catalogo.sql`). Además, `price_hourly` guarda una fila por objeto y hora, que es la materia prima de cualquier variación o mapa de calor propio (`db/migraciones/0001_esquema.sql`).

Hay un mercado AHledger aparte con columnas de cantidad publicada, número de subastas y ventas estimadas al día (`db/migraciones/0009_ahledger.sql`). La regla del proyecto es no mezclarlo nunca con TSM. Hay que comprobar si se sigue importando.

Las tablas `inventory`, `favorites` y `sales` siguen en el esquema, aunque la sección única «Mercado» no muestra datos personales.

Faltan cuatro datos, y su ausencia es la que limita qué se puede copiar:

1. **Cantidad en venta del reino.** La ficha de TSM la muestra, pero el CSV no la trae y leer la ficha está prohibido por los Términos.
2. **Datos regionales** (`avgSalePrice`, `saleRate`, `soldPerDay`). Están en un CSV público que la página no importa. El plan decidió no usarlos en el motor porque agregan toda la región (`PLAN.md`, apartado 1.2). Al principio de Forever muchas filas regionales traen tasa de venta 0 ([CSV regional](https://public-data.tradeskillmaster.com/forever/us/region/items.csv)).
3. **Precio de compra al NPC** («vendorBuy»). Es distinto del de venta y mucho más alto ([TSM Help: vendor prices](https://tradeskillmaster.helpjuice.com/en_US/addon/why-do-my-vendor-items-have-wrong-or-missing-material-prices)).
4. **Rendimientos de desencantamiento** fiables.

Las profesiones que reconoce la página son las de la etapa original: no hay Joyería ni Inscripción (`app/static/recetas.js`). Moler y prospectar no se aplican, así que el valor «Destroy» se reduce al desencantamiento.

## Diez funciones priorizadas para la Casa de Subastas

El orden combina tres criterios: valor para un jugador que vende y fabrica, datos ya disponibles y poco riesgo de mostrar algo engañoso. Las fórmulas son una adaptación propia de la lógica de TSM a precios agregados, no código oficial. Por eso deben rotularse como «estimación».

| # | Función para la página (equivalente en TSM) | Por qué | Datos que necesita | ¿Disponibles? |
|---|---|---|---|---|
| 1 | **Precio de publicación sugerido** (Auctioning) | Convierte «Vender» en «vende a X», con el motivo y la puja sugerida | minBuyout, marketValue, venta_npc y una banda configurable | Sí, todos |
| 2 | **Gangas para comprar y revender** (Shopping, Great Deals, Sniper) | Es la estrategia de flipping más usada y hoy la página no la ofrece | minBuyout, marketValue, historical, venta_npc | Sí. El minBuyout puede tener horas de retraso. |
| 3 | **Subastar o vender al NPC** (Vendor Search, Vendoring) | Detecta objetos a la venta por menos de lo que paga el NPC y objetos que no merece la pena subastar | minBuyout, marketValue, venta_npc, tasas | Sí. Hay que medir cuántos objetos tienen venta_npc. |
| 4 | **Recetas al estilo TSM**: material comprado o fabricado, valor `first(minBuyout, market)` y tope del 150 % | Corrige recetas sobrevaloradas y abarata las que tienen intermedios fabricables | Recetas, precios, vendorBuy de reactivos del NPC | En parte. Falta vendorBuy. |
| 5 | **Mapa de calor de toda la casa** por clase › subclase (AH Heatmap) | Amplía el treemap de materiales a todo el mercado, igual que la web de TSM | clase, subclase, variación propia de 24 h, tamaño de casilla | En parte. Sin cantidad, el tamaño debe ser número de objetos o valor. |
| 6 | **Mapa día de la semana × hora** en el detalle (Price Heatmap) | Muestra a qué hora suele estar más barato o más caro | price_hourly propio | Sí, pero hacen falta varias semanas de historial |
| 7 | **Bloque «Referencia regional (no es PvP Horda)»** (DBRegion*) | Da una pista de liquidez que hoy marca «sin dato» | CSV regional unido por itemId | No importado. Es fácil de añadir y ya está previsto como bloque aparte. |
| 8 | **Listas con perfil de precios** (Groups y Operations) | Aplica una banda distinta a materiales, equipo o consumibles sin tocar cada objeto | Listas del usuario y perfiles heredables | Sí. La tabla `favorites` sirve de base. |
| 9 | **Alertas por umbral** (alertas Gold y Sniper) | Avisa cuando un objeto vigilado baja de un precio | Umbral por objeto, consulta horaria y un canal de aviso | Los precios sí. El canal no existe. |
| 10 | **Valor de desencantar** (Destroy) | Responde a «¿desencanto, vendo al NPC o subasto?» | clase, calidad, nivel, tabla de desencantamiento, precio de los materiales | En parte. La tabla está sin verificar. |

Detrás de la tabla hay detalles que el desarrollador necesita.

**Función 1, precio de publicación.** Calcula `mín = max(k_min × market, 1,5 × venta_npc)`, `normal = k_norm × market` y `máx = max(k_max × market, 30 × venta_npc)`, con los ajustes por defecto `k_min = 0,8`, `k_norm = 1,0` y `k_max = 3,0` del preset de la comunidad. Los ajustes 0,25/2/5 de TSM 4.10 quedan como alternativa. Después aplica las reglas de Auctioning con un undercut de 1c:

1. Sin `minBuyout`, publica al precio normal.
2. Si `minBuyout − 1c < mín`, responde «Esperar: la competencia está por debajo de tu mínimo».
3. Si `minBuyout − 1c > máx`, publica al máximo.
4. En cualquier otro caso, publica a `minBuyout − 1c`.

La puja sugerida es `max(buyout × %puja, mín)`. La página no puede saber si la subasta más barata es tuya, así que debe advertirlo.

**Función 2, gangas.** Marca un objeto cuando `minBuyout ≤ max(venta_npc, k(precio) × marketValue)` y `historical` no está muy por debajo de `marketValue`. Esa segunda condición descarta caídas que no se recuperan. `k(precio)` sigue la escalera de Sniper: más alto para objetos caros y más bajo para los baratos. Margen de reventa: `market × 0,95 − minBuyout`.

**Función 3, NPC.** Comprar para vender al NPC deja `venta_npc − minBuyout`, sin comisión. Conviene vender al NPC cuando `market × 0,95 − depósito esperado ≤ venta_npc`.

**Función 4, recetas.** Usa `matPrice(r) = min(market(r), coste_fabricar(r) si es fabricable, vendorBuy(r))`. Hay que cortar los ciclos de la recursión. Si un precio falta, el coste queda «incompleto», igual que en TSM. Para vendorBuy hay que preparar a mano una tabla con los reactivos que vende el NPC, como viales, hilos o fundentes.

**Función 6, mapa día × hora.** Promedia `minBuyout` por día de la semana y hora en UTC, convertida a la hora del usuario, y lo muestra solo cuando cada celda tiene suficientes muestras. Forever salió el 4 de noviembre, así que hoy cada celda tiene como mucho una observación.

Lo que **no conviene copiar** son Ledger, Dashboard de oro, inventario multipersonaje, Mailing, Warehousing, el cancel scan y el sniping en tiempo real. Todos dependen de datos del addon o de anuncios en directo, y la página no tiene ninguno de los dos. Si algún día se quisiera contabilidad, hay herramientas de terceros que convierten el archivo de datos guardados del addon (SavedVariables) a CSV ([rubydoc tsm-accounting](https://www.rubydoc.info/gems/tsm-accounting/0.8.0)). También las fórmulas libres de TSM (un intérprete completo de custom strings) quedan fuera de la lista: dan mucha potencia a usuarios avanzados, pero cuestan bastante y poco sirven a quien empieza. Basta con ofrecer unas pocas bases de precio elegibles.

## Hechos verificados, inferencias y lagunas

| Afirmación | Estado | Base |
|---|---|---|
| Columnas del CSV del reino y su correspondencia con DBMarket, DBMinBuyout, DBRecent y DBHistorical | Verificado | [CSV del reino](https://public-data.tradeskillmaster.com/forever/us/realm/pvp-horde/items.csv), [TSM Help](https://support.tradeskillmaster.com/custom-strings/which-price-sources-can-i-use-and-what-do-they-mean) |
| El CSV regional de Forever US existe y trae ventas y tasa de venta | Verificado | [CSV regional](https://public-data.tradeskillmaster.com/forever/us/region/items.csv) |
| Algoritmo del valor de mercado (15 %, 20 %, 30 %, 1,5 desviaciones, 14 días) | Verificado (los pesos exactos de cada día solo aparecen en un gráfico) | [TSM Market Value](https://support.tradeskillmaster.com/tsm-addon-documentation/auctiondb-market-value) |
| TSM 4.15 da soporte a Forever | Verificado | [TSM 4.15](https://tradeskillmaster.com/news/tsm-4-15-brings-wow-forever-support-plus-new-desktop-app-1180) |
| Mapa de calor visible sin iniciar sesión | Observado por un navegador y no por otro | [realm EU](https://tradeskillmaster.com/forever/eu/pvp-horde) |
| Valores por defecto de Auctioning y Sniper | Verificado en el código de la 4.10.19; inferencia para la versión de 2026 | [Auctioning.lua](https://raw.githubusercontent.com/ichibsah/AddOns/master/TradeSkillMaster/Core/Service/Operations/Auctioning.lua) |
| Forever sigue las reglas de Classic: subastas individuales, pilas, pujas y undercut de 1c | Inferencia | Reglas de Classic en [TSM Auctioning Ops](https://support.tradeskillmaster.com/tsm-addon-documentation/1072146-tsm-addon-auctioning-operations) |
| Moler y prospectar no aplican en Forever | Inferencia, apoyada en la lista de profesiones del repositorio | `app/static/recetas.js` |
| Fórmula por defecto del coste de material | Inferencia (dato de la comunidad, 2018) | [r/woweconomy](https://lr.in.psf.lt/r/woweconomy/comments/9516i0/weekly_tradeskillmaster_thread/e4ce0wc/?context=3) |
| Ventana de la variación del mapa de calor y significado de «N Available» | Laguna | Sin documentación |
| Intervalo exacto de capturas en los reinos de Forever | Laguna (solo consta «cada pocas horas») | [Public data](https://tradeskillmaster.com/public-data) |
| Licencia de redistribución de los CSV | Laguna. Los Términos remiten a condiciones que no se encontraron. | [TSM Terms](https://tradeskillmaster.com/terms) |
| Diferencia entre 28s y 19s en la ficha de objeto | Laguna | [Ficha 4436](https://tradeskillmaster.com/forever/us/pvp-horde/items/4436) |
| Si la importación de AHledger (cantidad, ventas por día) sigue activa | Laguna. Hay que comprobarlo en el proyecto. | `db/migraciones/0009_ahledger.sql` |

## Conclusión

Lo valioso de TSM para esta página no son los datos, porque la página ya los tiene: es la **forma de decidir**. TSM no da un solo precio «bueno». Trabaja con bandas (mínimo, normal y máximo), elige siempre el valor válido más prudente y explica cada decisión con un motivo. La página ya tiene un motor Vender/Guardar/Esperar, y la mejora natural es que cada recomendación diga a qué precio, por qué regla y con qué suelo. Las funciones 1 a 3 salen de columnas que ya existen y cambian lo que el jugador hace con la información.

El límite de fondo es la liquidez. TSM la cubre con datos que el CSV del reino no publica: la cantidad en venta y las ventas de sus usuarios. Si la página quiere ir más allá de «está barato» y llegar a «se venderá», necesita una de estas tres vías, siempre como dato aparte y etiquetado: el CSV regional, AHledger (si sigue activo) o la API de Blizzard con la casa de subastas validada. Fingir esa liquidez sería peor que marcarla como «sin dato».
