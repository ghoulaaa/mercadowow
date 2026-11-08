-- =====================================================================
-- 0007 — Inventario valorado, historial para el gráfico y supuestos de depósito.
--
-- Dinero por lote del inventario:
--   bruto              = precio actual × cantidad
--   comisión           = bruto × comisión %            → coste DEFINITIVO
--   depósito           = depósito mínimo × publicaciones → RECUPERABLE si se vende
--   pérdida esperada   = depósito × probabilidad de no vender (SUPUESTO configurable)
--   neto estimado      = bruto − comisión − pérdida esperada
--   beneficio / margen = SOLO si se conoce el coste de compra; si no, null (nunca 0).
-- =====================================================================

insert into settings (key, value) values
  ('motor.prob_no_venta_pct', '50'),          -- SUPUESTO: % de publicaciones que caducan sin venderse
  ('motor.unidades_por_publicacion', '20')    -- cuántas unidades se ponen en cada subasta (para contar depósitos)
on conflict (key) do nothing;

-- Amplía la validación de ajustes con las dos claves nuevas (mismas reglas que 0006).
create or replace function guardar_ajustes(p_ajustes jsonb) returns jsonb language plpgsql as $$
declare
  k text; v numeric;
  rangos constant jsonb := '{
    "motor.vender_sobre_med7_pct":      [1, 200],
    "motor.vender_sobre_med30_pct":     [1, 200],
    "motor.vender_persistencia_obs":    [1, 3],
    "motor.guardar_bajo_med30_pct":     [1, 90],
    "motor.guardar_min_recuperaciones": [1, 30],
    "motor.caida_fuerte_pct_dia":       [0.1, 50],
    "motor.subida_fuerte_pct_dia":      [0.1, 100],
    "motor.min_dias_historial":         [1, 30],
    "motor.min_observaciones":          [3, 1000],
    "motor.dato_antiguo_horas":         [1, 168],
    "motor.extremo_factor":             [1.5, 100],
    "motor.comision_pct":               [0, 50],
    "motor.deposito_minimo_cobre":      [0, 1000000],
    "motor.prob_no_venta_pct":          [0, 100],
    "motor.unidades_por_publicacion":   [1, 1000]
  }';
begin
  if jsonb_typeof(p_ajustes) <> 'object' then
    raise exception 'Se esperaba un objeto con ajustes';
  end if;
  for k in select jsonb_object_keys(p_ajustes) loop
    if not rangos ? k then
      raise exception 'Ajuste desconocido: %', k;
    end if;
    begin
      v := (p_ajustes->>k)::numeric;
    exception when others then
      raise exception 'El ajuste % debe ser un número', k;
    end;
    if v is null or v < (rangos->k->>0)::numeric or v > (rangos->k->>1)::numeric then
      raise exception 'El ajuste % debe estar entre % y %', k, rangos->k->>0, rangos->k->>1;
    end if;
    if k in ('motor.vender_persistencia_obs', 'motor.guardar_min_recuperaciones', 'motor.min_observaciones',
             'motor.deposito_minimo_cobre', 'motor.unidades_por_publicacion') and v <> trunc(v) then
      raise exception 'El ajuste % debe ser un número entero', k;
    end if;
  end loop;
  insert into settings (key, value)
  select key, value #>> '{}' from jsonb_each(p_ajustes)
  on conflict (key) do update set value = excluded.value;
  return leer_ajustes();
end $$;

-- Corrige «1 observaciones» en los textos (se aplica al leer; los cálculos no cambian).
create or replace function _singular(p text) returns text language sql immutable as $$
  select regexp_replace(p, '(^|[^0-9,])1 observaciones', '\11 observación', 'g')
$$;

create or replace function _rec_al_leer(p_rec text, p_resumen text, p_puntos integer, p_hora_dato timestamptz, p_now timestamptz)
returns jsonb language sql stable as $$
  with x as (
    select extract(epoch from (p_now - p_hora_dato)) / 3600.0 as horas,
           ajuste_num('motor.dato_antiguo_horas', 8) as limite
  ), y as (
    select horas, limite,
           case when horas is null then 0 when horas < 2 then 20 when horas < limite then 10 else 0 end as p_edad
      from x
  )
  select jsonb_build_object(
    'rec',       case when horas > limite then 'OBSERVACION' else p_rec end,
    'resumen',   _singular(case when horas > limite then format('Datos antiguos (%s h): %s', round(horas), p_resumen)
                                else p_resumen end),
    'puntos',    p_puntos + p_edad,
    'p_edad',    p_edad,
    'horas_dato', round(horas, 1),
    'antiguo',   horas > limite,
    'nivel',     case when p_puntos + p_edad >= 40 then 'Media' else 'Baja' end)
  from y
