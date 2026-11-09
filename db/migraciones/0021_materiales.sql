-- =====================================================================
-- 0021 — W2 del plan V4: materiales de profesiones y relaciones objeto–profesión.
--
-- Todo sale de datos verificados, nunca de coincidencias de nombre:
--   * material de una profesión  = aparece como reactivo en sus recetas (AHledger /v1/crafting);
--   * producto de una profesión  = es el resultado de una de sus recetas;
--   * receta de una profesión    = objeto de la clase «Recipe» cuya subclase oficial es esa
--     profesión (clasificación de Blizzard). Así aparece Pesca, que no tiene recetas en AHledger.
--   * familia de un material     = su clase/subclase oficial (p. ej. Trade Goods › Herb → hierbas).
-- Un objeto puede tener varios roles y varias profesiones sin duplicarse en el catálogo.
-- Herramientas (martillo, cuchillo de desollar…): no vienen en los datos de recetas → no se infieren.
-- =====================================================================

-- Profesiones con recetas en AHledger + Pesca (solo por sus objetos de receta).
create function _profesiones_todas() returns text[] language sql immutable as $$
  select _profesiones() || array['Fishing']
$$;

-- Familias de materiales, en el orden en que se muestran.
create function _familias() returns text[] language sql immutable as $$
  select array['hierbas', 'metales', 'telas', 'cueros', 'encantamiento', 'elementales', 'cocina', 'piezas',
               'consumibles', 'reactivos', 'comercio_otros', 'mision', 'otros']
$$;

create function _familia(p_clase text, p_subclase text) returns text language sql immutable as $$
  select case
    when p_clase = 'Trade Goods' then case p_subclase
      when 'Herb' then 'hierbas' when 'Metal & Stone' then 'metales' when 'Cloth' then 'telas'
      when 'Leather' then 'cueros' when 'Enchanting' then 'encantamiento' when 'Elemental' then 'elementales'
      when 'Cooking' then 'cocina' when 'Parts' then 'piezas' when 'Explosives' then 'piezas' when 'Devices' then 'piezas'
      else 'comercio_otros' end
    when p_clase = 'Consumable' then 'consumibles'
    when p_clase = 'Miscellaneous' and p_subclase = 'Reagent' then 'reactivos'
    when p_clase = 'Reagent' then 'reactivos'
    when p_clase = 'Quest' then 'mision'
    else 'otros' end
$$;

-- Relaciones (objeto, profesión, rol) de una versión del juego.
create function _relaciones_profesion(p_game text) returns table (item_id integer, profesion text, rol text)
language sql stable as $$
  select rm.item_id, r.profesion, 'material'
    from recipe_materials rm join recipes r using (game_type, spell_id) where rm.game_type = p_game
  union
  select r.resultado_id, r.profesion, 'producto' from recipes r where r.game_type = p_game
  union
  select c.item_id, c.subclase, 'receta' from catalogo c
   where c.game_type = p_game and c.clase = 'Recipe' and c.subclase = any (_profesiones_todas())
$$;

-- Icono de cada profesión: el de su material más usado que tenga icono (un objeto real del catálogo;
-- no hay iconos oficiales de profesiones sin la API de Blizzard).
create function _icono_profesion(p_game text) returns table (profesion text, icono text, item_id integer)
language sql stable as $$
  select distinct on (profesion) profesion, icono, item_id from (
    select r.profesion, c.icono_url as icono, c.item_id, count(*) as usos
      from recipe_materials rm join recipes r using (game_type, spell_id)
      join catalogo c on c.game_type = rm.game_type and c.item_id = rm.item_id
     where rm.game_type = p_game and c.icono_url is not null
     group by r.profesion, c.icono_url, c.item_id
    union all
    select c.subclase, c.icono_url, c.item_id, 0 from catalogo c
     where c.game_type = p_game and c.clase = 'Recipe' and c.subclase = 'Fishing' and c.icono_url is not null) x
   order by profesion, usos desc, item_id
$$;

