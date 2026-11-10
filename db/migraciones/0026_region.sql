-- 0026 · X3 (plan V5): referencia regional de TSM.
--
-- TSM publica, además del archivo de cada reino, uno de TODA la región (US) con la venta media,
-- la tasa de venta y las ventas por día. Son datos de todos los reinos juntos: NO son de PvP Horda.
-- Por eso van en una tabla aparte, nunca se mezclan con price_hourly y no entran en el motor de
-- recomendaciones. Solo se muestran en el detalle y sirven para un filtro opcional.

create table region_items (
  game_type      text    not null,
  region         text    not null,
  item_id        integer not null check (item_id > 0),
  market_value   bigint  check (market_value > 0),
  historical     bigint  check (historical > 0),
  avg_sale_price bigint  check (avg_sale_price > 0),   -- null = la fuente no lo da (escribe 0)
  sale_rate      numeric check (sale_rate >= 0),       -- fracción: 0,25 = 25 %
  sold_per_day   numeric check (sold_per_day >= 0),
  primary key (game_type, region, item_id)
);

-- Última importación correcta de cada región.
create table region_sync (
  game_type         text not null,
  region            text not null,
  source_updated_at timestamptz not null,   -- fecha que da el propio archivo
  imported_at       timestamptz not null,
  filas             integer not null check (filas > 0),
  fuente_url        text,
  primary key (game_type, region)
);

alter table region_items enable row level security;
alter table region_sync enable row level security;
revoke all on region_items, region_sync from anon, authenticated;

insert into settings (key, value) values ('region_turno_hasta', '-infinity') on conflict (key) do nothing;

-- Sustituye TODO el archivo regional por el recibido (completo).
-- p_filas: [{item_id, market_value, historical, avg_sale_price, sale_rate, sold_per_day}]
create function guardar_region(p_game text, p_region text, p_filas jsonb, p_actualizado timestamptz,
                               p_fuente_url text default null, p_now timestamptz default now())
returns integer language plpgsql as $$
declare v_n integer;
begin
  if jsonb_typeof(p_filas) <> 'array' or jsonb_array_length(p_filas) = 0 then
    raise exception 'Archivo regional vacío: no se borra nada';
  end if;
  if p_actualizado is null then raise exception 'Falta la fecha del archivo regional'; end if;
  delete from region_items where game_type = p_game and region = p_region;
  insert into region_items (game_type, region, item_id, market_value, historical, avg_sale_price, sale_rate, sold_per_day)
  select distinct on (r.item_id) p_game, p_region, r.item_id, nullif(r.market_value, 0), nullif(r.historical, 0),
         nullif(r.avg_sale_price, 0), r.sale_rate, r.sold_per_day
    from jsonb_to_recordset(p_filas) as r(item_id integer, market_value bigint, historical bigint,
                                          avg_sale_price bigint, sale_rate numeric, sold_per_day numeric)
   order by r.item_id;
  get diagnostics v_n = row_count;
  insert into region_sync (game_type, region, source_updated_at, imported_at, filas, fuente_url)
  values (p_game, p_region, p_actualizado, p_now, v_n, p_fuente_url)
  on conflict (game_type, region) do update
     set source_updated_at = excluded.source_updated_at, imported_at = excluded.imported_at,
         filas = excluded.filas, fuente_url = excluded.fuente_url;
  return v_n;
end $$;

-- ¿Toca importar? Nunca se ha hecho o la última importación tiene más de ~1 día.
create function region_pendiente(p_game text, p_region text, p_now timestamptz default now()) returns boolean
language sql stable as $$
  select not exists (select 1 from region_sync s
                      where s.game_type = p_game and s.region = p_region
                        and s.imported_at > p_now - interval '23 hours')
$$;

create function tomar_turno_region(p_segundos integer default 300, p_now timestamptz default now())
returns boolean language sql as $$
  with t as (
    update settings set value = (p_now + make_interval(secs => p_segundos))::text
     where key = 'region_turno_hasta' and value::timestamptz <= p_now
    returning 1)
  select exists (select 1 from t)
$$;

create function soltar_turno_region() returns void language sql as $$
  update settings set value = '-infinity' where key = 'region_turno_hasta'
$$;

