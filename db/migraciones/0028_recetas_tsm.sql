-- 0028 · X4 (plan V5): recetas al estilo TSM.
--
-- Nueva base de precio 'tsm' para las recetas (las bases 'mediana' y 'minimo' siguen igual):
--   · Coste de cada material = el más barato entre
--       - comprarlo en subasta: compra mínima del último escaneo y, si no hay, su valor de mercado;
--       - fabricarlo: Σ cantidad × coste de sus materiales ÷ rendimiento medio de la receta
--         (se calcula por rondas acotadas, así que un ciclo de recetas nunca da vueltas sin fin);
--       - comprarlo al NPC, si se conoce (lo introduces tú: no hay fuente permitida que lo dé).
--   · Valor del producto = su compra mínima y, si no hay, su valor de mercado; con un tope opcional
--     (ajuste recetas.tope_valor_pct, 150 % por defecto; 0 = sin tope) sobre el valor de mercado.
--   · Si a un material le faltan los tres precios, la receta sigue saliendo «incompleta».
-- Es una ADAPTACIÓN propia de la idea de TSM a precios agregados, no su código: se rotula «estimación».

-- ---------- Precios de compra al NPC introducidos por ti ----------
create table precios_npc (
  game_type   text    not null,
  item_id     integer not null check (item_id > 0),
  precio      bigint  not null check (precio > 0 and precio <= 100000000000),
  origen      text    not null default 'usuario' check (origen = 'usuario'),
  actualizado timestamptz not null default now(),
  primary key (game_type, item_id)
);
alter table precios_npc enable row level security;
revoke all on precios_npc from anon, authenticated;

insert into settings (key, value) values ('recetas.tope_valor_pct', '150') on conflict (key) do nothing;

-- Lista de precios de compra al NPC introducidos.
create function listar_compra_npc(p_market_key text) returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', p.item_id, 'nombre', coalesce(c.nombre, '#' || p.item_id),
                                               'precio', p.precio, 'venta_npc', c.venta_npc, 'actualizado', p.actualizado)
                            order by c.nombre, p.item_id), '[]'::jsonb)
    from markets m
    join precios_npc p on p.game_type = m.game_type
    left join catalogo c on c.game_type = p.game_type and c.item_id = p.item_id
   where m.key = p_market_key
$$;

-- Importación verificable. p_filas: [{id, precio}] (precio en cobre; null = borrar el precio guardado).
-- Con p_aplicar = false solo comprueba y devuelve lo que se aceptaría (vista previa); nada se guarda.
-- Se rechaza: ID que no está en el catálogo, precio que no es un entero positivo, y un precio de compra
-- menor o igual que lo que el NPC paga al venderle el objeto (no es plausible).
create function importar_compra_npc(p_market_key text, p_filas jsonb, p_aplicar boolean default false,
                                    p_now timestamptz default now())
returns jsonb language plpgsql as $$
declare
  v_game text := (select game_type from markets where key = p_market_key and not is_demo);
  v_ok   jsonb;
  v_mal  jsonb;