$$;

create or replace function explicar_objeto(p_market_key text, p_item_id integer) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'id', r.item_id,
    'nombre', i.name,
    'categoria', i.category,
    'mercado', mk.key,
    'ficticio', mk.is_demo,
    'calculado_en', r.calculado_en,
    'hora_dato', (select max(source_updated_at) from snapshots s where s.market_id = mk.id),
    'recomendacion_motor', r.recomendacion,
    'lectura', _rec_al_leer(r.recomendacion, r.resumen, r.puntos_base,
                            (select max(source_updated_at) from snapshots s where s.market_id = mk.id), now()),
    'cifras', r.cifras,
    'motivos', (select coalesce(jsonb_agg(to_jsonb(_singular(m)) order by o), '[]'::jsonb)
                  from jsonb_array_elements_text(r.motivos) with ordinality as t(m, o)),
    'riesgos', r.riesgos,
    'desglose', r.desglose,
    'horizonte', r.horizonte,
    'comision_pct', ajuste_num('motor.comision_pct', 5),
    'deposito_minimo', ajuste_num('motor.deposito_minimo_cobre', 100),
    'prob_no_venta_pct', ajuste_num('motor.prob_no_venta_pct', 50),
    'ingreso_neto_unidad', round((r.cifras->>'precio')::numeric * (1 - ajuste_num('motor.comision_pct', 5) / 100)),
    'en_inventario', (select coalesce(sum(quantity), 0) from inventory v where v.market_id = mk.id and v.item_id = p_item_id))
  from markets mk
  join recomendaciones r on r.market_id = mk.id and r.item_id = p_item_id
  join items i on i.market_id = mk.id and i.item_id = p_item_id
  where mk.key = p_market_key
$$;

-- ---------- historial para el gráfico ----------
create function historial_objeto(p_market_key text, p_item_id integer, p_dias integer default 30)
returns jsonb language sql stable as $$
  with m as (select id from markets where key = p_market_key),
  ref as (select max(source_updated_at) as h from snapshots s, m where s.market_id = m.id)
  select jsonb_build_object(
    'id', p_item_id,
    'desde', (select h from ref) - make_interval(days => least(greatest(p_dias, 1), 60)),
    'hasta', (select h from ref),
    'puntos', coalesce((
      select jsonb_agg(jsonb_build_array(
               (extract(epoch from p.hour) * 1000)::bigint, p.min_buyout, p.market_value) order by p.hour)
        from price_hourly p, m
       where p.market_id = m.id and p.item_id = p_item_id
         and p.hour > (select h from ref) - make_interval(days => least(greatest(p_dias, 1), 60))), '[]'::jsonb),
    'med7',  (select (r.cifras->>'med7')::numeric from recomendaciones r, m where r.market_id = m.id and r.item_id = p_item_id),
    'med30', (select (r.cifras->>'med30')::numeric from recomendaciones r, m where r.market_id = m.id and r.item_id = p_item_id))
$$;

-- ---------- inventario ----------
create function _mercado_id(p_market_key text) returns smallint language plpgsql stable as $$
declare v smallint := (select id from markets where key = p_market_key);
begin
  if v is null then raise exception 'Mercado desconocido: %', p_market_key; end if;
  return v;
end $$;

create function _validar_lote(p_mid smallint, p_item_id integer, p_cantidad integer, p_coste bigint) returns void
language plpgsql stable as $$
begin
  if not exists (select 1 from items where market_id = p_mid and item_id = p_item_id) then
    raise exception 'El objeto % no existe en este mercado', p_item_id;
  end if;
  if p_cantidad is null or p_cantidad <= 0 or p_cantidad > 1000000 then
    raise exception 'La cantidad debe ser un entero entre 1 y 1 000 000';
  end if;
  if p_coste is not null and p_coste < 0 then
    raise exception 'El coste no puede ser negativo';
  end if;
end $$;