-- Estado de la referencia regional de un mercado (null si no hay ninguna importada o es de demostración).
create function _region_estado(p_market_key text) returns jsonb language sql stable as $$
  select jsonb_build_object('region', upper(m.region), 'actualizado', s.source_updated_at,
                            'importado', s.imported_at, 'objetos', s.filas)
    from markets m join region_sync s on s.game_type = m.game_type and s.region = m.region
   where m.key = p_market_key and not m.is_demo
$$;

-- Datos regionales de un objeto (null si el archivo regional no lo trae).
create function _region_objeto(p_market_key text, p_item_id integer) returns jsonb language sql stable as $$
  select _region_estado(p_market_key) || jsonb_build_object(
           'venta_media', r.avg_sale_price, 'valor_mercado', r.market_value, 'historico', r.historical,
           'tasa_venta', r.sale_rate, 'ventas_dia', r.sold_per_day)
    from markets m join region_items r on r.game_type = m.game_type and r.region = m.region
   where m.key = p_market_key and not m.is_demo and r.item_id = p_item_id
$$;

-- La ficha del objeto gana el bloque «region». La ficha anterior queda como base, sin tocar.
alter function ficha_objeto(text, integer) rename to _ficha_objeto_base;
create function ficha_objeto(p_market_key text, p_item_id integer) returns jsonb language sql stable as $$
  select b.f || jsonb_build_object('region', _region_objeto(p_market_key, p_item_id),
                                   'region_estado', _region_estado(p_market_key))
    from (select _ficha_objeto_base(p_market_key, p_item_id) as f) b
   where b.f is not null
$$;

-- ---------- Tabla del Mercado: filtro opcional «se vende en la región» (ventas al día ≥ X) ----------
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
  v_rol      text := nullif(p->>'rol', '');
  v_mat      boolean := coalesce((p->>'materiales')::boolean, false);
  v_fam      text := nullif(p->>'familia', '');
  v_nmin     bigint := _param_entero(p, 'nivel_min');
  v_nmax     bigint := _param_entero(p, 'nivel_max');
  v_pmin     bigint := _param_entero(p, 'precio_min');
  v_pmax     bigint := _param_entero(p, 'precio_max');
  v_ofertas  boolean := coalesce((p->>'solo_ofertas')::boolean, false);
  v_op       text := nullif(p->>'oportunidad', '');
  v_com      numeric := ajuste_num('motor.comision_pct', 5);
  v_vreg_t   text := nullif(btrim(coalesce(p->>'ventas_region_min', '')), '');
  v_vreg     numeric;
  v_res      jsonb;
