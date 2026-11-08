-- =====================================================================
-- 0008 — Ventas reales y evaluación de las recomendaciones («¿Acertó?»).
--
-- Ventas: lo que TÚ vendiste (cantidad, precio, fecha). Opcionalmente sale de
-- un lote del inventario: se copia su coste para calcular el beneficio REALIZADO
-- y se puede descontar la cantidad del lote.
--
-- Evaluación: el registro diario de recomendaciones (0006) se compara con el
-- precio observado 7 y 14 días después.
--   VENDER  acierta si después el precio era igual o MÁS BAJO (vender entonces fue mejor que esperar).
--   GUARDAR acierta si después el precio era MÁS ALTO (esperar compensó).
-- Son comparaciones con precios de anuncios, no con ventas confirmadas del mercado.
-- =====================================================================

alter table sales add column lote_id bigint;                       -- lote de origen (sin FK: el lote puede borrarse)
alter table sales add column unit_cost bigint check (unit_cost >= 0); -- coste copiado del lote; null = desconocido
alter table sales add column created_at timestamptz not null default now();
create index sales_market_fecha on sales (market_id, sold_at desc);

-- Regenerar el demo también limpia sus ventas, registro y recomendaciones (son ficticios).
alter function generar_demo(integer, timestamptz) rename to _generar_demo_base;
create function generar_demo(p_dias integer default 30, p_now timestamptz default now())
returns jsonb language plpgsql as $$
declare v_mid smallint := (select id from markets where key = 'demo:forever:us:demo' and is_demo);
begin
  if v_mid is not null then
    delete from sales where market_id = v_mid;
    delete from recommendation_log where market_id = v_mid;
    delete from recomendaciones where market_id = v_mid;
    delete from recomendaciones_estado where market_id = v_mid;
  end if;
  return _generar_demo_base(p_dias, p_now);
end $$;

-- Precio observado más cercano ANTES de un momento (máximo 24 h antes); null si no hay.
create function _precio_en(p_mid smallint, p_item integer, p_t timestamptz) returns jsonb
language sql stable as $$
  select jsonb_build_object('precio', coalesce(p.min_buyout, p.market_value), 'hora', p.hour)
    from price_hourly p
   where p.market_id = p_mid and p.item_id = p_item
     and p.hour <= p_t and p.hour > p_t - interval '24 hours'
   order by p.hour desc
   limit 1
$$;

create function registrar_venta(
  p_market_key      text,
  p_item_id         integer,
  p_cantidad        integer,
  p_precio_unitario bigint,
  p_vendido_en      timestamptz default now(),
  p_comision        bigint default null,   -- comisión realmente pagada; null = se estimará
  p_deposito_perdido bigint default null,  -- depósitos perdidos en relistados; null = no registrado
  p_lote_id         bigint default null,
  p_descontar       boolean default false,
  p_nota            text default null,
  p_now             timestamptz default now()
) returns jsonb language plpgsql as $$
declare
  v_mid   smallint := _mercado_id(p_market_key);
  v_lote  inventory%rowtype;
  v_coste bigint;
  v_id    bigint;