create function agregar_inventario(p_market_key text, p_item_id integer, p_cantidad integer,
                                   p_coste bigint default null, p_nota text default null)
returns jsonb language plpgsql as $$
declare v_mid smallint := _mercado_id(p_market_key); v_id bigint;
begin
  perform _validar_lote(v_mid, p_item_id, p_cantidad, p_coste);
  insert into inventory (market_id, item_id, quantity, unit_cost, note)
  values (v_mid, p_item_id, p_cantidad, p_coste, nullif(left(btrim(p_nota), 200), ''))
  returning id into v_id;
  return jsonb_build_object('id', v_id);
end $$;

-- p_coste null = coste desconocido (el beneficio de ese lote no se calcula).
create function editar_inventario(p_market_key text, p_id bigint, p_cantidad integer,
                                  p_coste bigint, p_nota text default null)
returns jsonb language plpgsql as $$
declare v_mid smallint := _mercado_id(p_market_key); v_item integer;
begin
  select item_id into v_item from inventory where id = p_id and market_id = v_mid;
  if v_item is null then
    raise exception 'Ese lote no existe en este mercado';
  end if;
  perform _validar_lote(v_mid, v_item, p_cantidad, p_coste);
  update inventory set quantity = p_cantidad, unit_cost = p_coste, note = nullif(left(btrim(p_nota), 200), '')
   where id = p_id and market_id = v_mid;
  return jsonb_build_object('id', p_id);
end $$;

create function borrar_inventario(p_market_key text, p_id bigint) returns jsonb language plpgsql as $$
declare v_mid smallint := _mercado_id(p_market_key);
begin
  delete from inventory where id = p_id and market_id = v_mid;
  if not found then
    raise exception 'Ese lote no existe en este mercado';
  end if;
  return jsonb_build_object('id', p_id, 'borrado', true);
end $$;

-- Importación: filas {item_id?, nombre?, cantidad, coste?}. Todo o nada.
create function importar_inventario(p_market_key text, p_rows jsonb, p_reemplazar boolean default false)
returns jsonb language plpgsql as $$
declare
  v_mid    smallint := _mercado_id(p_market_key);
  v_err    text[];
  v_n      integer;
begin
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 or jsonb_array_length(p_rows) > 5000 then
    raise exception 'Se esperaba una lista de 1 a 5000 filas';
  end if;

  drop table if exists _inv;
  create temporary table _inv on commit drop as
    select t.ord::integer as linea, r.item_id, nullif(btrim(r.nombre), '') as nombre, r.cantidad, r.coste,
           coalesce(r.item_id,
             (select min(i.item_id) from items i
               where i.market_id = v_mid and lower(i.name) = lower(btrim(r.nombre))
              having count(*) = 1)) as resuelto,
           (select count(*) from items i where i.market_id = v_mid and lower(i.name) = lower(btrim(r.nombre))) as coincidencias
      from jsonb_array_elements(p_rows) with ordinality as t(e, ord),
           jsonb_to_record(t.e) as r(item_id integer, nombre text, cantidad integer, coste bigint);

  select array_agg(msg order by linea) into v_err from (
    select linea, case
        when resuelto is null and nombre is not null and coincidencias > 1
          then format('Fila %s: «%s» coincide con %s objetos; usa el itemId', linea, nombre, coincidencias)
        when resuelto is null and nombre is not null
          then format('Fila %s: no hay ningún objeto llamado «%s» en este mercado', linea, nombre)
        when resuelto is null then format('Fila %s: falta itemId o nombre', linea)
        when not exists (select 1 from items i where i.market_id = v_mid and i.item_id = resuelto)
          then format('Fila %s: el objeto %s no existe en este mercado', linea, resuelto)
        when cantidad is null or cantidad <= 0 or cantidad > 1000000
          then format('Fila %s: cantidad no válida', linea)
        when coste < 0 then format('Fila %s: coste negativo', linea)
      end as msg
      from _inv) e
   where msg is not null;

  if v_err is not null then
    raise exception '%', array_to_string(v_err[1:10], ' · ')
      || case when cardinality(v_err) > 10 then format(' · y %s errores más', cardinality(v_err) - 10) else '' end;
  end if;

  if p_reemplazar then
    delete from inventory where market_id = v_mid;
  end if;
  insert into inventory (market_id, item_id, quantity, unit_cost)
  select v_mid, resuelto, cantidad, coste from _inv order by linea;
  get diagnostics v_n = row_count;
  return jsonb_build_object('importados', v_n, 'reemplazado', p_reemplazar);