begin
  if v_game is null then raise exception 'Mercado % no registrado o de demostración', p_market_key; end if;
  if jsonb_typeof(p_filas) <> 'array' then raise exception 'filas debe ser una lista'; end if;
  if jsonb_array_length(p_filas) > 2000 then raise exception 'Máximo 2000 filas por importación'; end if;

  with f as (
    select e.ordinality as n, e.value->'id' as id_j, e.value->'precio' as precio_j
      from jsonb_array_elements(p_filas) with ordinality e
  ),
  v as (
    select f.n,
           case when jsonb_typeof(f.id_j) = 'number' and (f.id_j)::text ~ '^\d{1,9}$' then (f.id_j)::text::integer end as id,
           f.id_j,
           case when jsonb_typeof(f.precio_j) = 'number' and (f.precio_j)::text ~ '^\d{1,11}$' then (f.precio_j)::text::bigint end as precio,
           jsonb_typeof(f.precio_j) = 'null' or f.precio_j is null as borrar
      from f
  ),
  c as (
    select v.*, cat.nombre, cat.venta_npc,
           case when v.id is null or v.id = 0 then 'ID no válido'
                when cat.item_id is null then 'no está en el catálogo'
                when v.borrar then null
                when v.precio is null or v.precio = 0 then 'el precio debe ser un entero positivo en cobre'
                when cat.venta_npc is not null and v.precio <= cat.venta_npc
                  then 'menor o igual que lo que paga el NPC (' || cat.venta_npc || ' c): no es plausible'
           end as motivo
      from v
      left join catalogo cat on cat.game_type = v_game and cat.item_id = v.id
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'nombre', nombre, 'precio', precio, 'borrar', borrar)
                            order by n) filter (where motivo is null), '[]'::jsonb),
         coalesce(jsonb_agg(jsonb_build_object('fila', n, 'id', coalesce(to_jsonb(id), id_j), 'motivo', motivo)
                            order by n) filter (where motivo is not null), '[]'::jsonb)
    into v_ok, v_mal
    from c;

  if p_aplicar then
    delete from precios_npc p
     using jsonb_array_elements(v_ok) e
     where p.game_type = v_game and p.item_id = (e->>'id')::integer and (e->>'borrar')::boolean;
    insert into precios_npc (game_type, item_id, precio, actualizado)
    select distinct on ((e->>'id')::integer) v_game, (e->>'id')::integer, (e->>'precio')::bigint, p_now
      from jsonb_array_elements(v_ok) with ordinality x(e, n)
     where not (e->>'borrar')::boolean
     order by (e->>'id')::integer, n desc      -- un ID repetido: vale la última fila
    on conflict (game_type, item_id) do update set precio = excluded.precio, actualizado = excluded.actualizado;
  end if;

  return jsonb_build_object('aplicado', p_aplicar, 'aceptadas', v_ok, 'rechazadas', v_mal,
                            'guardados', (select count(*) from precios_npc where game_type = v_game));
end $$;

-- ---------- Coste de cada objeto al estilo TSM ----------
-- Devuelve {item_id: {s: subasta, n: npc, f: fabricar, c: coste, o: origen}} para todo objeto de las recetas.
create function _costes_tsm(p_market_key text) returns jsonb language plpgsql stable as $$
declare
  v_m    markets%rowtype;
  v_hora timestamptz;
  v      jsonb;
  v_ant  jsonb;
begin
  select * into v_m from markets where key = p_market_key;
  if not found then return '{}'::jsonb; end if;
  select date_trunc('hour', max(s.source_updated_at), 'UTC') into v_hora from snapshots s where s.market_id = v_m.id;

  with u as (
    select distinct item_id from recipe_materials where game_type = v_m.game_type
    union
    select resultado_id from recipes where game_type = v_m.game_type
  ),
  b as (
    select u.item_id,
           coalesce(p.min_buyout, p.median, p.market_value) as s,
           coalesce(pn.precio, c.compra_npc) as n
      from u
      left join price_hourly p on p.market_id = v_m.id and p.hour = v_hora and p.item_id = u.item_id
      left join precios_npc pn on pn.game_type = v_m.game_type and pn.item_id = u.item_id and not v_m.is_demo
      left join catalogo c on c.game_type = v_m.game_type and c.item_id = u.item_id and not v_m.is_demo
  )
  select coalesce(jsonb_object_agg(item_id::text, jsonb_build_object('s', s, 'n', n, 'f', null, 'c', least(s, n),
                    'o', case when s is not null and (n is null or s <= n) then 'subasta' when n is not null then 'npc' end)),
                  '{}'::jsonb)
    into v from b;

  -- Rondas: cada una deja fabricar con los costes de la anterior. Los costes solo bajan, así que
  -- un ciclo de recetas no cambia nada y 6 rondas cubren cadenas de fabricación de 6 niveles.
  for i in 1..6 loop
    v_ant := v;
    with rc as (
      select r.resultado_id,
             min(x.total / ((r.cantidad_min + r.cantidad_max) / 2.0)) filter (where x.completo) as f
        from recipes r
        cross join lateral (
          select sum(rm.cantidad * (v_ant->(rm.item_id::text)->>'c')::numeric) as total,
                 bool_and(v_ant->(rm.item_id::text)->>'c' is not null) as completo
            from recipe_materials rm
           where rm.game_type = r.game_type and rm.spell_id = r.spell_id) x
       where r.game_type = v_m.game_type
       group by r.resultado_id
    )
    select jsonb_object_agg(e.k, jsonb_build_object('s', e.s, 'n', e.n, 'f', e.f, 'c', least(e.s, e.n, e.f),
             'o', case when e.s is not null and e.s <= coalesce(least(e.n, e.f), e.s) then 'subasta'
                       when e.n is not null and e.n <= coalesce(e.f, e.n) then 'npc'
                       when e.f is not null then 'fabricar' end))
      into v
      from (select x.k, (x.j->>'s')::bigint as s, (x.j->>'n')::bigint as n, ceil(rc.f)::bigint as f
              from jsonb_each(v_ant) x(k, j)
              left join rc on rc.resultado_id = x.k::integer) e;
    exit when v = v_ant;
  end loop;
  return v;