begin
  if not exists (select 1 from items where market_id = v_mid and item_id = p_item_id) then
    raise exception 'El objeto % no existe en este mercado', p_item_id;
  end if;
  if p_cantidad is null or p_cantidad <= 0 or p_cantidad > 1000000 then
    raise exception 'La cantidad debe ser un entero entre 1 y 1 000 000';
  end if;
  if p_precio_unitario is null or p_precio_unitario < 0 then
    raise exception 'El precio de venta no puede faltar ni ser negativo';
  end if;
  if p_vendido_en is null or p_vendido_en > p_now + interval '10 minutes' then
    raise exception 'La fecha de venta falta o está en el futuro';
  end if;
  if p_vendido_en < p_now - interval '365 days' then
    raise exception 'La fecha de venta tiene más de un año';
  end if;
  if coalesce(p_comision, 0) < 0 or coalesce(p_deposito_perdido, 0) < 0 then
    raise exception 'La comisión y el depósito no pueden ser negativos';
  end if;

  if p_lote_id is not null then
    select * into v_lote from inventory where id = p_lote_id and market_id = v_mid for update;
    if not found then
      raise exception 'Ese lote no existe en este mercado';
    end if;
    if v_lote.item_id <> p_item_id then
      raise exception 'El lote elegido es de otro objeto';
    end if;
    v_coste := v_lote.unit_cost;
    if p_descontar then
      if p_cantidad > v_lote.quantity then
        raise exception 'El lote solo tiene % unidades', v_lote.quantity;
      end if;
      if p_cantidad = v_lote.quantity then
        delete from inventory where id = p_lote_id;
      else
        update inventory set quantity = quantity - p_cantidad where id = p_lote_id;
      end if;
    end if;
  elsif p_descontar then
    raise exception 'Para descontar del inventario hay que elegir un lote';
  end if;

  insert into sales (market_id, item_id, quantity, unit_price, sold_at, fee_paid, deposit_lost, note,
                     lote_id, unit_cost, created_at)
  values (v_mid, p_item_id, p_cantidad, p_precio_unitario, p_vendido_en, p_comision, p_deposito_perdido,
          nullif(left(btrim(p_nota), 200), ''), p_lote_id, v_coste, p_now)
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'descontado', p_descontar and p_lote_id is not null);
end $$;

-- Borrar una venta NO devuelve las unidades al inventario (se dice en la página).
create function borrar_venta(p_market_key text, p_id bigint) returns jsonb language plpgsql as $$
declare v_mid smallint := _mercado_id(p_market_key);
begin
  delete from sales where id = p_id and market_id = v_mid;
  if not found then
    raise exception 'Esa venta no existe en este mercado';
  end if;
  return jsonb_build_object('id', p_id, 'borrada', true);
end $$;

create function ventas_listado(p_market_key text, p_now timestamptz default now()) returns jsonb
language sql stable as $$
  with m as (select id from markets where key = p_market_key),
  base as (
    select s.*, i.name,
           s.quantity * s.unit_price as bruto,
           coalesce(s.fee_paid, round(s.quantity * s.unit_price * ajuste_num('motor.comision_pct', 5) / 100)) as comision,
           s.fee_paid is null as comision_estimada,
           coalesce(s.deposit_lost, 0) as deposito,
           _precio_en(s.market_id, s.item_id, s.sold_at) as mercado_entonces,
           case when s.sold_at <= p_now - interval '7 days'
                then _precio_en(s.market_id, s.item_id, s.sold_at + interval '7 days') end as mercado_7d,
           (select l.recommendation from recommendation_log l
             where l.market_id = s.market_id and l.item_id = s.item_id
               and l.day = (s.sold_at at time zone 'UTC')::date) as rec_ese_dia
      from sales s join m on s.market_id = m.id
      join items i on i.market_id = s.market_id and i.item_id = s.item_id
  ),
  fin as (
    select b.*,
           b.bruto - b.comision - b.deposito as neto,
           case when b.unit_cost is not null
                then b.bruto - b.comision - b.deposito - b.unit_cost * b.quantity end as beneficio
      from base b
  )
  select jsonb_build_object(
    'ventas', coalesce(jsonb_agg(jsonb_build_object(
        'id', id, 'item_id', item_id, 'nombre', name, 'cantidad', quantity, 'precio', unit_price,
        'vendido_en', sold_at, 'bruto', bruto, 'comision', comision, 'comision_estimada', comision_estimada,
        'deposito_perdido', deposit_lost, 'neto', neto, 'coste_unitario', unit_cost, 'beneficio', beneficio,
        'margen', case when unit_cost * quantity > 0 then round(beneficio / (unit_cost * quantity), 4) end,
        'nota', note, 'lote_id', lote_id,
        'precio_mercado', (mercado_entonces->>'precio')::bigint,
        'vs_mercado', case when (mercado_entonces->>'precio')::numeric > 0
                           then round(unit_price / (mercado_entonces->>'precio')::numeric - 1, 4) end,
        'precio_7d', (mercado_7d->>'precio')::bigint,
        'vs_7d', case when (mercado_7d->>'precio')::numeric > 0
                      then round((mercado_7d->>'precio')::numeric / unit_price - 1, 4) end,
        'rec_ese_dia', rec_ese_dia)
      order by sold_at desc, id desc), '[]'::jsonb),
    'totales', jsonb_build_object(
        'ventas', count(*),
        'unidades', coalesce(sum(quantity), 0),
        'neto', coalesce(sum(neto), 0),
        'con_coste', count(*) filter (where beneficio is not null),
        'sin_coste', count(*) filter (where beneficio is null),
        'beneficio_con_coste', sum(beneficio),
        'comisiones_estimadas', count(*) filter (where comision_estimada)))
  from fin