end $$;

-- Inventario con su valor estimado y la recomendación actual de cada objeto.
create function inventario_valorado(p_market_key text) returns jsonb
language sql stable as $$
  with m as (select id from markets where key = p_market_key),
  sup as (
    select ajuste_num('motor.comision_pct', 5) / 100 as com,
           ajuste_num('motor.deposito_minimo_cobre', 100) as dep,
           ajuste_num('motor.prob_no_venta_pct', 50) / 100 as pnv,
           ajuste_num('motor.unidades_por_publicacion', 20) as upp
  ),
  ultima as (select max(source_updated_at) as hora from snapshots s, m where s.market_id = m.id),
  base as (
    select v.id, v.item_id, i.name, i.category, v.quantity, v.unit_cost, v.note, v.created_at,
           u.precio, u.hour,
           l.x as lectura,
           ceil(v.quantity / sup.upp) as publicaciones,
           sup.*
      from inventory v
      join m on v.market_id = m.id
      join items i on i.market_id = v.market_id and i.item_id = v.item_id
      cross join sup
      left join lateral (
        select coalesce(p.min_buyout, p.market_value) as precio, p.hour
          from price_hourly p
         where p.market_id = v.market_id and p.item_id = v.item_id
         order by p.hour desc limit 1) u on true
      left join recomendaciones r on r.market_id = v.market_id and r.item_id = v.item_id
      left join lateral (
        select case when r.item_id is null then null
                    else _rec_al_leer(r.recomendacion, r.resumen, r.puntos_base, (select hora from ultima), now()) end as x
      ) l on true
  ),
  calc as (
    select b.*,
           b.precio * b.quantity                                  as bruto,
           round(b.precio * b.quantity * b.com)                   as comision,
           b.dep * b.publicaciones                                as deposito,
           round(b.dep * b.publicaciones * b.pnv)                 as perdida_deposito,
           b.unit_cost * b.quantity                               as coste_total
      from base b
  ),
  fin as (
    select c.*,
           c.bruto - c.comision - c.perdida_deposito as neto,
           case when c.coste_total is not null and c.bruto is not null
                then c.bruto - c.comision - c.perdida_deposito - c.coste_total end as beneficio
      from calc c
  )
  select jsonb_build_object(
    'filas', coalesce(jsonb_agg(jsonb_build_object(
        'id', id, 'item_id', item_id, 'nombre', name, 'categoria', category,
        'cantidad', quantity, 'coste_unitario', unit_cost, 'nota', note,
        'precio', precio, 'hora', hour, 'ausente', hour < date_trunc('hour', (select hora from ultima), 'UTC'),
        'publicaciones', publicaciones,
        'bruto', bruto, 'comision', comision, 'deposito', deposito, 'perdida_deposito', perdida_deposito,
        'neto', neto, 'coste_total', coste_total, 'beneficio', beneficio,
        'margen', case when coste_total > 0 then round(beneficio / coste_total, 4) end,
        'rec', lectura->>'rec', 'resumen', lectura->>'resumen', 'nivel', lectura->>'nivel',
        'puntos', (lectura->>'puntos')::integer)
      order by name, id) filter (where id is not null), '[]'::jsonb),
    'totales', jsonb_build_object(
        'lotes', count(id),
        'unidades', coalesce(sum(quantity), 0),
        'neto', sum(neto),
        'sin_precio', count(id) filter (where precio is null),
        'con_coste', count(id) filter (where coste_total is not null),
        'sin_coste', count(id) filter (where coste_total is null),
        -- El beneficio total SOLO suma lotes con coste conocido (y se dice cuántos quedan fuera).
        'beneficio_con_coste', sum(beneficio),
        'coste_con_coste', sum(coste_total) filter (where beneficio is not null),
        'vender', count(id) filter (where lectura->>'rec' = 'VENDER'),
        'guardar', count(id) filter (where lectura->>'rec' = 'GUARDAR')),
    'supuestos', (select jsonb_build_object('comision_pct', com * 100, 'deposito_minimo', dep,
                                            'prob_no_venta_pct', pnv * 100, 'unidades_por_publicacion', upp) from sup))
  from fin
$$;

revoke execute on all functions in schema public from public, anon, authenticated;
