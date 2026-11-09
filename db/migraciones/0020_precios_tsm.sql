-- =====================================================================
-- 0020 — W1 del plan V4: precios TSM como fuente principal y trazables.
--
-- * TSM publica minBuyout = 0 (y recent = 0) cuando NO hay anuncios en ese momento. Un 0 no es
--   un precio: se guarda como null («sin dato»), nunca como 0c. Se corrigen los datos ya guardados
--   (la Edge Function ya convierte los 0 al importar).
-- * Cada métrica de cada fuente tiene nombre y significado (tabla `metricas`).
-- * La tabla del Mercado muestra SOLO la compra mínima como precio. El valor de mercado va aparte,
--   con su nombre; nunca se presenta como compra mínima. Variaciones y minigráfico, solo con la
--   compra mínima (misma métrica, mismo mercado).
-- * Mercado principal: TSM · Forever · US · PvP · Horda (el de la especificación). AHledger sigue
--   como fuente aparte, elegible y con su nombre: nunca se mezclan.
-- =====================================================================

-- ---------- 1. Un 0 de TSM es «sin anuncios», no un precio ----------
update price_hourly p
   set min_buyout   = nullif(p.min_buyout, 0),
       recent       = nullif(p.recent, 0),
       market_value = nullif(p.market_value, 0),
       historical   = nullif(p.historical, 0)
  from markets m
 where m.id = p.market_id and m.provider = 'tsm'
   and (p.min_buyout = 0 or p.recent = 0 or p.market_value = 0 or p.historical = 0);

-- ---------- 2. Métricas con nombre y significado ----------
create table metricas (
  proveedor   text not null,
  columna     text not null check (columna in ('min_buyout', 'market_value', 'recent', 'historical', 'median',
                                               'quantity', 'sales_per_day')),
  clave_fuente text not null,          -- nombre del campo en la fuente
  nombre      text not null,
  significado text not null,
  url         text,
  orden       smallint not null,
  primary key (proveedor, columna)
);
alter table metricas enable row level security;
revoke all on metricas from anon, authenticated;

insert into metricas (proveedor, columna, clave_fuente, nombre, significado, url, orden) values
  ('tsm', 'min_buyout', 'minBuyout', 'Compra mínima',
   'Precio por unidad de la subasta más barata en el último escaneo del reino. Sin anuncios no hay valor.',
   'https://support.tradeskillmaster.com/which-price-sources-can-i-use-and-what-do-they-mean', 1),
  ('tsm', 'market_value', 'marketValue', 'Valor de mercado (TSM)',
   'Media ponderada de 14 días que da más peso a los 3 últimos. Refleja precios de anuncios, no de ventas.',
   'https://support.tradeskillmaster.com/which-price-sources-can-i-use-and-what-do-they-mean', 2),
  ('tsm', 'recent', 'recent', 'Valor reciente (TSM)',
   'Calculado solo con el escaneo más reciente.',
   'https://support.tradeskillmaster.com/which-price-sources-can-i-use-and-what-do-they-mean', 3),
  ('tsm', 'historical', 'historical', 'Precio histórico (TSM)',
   'Media de 60 días del valor de mercado.',
   'https://support.tradeskillmaster.com/which-price-sources-can-i-use-and-what-do-they-mean', 4),
  ('ahledger', 'min_buyout', 'min', 'Compra mínima',
   'Precio por unidad del anuncio más barato en el último escaneo de AHledger.',
   'https://ahledger.com/developers', 1),
  ('ahledger', 'median', 'median', 'Mediana del escaneo (AHledger)',
   'Mediana de los anuncios del último escaneo.', 'https://ahledger.com/developers', 2),
  ('ahledger', 'historical', 'median30d', 'Mediana de 30 días (AHledger)',
   'Mediana de los últimos 30 días según AHledger.', 'https://ahledger.com/developers', 3),
  ('ahledger', 'quantity', 'quantity', 'Cantidad publicada',
   'Unidades a la venta en el último escaneo.', 'https://ahledger.com/developers', 4),
  ('ahledger', 'sales_per_day', 'salesPerDay', 'Ventas por día (estimación)',
   'Estimación de AHledger: un escaneo no distingue una venta de una cancelación.', 'https://ahledger.com/glossary', 5);

