# TSM: funciones de venta y compra (Auctioning, Shopping, Sniper, Groups/Operations)

Notas de investigación (noviembre 2026). Fuentes principales: centro de ayuda oficial (support.tradeskillmaster.com) y el código Lua del addon TSM **v4.10.19** que hay en un espejo público de GitHub (ichibsah/AddOns). **Aviso:** ese espejo es una versión antigua (rama 4.10, de hacia 2020-2021). Las versiones actuales (4.13/4.14+) pueden traer cambios. La lógica de decisión que se describe abajo viene de ese código y es la base más fiable que encontré, pero no está comprobada contra la versión de 2026.

Archivos de código citados:
- Valores por defecto de Auctioning: https://raw.githubusercontent.com/ichibsah/AddOns/master/TradeSkillMaster/Core/Service/Operations/Auctioning.lua
- Post scan: https://raw.githubusercontent.com/ichibsah/AddOns/master/TradeSkillMaster/Core/Service/Auctioning/PostScan.lua
- Cancel scan: https://raw.githubusercontent.com/ichibsah/AddOns/master/TradeSkillMaster/Core/Service/Auctioning/CancelScan.lua
- Shopping: https://raw.githubusercontent.com/ichibsah/AddOns/master/TradeSkillMaster/Core/Service/Operations/Shopping.lua
- Sniper: https://raw.githubusercontent.com/ichibsah/AddOns/master/TradeSkillMaster/Core/Service/Operations/Sniper.lua
- Groups: https://raw.githubusercontent.com/ichibsah/AddOns/master/TradeSkillMaster/Core/Service/Groups/Core.lua
- Operations (núcleo): https://raw.githubusercontent.com/ichibsah/AddOns/master/TradeSkillMaster/Core/Service/Operations/Core.lua

## Groups y Operations: qué son, cómo se organizan los objetos, herencia y configuración

### Takeaway
Un **Group** es una carpeta de objetos organizada en árbol (padre y subgrupos). Una **Operation** es un conjunto de ajustes con nombre, de un módulo concreto (Auctioning, Shopping, Sniper, Crafting, Mailing, Vendoring, Warehousing), que se asigna a uno o varios grupos. Un subgrupo hereda las operaciones de su padre salvo que active "override" para ese módulo. Cada ajuste de una operación es un "custom string", una fórmula de precio como `80% dbmarket`.

