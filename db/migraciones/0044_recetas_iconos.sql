-- Fabricación (V8): los iconos de las recetas salen primero del catálogo (iconos oficiales de Blizzard), como en la
-- tabla del mercado. Antes solo se miraba la tabla de precios del mercado y muchos productos y materiales
-- (117 de 195 en Alquimia) se quedaban sin icono. Mismo cálculo y misma forma que en 0028; solo cambia 'icono'.

create or replace function _recetas_json_tsm(p_market_key text, p_profesion text, p_spells integer[]) returns jsonb
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
             'id', rm.item_id, 'nombre', coalesce(i.name, rm.nombre), 'icono', coalesce(ca.icono_url, i.icon_url),
             'calidad', i.quality,
             'cantidad', rm.cantidad, 'precio', k.c, 'coste', rm.cantidad * k.c, 'origen', k.o,
             'subasta', k.s, 'npc', k.n, 'fabricar', k.f, 'npc_tuyo', pn.item_id is not null)
             order by rm.cantidad * k.c desc nulls first, rm.item_id) as lista,
           sum(rm.cantidad * k.c) as parcial,
           coalesce(array_agg(coalesce(i.name, rm.nombre) order by rm.item_id) filter (where k.c is null), '{}') as faltan
      from r
      join recipe_materials rm on rm.game_type = r.game_type and rm.spell_id = r.spell_id
      cross join m
      left join items i on i.market_id = m.id and i.item_id = rm.item_id
      left join catalogo ca on ca.game_type = m.game_type and ca.item_id = rm.item_id
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
              'calidad', coalesce(i.quality, g.resultado_calidad), 'icono', coalesce(ca.icono_url, i.icon_url),
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
    left join items i on i.market_id = m.id and i.item_id = g.resultado_id
    left join catalogo ca on ca.game_type = m.game_type and ca.item_id = g.resultado_id;
  return v_res;
end $$;
