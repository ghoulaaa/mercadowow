-- =====================================================================
-- 0015 — Profesiones y recetas (R5).
--
-- * Recetas, reactivos y cantidades tal como los lista AHledger (/v1/crafting):
--   nada se inventa; una receta que AHledger no lista no existe aquí.
-- * Son datos del juego (por versión), no del mercado: el coste se calcula al leer,
--   con los precios del ÚLTIMO escaneo del mercado elegido.
-- * Si falta el precio de algún reactivo, el coste queda INCOMPLETO (null) y se
--   dice cuáles faltan; nunca se rellena con otra cosa.
-- =====================================================================

create function _profesiones() returns text[] language sql immutable as $$
  select array['Alchemy', 'Blacksmithing', 'Cooking', 'Enchanting', 'Engineering', 'First Aid',
               'Herbalism', 'Leatherworking', 'Mining', 'Skinning', 'Tailoring']
$$;

create table recipes (
  game_type         text not null,
  spell_id          integer not null check (spell_id > 0),
  nombre            text not null check (btrim(nombre) <> ''),
  profesion         text not null check (profesion = any (_profesiones())),
  nivel_requerido   integer check (nivel_requerido >= 0),
  obtencion         text,                         -- tal cual AHledger: trainer, unknown…
  resultado_id      integer not null check (resultado_id > 0),
  resultado_nombre  text not null,
  resultado_calidad text,
  cantidad_min      integer not null check (cantidad_min >= 1),
  cantidad_max      integer not null,
  fuente            text not null default 'ahledger',
  actualizado_en    timestamptz not null,
  primary key (game_type, spell_id),
  check (cantidad_max >= cantidad_min)
);
create index recipes_resultado on recipes (game_type, resultado_id);
create index recipes_profesion on recipes (game_type, profesion);

create table recipe_materials (
  game_type text not null,
  spell_id  integer not null,
  item_id   integer not null check (item_id > 0),
  nombre    text not null,
  cantidad  integer not null check (cantidad > 0),
  primary key (game_type, spell_id, item_id),
  foreign key (game_type, spell_id) references recipes on delete cascade
);
create index recipe_materials_objeto on recipe_materials (game_type, item_id);

-- Última descarga correcta de cada profesión.
create table recipe_sync (
  game_type       text not null,
  profesion       text not null check (profesion = any (_profesiones())),
  sincronizado_en timestamptz not null,
  recetas         integer not null check (recetas >= 0),
  fuente_url      text,
  primary key (game_type, profesion)
);

alter table recipes enable row level security;
alter table recipe_materials enable row level security;
alter table recipe_sync enable row level security;
revoke all on recipes, recipe_materials, recipe_sync from anon, authenticated;

insert into settings (key, value) values ('recetas_turno_hasta', '-infinity') on conflict (key) do nothing;

-- Sustituye TODAS las recetas de una profesión por la lista recibida (completa).
-- p_recetas: [{spell_id, nombre, nivel_requerido, obtencion, resultado_id, resultado_nombre,
--              resultado_calidad, cantidad_min, cantidad_max, reactivos: [{item_id, nombre, cantidad}]}]
create function guardar_recetas(p_game text, p_profesion text, p_recetas jsonb, p_fuente_url text default null,
                                p_now timestamptz default now())
returns integer language plpgsql as $$
declare v_n integer;
begin
  if not (p_profesion = any (_profesiones())) then
    raise exception 'Profesión desconocida: %', p_profesion;
  end if;
  if jsonb_typeof(p_recetas) <> 'array' or jsonb_array_length(p_recetas) = 0 then
    raise exception 'Lista de recetas vacía: no se borra nada';
  end if;
  if exists (select 1 from jsonb_array_elements(p_recetas) e
              where jsonb_typeof(e->'reactivos') <> 'array' or jsonb_array_length(e->'reactivos') = 0) then
    raise exception 'Hay recetas sin reactivos';
  end if;

  drop table if exists _r;
  create temp table _r on commit drop as
  select distinct on (r.spell_id) r.*
    from jsonb_to_recordset(p_recetas) as r(spell_id integer, nombre text, nivel_requerido integer, obtencion text,
                                            resultado_id integer, resultado_nombre text, resultado_calidad text,
                                            cantidad_min integer, cantidad_max integer, reactivos jsonb)
   order by r.spell_id;

  delete from recipes x
   where x.game_type = p_game and x.profesion = p_profesion
     and not exists (select 1 from _r where _r.spell_id = x.spell_id);

  insert into recipes (game_type, spell_id, nombre, profesion, nivel_requerido, obtencion, resultado_id,
                       resultado_nombre, resultado_calidad, cantidad_min, cantidad_max, fuente, actualizado_en)
  select p_game, spell_id, nombre, p_profesion, nivel_requerido, obtencion, resultado_id,
         resultado_nombre, resultado_calidad, cantidad_min, cantidad_max, 'ahledger', p_now
    from _r
  on conflict (game_type, spell_id) do update
     set nombre = excluded.nombre, profesion = excluded.profesion, nivel_requerido = excluded.nivel_requerido,
         obtencion = excluded.obtencion, resultado_id = excluded.resultado_id,
         resultado_nombre = excluded.resultado_nombre, resultado_calidad = excluded.resultado_calidad,
         cantidad_min = excluded.cantidad_min, cantidad_max = excluded.cantidad_max,
         fuente = excluded.fuente, actualizado_en = excluded.actualizado_en;

  delete from recipe_materials rm using _r where rm.game_type = p_game and rm.spell_id = _r.spell_id;
  -- Un reactivo repetido en la lista se suma (no se pierde cantidad).
  insert into recipe_materials (game_type, spell_id, item_id, nombre, cantidad)
  select p_game, _r.spell_id, (x->>'item_id')::integer, min(x->>'nombre'), sum((x->>'cantidad')::integer)
    from _r, jsonb_array_elements(_r.reactivos) x
   group by _r.spell_id, (x->>'item_id')::integer;

  select count(*) into v_n from _r;
  insert into recipe_sync (game_type, profesion, sincronizado_en, recetas, fuente_url)
  values (p_game, p_profesion, p_now, v_n, p_fuente_url)
  on conflict (game_type, profesion) do update
     set sincronizado_en = excluded.sincronizado_en, recetas = excluded.recetas, fuente_url = excluded.fuente_url;
  return v_n;