end $$;

-- Recetas con coste al estilo TSM. Misma forma que _recetas_json y, además, por material: origen y
-- las tres alternativas; por resultado: si se aplicó el tope.
create function _recetas_json_tsm(p_market_key text, p_profesion text, p_spells integer[]) returns jsonb
language plpgsql stable as $$
declare
  v_costes jsonb := _costes_tsm(p_market_key);
  v_tope   numeric := ajuste_num('recetas.tope_valor_pct', 150);
  v_res    jsonb;
begin
  with m as (select id, game_type from markets where key = p_market_key),
  h as (select date_trunc('hour', max(s.source_updated_at), 'UTC') as hora
          from snapshots s join m on s.market_id = m.id),
  r as (select x.* from recipes x join m on x.game_type = m.game_type
         where (p_profesion is null or x.profesion = p_profesion)
           and (p_spells is null or x.spell_id = any (p_spells))),
  mat as (
    select rm.spell_id,
           jsonb_agg(jsonb_build_object(
             'id', rm.item_id, 'nombre', coalesce(i.name, rm.nombre), 'icono', i.icon_url, 'calidad', i.quality,
             'cantidad', rm.cantidad, 'precio', k.c, 'coste', rm.cantidad * k.c, 'origen', k.o,
             'subasta', k.s, 'npc', k.n, 'fabricar', k.f, 'npc_tuyo', pn.item_id is not null)
             order by rm.cantidad * k.c desc nulls first, rm.item_id) as lista,
           sum(rm.cantidad * k.c) as parcial,
           coalesce(array_agg(coalesce(i.name, rm.nombre) order by rm.item_id) filter (where k.c is null), '{}') as faltan
      from r
      join recipe_materials rm on rm.game_type = r.game_type and rm.spell_id = r.spell_id
      cross join m
      left join items i on i.market_id = m.id and i.item_id = rm.item_id
      left join precios_npc pn on pn.game_type = m.game_type and pn.item_id = rm.item_id
      cross join lateral (select (v_costes->(rm.item_id::text)->>'c')::bigint as c, v_costes->(rm.item_id::text)->>'o' as o,
                                 (v_costes->(rm.item_id::text)->>'s')::bigint as s, (v_costes->(rm.item_id::text)->>'n')::bigint as n,
                                 (v_costes->(rm.item_id::text)->>'f')::bigint as f) k
     group by rm.spell_id),
  res as (
    select p.item_id, p.min_buyout, p.market_value, p.sales_per_day, p.quantity
      from m cross join h
      join price_hourly p on p.market_id = m.id and p.hour = h.hora
     where p.item_id in (select resultado_id from r)),
  c as (
    select r.*, mat.lista, mat.faltan, mat.parcial,
           case when cardinality(mat.faltan) = 0 then mat.parcial end as coste,
           v.valor as precio_res, v.tope as tope_aplicado, v.fuente as fuente_valor,
           res.sales_per_day, res.quantity,
           (r.cantidad_min + r.cantidad_max) / 2.0 as rendimiento,
           ajuste_num('motor.comision_pct', 5) as pct
      from r
      join mat on mat.spell_id = r.spell_id
      left join res on res.item_id = r.resultado_id
      cross join lateral (
        select case when t.bruto is not null and v_tope > 0 and res.market_value is not null
                         and t.bruto > floor(res.market_value * v_tope / 100)
                    then floor(res.market_value * v_tope / 100)::bigint else t.bruto end as valor,
               coalesce(t.bruto is not null and v_tope > 0 and res.market_value is not null
                        and t.bruto > floor(res.market_value * v_tope / 100), false) as tope,
               case when res.min_buyout is not null then 'compra_minima'
                    when res.market_value is not null then 'valor_mercado' end as fuente
          from (select coalesce(res.min_buyout, res.market_value) as bruto) t) v),
  f as (select c.*, round(c.precio_res * c.rendimiento) as bruto from c),
  g as (select f.*, f.bruto - floor(f.bruto * f.pct / 100) as neto from f)
  select coalesce(jsonb_agg(jsonb_build_object(
           'spell', g.spell_id, 'nombre', g.nombre, 'profesion', g.profesion,
           'nivel', g.nivel_requerido, 'obtencion', g.obtencion,
           'resultado', jsonb_build_object(
              'id', g.resultado_id, 'nombre', coalesce(i.name, g.resultado_nombre),
              'calidad', coalesce(i.quality, g.resultado_calidad), 'icono', i.icon_url,
              'cantidad_min', g.cantidad_min, 'cantidad_max', g.cantidad_max, 'rendimiento', g.rendimiento,
              'precio', g.precio_res, 'fuente_valor', g.fuente_valor, 'tope_aplicado', g.tope_aplicado,
              'ventas_dia', g.sales_per_day, 'publicadas', g.quantity),
           'reactivos', g.lista,
           'completa', g.coste is not null,
           'faltan', to_jsonb(g.faltan),
           'coste', g.coste,
           'coste_parcial', g.parcial,
           'bruto', g.bruto,
           'comision', g.bruto - g.neto,
           'neto', g.neto,
           'margen', g.neto - g.coste,
           'margen_pct', case when g.coste > 0 then round((g.neto - g.coste) / g.coste, 4) end,
           'ganancia_dia', case when g.sales_per_day is not null
                                then round((g.neto - g.coste) / g.rendimiento * g.sales_per_day) end,
           'dias_para_vender', case when g.sales_per_day > 0 then round(g.quantity / g.sales_per_day, 1) end
         ) order by g.nombre, g.spell_id), '[]'::jsonb)
    into v_res
    from g
    cross join m
    left join items i on i.market_id = m.id and i.item_id = g.resultado_id;
  return v_res;
