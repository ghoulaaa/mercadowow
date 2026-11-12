-- 0041 · Etapa 5: historial para la vista «Fabricación».
--
-- Devuelve, para unos objetos (el producto de una receta y todo lo que interviene en ella), sus
-- precios en CADA escaneo guardado del mercado dentro del periodo. El navegador vuelve a pasar el
-- motor de cálculo escaneo a escaneo para obtener la evolución del coste y de la ganancia, con las
-- mismas reglas que la tabla. Nada se interpola: un escaneo en que falta un objeto va sin él.
--
-- Forma: {mercado, desde, hasta, escaneos: [hora…], primer_escaneo,
--         series: {id: [[hora, compra mínima, valor de mercado, unidades, ventas/día]…]}}
-- Las unidades vienen del propio mercado o, si no las publica (TSM), del escaneo de AHledger del
-- mismo reino en la misma hora (marcado con cantidades_de).

create function historial_fabricacion(p_market_key text, p_ids integer[], p_dias integer default 7)
returns jsonb language plpgsql stable as $$
declare
  v_m     markets%rowtype;
  v_hasta timestamptz;
  v_desde timestamptz;
  v_cmp   smallint;
begin
  select * into v_m from markets where key = p_market_key;
  if not found then raise exception 'Mercado desconocido: %', p_market_key using errcode = '22023'; end if;
  if p_dias is null or p_dias not in (1, 7, 30, 90) then
    raise exception 'Periodo no válido: % (1, 7, 30 o 90 días)', p_dias using errcode = '22023';
  end if;
  if p_ids is null or cardinality(p_ids) = 0 or cardinality(p_ids) > 300 then
    raise exception 'Entre 1 y 300 objetos' using errcode = '22023';
  end if;

  select date_trunc('hour', max(source_updated_at), 'UTC') into v_hasta from snapshots where market_id = v_m.id;
  if v_hasta is null then
    return jsonb_build_object('mercado', v_m.key, 'escaneos', '[]'::jsonb, 'series', '{}'::jsonb);
  end if;
  v_desde := v_hasta - make_interval(days => p_dias);

  -- Mercado que aporta las unidades (AHledger del mismo reino) si este no las publica.
  select c.id into v_cmp from _cantidades_de(v_m.id) c limit 1;

  return jsonb_build_object(
    'mercado', v_m.key,
    'desde', v_desde,
    'hasta', v_hasta,
    'cantidades_de', case when v_cmp is not null then 'AHledger' end,
    'primer_escaneo', (select min(source_updated_at) from snapshots where market_id = v_m.id),
    'escaneos', coalesce((
      select jsonb_agg(h order by h) from (
        select distinct date_trunc('hour', source_updated_at, 'UTC') as h
          from snapshots where market_id = v_m.id
           and source_updated_at > v_desde and date_trunc('hour', source_updated_at, 'UTC') <= v_hasta) x), '[]'::jsonb),
    'series', coalesce((
      select jsonb_object_agg(s.item_id::text, s.puntos)
        from (
          select p.item_id,
                 jsonb_agg(jsonb_build_array(p.hour, p.min_buyout, p.market_value,
                                             coalesce(p.quantity, q.quantity), p.sales_per_day) order by p.hour) as puntos
            from price_hourly p
            left join price_hourly q on v_cmp is not null and q.market_id = v_cmp and q.item_id = p.item_id
                                    and q.hour = p.hour and q.quantity > 0
           where p.market_id = v_m.id and p.item_id = any (p_ids) and p.hour > v_desde and p.hour <= v_hasta
           group by p.item_id) s), '{}'::jsonb)
  );
end $$;
