-- =====================================================================
-- 0018 — V3 del plan V3: «Esperar» solo con evidencia, y mínimo observado en la ficha.
--
-- * El motor sigue igual (código interno OBSERVACION). La página lo llama «Esperar».
-- * Nuevo campo de lectura `evidencia`: false cuando el motor NO tiene datos para opinar
--   (sin precios, fuera del último escaneo, historial corto, precio extremo o dato antiguo).
--   En ese caso la página no muestra etiqueta, solo «Sin datos suficientes» y el motivo.
--   «Esperar» queda para cuando hay datos pero no se cumple ninguna regla de vender o guardar.
-- * La ficha añade el mínimo y el máximo de la compra mínima observados en 30 días.
-- =====================================================================

create or replace function _sin_evidencia(p_rec text, p_resumen text) returns boolean
language sql immutable as $$
  select p_rec = 'OBSERVACION' and (
           p_resumen in ('Sin precios en los últimos 30 días', 'No aparece en el último escaneo',
                         'Precio extremo: posible error o muy poca oferta')
           or p_resumen like 'Historial insuficiente%')
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
    'evidencia', not (coalesce(horas > limite, false) or _sin_evidencia(p_rec, p_resumen)),
    'nivel',     case when p_puntos + p_edad >= 40 then 'Media' else 'Baja' end)
  from y
$$;

-- Ficha: mínimo y máximo observados (compra mínima, 30 días hasta el último escaneo), con su hora.
create or replace function _extremos_30d(p_market_id smallint, p_item_id integer) returns jsonb
language sql stable as $$
  with ref as (select max(source_updated_at) as h from snapshots where market_id = p_market_id),
  o as (select p.hour, coalesce(p.min_buyout, p.market_value) as v
          from price_hourly p, ref
         where p.market_id = p_market_id and p.item_id = p_item_id
           and p.hour > ref.h - interval '30 days' and coalesce(p.min_buyout, p.market_value) is not null)
  select case when exists (select 1 from o) then jsonb_build_object(
    'minimo', (select v from o order by v, hour desc limit 1),
    'minimo_hora', (select hour from o order by v, hour desc limit 1),
    'maximo', (select v from o order by v desc, hour desc limit 1),
    'maximo_hora', (select hour from o order by v desc, hour desc limit 1),
    'observaciones', (select count(*) from o)) end
$$;

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
    'extremos_30d', (select _extremos_30d(m.id, p_item_id) from m),
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
