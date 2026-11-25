-- =====================================================================
-- 0052 — Informe diario: «Pociones y elixires más vendidos» (antes «Consumibles más vendidos»).
-- informe_base devuelve también la subclase de los consumibles del catálogo (Potions, Elixirs, Food & Drink…)
-- para que el informe muestre solo pociones y elixires, sin comida. La categoría «Consumibles» de la página de
-- categorías no cambia (sigue incluyendo todos los consumibles).
-- =====================================================================
/**
 * Datos del informe: 48 h hasta p_hasta (las 24 h del informe y las 24 anteriores).
 *   serie: [[ms, unidades publicadas, objetos, válida], …] por hora con escaneo (nada se rellena).
 *   objetos: [[id, mediana 24 h, mediana 24 h anteriores, escaneos 24 h, escaneos antes, cantidad mediana 24 h,
 *              cantidad mediana antes, compra mínima ahora, cantidad ahora, ventas/día ahora, ventas/día antes,
 *              mediana 30 días del proveedor, venta al NPC, categoría, subclase si es un consumible], …] — precios
 *              por UNIDAD, en cobre.
 * Solo se usan las horas válidas (escaneo completo).
 */
create or replace function informe_base(p_market_key text, p_hasta timestamptz default now()) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_m markets%rowtype; r jsonb;
begin
  select * into v_m from markets where key = p_market_key;
  if not found then raise exception 'Mercado desconocido'; end if;
  with h as (
    select hour, count(*) as n, sum(quantity) as q
      from price_hourly
     where market_id = v_m.id and hour > p_hasta - interval '48 hours' and hour <= p_hasta
     group by hour),
  med as (select percentile_cont(0.5) within group (order by n) as mn,
                 percentile_cont(0.5) within group (order by q) as mq from h),
  hv as (select h.*, (h.n >= 0.9 * med.mn and (med.mq is null or coalesce(h.q, 0) >= 0.6 * med.mq)) as valida from h, med),
  p as (
    select ph.item_id, ph.hour, ph.min_buyout, ph.quantity, ph.sales_per_day, ph.historical,
           ph.hour > p_hasta - interval '24 hours' as act
      from price_hourly ph join hv on hv.hour = ph.hour and hv.valida
     where ph.market_id = v_m.id and ph.hour > p_hasta - interval '48 hours' and ph.hour <= p_hasta),
  ult as (select distinct on (item_id) item_id, min_buyout, quantity, sales_per_day, historical
            from p where act order by item_id, hour desc),
  ant as (select distinct on (item_id) item_id, sales_per_day from p where not act order by item_id, hour desc),
  est as (
    select item_id,
           percentile_cont(0.5) within group (order by min_buyout) filter (where act) as med_act,
           percentile_cont(0.5) within group (order by min_buyout) filter (where not act) as med_ant,
           count(min_buyout) filter (where act) as n_act,
           count(min_buyout) filter (where not act) as n_ant,
           percentile_cont(0.5) within group (order by quantity) filter (where act) as q_act,
           percentile_cont(0.5) within group (order by quantity) filter (where not act) as q_ant
      from p group by item_id)
  select jsonb_build_object(
    'mercado', jsonb_build_object('key', v_m.key, 'nombre', v_m.label, 'proveedor', v_m.provider, 'faccion', v_m.faction,
                                  'reglas', v_m.ruleset, 'region', v_m.region, 'juego', v_m.game_type,
                                  'atribucion', v_m.atribucion_texto),
    'hasta', p_hasta,
    'serie', (select coalesce(jsonb_agg(jsonb_build_array((extract(epoch from hour) * 1000)::bigint, q, n, valida) order by hour), '[]'::jsonb) from hv),
    'objetos', (select coalesce(jsonb_agg(jsonb_build_array(e.item_id, round(e.med_act), round(e.med_ant), e.n_act, e.n_ant,
                                  round(e.q_act), round(e.q_ant), u.min_buyout, u.quantity, round(u.sales_per_day, 2),
                                  round(a.sales_per_day, 2), u.historical, c.venta_npc,
                                  _informe_categoria(c.clase, c.subclase, c.nombre),
                                  case when c.clase = 'Consumable' then c.subclase end)), '[]'::jsonb)
                  from est e join ult u using (item_id) left join ant a using (item_id)
                  left join catalogo c on c.game_type = v_m.game_type and c.item_id = e.item_id)
  ) into r;
  return r;
end $$;

revoke all on function informe_base(text, timestamptz) from public, anon, authenticated;