$$;

-- Evaluación de las recomendaciones registradas.
create function evaluar_recomendaciones(p_market_key text, p_now timestamptz default now()) returns jsonb
language sql stable as $$
  with m as (select id from markets where key = p_market_key),
  casos as (
    select l.item_id, l.day, l.recommendation as rec, l.price as precio_rec, h.horizonte,
           -- Momento evaluado: mediodía UTC del día registrado + horizonte.
           (l.day::timestamp at time zone 'UTC') + interval '12 hours' + make_interval(days => h.horizonte) as t_eval
      from recommendation_log l join m on l.market_id = m.id
      cross join (values (7), (14)) as h(horizonte)
     where l.recommendation in ('VENDER', 'GUARDAR') and l.price > 0
  ),
  medidos as (
    select c.*,
           c.t_eval <= p_now as maduro,
           case when c.t_eval <= p_now then (_precio_en((select id from m), c.item_id, c.t_eval)->>'precio')::numeric end as precio_despues
      from casos c
  ),
  evaluados as (
    select *, precio_despues / precio_rec - 1 as cambio,
           case rec when 'VENDER' then precio_despues <= precio_rec
                    when 'GUARDAR' then precio_despues > precio_rec end as acierto
      from medidos where maduro and precio_despues is not null
  ),
  resumen as (
    select h.horizonte, r.rec,
           (select count(*) from evaluados e where e.horizonte = h.horizonte and e.rec = r.rec) as n,
           (select count(*) from evaluados e where e.horizonte = h.horizonte and e.rec = r.rec and e.acierto) as aciertos,
           (select round(avg(e.cambio), 4) from evaluados e where e.horizonte = h.horizonte and e.rec = r.rec) as cambio_medio,
           (select count(*) from medidos x where x.horizonte = h.horizonte and x.rec = r.rec and not x.maduro) as pendientes,
           (select count(*) from medidos x where x.horizonte = h.horizonte and x.rec = r.rec and x.maduro and x.precio_despues is null) as sin_dato
      from (values (7), (14)) as h(horizonte) cross join (values ('VENDER'), ('GUARDAR')) as r(rec)
  )
  select jsonb_build_object(
    'resumen', (select jsonb_agg(jsonb_build_object(
                   'horizonte', horizonte, 'rec', rec, 'n', n, 'aciertos', aciertos,
                   'tasa', case when n > 0 then round(aciertos::numeric / n, 4) end,
                   'cambio_medio', cambio_medio, 'pendientes', pendientes, 'sin_dato', sin_dato)
                 order by horizonte, rec desc) from resumen),
    'ultimos', coalesce((select jsonb_agg(x order by x.dia desc, x.nombre) from (
                   select e.item_id as id, i.name as nombre, e.day as dia, e.rec, e.horizonte,
                          e.precio_rec, e.precio_despues, round(e.cambio, 4) as cambio, e.acierto
                     from evaluados e join items i on i.market_id = (select id from m) and i.item_id = e.item_id
                    order by e.day desc, e.horizonte limit 30) x), '[]'::jsonb),
    'primer_registro', (select min(l.day) from recommendation_log l join m on l.market_id = m.id),
    'dias_registrados', (select count(distinct l.day) from recommendation_log l join m on l.market_id = m.id))
$$;

revoke execute on all functions in schema public from public, anon, authenticated;