create function metricas_mercado(p_market_key text) returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object('columna', x.columna, 'clave_fuente', x.clave_fuente, 'nombre', x.nombre,
                                               'significado', x.significado, 'url', x.url) order by x.orden), '[]'::jsonb)
    from metricas x join markets m on m.provider = x.proveedor
   where m.key = p_market_key
$$;

-- ---------- 3. Mercado principal y atribución de TSM ----------
insert into settings (key, value) values ('mercado_principal', 'tsm:forever:us:pvp-horde')
on conflict (key) do update set value = excluded.value;

create function mercado_principal() returns text language sql stable as $$
  select s.value from settings s join markets m on m.key = s.value where s.key = 'mercado_principal'
$$;

update markets
   set atribucion_texto = 'Precios: TradeSkillMaster (datos públicos)',
       atribucion_url = 'https://tradeskillmaster.com/public-data'
 where key = 'tsm:forever:us:pvp-horde';

-- ---------- 4. Tabla del Mercado: precio = compra mínima; valor de mercado aparte ----------
create or replace function mercado_pagina(p_market_key text, p jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable as $$
declare
  v_m        markets%rowtype;
  v_orden    text := coalesce(nullif(p->>'orden', ''), 'nombre');
  v_dir      text;
  v_tam      integer := coalesce(_param_entero(p, 'por_pagina'), 100);
  v_pag      integer := coalesce(_param_entero(p, 'pagina'), 1);
  v_qraw     text := btrim(coalesce(p->>'q', ''));
  v_id       integer := (substring(v_qraw from '^#?(\d{1,9})$'))::integer;
  v_palabras text[];
  v_cat      text := nullif(p->>'categoria', '');
  v_sub      text := nullif(p->>'subcategoria', '');
  v_cal      text := nullif(p->>'calidad', '');
  v_prof     text := nullif(p->>'profesion', '');
  v_nmin     bigint := _param_entero(p, 'nivel_min');
  v_nmax     bigint := _param_entero(p, 'nivel_max');
  v_pmin     bigint := _param_entero(p, 'precio_min');
  v_pmax     bigint := _param_entero(p, 'precio_max');
  v_ofertas  boolean := coalesce((p->>'solo_ofertas')::boolean, false);
  v_res      jsonb;
begin
  select * into v_m from markets where key = p_market_key;
  if not found then raise exception 'Mercado % no registrado', p_market_key; end if;
  if v_orden not in ('nombre', 'precio', 'cantidad', 'var24') then
    raise exception 'Orden no válido: % (nombre, precio, cantidad o var24)', v_orden;
  end if;
  v_dir := coalesce(nullif(p->>'dir', ''), case when v_orden in ('nombre', 'precio') then 'asc' else 'desc' end);
  if v_dir not in ('asc', 'desc') then raise exception 'Dirección no válida: % (asc o desc)', v_dir; end if;
  if v_tam not between 1 and 200 then raise exception 'por_pagina debe estar entre 1 y 200'; end if;
  if v_pag < 1 then raise exception 'pagina debe ser 1 o más'; end if;
  if v_prof is not null and not (v_prof = any (_profesiones())) then
    raise exception 'Profesión desconocida: %', v_prof;
  end if;
  -- Palabras normalizadas (sin tildes ni mayúsculas); % y _ se buscan como texto.
  select coalesce(array_agg(replace(replace(replace(w, '\', '\\'), '%', '\%'), '_', '\_')), '{}')
    into v_palabras
    from unnest(regexp_split_to_array(_normalizar(v_qraw), '\s+')) w
   where w <> '';

  with ult as (
    select date_trunc('hour', max(s.source_updated_at), 'UTC') as hora, max(s.source_updated_at) as escaneo
      from snapshots s where s.market_id = v_m.id
  ),
  base as (
    select c.item_id, c.nombre, c.calidad, c.clase, c.subclase, c.nivel, c.icono_url, c.busqueda
      from catalogo c
     where c.game_type = v_m.game_type and not v_m.is_demo
    union all
    select i.item_id, i.name, i.quality, i.category, i.item_subclass, i.level, i.icon_url, _normalizar(i.name)
      from items i
     where i.market_id = v_m.id
       and (v_m.is_demo or not exists (select 1 from catalogo c where c.game_type = v_m.game_type and c.item_id = i.item_id))
  ),
  con_precio as (
    select b.*, coalesce(b.clase, 'Sin clasificar') as categoria,
           pm.hour as visto,
           case when p.hour is null then 'sin_datos'
                when pm.hour >= u.hora then 'con_ofertas' else 'sin_ofertas' end as estado,
           case when pm.hour >= u.hora then pm.min_buyout end as precio,
           case when p.hour >= u.hora then p.market_value end as valor_mercado,
           case when pm.hour >= u.hora then p.quantity end as cantidad,
           pm.min_buyout as ultimo_precio,
           p24.precio as precio_24h, p24.hour as hora_24h
      from base b
      cross join ult u
      left join lateral (select x.hour, x.min_buyout, x.market_value, x.quantity from price_hourly x
                          where x.market_id = v_m.id and x.item_id = b.item_id
                          order by x.hour desc limit 1) p on true
      -- Último escaneo con compra mínima (puede ser anterior al último en que aparece el objeto).
      left join lateral (select x.hour, x.min_buyout from price_hourly x
                          where x.market_id = v_m.id and x.item_id = b.item_id and x.min_buyout is not null
                          order by x.hour desc limit 1) pm on p.hour is not null
      -- Variación: la MISMA métrica (compra mínima) ~24 h antes.
      left join lateral (select x.hour, x.min_buyout as precio from price_hourly x
                          where x.market_id = v_m.id and x.item_id = b.item_id and x.min_buyout is not null
                            and x.hour <= pm.hour - interval '24 hours' and x.hour >= pm.hour - interval '30 hours'
                          order by x.hour desc limit 1) p24 on pm.hour >= u.hora
  ),
  -- Todos los filtros MENOS la categoría (para contar cuántos hay en cada categoría).
  sin_cat as (
    select cp.*,
           case when cp.precio_24h > 0 and cp.precio is not null
                then round((cp.precio - cp.precio_24h) * 100.0 / cp.precio_24h, 1) end as var24
      from con_precio cp
     where (v_id is null or cp.item_id = v_id or cp.busqueda like '%' || v_id::text || '%')
       and (v_id is not null or cardinality(v_palabras) = 0
            or (select bool_and(cp.busqueda like '%' || w || '%') from unnest(v_palabras) w))
       and (v_cal is null or cp.calidad = v_cal)
       and (v_nmin is null or cp.nivel >= v_nmin)
       and (v_nmax is null or cp.nivel <= v_nmax)
       and (v_pmin is null or cp.precio >= v_pmin)
       and (v_pmax is null or cp.precio <= v_pmax)
       and (not v_ofertas or cp.estado = 'con_ofertas')
       and (v_prof is null
            or exists (select 1 from recipes r where r.game_type = v_m.game_type and r.profesion = v_prof
                                                 and r.resultado_id = cp.item_id)
            or exists (select 1 from recipe_materials rm join recipes r using (game_type, spell_id)
                        where rm.game_type = v_m.game_type and r.profesion = v_prof and rm.item_id = cp.item_id))
  ),
  filtrado as (
    select * from sin_cat
     where (v_cat is null or categoria = v_cat) and (v_sub is null or subclase = v_sub)
  ),
  pagina as (
    select f.*, count(*) over () as total
      from filtrado f
     order by
       case when v_dir = 'asc' then case v_orden when 'precio' then f.precio::numeric when 'cantidad' then f.cantidad::numeric
                                                  when 'var24' then f.var24 end end asc nulls last,
       case when v_dir = 'desc' then case v_orden when 'precio' then f.precio::numeric when 'cantidad' then f.cantidad::numeric
                                                   when 'var24' then f.var24 end end desc nulls last,
       case when v_orden = 'nombre' and v_dir = 'asc' then f.busqueda end asc,
       case when v_orden = 'nombre' and v_dir = 'desc' then f.busqueda end desc,
       f.busqueda, f.item_id
     limit v_tam offset (v_pag - 1) * v_tam
  ),
  cats as (
    select categoria, count(*) as n,
           (array_agg(icono_url order by item_id) filter (where icono_url is not null))[1] as icono
      from sin_cat group by categoria
  ),
  subs as (
    select categoria, jsonb_agg(jsonb_build_object('subcategoria', subclase, 'n', n) order by subclase) as subcategorias
      from (select categoria, subclase, count(*) as n from sin_cat where subclase is not null group by 1, 2) x
     group by categoria
  )
  select jsonb_build_object(
    'mercado', v_m.key,
    'escaneo', (select escaneo from ult),
    'pagina', v_pag,
    'por_pagina', v_tam,
    'total', coalesce((select max(total) from pagina), (select count(*) from filtrado)),
    'total_catalogo', (select count(*) from base),
    'filas', coalesce((select jsonb_agg(jsonb_build_object(
        'id', pg.item_id, 'nombre', pg.nombre, 'calidad', pg.calidad, 'icono', pg.icono_url,
        'categoria', pg.categoria, 'subcategoria', pg.subclase, 'nivel', pg.nivel,
        'estado', pg.estado, 'precio', pg.precio, 'valor_mercado', pg.valor_mercado,
        'cantidad', pg.cantidad, 'var24', pg.var24,
        'precio_24h', pg.precio_24h, 'hora_24h', pg.hora_24h,
        'visto', pg.visto, 'ultimo_precio', case when pg.estado = 'sin_ofertas' then pg.ultimo_precio end,
        -- Minigráfico: compra mínima más baja de cada tramo de 6 h en los últimos 7 días (solo tramos observados).
        'spark', (select coalesce(jsonb_agg(jsonb_build_array((extract(epoch from t.tramo) * 1000)::bigint, t.v) order by t.tramo), '[]'::jsonb)
                    from (select date_bin('6 hours', x.hour, timestamptz '2000-01-01 00:00+00') as tramo,
                                 min(x.min_buyout) as v
                            from price_hourly x
                           where x.market_id = v_m.id and x.item_id = pg.item_id and x.min_buyout is not null
                             and x.hour > (select hora from ult) - interval '7 days'
                           group by 1) t)
      ) order by rn)
      from (select pagina.*, row_number() over () as rn from pagina) pg), '[]'::jsonb),
    'categorias', coalesce((select jsonb_agg(jsonb_build_object(
        'categoria', c.categoria, 'n', c.n, 'icono', c.icono, 'subcategorias', coalesce(s.subcategorias, '[]'::jsonb))
        order by c.categoria = 'Sin clasificar', c.categoria)
      from cats c left join subs s using (categoria)), '[]'::jsonb),
    'calidades', coalesce((select jsonb_agg(distinct calidad) from base where calidad is not null), '[]'::jsonb),
    'profesiones', coalesce((select jsonb_agg(distinct r.profesion) from recipes r where r.game_type = v_m.game_type), '[]'::jsonb)
  ) into v_res;
  return v_res;
end $$;


-- ---------- 5. Ficha: cada métrica separada, con la hora original y la de importación ----------
create or replace function _extremos_30d(p_market_id smallint, p_item_id integer) returns jsonb
language sql stable as $$
  with ref as (select max(source_updated_at) as h from snapshots where market_id = p_market_id),
  o as (select p.hour, p.min_buyout as v
          from price_hourly p, ref
         where p.market_id = p_market_id and p.item_id = p_item_id
           and p.hour > ref.h - interval '30 days' and p.min_buyout is not null)
  select case when exists (select 1 from o) then jsonb_build_object(
    'minimo', (select v from o order by v, hour desc limit 1),
    'minimo_hora', (select hour from o order by v, hour desc limit 1),
    'maximo', (select v from o order by v desc, hour desc limit 1),
    'maximo_hora', (select hour from o order by v desc, hour desc limit 1),
    'observaciones', (select count(*) from o)) end
$$;

create or replace function ficha_objeto(p_market_key text, p_item_id integer) returns jsonb
language sql stable as $$
  with m as (select id, game_type, is_demo, provider from markets where key = p_market_key),
  ult as (select date_trunc('hour', max(s.source_updated_at), 'UTC') as hora, max(s.source_updated_at) as escaneo
            from snapshots s, m where s.market_id = m.id),
  p as (select x.*, s.source_updated_at as observado, s.fetched_at as importado
          from price_hourly x join m on x.market_id = m.id left join snapshots s on s.id = x.snapshot_id
         where x.item_id = p_item_id order by x.hour desc limit 1),
  pm as (select x.hour, x.min_buyout from price_hourly x join m on x.market_id = m.id
          where x.item_id = p_item_id and x.min_buyout is not null order by x.hour desc limit 1)
  select case when c.item_id is null and i.item_id is null then null else jsonb_build_object(
    'id', p_item_id,
    'nombre', coalesce(c.nombre, i.name),
    'nombre_es', c.nombre_es,
    'calidad', coalesce(c.calidad, i.quality),
    'clase', coalesce(c.clase, i.item_class),
    'subclase', coalesce(c.subclase, i.item_subclass),
    'nivel', coalesce(c.nivel, i.level),
    'nivel_requerido', coalesce(c.nivel_requerido, i.required_level),
    'venta_npc', coalesce(c.venta_npc, i.vendor_price),
    'compra_npc', c.compra_npc,
    'icono', coalesce(c.icono_url, i.icon_url),
    'wowhead_url', case when not (select is_demo from m) then
                     coalesce(c.wowhead_url, format('https://www.wowhead.com/%s/item=%s', (select game_type from m), p_item_id)) end,
    'fuente', c.fuente,
    'fuente_url', c.fuente_url,
    'verificado_en', c.verificado_en,
    'en_catalogo', c.item_id is not null,
    'en_mercado', i.item_id is not null,
    'proveedor', (select provider from m),
    'escaneo', (select escaneo from ult),
    'estado', case when not exists (select 1 from p) then 'sin_datos'
                   when (select hour from pm) >= (select hora from ult) then 'con_ofertas'
                   else 'sin_ofertas' end,
    'extremos_30d', (select _extremos_30d(m.id, p_item_id) from m),
    'metricas', metricas_mercado(p_market_key),
    'ultima_compra_minima', (select jsonb_build_object('hora', pm.hour, 'valor', pm.min_buyout) from pm),
    'mercado', (select jsonb_build_object('hora', p.hour, 'precio', p.min_buyout, 'mediana', p.median,
                                          'valor_mercado', p.market_value, 'reciente', p.recent,
                                          'historico', p.historical, 'cantidad', p.quantity,
                                          'ventas_dia', p.sales_per_day,
                                          'observado', p.observado, 'importado', p.importado) from p)) end
  from (select 1) uno
  left join m on true
  left join catalogo c on c.game_type = m.game_type and c.item_id = p_item_id and not m.is_demo
  left join items i on i.market_id = m.id and i.item_id = p_item_id
$$;

revoke execute on all functions in schema public from public, anon, authenticated;