### Cited Findings
- Las operaciones son instrucciones que se aplican a un grupo y deciden cómo TSM trata los objetos de ese grupo al publicar, comprar, enviar por correo, fabricar, etc. — [TSM Groups](https://support.tradeskillmaster.com/tsm-addon-documentation/tsm-addon-groups); [TSM Managing Operations](https://tradeskillmaster.helpjuice.com/en_US/tsm-addon-documentation/tsm-addon-manging-operations)
- El **Base Group** contiene todos los objetos del juego que no se han añadido a otro grupo, y no se puede borrar. Su buscador encuentra cualquier objeto del juego sin agrupar, aunque no lo tengas. — [TSM Groups](https://support.tradeskillmaster.com/tsm-addon-documentation/tsm-addon-groups)
- Los grupos se anidan y se reordenan arrastrando. Si sueltas un grupo sobre el Base Group, pasa a ser un padre de nivel superior. Borrar un grupo borra también sus subgrupos. Con Shift + "Remove Items", los objetos pasan al grupo padre en vez de salir del grupo. — [TSM Groups](https://support.tradeskillmaster.com/tsm-addon-documentation/tsm-addon-groups)
- Formas de añadir objetos: seleccionarlos en el Base Group y moverlos ("Move X Items"), arrastrarlos, o seleccionar varios arrastrando con el botón derecho. — [TSM Groups](https://support.tradeskillmaster.com/tsm-addon-documentation/tsm-addon-groups)
- **Import/Export:** se pega un "string" que contiene grupos, operaciones y objetos. Importar siempre crea un grupo nuevo llamado "Imported Group". Al exportar puedes incluir subgrupos y excluir operaciones o custom sources. Así se reparten los "presets" de la comunidad. — [TSM Groups](https://support.tradeskillmaster.com/tsm-addon-documentation/tsm-addon-groups)
- **Herencia (código):** cada grupo guarda, por módulo, una lista ordenada de nombres de operaciones y un indicador `override`. Al crear un subgrupo se copian las operaciones del padre ("assign all parent operations to this group") y `override` queda desactivado, así que hereda. Activar `override` vacía la lista del grupo (empieza en blanco, no copia la del padre). Desactivarlo vuelve a heredar del padre (`InheritParentOperations`). Al mover un grupo, se recalcula la herencia del grupo y de sus hijos, excepto los hijos con override propio. El grupo raíz siempre tiene override. — [Groups/Core.lua](https://raw.githubusercontent.com/ichibsah/AddOns/master/TradeSkillMaster/Core/Service/Groups/Core.lua)
- Solo se pueden añadir operaciones a un grupo con override activo y por debajo del máximo del módulo (`#groupOperations < TSM.Operations.GetMaxNumber(moduleName)`). Cada módulo define su propio máximo (`maxOperations`). — [Groups/Core.lua](https://raw.githubusercontent.com/ichibsah/AddOns/master/TradeSkillMaster/Core/Service/Groups/Core.lua); [Operations/Core.lua](https://raw.githubusercontent.com/ichibsah/AddOns/master/TradeSkillMaster/Core/Service/Operations/Core.lua)
- Las operaciones se guardan como lista ordenada (se pueden reordenar). `GetFirstOperationByItem` devuelve la primera operación no ignorada del grupo del objeto. — [Operations/Core.lua](https://raw.githubusercontent.com/ichibsah/AddOns/master/TradeSkillMaster/Core/Service/Operations/Core.lua)
- **Gestión, en todas las operaciones:** "Ignore operation on faction-realms" e "Ignore operation on characters" desactivan la operación en ciertos reinos/facciones o personajes (claves "personaje - facción - reino" y "facción - reino"). — [Operations/Core.lua](https://raw.githubusercontent.com/ichibsah/AddOns/master/TradeSkillMaster/Core/Service/Operations/Core.lua); [TSM Shopping Ops](https://support.tradeskillmaster.com/tsm-addon-shopping-operations)
- **Relationships:** un ajuste de una operación puede "enlazarse" a otra operación y copiar su valor, incluso en cadena. Los enlaces circulares se eliminan. — [Operations/Core.lua](https://raw.githubusercontent.com/ichibsah/AddOns/master/TradeSkillMaster/Core/Service/Operations/Core.lua)
- Las operaciones #Default: la #Default Auctioning se aplica al Base Group. La #Default Shopping tiene precio máximo `dbmarket` y ningún límite de restock. Para Auctioning y Sniper la página de defaults dice "Coming soon". — [How do the #Default Operations work?](https://support.tradeskillmaster.com/en_US/addon/how-do-the-default-operations-work); [TSM Auctioning Ops](https://support.tradeskillmaster.com/tsm-addon-documentation/1072146-tsm-addon-auctioning-operations)
- Shopping no funciona sobre el Base Group. Sniper tampoco funciona sobre el Base Group en Retail, pero sí en Classic. — [TSM Shopping Ops](https://support.tradeskillmaster.com/tsm-addon-shopping-operations); [TSM Sniper Ops](https://support.tradeskillmaster.com/tsm-addon-documentation/tsm-addon-sniper-operations)

### Inferences
- Para la web: modelar "Grupo" como categoría jerárquica de objetos con "Perfil de precios" (equivalente a la operación) heredable. Basta con tomar el perfil del ancestro más cercano que tenga override. Se puede ofrecer un perfil por defecto que haga de "#Default" y un catálogo de perfiles predefinidos (conservador, normal, agresivo).
- Los custom strings combinan fuentes de precio (dbmarket, dbminbuyout, dbhistorical, dbregionmarketavg, crafting, vendorsell, destroy) con funciones (`max`, `min`, `avg`, `first`, `check`, `ifgt`) y porcentajes. La web solo tiene min buyout, market, recent e historical, así que puede soportar un subconjunto de esta sintaxis.

### Gaps
- No encontré el valor numérico de `maxOperations` por módulo. De memoria creo que Auctioning permite varias operaciones por grupo (TSM3 permitía hasta 5), pero no lo pude verificar.
- La documentación oficial no explica la herencia (la página de Groups no la menciona). Lo que pongo sale solo del código v4.10.
- No queda claro, por fuentes, cómo se combinan varias operaciones de Auctioning en un mismo grupo al publicar (el código de post scan las recorre todas, pero no vi la regla exacta de reparto de cantidades).

## Ajustes de la operación de Auctioning (valores por defecto y recomendados)

### Takeaway
Auctioning define una franja de precios: **Minimum price** (suelo), **Maximum price** (techo) y **Normal price** (precio si no hay competencia). También define cuánto rebajar (**Undercut**), qué hacer si la competencia está por debajo del mínimo (**priceReset**) o por encima del máximo (**aboveMax**), cuánto publicar (**Post cap**, **Keep quantity**, **stack size** en Classic) y cuándo cancelar. Los valores por defecto se basan en `first(crafting, dbmarket, dbregionmarketavg)`: mínimo 25%, normal 200% y máximo 500% del valor medio, con suelos basados en el precio de venta al vendedor.

### Cited Findings
**Pestaña Posting (Posting Options):**
- "Auction duration" (12, 24 o 48 h). Por defecto `duration = 2` (24 h). — [TSM Auctioning Ops](https://support.tradeskillmaster.com/tsm-addon-documentation/1072146-tsm-addon-auctioning-operations); [Auctioning.lua](https://raw.githubusercontent.com/ichibsah/AddOns/master/TradeSkillMaster/Core/Service/Operations/Auctioning.lua)
- "Post cap": cuántos objetos (o subastas) publica la operación. Con 0 la operación queda desactivada. Por defecto `"5"`. Rango de 0 a 50000 (máximo 200 en Classic). — mismas fuentes
- "Amount kept in bags" (`keepQuantity`): cuántos objetos guardar sin publicar. Por defecto `"0"`. — mismas fuentes
- "Don't post after this many expires" (`maxExpires`): deja de publicar el objeto tras N expiraciones desde la última venta. Por defecto `"0"` (desactivado). — mismas fuentes
- Estos campos aceptan custom strings que den un número dentro del rango; la 4.10 permitió strings en keepQuantity y otros. — [TSM Auctioning Ops](https://support.tradeskillmaster.com/tsm-addon-documentation/1072146-tsm-addon-auctioning-operations); [TSM 4.10 New Sources](https://blog.tradeskillmaster.com/tsm-4-10-new-sources/)

**Pestaña Posting (Posting Price):**
- "Set bid as percentage of buyout" (`bidPercent`), de 0% a 100%. Por defecto 1 (100%). La puja nunca baja del mínimo. En el código existen también `useFixedBid` (false) y `fixedBid` ("1c"), añadidos en una versión. — [TSM Auctioning Ops](https://support.tradeskillmaster.com/tsm-addon-documentation/1072146-tsm-addon-auctioning-operations); [Auctioning.lua](https://raw.githubusercontent.com/ichibsah/AddOns/master/TradeSkillMaster/Core/Service/Operations/Auctioning.lua); [diff pastebin](https://pastebin.com/vCsK7awq)
- "Undercut amount": cuánto por debajo de la competencia se publica. Por defecto **0c en Retail y 1c en Classic**. En Retail, cualquier undercut menor de 1 plata se convierte en 0c (`SanitizeUndercut`), porque Retail ordena por plata y con el mismo precio tu subasta sale delante (LIFO). — [TSM Auctioning Ops](https://support.tradeskillmaster.com/tsm-addon-documentation/1072146-tsm-addon-auctioning-operations); [Auctioning.lua](https://raw.githubusercontent.com/ichibsah/AddOns/master/TradeSkillMaster/Core/Service/Operations/Auctioning.lua)
- "Minimum price": el precio más bajo al que se rebaja a la competencia. Por defecto: `check(first(crafting,dbmarket,dbregionmarketavg), max(0.25*avg(crafting,dbmarket,dbregionmarketavg), 1.5*vendorsell))`. `check()` invalida el precio si el primer parámetro no es válido o no es mayor que 0. — [Auctioning.lua](https://raw.githubusercontent.com/ichibsah/AddOns/master/TradeSkillMaster/Core/Service/Operations/Auctioning.lua); explicación en el blog de TSM (agosto 2023), citado por [búsqueda](https://blog.tradeskillmaster.com/2023/08/)
- "Maximum price": el precio más alto al que se rebaja. Por defecto: `check(first(...), max(5*avg(crafting,dbmarket,dbregionmarketavg), 30*vendorsell))`. — [Auctioning.lua](https://raw.githubusercontent.com/ichibsah/AddOns/master/TradeSkillMaster/Core/Service/Operations/Auctioning.lua)
- "Normal price": precio de respaldo si no hay nada que rebajar. Puede superar al máximo. Por defecto: `check(first(...), max(2*avg(crafting,dbmarket,dbregionmarketavg), 12*vendorsell))`. — [TSM Auctioning Ops](https://support.tradeskillmaster.com/tsm-addon-documentation/1072146-tsm-addon-auctioning-operations); [Auctioning.lua](https://raw.githubusercontent.com/ichibsah/AddOns/master/TradeSkillMaster/Core/Service/Operations/Auctioning.lua)
- Si la competencia está por debajo del mínimo (`priceReset`, por defecto `"none"`) o por encima del máximo (`aboveMax`, por defecto `"maxPrice"`), las opciones son: "Don't Post Items", "Post at Minimum Price", "Post at Maximum Price" y "Post at Normal Price". Solo para el mínimo existe además "Ignore Auctions Below Min" (`"ignore"`). — [TSM Auctioning Ops](https://support.tradeskillmaster.com/tsm-addon-documentation/1072146-tsm-addon-auctioning-operations); [Auctioning.lua](https://raw.githubusercontent.com/ichibsah/AddOns/master/TradeSkillMaster/Core/Service/Operations/Auctioning.lua)
- Validación: normal price o max price por debajo del min price hace la operación inválida, y el objeto se salta con un error. — [PostScan.lua](https://raw.githubusercontent.com/ichibsah/AddOns/master/TradeSkillMaster/Core/Service/Auctioning/PostScan.lua)

**Pestaña Details (General):**
- "Ignore auctions by duration" (`ignoreLowDuration`, por defecto 0): no tiene en cuenta subastas ajenas con poco tiempo restante. Umbrales: Short (<30 min), Medium (30 min a 2 h), Long (2 a 12 h). — [TSM Auctioning Ops](https://support.tradeskillmaster.com/tsm-addon-documentation/1072146-tsm-addon-auctioning-operations); [Auctioning.lua](https://raw.githubusercontent.com/ichibsah/AddOns/master/TradeSkillMaster/Core/Service/Operations/Auctioning.lua)
- "Blacklisted players" (`blacklist`, por defecto ""): personajes a los que se rebaja *aunque* su subasta esté por debajo del mínimo. No significa "no rebajar". — mismas fuentes
- En el código aparece también una **whitelist** global (opción de Auctioning, no de la operación) con `matchWhitelist`: los vendedores de la lista (p. ej. tus alts o amigos) no se rebajan, se iguala su precio o no se publica. — [PostScan.lua](https://raw.githubusercontent.com/ichibsah/AddOns/master/TradeSkillMaster/Core/Service/Auctioning/PostScan.lua); [CancelScan.lua](https://raw.githubusercontent.com/ichibsah/AddOns/master/TradeSkillMaster/Core/Service/Auctioning/CancelScan.lua)

**Pestaña Canceling:**
- "Cancel undercut auctions" (`cancelUndercut`, por defecto true): cancela tus subastas si te han rebajado o, en Retail, si alguien publica después de ti al mismo precio. — [TSM Auctioning Ops](https://support.tradeskillmaster.com/tsm-addon-documentation/1072146-tsm-addon-auctioning-operations); [Auctioning.lua](https://raw.githubusercontent.com/ichibsah/AddOns/master/TradeSkillMaster/Core/Service/Operations/Auctioning.lua)
- "Cancel to repost higher" (`cancelRepost`, por defecto true): si la competencia se canceló o expiró, propone cancelar y volver a publicar más caro. — mismas fuentes
- "Repost Threshold" (`cancelRepostThreshold`, por defecto `"1g"`): diferencia mínima entre tu precio actual y el nuevo para justificar la republicación. — mismas fuentes
- Opción global `cancelWithBid`: por defecto no se cancelan subastas que ya tienen puja (motivo `cancelBid`). — [CancelScan.lua](https://raw.githubusercontent.com/ichibsah/AddOns/master/TradeSkillMaster/Core/Service/Auctioning/CancelScan.lua)

**Solo Classic (no existen en Retail):**
- `stackSize` (por defecto "1", rango 1-200), `stackSizeIsCap` (por defecto false: si no tienes una pila completa, publica lo que tengas) y `matchStackSize` (por defecto false: al cancelar, solo mira subastas de tu mismo tamaño de pila). — [Auctioning.lua](https://raw.githubusercontent.com/ichibsah/AddOns/master/TradeSkillMaster/Core/Service/Operations/Auctioning.lua)
- En la 8.3 (commodities) se quitó Stack Size de las operaciones de Retail; sigue existiendo en Classic. — [TSM blog (gumdrops)](https://blog.tradeskillmaster.com/author/gumdrops/page/3/)

**Presets y recomendaciones de la comunidad:**
- Un preset muy citado (post de Reddit recogido por Wowhead): min/normal/max = **80% / 100% / 300% de dbmarket**, con una condición: si dbmarket está por debajo de cierta cifra en oro, el mínimo baja a 1 plata (para liquidar objetos baratos). — resumen de búsqueda sobre [Wowhead Economy Wrap-Up 315](https://www.wowhead.com/news/token-discussions-tsm-strings-wowhead-economy-weekly-wrap-up-315-337769) (no pude leer el texto completo del artículo)
- Otra guía de Wowhead fija el mínimo en un % del coste de fabricación, "always set it to 105%", y construye min/normal/max con crafting, average buyout y dbmarket, dividiendo entre 0.95 por la comisión de la casa de subastas. — [Wowhead (TBC) guide](https://de.tbc.wowhead.com/news/wowhead-economy-weekly-wrap-up-177-preparing-for-gold-in-tbcc-milling-calculator-322374); [Wowhead Wrap-Up 335514](https://shadowlands.wowhead.com/news/10-2-professions-and-wotlk-classic-epic-flipping-wowhead-economy-weekly-wrap-up-335514)
- El método de valor de fabricación por defecto, según un hilo de r/woweconomy, es `first(dbminbuyout, dbmarket) * 0.95` (el 0.95 descuenta la comisión de la casa de subastas). — [r/woweconomy Oct 2022](https://lr.in.psf.lt/r/woweconomy/comments/yc2knd/weekly_tradeskillmaster_thread/itsyuoc/?context=3)
- No hay acuerdo sobre el undercut: unos recomiendan 1c ("Just undercut by 1c and move on") y otros dicen que hace falta "10-20% at minimum". — [Blizzard forums](https://us.forums.blizzard.com/en/wow/t/easiest-way-to-sell-on-the-auction-house/1169267)
- DBMinBuyout es el precio de la subasta más barata en el último escaneo. No es en directo, así que puede estar desfasado o incompleto. En Classic los datos se recogen de los usuarios de TSM. — resumen de [Wowhead Wrap-Up 186](https://www.wowhead.com/news/wowhead-economy-weekly-wrap-up-186-legendary-stock-tracker-brutosaur-container-323446)

### Inferences
- Para la web: la recomendación de "precio de venta" puede usar los mismos tres valores: min = 80-90% de market (o 25% en el preset por defecto), normal = 100-200% de market y max = 300-500% de market. Después se compara el min buyout agregado con esa franja.
- En Classic/Forever el undercut por defecto es 1c y existen las pilas (stacks). La web debería recomendar un precio por unidad y quizá un tamaño de pila. En Classic las pujas (bid) tienen sentido, así que conviene mostrar un bid sugerido = buyout × bidPercent, nunca por debajo del mínimo.

### Gaps
- No encontré el texto completo de los strings de Wowhead Wrap-Up 315 (la página no cargó el cuerpo del artículo).
- No pude confirmar si las versiones actuales (2025-2026) cambiaron los valores por defecto. Sigue sin haber documentación oficial de los defaults de Auctioning ("Coming soon").
- No encontré documentación pública separada sobre "fixed bid" más allá del código.

## Lógica paso a paso del post scan y del cancel scan de Auctioning

### Takeaway
**Post:** primero comprueba que se puede publicar (post cap, cantidad mínima tras keep quantity, expiraciones, precios válidos). Luego busca la subasta ajena más barata, sin contar las de poca duración, y decide el precio por este orden: sin competencia → Normal; competencia − undercut < Min → priceReset, rebajar al de la blacklist o no publicar; la subasta más barata es tuya o de la whitelist → igualar; competencia − undercut > Max → aboveMax; si no → competencia − undercut. Al final aplica el suelo del mínimo.
**Cancel:** cancela tus subastas si te han rebajado (y la competencia no está por debajo de tu mínimo), o si puedes republicar más caro con una diferencia mayor que el threshold.

### Cited Findings
**Post scan** (todo de [PostScan.lua](https://raw.githubusercontent.com/ichibsah/AddOns/master/TradeSkillMaster/Core/Service/Auctioning/PostScan.lua)):
1. Validación de cada operación, en orden:
   - postCap inválido → `invalidItemGroup`; postCap = 0 → `postDisabled`.
   - (Classic) stackSize inválido, o mayor que la pila máxima sin stackSizeIsCap → la operación se rechaza.
   - Cantidad que tienes − keepQuantity < cantidad mínima (1 en Retail; stackSize en Classic, o 1 con stackSizeIsCap) → `postNotEnough`.
   - maxExpires > 0 y expiraciones desde la última venta > maxExpires → `postMaxExpires`.
   - minPrice, maxPrice, normalPrice o undercut inválidos, normal < min o max < min → error.
   - El objeto se publica solo si al menos una operación es válida y ninguna es inválida.
2. Cantidad:
   - Retail: `perAuction = min(postCap, numHave)`. Los objetos que no son commodities se publican de uno en uno; los commodities se agrupan.
   - Classic: `perAuction = min(stackSize, maxStack)` y `maxCanPost = min(floor(numHave/perAuction), postCap)`. Con stackSizeIsCap se publica también la pila parcial sobrante.
   - Se descuentan del postCap tus subastas ya activas o en cola al mismo precio y tamaño de pila; si no queda nada → `postTooMany`.
3. Competencia: solo cuentan subastas con buyout > 0 y tiempo restante mayor que ignoreLowDuration. "Ignore Auctions Below Min" hace que se pasen por alto las subastas por debajo del mínimo y se busque la siguiente. `GetLowestAuction` marca si la más barata es tuya (isPlayer), de la whitelist o de la blacklist.
4. Decisión de buyout (gana la primera que se cumple):
   1. Sin competencia → `postNormal` (normalPrice).
   2. Vendedor desconocido → `invalidSeller` (se salta).
   3. Más barata − undercut < minPrice:
      - con priceReset configurado → `postResetMin`, `postResetMax` o `postResetNormal`;
      - si no, y el vendedor está en la blacklist → `postBlacklist` (rebaja aun por debajo del mínimo);
      - si no → `postBelowMin` (no publica).
   4. La más barata es tuya → `postPlayer` (iguala tu precio). Si es de la whitelist → `postWhitelist` (iguala, con matchWhitelist) o `postWhitelistNoPost`.
   5. Más barata − undercut > maxPrice → `postAboveMaxNoPost` (si aboveMax = none), o `postAboveMaxMin`, `postAboveMaxMax` o `postAboveMaxNormal`.
   6. Si no → `postUndercut` (más barata − undercut).
5. Ajustes finales:
   - buyout = max(buyout, minPrice), excepto en el caso de la blacklist;
   - bid = max(buyout × bidPercent, minPrice);
   - Retail redondea a la plata (mínimo 1 plata); Classic redondea el bid hacia abajo.

**Cancel scan** (todo de [CancelScan.lua](https://raw.githubusercontent.com/ichibsah/AddOns/master/TradeSkillMaster/Core/Service/Auctioning/CancelScan.lua)):
1. Solo mira tus subastas no vendidas, de los grupos seleccionados. Si la operación no tiene ni cancelUndercut ni cancelRepost → `cancelDisabled`.
2. Salidas tempranas:
   - (Classic, con matchStackSize) se salta pilas de distinto tamaño;
   - tiene puja y cancelWithBid está desactivado → `cancelBid`;
   - (Retail) no tienes oro para el coste de cancelar → `cancelNoMoney`.
3. Sin competencia: si cancelRepost y `normalPrice − tuBuyout > cancelRepostThreshold` → cancelar (`cancelRepost`); si no → `cancelNotUndercut`.
4. Con competencia (gana la primera que se cumple):
   1. Tu buyout < minPrice → `cancelReset` si cancelRepost y `tuBuyout < resetPrice − threshold`; si no → `cancelBelowMin`.
   2. La más barata ajena < minPrice (y no está en la blacklist) → `cancelBelowMin`, no cancela: no persigue precios por debajo del suelo.
   3. Te rebajaste a ti mismo (otra subasta tuya más barata) → `cancelPlayerUndercut`.
   4. Eres el único vendedor → `cancelRepost` si `normal − tuBuyout > threshold`; si no → `cancelAtNormal`.
   5. Eres la más barata y la segunda está por encima del máximo → repost a aboveMax si la diferencia supera el threshold; si no → `cancelAtAboveMax`.
   6. Eres la más barata → repost si `(segunda − undercut) − tuBuyout > threshold`; si no → `cancelNotUndercut`.
   7. Te han rebajado y cancelUndercut está desactivado → no hace nada.
   8. Te rebajó alguien de la whitelist con el mismo precio → `cancelAtWhitelist` (no cancela); con otro precio → `cancelWhitelistUndercut`.
   9. Te rebajó alguien que no está en la whitelist → `cancelUndercut`.
- En Retail, un empate de precio se resuelve por ID de subasta (la más reciente va primero, LIFO). — [CancelScan.lua](https://raw.githubusercontent.com/ichibsah/AddOns/master/TradeSkillMaster/Core/Service/Auctioning/CancelScan.lua); [TSM Auctioning Ops](https://support.tradeskillmaster.com/tsm-addon-documentation/1072146-tsm-addon-auctioning-operations)

### Inferences
- **Adaptación sin listados en directo:** la web puede simular el post scan usando el min buyout agregado como "la más barata":
  - min buyout ausente → Normal;
  - min buyout − undercut < Min → "No publicar / esperar" (o reset);
  - min buyout − undercut > Max → publicar a Max;
  - si no → min buyout − undercut.
- La web no puede saber si la más barata es tuya, de la whitelist o con poca duración, ni hacer el cancel scan real. Como mucho puede avisar: "si tu subasta está a X y el min buyout actual es Y < X, conviene cancelar". Conviene avisar de que el min buyout puede estar desfasado.
- Se pueden mostrar códigos de motivo equivalentes ("Publicar a precio normal (sin competencia)", "Por debajo del mínimo: no publicar", etc.) para dar transparencia, como hace el log de TSM.

### Gaps
- No vi el código de `GetLowestAuction` ni `GetPrice` (Util.lua), así que la regla exacta de whitelist/blacklist/"ignore below min" en la selección de la competencia es inferida.
- No he verificado si la lógica cambió después de la v4.10.19.

## Operación de Shopping y la interfaz de búsqueda (filtros, sintaxis avanzada, búsquedas guardadas, vendor/disenchant)

### Takeaway
La operación de Shopping tiene cuatro ajustes: **Maximum auction price** (por defecto `dbmarket`), **Show auctions above max price** (por defecto sí), **Maximum restock quantity** (por defecto 0 = sin límite) y **Sources to include for restock** (alts, auctions, bank, guild). Ya no existe "even stacks" en la operación. La pestaña Shopping permite además buscar por grupos, por texto con filtros `/`, búsquedas guardadas, Vendor Search, Disenchant Search y Great Deals.

### Cited Findings
- Ajustes: "Maximum auction price" (acepta custom strings), "Show auctions above max price" (activado por defecto), "Maximum restock quantity" y "Sources to include for restock". Shopping no funciona sobre el Base Group. — [TSM Shopping Ops](https://support.tradeskillmaster.com/tsm-addon-shopping-operations)
- Valores por defecto (código): `restockQuantity "0"`, `maxPrice "dbmarket"`, `showAboveMaxPrice true`, `restockSources {alts=false, auctions=false, bank=false, guild=false}`. No existe `evenStacks`. — [Shopping.lua](https://raw.githubusercontent.com/ichibsah/AddOns/master/TradeSkillMaster/Core/Service/Operations/Shopping.lua)
- Restock: cuenta bolsas + correo, más las fuentes activadas (banco y banco de reagentes, banco de hermandad, alts, subastas). Si tienes ≥ restockQuantity, no busca. Si no, compra como mucho `restockQuantity − numHave`. Con 0 no hay límite. Rango de 0 a 50000. — [Shopping.lua](https://raw.githubusercontent.com/ichibsah/AddOns/master/TradeSkillMaster/Core/Service/Operations/Shopping.lua)
- Filtrado: con showAboveMaxPrice desactivado, se ocultan las subastas con buyout > maxPrice. Con la opción activada se muestran todas, y las que superan el máximo aparecen marcadas. — [Shopping.lua](https://raw.githubusercontent.com/ichibsah/AddOns/master/TradeSkillMaster/Core/Service/Operations/Shopping.lua)
- La opción "even stacks" se quitó de Shopping/Browse porque ya no hacía falta con los commodities de la 8.3 (Retail). — [TSM blog](https://blog.tradeskillmaster.com/author/gumdrops/page/3/), citado vía búsqueda
- **Sintaxis de filtros (búsqueda por texto):**
  - nombre (parcial), o `/exact` para nombre exacto (solo Shopping);
  - nivel requerido `/90`, `/25/50`, `/0/30`;
  - nivel de objeto `/i600`, `/i700/i730`;
  - clase `/armor`, `/weapon`, `/gem` y subclase `/armor/cloth`;
  - ranura `/head`, `/back`;
  - calidad `/common`, `/uncommon`, `/rare`, `/epic`;
  - precio máximo `/1000g` (en Shopping es el buyout máximo);
  - `/usable` (solo Shopping);
  - `/x200`: cantidad, la búsqueda se detiene al llegar a ella (solo Shopping);
  - `/even`: pilas múltiplos de 5, para moler/prospectar (solo Shopping; posiblemente obsoleto en Retail);
  - `/upgrades` (Browse).
  — [TSM: How do I filter items](https://support.tradeskillmaster.com/how-do-i-filter-items-in-my-groups-or-the-base-group)
- El filtro `/disenchant` es propio del módulo Shopping: p. ej. "temporal crystal/disenchant" devuelve los objetos que se desencantan en Temporal Crystal. — [TSM blog p=644](https://blog.tradeskillmaster.com/?p=644), citado vía búsqueda
- El addon tiene módulos de búsqueda separados: VendorSearch, DisenchantSearch, GreatDealsSearch, GroupSearch, FilterSearch y SavedSearches. — [TradeSkillMaster.toc v4.10.19](https://raw.githubusercontent.com/ichibsah/AddOns/master/TradeSkillMaster/TradeSkillMaster.toc)
- **Vendor Search:** exige un escaneo de AuctionDB de menos de 12 h. Preselecciona los objetos con `minBuyout < vendorSell` y luego, en la búsqueda en directo, muestra solo las subastas con buyout menor que el precio de venta al vendedor. — [VendorSearch.lua](https://raw.githubusercontent.com/ichibsah/AddOns/master/TradeSkillMaster/Core/Service/Shopping/VendorSearch.lua)
- **Disenchant Search:** objetos desencantables, con nivel de objeto entre `minDeSearchLvl` y `maxDeSearchLvl`, y buyout ≤ `maxDeSearchPercent`% del valor `Destroy` (desencantar). Exige datos de menos de 12 h. — [DisenchantSearch.lua](https://raw.githubusercontent.com/ichibsah/AddOns/master/TradeSkillMaster/Core/Service/Shopping/DisenchantSearch.lua)
- **Great Deals:** lista de objetos "SHOPPING_SEARCHES/greatDeals" por reino que genera la aplicación de escritorio TSM (TSM App). El addon solo la carga como filtro. — [GreatDealsSearch.lua](https://raw.githubusercontent.com/ichibsah/AddOns/master/TradeSkillMaster/Core/Service/Shopping/GreatDealsSearch.lua)
- **Saved searches:** la interfaz guarda las búsquedas recientes y favoritas ("Show Saved Searches" en versiones antiguas). — [Engadget 2012](https://www.engadget.com/2012-08-08-addon-spotlight-tradeskillmaster-tips-and-tricks.html) (fuente antigua)

### Inferences
- Equivalentes en la web:
  - "Lista de compra": por grupo, mostrar los objetos con min buyout ≤ maxPrice (p. ej. ≤ 100% de market, o ≤ 70-80% para gangas), con una cantidad objetivo de restock (que el usuario mete a mano).
  - "Vendor flip": min buyout < precio de venta al vendedor (hace falta tener los precios de vendedor).
  - "DE flip": min buyout < X% del valor de desencantar (hace falta una tabla de desencantamiento).
  - "Great deals": min buyout muy por debajo de market e historical.

### Gaps
- No encontré el valor por defecto de `maxDeSearchPercent` ni de los niveles mínimo y máximo de la búsqueda de desencantar.
- No pude confirmar que `/even` o la búsqueda de crafting sigan existiendo en Classic/Forever en las versiones actuales.
- La documentación no explica cómo genera la TSM App la lista de Great Deals (criterio de precio).

## Sniper: funcionamiento y filtros

### Takeaway
Sniper repite una búsqueda sin parar para "cazar" subastas recién publicadas por debajo de un precio (`belowPrice`). En Retail funciona como un Shopping en bucle (con 30 s entre búsquedas). En Classic revisa una y otra vez la última página de la casa de subastas, donde salen las subastas nuevas. Tiene modo buyout y modo bid.

### Cited Findings
- Retail: como un Shopping que se repite hasta pararlo, con 30 s entre búsquedas. Classic: busca una y otra vez en la última página (las subastas recientes). — [TSM Sniper Ops](https://support.tradeskillmaster.com/tsm-addon-documentation/tsm-addon-sniper-operations)
- Único ajuste: "Maximum price" (custom string), más las opciones de gestión. No funciona sobre el Base Group en Retail, sí en Classic. — [TSM Sniper Ops](https://support.tradeskillmaster.com/tsm-addon-documentation/tsm-addon-sniper-operations)
- Clave `belowPrice` por defecto: `max(vendorsell, ifgt(DBRegionMarketAvg, 250000g, 0.8, ifgt(DBRegionMarketAvg, 100000g, 0.7, ...)))`. Es una cadena de `ifgt` que aplica un multiplicador decreciente (de 0.8 hasta 0.05) sobre DBRegionMarketAvg según lo caro que sea el objeto (cuanto más barato, menor porcentaje), y nunca baja del precio de venta al vendedor. — [Sniper.lua](https://raw.githubusercontent.com/ichibsah/AddOns/master/TradeSkillMaster/Core/Service/Operations/Sniper.lua)
- Sniper tiene dos modos de búsqueda: BuyoutSearch y BidSearch. — [TradeSkillMaster.toc](https://raw.githubusercontent.com/ichibsah/AddOns/master/TradeSkillMaster/TradeSkillMaster.toc)
- No hay acuerdo sobre el Base Group en Retail: un hilo de septiembre de 2024 dice que desde la 4.10 no se puede, y otro de octubre de 2024 dice que desde la 4.14 se puede asignar Sniper al Base Group. — [r/woweconomy Sep 2024](https://lr.in.psf.lt/r/woweconomy/comments/1f6ykz4/weekly_tradeskillmaster_thread); [r/woweconomy Oct 2024](https://lr.in.psf.lt/r/woweconomy/comments/1gdv8ej/weekly_tradeskillmaster_thread/luuzati/?context=3)

### Inferences
- La web no puede hacer sniping real (no tiene datos en directo). Lo más parecido: una alerta cuando, en la consulta horaria, el min buyout de un objeto baja de un umbral escalonado como el `belowPrice` por defecto (80% del market para objetos caros, porcentajes menores para los baratos).

### Gaps
- No obtuve la cadena `belowPrice` completa (la respuesta salió truncada después de 0.7) ni los umbrales intermedios exactos.
- No encontré documentación oficial del modo bid de Sniper.

## Qué existe en Classic/Forever y qué es solo de Retail (commodities vs. subasta individual)

### Takeaway
En Classic (y por tanto, previsiblemente, en WoW Forever, que se basa en un cliente Classic) cada subasta es individual y tiene pilas, pujas y undercut de 1c. Retail tiene commodities (precio por unidad, compra parcial), orden LIFO con el mismo precio, undercut 0c redondeado a la plata y sin stack size.

### Cited Findings
- Solo Retail: posting Last-In-First-Out (si igualas el precio de la competencia, tu subasta sale delante) y cancelar si alguien publica después al mismo precio. Undercut por defecto 0c (Retail) y 1c (Classic). — [TSM Auctioning Ops](https://support.tradeskillmaster.com/tsm-addon-documentation/1072146-tsm-addon-auctioning-operations)
- Solo Classic: `stackSize`, `stackSizeIsCap`, `matchStackSize`; postCap máximo 200 en Classic frente a 50000 en Retail. Retail: undercut menor de 1 plata → 0c, y precios redondeados a la plata. — [Auctioning.lua](https://raw.githubusercontent.com/ichibsah/AddOns/master/TradeSkillMaster/Core/Service/Operations/Auctioning.lua); [PostScan.lua](https://raw.githubusercontent.com/ichibsah/AddOns/master/TradeSkillMaster/Core/Service/Auctioning/PostScan.lua)
- Stack Size y "even stacks" se quitaron de Retail con los commodities de la 8.3. — [TSM blog](https://blog.tradeskillmaster.com/author/gumdrops/page/3/)
- (Retail) El coste de cancelar se comprueba con `C_AuctionHouse.GetCancelCost`. — [CancelScan.lua](https://raw.githubusercontent.com/ichibsah/AddOns/master/TradeSkillMaster/Core/Service/Auctioning/CancelScan.lua)
- Sniper en Classic revisa la última página; en Retail repite la búsqueda cada 30 s. Sniper funciona sobre el Base Group en Classic. — [TSM Sniper Ops](https://support.tradeskillmaster.com/tsm-addon-documentation/tsm-addon-sniper-operations)
- En Classic los precios de AuctionDB se recogen de los usuarios de TSM (no de la API de Blizzard). — resumen de [Wowhead Wrap-Up 186](https://www.wowhead.com/news/wowhead-economy-weekly-wrap-up-186-legendary-stock-tracker-brutosaur-container-323446)

### Inferences
- Para WoW Forever US PvP Horde, la web debería seguir las reglas de Classic: undercut de 1c (o un porcentaje), recomendaciones por unidad y por pila, bid sugerido, y sin LIFO (igualar el precio no te pone delante).

### Gaps
- No encontré ninguna fuente concreta sobre el soporte de TSM para "WoW Forever" como tal, ni sobre qué variante del addon (Classic Era / Anniversary) usa.

## Estrategias habituales de goldmaking con TSM y presets de la comunidad

### Takeaway
Los patrones típicos son: publicar con una franja de precios relativa a dbmarket (min 80-90%, normal 100-200%, max 300-500%); hacer flipping, es decir, comprar con Shopping/Sniper por debajo de un % de market y revender con Auctioning; vendor flip y DE/milling flip; y vender lo fabricado con un mínimo ligado al coste de fabricación (≥ 105%).

### Cited Findings
- Preset min/normal/max = 80/100/300% de dbmarket, con condición `ifgt` para objetos baratos. — resumen de [Wowhead Wrap-Up 315](https://www.wowhead.com/news/token-discussions-tsm-strings-wowhead-economy-weekly-wrap-up-315-337769)
- Mínimo = 105% del coste de fabricación para lo fabricado. — [Wowhead TBC guide](https://de.tbc.wowhead.com/news/wowhead-economy-weekly-wrap-up-177-preparing-for-gold-in-tbcc-milling-calculator-322374)
- "Epic flipping" en WotLK Classic (comprar épicas baratas y revender), con strings basados en crafting, avgbuyout y dbmarket divididos entre 0.95. — [Wowhead Wrap-Up 335514](https://shadowlands.wowhead.com/news/10-2-professions-and-wotlk-classic-epic-flipping-wowhead-economy-weekly-wrap-up-335514)
- Vendor search (comprar por debajo del precio de vendedor) y disenchant search (comprar para desencantar) como estrategias de flipping. — [Tradeprincess blog 2013](https://tradeprincess.blogspot.com/2013/07/); [VendorSearch.lua](https://raw.githubusercontent.com/ichibsah/AddOns/master/TradeSkillMaster/Core/Service/Shopping/VendorSearch.lua)
- El valor por defecto del Sniper ya es un escalado: cuanto más caro el objeto, mayor el % del market regional que aceptas pagar (80% por encima de 250000g, 70% por encima de 100000g...). — [Sniper.lua](https://raw.githubusercontent.com/ichibsah/AddOns/master/TradeSkillMaster/Core/Service/Operations/Sniper.lua)

### Inferences
- Reglas de recomendación que puede implementar una web solo con datos agregados:
  - **Comprar** si min buyout ≤ k × market (k = 0.7-0.8), y además historical ≈ market (para descartar caídas estructurales).
  - **Vender** a max(min buyout − undercut, 0.8 × market) o, si no hay oferta, a 1.0-2.0 × market.
  - **No vender** (esperar) si min buyout < 0.8 × market.
  - **Margen de flip:** (precio de venta × 0.95) − precio de compra > 0, por la comisión del 5% de la casa de subastas.

### Gaps
- No pude leer completos los artículos de Wowhead con strings concretos (el cuerpo del artículo no cargaba). Los porcentajes 80/100/300 vienen del resumen de búsqueda, no del texto literal.
- No encontré presets específicos para Classic Era/Forever en r/woweconomy en el tiempo disponible.
