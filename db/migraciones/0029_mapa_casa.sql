-- =====================================================================
-- 0029 — X5 del plan V5: mapa de TODA la casa (clase › subclase › objetos).
--
-- Mismas reglas que el mapa de materiales (0022):
-- * Variación: SOLO compra mínima contra compra mínima, del mismo mercado, entre el último escaneo
--   y el escaneo con compra mínima más cercano a «último − periodo» (con tolerancia). Sin referencia
--   comparable → null, nunca un 0 inventado.
-- * Color de un grupo: la MEDIANA de las variaciones de sus objetos que tienen variación.
-- * Tamaño: con cantidades publicadas (AHledger), las unidades; si no (TSM), uniforme para los objetos
--   y «número de objetos» para los grupos. No se deduce volumen de los anuncios.
-- Niveles: sin clase → clases; con clase → subclases; con clase y subclase → objetos (máx. 400).
-- =====================================================================

create function mapa_casa(p_market_key text, p jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable as $$
declare
  v_m       markets%rowtype;
  v_periodo text := coalesce(nullif(p->>'periodo', ''), '24h');
  v_horas   integer;
  v_tol     integer;
  v_clase   text := nullif(p->>'clase', '');
  v_sub     text := nullif(p->>'subclase', '');
  v_cal     text := nullif(p->>'calidad', '');
  v_ofertas boolean := coalesce((p->>'solo_ofertas')::boolean, false);
  v_nivel   text;
  v_hay_cantidad boolean;
  v_max     constant integer := 400;
  v_res     jsonb;
begin
  select * into v_m from markets where key = p_market_key;
  if not found then raise exception 'Mercado % no registrado', p_market_key; end if;
  select h, t into v_horas, v_tol from (values ('24h', 24, 6), ('3d', 72, 12), ('7d', 168, 24)) x(k, h, t)
   where x.k = v_periodo;
  if v_horas is null then raise exception 'Periodo no válido: % (24h, 3d o 7d)', v_periodo; end if;
  if v_sub is not null and v_clase is null then raise exception 'La subclase necesita una clase'; end if;
  v_nivel := case when v_clase is null then 'clases' when v_sub is null then 'subclases' else 'objetos' end;
  v_hay_cantidad := exists (select 1 from metricas x where x.proveedor = v_m.provider and x.columna = 'quantity');

  with ult as (
    select date_trunc('hour', max(s.source_updated_at), 'UTC') as hora, max(s.source_updated_at) as escaneo
      from snapshots s where s.market_id = v_m.id
  ),
  base as (
    select c.item_id, c.nombre, c.calidad, c.icono_url, c.clase, c.subclase
      from catalogo c
     where c.game_type = v_m.game_type and not v_m.is_demo
    union all
    select i.item_id, coalesce(nullif(btrim(i.name), ''), '#' || i.item_id), i.quality, i.icon_url, i.category, i.item_subclass
      from items i
     where i.market_id = v_m.id
       and (v_m.is_demo or not exists (select 1 from catalogo c where c.game_type = v_m.game_type and c.item_id = i.item_id))
  ),
  b2 as (
    select b.*, coalesce(b.clase, 'Sin clasificar') as g_clase, coalesce(b.subclase, 'Sin subclase') as g_sub
      from base b
     where (v_cal is null or b.calidad = v_cal)
  ),
  b3 as (
    select * from b2
     where (v_clase is null or g_clase = v_clase) and (v_sub is null or g_sub = v_sub)
  ),
  datos as (
    select b.*, a.hour as hora, a.min_buyout as precio, a.quantity as cantidad,
           r.hour as hora_ref, r.min_buyout as precio_ref,
           case when a.hour >= u.hora then 'con_ofertas'
                when exists (select 1 from price_hourly x where x.market_id = v_m.id and x.item_id = b.item_id) then 'sin_ofertas'
                else 'sin_datos' end as estado
      from b3 b cross join ult u
      left join lateral (select x.hour, x.min_buyout, x.quantity from price_hourly x
                          where x.market_id = v_m.id and x.item_id = b.item_id and x.min_buyout is not null
                          order by x.hour desc limit 1) a on true
      left join lateral (select x.hour, x.min_buyout from price_hourly x
                          where x.market_id = v_m.id and x.item_id = b.item_id and x.min_buyout is not null
                            and x.hour <= u.hora - make_interval(hours => v_horas)
                            and x.hour >= u.hora - make_interval(hours => v_horas + v_tol)
                          order by x.hour desc limit 1) r on a.hour >= u.hora
  ),
  fin as (
    select d.*, case when d.estado = 'con_ofertas' and d.precio_ref > 0
                     then round((d.precio - d.precio_ref) * 100.0 / d.precio_ref, 1) end as variacion,
           case when v_nivel = 'clases' then d.g_clase else d.g_sub end as grupo
      from datos d
     where not v_ofertas or d.estado = 'con_ofertas'
  ),
  grupos as (
    select grupo, count(*) as n,
           count(*) filter (where estado = 'con_ofertas') as con_ofertas,
           count(variacion) as con_variacion,
           round(percentile_cont(0.5) within group (order by variacion)::numeric, 1) as variacion,
           case when v_hay_cantidad then coalesce(sum(cantidad) filter (where estado = 'con_ofertas'), 0) end as cantidad,
           (array_agg(icono_url order by (estado = 'con_ofertas') desc, item_id) filter (where icono_url is not null))[1] as icono
      from fin group by grupo
  )
  select jsonb_build_object(
    'mercado', v_m.key,
    'ambito', 'casa',
    'nivel', v_nivel,
    'clase', v_clase,
    'subclase', v_sub,
    'periodo', v_periodo,
    'horas', v_horas,
    'escaneo', (select escaneo from ult),
    'tamano', case when v_hay_cantidad then 'cantidad' else 'uniforme' end,
    'total', (select count(*) from fin),
    'con_variacion', (select count(*) from fin where variacion is not null),
    'limite', case when v_nivel = 'objetos' then v_max end,
    'grupos', case when v_nivel <> 'objetos' then coalesce((select jsonb_agg(jsonb_build_object(
        'clave', g.grupo, 'n', g.n, 'con_ofertas', g.con_ofertas, 'con_variacion', g.con_variacion,
        'variacion', g.variacion, 'cantidad', g.cantidad, 'icono', g.icono)
        order by g.grupo in ('Sin clasificar', 'Sin subclase'), coalesce(g.cantidad, g.n) desc, g.grupo)
      from grupos g), '[]'::jsonb) end,
    'objetos', case when v_nivel = 'objetos' then coalesce((select jsonb_agg(jsonb_build_object(
        'id', o.item_id, 'nombre', o.nombre, 'calidad', o.calidad, 'icono', o.icono_url, 'estado', o.estado,
        'precio', case when o.estado = 'con_ofertas' then o.precio end,
        'precio_ref', case when o.variacion is not null then o.precio_ref end,
        'hora_ref', case when o.variacion is not null then o.hora_ref end,
        'hora', o.hora, 'variacion', o.variacion,
        'cantidad', case when o.estado = 'con_ofertas' then o.cantidad end) order by o.orden)
      from (select f.*, row_number() over (order by (f.estado = 'con_ofertas') desc,
                                                    coalesce(case when v_hay_cantidad then f.cantidad end, 0) desc,
                                                    f.nombre, f.item_id) as orden
              from fin f) o
     where o.orden <= v_max), '[]'::jsonb) end
  ) into v_res;
  return v_res;
end $$;

revoke execute on all functions in schema public from public, anon, authenticated;