end $$;

-- La función de siempre pasa a ser la «clásica»; la nueva elige según la base.
alter function _recetas_json(text, text, integer[], text) rename to _recetas_json_clasico;
create function _recetas_json(p_market_key text, p_profesion text, p_spells integer[], p_base text)
returns jsonb language sql stable as $$
  select case when p_base = 'tsm' then _recetas_json_tsm(p_market_key, p_profesion, p_spells)
              else _recetas_json_clasico(p_market_key, p_profesion, p_spells, p_base) end
$$;

create or replace function _base_precio(p_base text) returns text language plpgsql immutable as $$
begin
  if coalesce(p_base, 'mediana') not in ('mediana', 'minimo', 'tsm') then
    raise exception 'Base de precio no válida: % (mediana, minimo o tsm)', p_base;
  end if;
  return coalesce(p_base, 'mediana');
end $$;

-- Cabecera: con la base 'tsm' también el tope aplicado.
create or replace function _recetas_cabecera(p_market_key text, p_base text) returns jsonb language sql stable as $$
  select jsonb_build_object(
    'mercado', m.key, 'base', p_base,
    'hora_precios', (select max(s.source_updated_at) from snapshots s where s.market_id = m.id),
    'comision_pct', ajuste_num('motor.comision_pct', 5),
    'tope_valor_pct', case when p_base = 'tsm' then ajuste_num('recetas.tope_valor_pct', 150) end,
    'atribucion', jsonb_build_object('texto', 'Prices from AHledger', 'url', 'https://ahledger.com/crafting'))
    from markets m where m.key = p_market_key
$$;

-- La ficha muestra el precio de compra al NPC introducido por ti (y lo marca).
create or replace function ficha_objeto(p_market_key text, p_item_id integer) returns jsonb language sql stable as $$
  select b.f || jsonb_build_object('region', _region_objeto(p_market_key, p_item_id),
                                   'region_estado', _region_estado(p_market_key))
             || case when pn.precio is not null
                     then jsonb_build_object('compra_npc', pn.precio, 'compra_npc_origen', 'usuario',
                                             'compra_npc_fecha', pn.actualizado)
                     when b.f->'compra_npc' is not null and b.f->'compra_npc' <> 'null'::jsonb
                     then jsonb_build_object('compra_npc_origen', 'catalogo')
                     else '{}'::jsonb end
    from (select _ficha_objeto_base(p_market_key, p_item_id) as f) b
    left join markets m on m.key = p_market_key and not m.is_demo
    left join precios_npc pn on pn.game_type = m.game_type and pn.item_id = p_item_id
   where b.f is not null
$$;

revoke execute on all functions in schema public from public, anon, authenticated;
