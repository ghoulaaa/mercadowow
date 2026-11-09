-- =====================================================================
-- 0017 — Tabla del Mercado paginada sobre TODO el catálogo (V2 del plan V3).
--
-- * Recorre el catálogo de la versión (y los objetos del mercado que aún no están en él),
--   tengan o no ofertas. El demo solo usa sus propios objetos ficticios.
-- * Estado de cada objeto, solo con pruebas:
--     con_ofertas  → aparece en el último escaneo del mercado;
--     sin_ofertas  → se vio antes en este mercado, pero no en el último escaneo;
--     sin_datos    → nunca se ha visto en este mercado.
--   («No subastable» necesitaría la vinculación del objeto: ninguna fuente actual la da.)
-- * Un precio desconocido es null, nunca 0.
-- * Filtra, ordena y pagina en la base de datos: la página recibe 100 filas, no 5.000.
-- =====================================================================

-- Entero opcional de un parámetro JSON; texto no numérico → error claro (no un fallo de conversión).
create function _param_entero(p jsonb, k text) returns bigint language plpgsql immutable as $$
declare v text := nullif(btrim(p->>k), '');
begin
  if v is null then return null; end if;
  if v !~ '^-?\d{1,15}$' then raise exception '«%» no es un número entero: %', k, v; end if;
  return v::bigint;
end $$;

create function mercado_pagina(p_market_key text, p jsonb default '{}'::jsonb) returns jsonb
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
           p.hour as visto,
           case when p.hour is null then 'sin_datos'
                when p.hour >= u.hora then 'con_ofertas' else 'sin_ofertas' end as estado,
           case when p.hour >= u.hora then coalesce(p.min_buyout, p.market_value) end as precio,
           case when p.hour >= u.hora then p.quantity end as cantidad,
           p.min_buyout as ultimo_precio,
           p24.precio as precio_24h, p24.hour as hora_24h
      from base b
      cross join ult u
      left join lateral (select x.hour, x.min_buyout, x.market_value, x.quantity from price_hourly x
                          where x.market_id = v_m.id and x.item_id = b.item_id
                          order by x.hour desc limit 1) p on true
      left join lateral (select x.hour, coalesce(x.min_buyout, x.market_value) as precio from price_hourly x
                          where x.market_id = v_m.id and x.item_id = b.item_id
                            and x.hour <= p.hour - interval '24 hours' and x.hour >= p.hour - interval '30 hours'
                          order by x.hour desc limit 1) p24 on p.hour >= u.hora
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
        'estado', pg.estado, 'precio', pg.precio, 'cantidad', pg.cantidad, 'var24', pg.var24,
        'precio_24h', pg.precio_24h, 'hora_24h', pg.hora_24h,
        'visto', pg.visto, 'ultimo_precio', case when pg.estado = 'sin_ofertas' then pg.ultimo_precio end,
        -- Minigráfico: compra mínima más baja de cada tramo de 6 h en los últimos 7 días (solo tramos observados).
        'spark', (select coalesce(jsonb_agg(jsonb_build_array((extract(epoch from t.tramo) * 1000)::bigint, t.v) order by t.tramo), '[]'::jsonb)
                    from (select date_bin('6 hours', x.hour, timestamptz '2000-01-01 00:00+00') as tramo,
                                 min(coalesce(x.min_buyout, x.market_value)) as v
                            from price_hourly x
                           where x.market_id = v_m.id and x.item_id = pg.item_id
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

-- Ficha: además del último precio, dice si está en el último escaneo (estado) y la hora de ese escaneo.
create or replace function ficha_objeto(p_market_key text, p_item_id integer) returns jsonb
language sql stable as $$
  with m as (select id, game_type, is_demo from markets where key = p_market_key),
  ult as (select date_trunc('hour', max(s.source_updated_at), 'UTC') as hora, max(s.source_updated_at) as escaneo
            from snapshots s, m where s.market_id = m.id)
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
    'escaneo', (select escaneo from ult),
    'estado', case when not exists (select 1 from price_hourly p, m where p.market_id = m.id and p.item_id = p_item_id)
                   then 'sin_datos'
                   when exists (select 1 from price_hourly p, m, ult where p.market_id = m.id and p.item_id = p_item_id
                                                                     and p.hour >= ult.hora)
                   then 'con_ofertas' else 'sin_ofertas' end,
    'mercado', (select jsonb_build_object('hora', p.hour, 'precio', p.min_buyout, 'mediana', p.median,
                                          'valor_mercado', p.market_value, 'cantidad', p.quantity,
                                          'ventas_dia', p.sales_per_day, 'historico', p.historical)
                  from price_hourly p, m
                 where p.market_id = m.id and p.item_id = p_item_id
                 order by p.hour desc limit 1)) end
  from (select 1) uno
  left join m on true
  left join catalogo c on c.game_type = m.game_type and c.item_id = p_item_id and not m.is_demo
  left join items i on i.market_id = m.id and i.item_id = p_item_id
$$;

revoke execute on all functions in schema public from public, anon, authenticated;