end $$;

-- Profesiones sin descargar o cuya última descarga tiene más de ~1 día.
create function recetas_pendientes(p_game text, p_now timestamptz default now()) returns text[]
language sql stable as $$
  select coalesce(array_agg(p order by p), '{}')
    from unnest(_profesiones()) p
   where not exists (select 1 from recipe_sync s
                      where s.game_type = p_game and s.profesion = p
                        and s.sincronizado_en > p_now - interval '23 hours')
$$;

create function tomar_turno_recetas(p_segundos integer default 300, p_now timestamptz default now())
returns boolean language sql as $$
  with t as (
    update settings set value = (p_now + make_interval(secs => p_segundos))::text
     where key = 'recetas_turno_hasta' and value::timestamptz <= p_now
    returning 1)
  select exists (select 1 from t)
$$;

create function soltar_turno_recetas() returns void language sql as $$
  update settings set value = '-infinity' where key = 'recetas_turno_hasta'
$$;

-- Recetas con su coste calculado con los precios del último escaneo del mercado.
-- p_base: 'mediana' (mediana del escaneo, como AHledger) o 'minimo' (compra inmediata mínima).
create function _recetas_json(p_market_key text, p_profesion text, p_spells integer[], p_base text)
returns jsonb language sql stable as $$
  with m as (select id, game_type from markets where key = p_market_key),
  h as (select date_trunc('hour', max(s.source_updated_at), 'UTC') as hora
          from snapshots s join m on s.market_id = m.id),
  r as (select x.* from recipes x join m on x.game_type = m.game_type
         where (p_profesion is null or x.profesion = p_profesion)
           and (p_spells is null or x.spell_id = any (p_spells))),
  ids as (select resultado_id as item_id from r
          union
          select rm.item_id from recipe_materials rm join r on r.game_type = rm.game_type and r.spell_id = rm.spell_id),
  pr as (select p.item_id,
                case when p_base = 'minimo' then p.min_buyout else coalesce(p.median, p.market_value) end as precio,
                p.sales_per_day, p.quantity
           from m cross join h
           join price_hourly p on p.market_id = m.id and p.hour = h.hora
           join ids on ids.item_id = p.item_id),
  mat as (
    select rm.spell_id,
           jsonb_agg(jsonb_build_object(
             'id', rm.item_id, 'nombre', coalesce(i.name, rm.nombre), 'icono', i.icon_url, 'calidad', i.quality,
             'cantidad', rm.cantidad, 'precio', pr.precio, 'coste', rm.cantidad * pr.precio)
             order by rm.cantidad * pr.precio desc nulls first, rm.item_id) as lista,
           sum(rm.cantidad * pr.precio) as parcial,
           coalesce(array_agg(coalesce(i.name, rm.nombre) order by rm.item_id) filter (where pr.precio is null),
                    '{}') as faltan
      from r
      join recipe_materials rm on rm.game_type = r.game_type and rm.spell_id = r.spell_id
      cross join m
      left join items i on i.market_id = m.id and i.item_id = rm.item_id
      left join pr on pr.item_id = rm.item_id
     group by rm.spell_id),
  c as (
    select r.*, mat.lista, mat.faltan, mat.parcial,
           case when cardinality(mat.faltan) = 0 then mat.parcial end as coste,
           res.precio as precio_res, res.sales_per_day, res.quantity,
           (r.cantidad_min + r.cantidad_max) / 2.0 as rendimiento,
           round(res.precio * (r.cantidad_min + r.cantidad_max) / 2.0) as bruto,
           ajuste_num('motor.comision_pct', 5) as pct
      from r
      join mat on mat.spell_id = r.spell_id
      left join pr res on res.item_id = r.resultado_id),
  f as (select c.*, c.bruto - floor(c.bruto * c.pct / 100) as neto from c)
  select coalesce(jsonb_agg(jsonb_build_object(
           'spell', f.spell_id, 'nombre', f.nombre, 'profesion', f.profesion,
           'nivel', f.nivel_requerido, 'obtencion', f.obtencion,
           'resultado', jsonb_build_object(
              'id', f.resultado_id, 'nombre', coalesce(i.name, f.resultado_nombre),
              'calidad', coalesce(i.quality, f.resultado_calidad), 'icono', i.icon_url,
              'cantidad_min', f.cantidad_min, 'cantidad_max', f.cantidad_max, 'rendimiento', f.rendimiento,
              'precio', f.precio_res, 'ventas_dia', f.sales_per_day, 'publicadas', f.quantity),
           'reactivos', f.lista,
           'completa', f.coste is not null,
           'faltan', to_jsonb(f.faltan),
           'coste', f.coste,
           'coste_parcial', f.parcial,
           'bruto', f.bruto,
           'comision', f.bruto - f.neto,
           'neto', f.neto,
           'margen', f.neto - f.coste,
           'margen_pct', case when f.coste > 0 then round((f.neto - f.coste) / f.coste, 4) end,
           'ganancia_dia', case when f.sales_per_day is not null
                                then round((f.neto - f.coste) / f.rendimiento * f.sales_per_day) end,
           'dias_para_vender', case when f.sales_per_day > 0 then round(f.quantity / f.sales_per_day, 1) end
         ) order by f.nombre, f.spell_id), '[]'::jsonb)
    from f
    cross join m
    left join items i on i.market_id = m.id and i.item_id = f.resultado_id