-- Resumen de relaciones de un objeto (para el detalle).
create function relaciones_objeto(p_game text, p_item_id integer) returns jsonb language sql stable as $$
  with c as (select clase, subclase from catalogo where game_type = p_game and item_id = p_item_id),
  usos as (select r.profesion, count(distinct r.spell_id) as recetas, min(r.nivel_requerido) as nivel_min,
                  sum(rm.cantidad) as cantidad_total
             from recipe_materials rm join recipes r using (game_type, spell_id)
            where rm.game_type = p_game and rm.item_id = p_item_id group by r.profesion),
  prod as (select r.profesion, count(*) as recetas, min(r.nivel_requerido) as nivel_min
             from recipes r where r.game_type = p_game and r.resultado_id = p_item_id group by r.profesion)
  select jsonb_build_object(
    'familia', (select _familia(clase, subclase) from c),
    'es_material', exists (select 1 from usos),
    'es_producto', exists (select 1 from prod),
    'receta_de', (select subclase from c where clase = 'Recipe' and subclase = any (_profesiones_todas())),
    'consumen', coalesce((select jsonb_agg(jsonb_build_object('profesion', profesion, 'recetas', recetas,
                            'nivel_min', nivel_min) order by recetas desc, profesion) from usos), '[]'::jsonb),
    'producen', coalesce((select jsonb_agg(jsonb_build_object('profesion', profesion, 'recetas', recetas,
                            'nivel_min', nivel_min) order by profesion) from prod), '[]'::jsonb))
$$;

-- recetas_objeto (0015) + relaciones.
create or replace function recetas_objeto(p_market_key text, p_item_id integer, p_base text default 'mediana')
returns jsonb language plpgsql stable as $$
declare
  v_base text := _base_precio(p_base);
  v_cab  jsonb := _recetas_cabecera(p_market_key, v_base);
  v_game text := (select game_type from markets where key = p_market_key);
begin
  if v_cab is null then raise exception 'Mercado % no registrado', p_market_key; end if;
  return v_cab || jsonb_build_object(
    'id', p_item_id,
    'relaciones', relaciones_objeto(v_game, p_item_id),
    'fabricacion', _recetas_json(p_market_key, null,
                     (select coalesce(array_agg(spell_id), '{}') from recipes
                       where game_type = v_game and resultado_id = p_item_id), v_base),
    'usos', (select coalesce(jsonb_agg(jsonb_build_object(
                      'spell', r.spell_id, 'nombre', r.nombre, 'profesion', r.profesion, 'nivel', r.nivel_requerido,
                      'cantidad', rm.cantidad, 'resultado_id', r.resultado_id, 'resultado_nombre', r.resultado_nombre)
                    order by r.profesion, r.nivel_requerido nulls last, r.nombre), '[]'::jsonb)
               from recipe_materials rm join recipes r using (game_type, spell_id)
              where rm.game_type = v_game and rm.item_id = p_item_id));
end $$;

-- ---------- Tabla del Mercado: filtros de profesión por rol, materiales y familia ----------
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
  if v_prof is not null and not (v_prof = any (_profesiones_todas())) then
    raise exception 'Profesión desconocida: %', v_prof;
  end if;
  if v_rol is not null and v_rol not in ('material', 'receta', 'producto') then
    raise exception 'Rol no válido: % (material, receta o producto)', v_rol;
  end if;
  if v_rol is not null and v_prof is null then raise exception 'El rol necesita una profesión'; end if;
  if v_fam is not null and not (v_fam = any (_familias())) then raise exception 'Familia desconocida: %', v_fam; end if;
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
    -- Un objeto que la fuente publica sin nombre se muestra por su ID (no se inventa un nombre).
    select i.item_id, coalesce(nullif(btrim(i.name), ''), '#' || i.item_id), i.quality, i.category, i.item_subclass,
           i.level, i.icon_url, _normalizar(coalesce(nullif(btrim(i.name), ''), i.item_id::text))
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
  -- f0: filtros generales (texto, calidad, nivel, precio, disponibilidad).
  f0 as (
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
  ),
  marcas as (
    select f0.*,
           (v_cat is null or f0.categoria = v_cat) and (v_sub is null or f0.subclase = v_sub) as en_cat,
           (v_prof is null or exists (select 1 from rel where rel.item_id = f0.item_id and rel.profesion = v_prof
                                                     and (v_rol is null or rel.rol = v_rol)))
             and (not v_mat or f0.es_material)
             and (v_fam is null or (f0.es_material and f0.familia = v_fam)) as en_prof
      from f0
  ),
  sin_cat as (select * from marcas where en_prof),    -- para contar por categoría
  sin_prof as (select * from marcas where en_cat),    -- para contar por profesión y familia
  filtrado as (select * from marcas where en_cat and en_prof),
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
    'materiales_total', (select count(*) from sin_prof where es_material),
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
