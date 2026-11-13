-- 0040 · Etapa 2: datos en bruto para la vista «Fabricación».
--
-- El cálculo (coste, comprar o fabricar, comisión, ROI, margen…) lo hace el motor del navegador
-- (app/static/fabricacion.js), el mismo que se prueba en Node. Esta función solo entrega, en una
-- llamada, todas las recetas con sus materiales y los precios del ÚLTIMO escaneo de cada objeto
-- que interviene. Nada se rellena: un precio que no existe va como null.
--
-- Forma (claves cortas: son ~2.200 recetas y ~3.000 objetos):
--   {mercado, demo, escaneo, cantidades: {proveedor, escaneo} | null, tope_pct, comision_pct,
--    recetas:  [{s: spell, n: nombre, p: profesion, l: nivel, o: obtencion, r: resultado, mn, mx, m: [[id, cantidad]…]}],
--    objetos:  {id: {n: nombre, i: icono, q: calidad, s: compra mínima, v: valor de mercado, h: histórico,
--                    c: unidades publicadas, cr: c viene de otro proveedor, npc: compra al NPC,
--                    npc_tuyo: la puso el usuario, vn: venta al NPC, d: ventas/día del reino, dg: ventas/día región}}}

create or replace function datos_fabricacion(p_market_key text) returns jsonb language plpgsql stable as $$
declare
  v_m    markets%rowtype;
  v_hora timestamptz;
  v_esc  timestamptz;
  v_cmp  record;
  v_res  jsonb;
begin
  select * into v_m from markets where key = p_market_key;
  if not found then raise exception 'Mercado desconocido: %', p_market_key using errcode = '22023'; end if;
  select date_trunc('hour', max(s.source_updated_at), 'UTC'), max(s.source_updated_at)
    into v_hora, v_esc from snapshots s where s.market_id = v_m.id;
  select * into v_cmp from _cantidades_de(v_m.id) limit 1;

  with r as (
    select x.* from recipes x where x.game_type = v_m.game_type
  ),
  ids as (
    select distinct item_id from recipe_materials where game_type = v_m.game_type
    union
    select resultado_id from r
  ),
  o as (
    select ids.item_id,
           coalesce(c.nombre, nullif(btrim(i.name), ''), rn.nombre) as nombre,
           coalesce(c.icono_url, i.icon_url) as icono,
           coalesce(c.calidad, i.quality) as calidad,
           p.min_buyout, p.market_value, p.historical,
           coalesce(p.quantity, q.quantity) as cantidad,
           p.quantity is null and q.quantity is not null as cantidad_ref,
           coalesce(pn.precio, c.compra_npc) as npc,
           pn.item_id is not null as npc_tuyo,
           coalesce(c.venta_npc, i.vendor_price) as venta_npc,
           p.sales_per_day as ventas_reino,
           rg.sold_per_day as ventas_region
      from ids
      left join catalogo c on c.game_type = v_m.game_type and c.item_id = ids.item_id and not v_m.is_demo
      left join items i on i.market_id = v_m.id and i.item_id = ids.item_id
      left join price_hourly p on p.market_id = v_m.id and p.hour = v_hora and p.item_id = ids.item_id
      left join price_hourly q on v_cmp.id is not null and q.market_id = v_cmp.id and q.hour = v_cmp.hora
                              and q.item_id = ids.item_id and q.quantity > 0
      left join precios_npc pn on pn.game_type = v_m.game_type and pn.item_id = ids.item_id and not v_m.is_demo
      left join region_items rg on rg.game_type = v_m.game_type and rg.region = v_m.region
                               and rg.item_id = ids.item_id and not v_m.is_demo
      left join lateral (select coalesce(x.resultado_nombre, '#' || ids.item_id) as nombre from r x
                          where x.resultado_id = ids.item_id limit 1) rn0 on true
      left join lateral (select coalesce(rn0.nombre, (select rm.nombre from recipe_materials rm
                                                       where rm.game_type = v_m.game_type and rm.item_id = ids.item_id limit 1),
                                         '#' || ids.item_id) as nombre) rn on true
  )
  select jsonb_build_object(
    'mercado', v_m.key,
    'demo', v_m.is_demo,
    'escaneo', v_esc,
    'cantidades', case when v_cmp.id is not null
                       then jsonb_build_object('proveedor', 'AHledger', 'escaneo', v_cmp.escaneo) end,
    'tope_pct', ajuste_num('recetas.tope_valor_pct', 150),
    'comision_pct', ajuste_num('motor.comision_pct', 5),
    'recetas', coalesce((
      select jsonb_agg(jsonb_build_object(
               's', r.spell_id, 'n', r.nombre, 'p', r.profesion, 'l', r.nivel_requerido, 'o', r.obtencion,
               'r', r.resultado_id, 'mn', r.cantidad_min, 'mx', r.cantidad_max,
               'm', (select jsonb_agg(jsonb_build_array(rm.item_id, rm.cantidad) order by rm.item_id)
                       from recipe_materials rm
                      where rm.game_type = r.game_type and rm.spell_id = r.spell_id))
             order by r.spell_id)
        from r), '[]'::jsonb),
    'objetos', coalesce((
      select jsonb_object_agg(o.item_id::text, jsonb_strip_nulls(jsonb_build_object(
               'n', o.nombre, 'i', o.icono, 'q', o.calidad,
               's', o.min_buyout, 'v', o.market_value, 'h', o.historical,
               'c', o.cantidad, 'cr', case when o.cantidad_ref then true end,
               'npc', o.npc, 'npc_tuyo', case when o.npc_tuyo then true end,
               'vn', o.venta_npc, 'd', o.ventas_reino, 'dg', o.ventas_region)))
        from o), '{}'::jsonb)
  ) into v_res;
  return v_res;
end $$;