$$;

create function _base_precio(p_base text) returns text language plpgsql immutable as $$
begin
  if coalesce(p_base, 'mediana') not in ('mediana', 'minimo') then
    raise exception 'Base de precio no válida: % (mediana o minimo)', p_base;
  end if;
  return coalesce(p_base, 'mediana');
end $$;

-- Cabecera común: hora de los precios usados, comisión aplicada y atribución.
create function _recetas_cabecera(p_market_key text, p_base text) returns jsonb language sql stable as $$
  select jsonb_build_object(
    'mercado', m.key, 'base', p_base,
    'hora_precios', (select max(s.source_updated_at) from snapshots s where s.market_id = m.id),
    'comision_pct', ajuste_num('motor.comision_pct', 5),
    'atribucion', jsonb_build_object('texto', 'Prices from AHledger', 'url', 'https://ahledger.com/crafting'))
    from markets m where m.key = p_market_key
$$;

create function profesiones_recetas(p_market_key text) returns jsonb language sql stable as $$
  with m as (select game_type from markets where key = p_market_key)
  select coalesce(jsonb_agg(jsonb_build_object(
           'profesion', p,
           'recetas', (select count(*) from recipes r where r.game_type = m.game_type and r.profesion = p),
           'sincronizado_en', s.sincronizado_en) order by p), '[]'::jsonb)
    from m cross join unnest(_profesiones()) p
    left join recipe_sync s on s.game_type = m.game_type and s.profesion = p
$$;

create function recetas_profesion(p_market_key text, p_profesion text, p_base text default 'mediana')
returns jsonb language plpgsql stable as $$
declare v_base text := _base_precio(p_base); v_cab jsonb := _recetas_cabecera(p_market_key, v_base);
begin
  if v_cab is null then raise exception 'Mercado % no registrado', p_market_key; end if;
  if not (p_profesion = any (_profesiones())) then raise exception 'Profesión desconocida: %', p_profesion; end if;
  return v_cab || jsonb_build_object(
    'profesion', p_profesion,
    'sincronizado_en', (select s.sincronizado_en from recipe_sync s join markets m on m.game_type = s.game_type
                         where m.key = p_market_key and s.profesion = p_profesion),
    'recetas', _recetas_json(p_market_key, p_profesion, null, v_base));
end $$;

-- Para la ficha y el comparador: recetas que FABRICAN el objeto y recetas que lo USAN.
create function recetas_objeto(p_market_key text, p_item_id integer, p_base text default 'mediana')
returns jsonb language plpgsql stable as $$
declare
  v_base text := _base_precio(p_base);
  v_cab  jsonb := _recetas_cabecera(p_market_key, v_base);
  v_game text := (select game_type from markets where key = p_market_key);
begin
  if v_cab is null then raise exception 'Mercado % no registrado', p_market_key; end if;
  return v_cab || jsonb_build_object(
    'id', p_item_id,
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

revoke execute on all functions in schema public from public, anon, authenticated;