begin
  select * into v_m from markets where key = p_market_key;
  if not found then raise exception 'Mercado % no registrado', p_market_key; end if;
  if v_orden not in ('nombre', 'precio', 'cantidad', 'var24', 'margen', 'margen_pct') then
    raise exception 'Orden no válido: % (nombre, precio, cantidad, var24, margen o margen_pct)', v_orden;
  end if;
  v_dir := coalesce(nullif(p->>'dir', ''), case when v_orden in ('nombre', 'precio') then 'asc' else 'desc' end);
  if v_dir not in ('asc', 'desc') then raise exception 'Dirección no válida: % (asc o desc)', v_dir; end if;
  if v_tam not between 1 and 200 then raise exception 'por_pagina debe estar entre 1 y 200'; end if;
  if v_pag < 1 then raise exception 'pagina debe ser 1 o más'; end if;
  if v_prof is not null and not (v_prof = any (_profesiones_todas())) then
    raise exception 'Profesión desconocida: %', v_prof;
  end if;
  if v_rol is not null and v_rol not in ('material', 'receta', 'producto') then
    raise exception 'Rol no válido: % (material, receta o producto)', v_rol;
  end if;
  if v_rol is not null and v_prof is null then raise exception 'El rol necesita una profesión'; end if;
  if v_fam is not null and not (v_fam = any (_familias())) then raise exception 'Familia desconocida: %', v_fam; end if;
  if v_op is not null and v_op not in ('ganga', 'npc', 'todas') then
    raise exception 'Oportunidad no válida: % (ganga, npc o todas)', v_op;
  end if;
  if v_vreg_t is not null then
    if v_vreg_t !~ '^\d{1,6}(\.\d{1,3})?$' then
      raise exception 'ventas_region_min no válido: % (número de ventas al día, p. ej. 5)', v_vreg_t;
    end if;
    v_vreg := v_vreg_t::numeric;
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
    select c.item_id, c.nombre, c.calidad, c.clase, c.subclase, c.nivel, c.icono_url, c.busqueda, c.venta_npc
      from catalogo c
     where c.game_type = v_m.game_type and not v_m.is_demo
    union all
    -- Un objeto que la fuente publica sin nombre se muestra por su ID (no se inventa un nombre).
    select i.item_id, coalesce(nullif(btrim(i.name), ''), '#' || i.item_id), i.quality, i.category, i.item_subclass,
           i.level, i.icon_url, _normalizar(coalesce(nullif(btrim(i.name), ''), i.item_id::text)), i.vendor_price
      from items i
     where i.market_id = v_m.id
       and (v_m.is_demo or not exists (select 1 from catalogo c where c.game_type = v_m.game_type and c.item_id = i.item_id))
  ),
  rel as (select * from _relaciones_profesion(v_m.game_type)),
  con_precio as (
    select b.*, coalesce(b.clase, 'Sin clasificar') as categoria, _familia(b.clase, b.subclase) as familia,
           exists (select 1 from rel where rel.item_id = b.item_id and rel.rol = 'material') as es_material,
           pm.hour as visto,
           case when p.hour is null then 'sin_datos'
                when pm.hour >= u.hora then 'con_ofertas' else 'sin_ofertas' end as estado,
           case when pm.hour >= u.hora then pm.min_buyout end as precio,
           case when p.hour >= u.hora then p.market_value end as valor_mercado,
           case when p.hour >= u.hora then p.historical end as historico,
           case when pm.hour >= u.hora then p.quantity end as cantidad,
           pm.min_buyout as ultimo_precio,
           -- Referencia de TODA la región (no de este reino): solo para mostrar y para el filtro opcional.
           rg.sold_per_day as ventas_region,
           p24.precio as precio_24h, p24.hour as hora_24h
      from base b
      cross join ult u
      left join region_items rg on rg.game_type = v_m.game_type and rg.region = v_m.region
                               and rg.item_id = b.item_id and not v_m.is_demo
      left join lateral (select x.hour, x.min_buyout, x.market_value, x.quantity, x.historical from price_hourly x
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
  -- f0: filtros generales (texto, calidad, nivel, precio, disponibilidad).
  f0 as (
    select cp.*,
           case when cp.precio_24h > 0 and cp.precio is not null
                then round((cp.precio - cp.precio_24h) * 100.0 / cp.precio_24h, 1) end as var24,
           o.bajo_npc, o.ganga, o.margen, o.margen_tipo,
           case when cp.precio > 0 then round(o.margen * 100.0 / cp.precio, 1) end as margen_pct
      from con_precio cp
      cross join lateral (
        select m.bajo_npc, m.ganga,
               case when m.bajo_npc and (m.m_mercado is null or m.m_npc >= m.m_mercado) then m.m_npc else m.m_mercado end as margen,
               case when m.bajo_npc and (m.m_mercado is null or m.m_npc >= m.m_mercado) then 'npc'
                    when m.m_mercado is not null then 'mercado' end as margen_tipo
          from (select coalesce(cp.precio < cp.venta_npc, false) as bajo_npc,
                       _es_ganga(cp.precio, cp.valor_mercado, cp.historico, v_com) as ganga,
                       cp.venta_npc - cp.precio as m_npc,
                       _neto_venta(cp.valor_mercado, v_com) - cp.precio as m_mercado) m
      ) o
     where (v_id is null or cp.item_id = v_id or cp.busqueda like '%' || v_id::text || '%')
       and (v_id is not null or cardinality(v_palabras) = 0
            or (select bool_and(cp.busqueda like '%' || w || '%') from unnest(v_palabras) w))
       and (v_cal is null or cp.calidad = v_cal)
       and (v_nmin is null or cp.nivel >= v_nmin)
       and (v_nmax is null or cp.nivel <= v_nmax)
       and (v_pmin is null or cp.precio >= v_pmin)
       and (v_pmax is null or cp.precio <= v_pmax)
       and (not v_ofertas or cp.estado = 'con_ofertas')
       and (v_vreg is null or cp.ventas_region >= v_vreg)
  ),
  marcas as (
    select f0.*,
           (v_cat is null or f0.categoria = v_cat) and (v_sub is null or f0.subclase = v_sub) as en_cat,
           (v_op is null or (v_op = 'ganga' and f0.ganga) or (v_op = 'npc' and f0.bajo_npc)
              or (v_op = 'todas' and (f0.ganga or f0.bajo_npc))) as en_op,
           (v_prof is null or exists (select 1 from rel where rel.item_id = f0.item_id and rel.profesion = v_prof
                                                     and (v_rol is null or rel.rol = v_rol)))
             and (not v_mat or f0.es_material)
             and (v_fam is null or (f0.es_material and f0.familia = v_fam)) as en_prof
      from f0
  ),
  sin_cat as (select * from marcas where en_prof and en_op),    -- para contar por categoría
  sin_prof as (select * from marcas where en_cat and en_op),    -- para contar por profesión y familia
  sin_op as (select * from marcas where en_cat and en_prof),    -- para contar las oportunidades
  filtrado as (select * from marcas where en_cat and en_prof and en_op),
  pagina as (
    select f.*, count(*) over () as total
      from filtrado f
     order by
       case when v_dir = 'asc' then case v_orden when 'precio' then f.precio::numeric when 'cantidad' then f.cantidad::numeric
                                                  when 'var24' then f.var24
                                                  when 'margen' then f.margen::numeric when 'margen_pct' then f.margen_pct end end asc nulls last,
       case when v_dir = 'desc' then case v_orden when 'precio' then f.precio::numeric when 'cantidad' then f.cantidad::numeric
                                                   when 'var24' then f.var24
                                                   when 'margen' then f.margen::numeric when 'margen_pct' then f.margen_pct end end desc nulls last,
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
        'venta_npc', pg.venta_npc, 'historico', pg.historico,
        'ganga', pg.ganga, 'bajo_npc', pg.bajo_npc,
        'margen', pg.margen, 'margen_pct', pg.margen_pct, 'margen_tipo', pg.margen_tipo,
        'ventas_region', pg.ventas_region,
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
    'materiales_total', (select count(*) from sin_prof where es_material),
    'region', _region_estado(p_market_key),
    -- Oportunidades con los demás filtros aplicados, y las reglas con que se calculan.
    'oportunidades', (select jsonb_build_object('ganga', count(*) filter (where ganga),
                                                'npc', count(*) filter (where bajo_npc),
                                                'todas', count(*) filter (where ganga or bajo_npc)) from sin_op),
    'reglas_oportunidad', jsonb_build_object('comision_pct', v_com, 'historico_min_pct', _ganga_historico_min_pct(),
                                             'tramos', _ganga_tramos()),
    'familias', coalesce((select jsonb_agg(jsonb_build_object('familia', familia, 'n', n) order by array_position(_familias(), familia))
                            from (select familia, count(*) as n from sin_prof where es_material group by familia) x), '[]'::jsonb),
    -- Nombres de las profesiones (como antes de 0021, para páginas aún no actualizadas).
    'profesiones', coalesce((select jsonb_agg(distinct rel.profesion) from rel), '[]'::jsonb),
    -- Profesiones con sus contadores por rol (respetan la categoría y los filtros generales).
    'profesiones_roles', coalesce((select jsonb_agg(jsonb_build_object(
        'profesion', t.profesion, 'n', t.n, 'material', t.material, 'receta', t.receta, 'producto', t.producto,
        'icono', (select ic.icono from _icono_profesion(v_m.game_type) ic where ic.profesion = t.profesion))
        order by t.profesion)
      from (select rel.profesion, count(distinct sp.item_id) as n,
                   count(distinct sp.item_id) filter (where rel.rol = 'material') as material,
                   count(distinct sp.item_id) filter (where rel.rol = 'receta') as receta,
                   count(distinct sp.item_id) filter (where rel.rol = 'producto') as producto
              from rel join sin_prof sp on sp.item_id = rel.item_id
             group by rel.profesion) t), '[]'::jsonb)
  ) into v_res;
  return v_res;
end $$;


revoke execute on all functions in schema public from public, anon, authenticated;
