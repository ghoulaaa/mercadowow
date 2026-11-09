-- =====================================================================
-- 0022 — W3 del plan V4: datos del mapa de materiales (treemap por familias).
--
-- * Variación: SOLO compra mínima contra compra mínima, del mismo mercado, entre el último
--   escaneo y el escaneo con compra mínima más cercano a «último − periodo» (con tolerancia).
--   Si no hay referencia comparable → sin historial (null), nunca un 0 inventado.
-- * Tamaño: la cantidad publicada si la fuente la da (AHledger). Si no (TSM), tamaño uniforme:
--   no se deduce volumen de los anuncios.
-- * Respeta los filtros de la barra lateral que tienen sentido para materiales.
-- =====================================================================

create function mapa_materiales(p_market_key text, p jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable as $$
declare
  v_m       markets%rowtype;
  v_periodo text := coalesce(nullif(p->>'periodo', ''), '24h');
  v_horas   integer;
  v_tol     integer;   -- tolerancia (h) hacia atrás para encontrar la referencia
  v_prof    text := nullif(p->>'profesion', '');
  v_fam     text := nullif(p->>'familia', '');
  v_cal     text := nullif(p->>'calidad', '');
  v_ofertas boolean := coalesce((p->>'solo_ofertas')::boolean, false);
  v_hay_cantidad boolean;
  v_res     jsonb;
begin
  select * into v_m from markets where key = p_market_key;
  if not found then raise exception 'Mercado % no registrado', p_market_key; end if;
  select h, t into v_horas, v_tol from (values ('24h', 24, 6), ('3d', 72, 12), ('7d', 168, 24)) x(k, h, t)
   where x.k = v_periodo;
  if v_horas is null then raise exception 'Periodo no válido: % (24h, 3d o 7d)', v_periodo; end if;
  if v_prof is not null and not (v_prof = any (_profesiones_todas())) then raise exception 'Profesión desconocida: %', v_prof; end if;
  if v_fam is not null and not (v_fam = any (_familias())) then raise exception 'Familia desconocida: %', v_fam; end if;
  v_hay_cantidad := exists (select 1 from metricas x where x.proveedor = v_m.provider and x.columna = 'quantity');

  with ult as (
    select date_trunc('hour', max(s.source_updated_at), 'UTC') as hora, max(s.source_updated_at) as escaneo
      from snapshots s where s.market_id = v_m.id
  ),
  mats as (
    select distinct rm.item_id from recipe_materials rm join recipes r using (game_type, spell_id)
     where rm.game_type = v_m.game_type and (v_prof is null or r.profesion = v_prof)
  ),
  base as (
    select c.item_id, c.nombre, c.calidad, c.icono_url, _familia(c.clase, c.subclase) as familia
      from mats join catalogo c on c.game_type = v_m.game_type and c.item_id = mats.item_id
     where not v_m.is_demo and (v_cal is null or c.calidad = v_cal)
  ),
  datos as (
    select b.*, a.hour as hora, a.min_buyout as precio, a.quantity as cantidad,
           r.hour as hora_ref, r.min_buyout as precio_ref,
           case when a.hour >= u.hora then 'con_ofertas'
                when exists (select 1 from price_hourly x where x.market_id = v_m.id and x.item_id = b.item_id) then 'sin_ofertas'
                else 'sin_datos' end as estado
      from base b cross join ult u
      left join lateral (select x.hour, x.min_buyout, x.quantity from price_hourly x
                          where x.market_id = v_m.id and x.item_id = b.item_id and x.min_buyout is not null
                          order by x.hour desc limit 1) a on true
      left join lateral (select x.hour, x.min_buyout from price_hourly x
                          where x.market_id = v_m.id and x.item_id = b.item_id and x.min_buyout is not null
                            and x.hour <= u.hora - make_interval(hours => v_horas)
                            and x.hour >= u.hora - make_interval(hours => v_horas + v_tol)
                          order by x.hour desc limit 1) r on a.hour >= u.hora
     where (v_fam is null or b.familia = v_fam)
  ),
  fin as (
    select d.*, case when d.estado = 'con_ofertas' and d.precio_ref > 0
                     then round((d.precio - d.precio_ref) * 100.0 / d.precio_ref, 1) end as variacion
      from datos d
     where not v_ofertas or d.estado = 'con_ofertas'
  )
  select jsonb_build_object(
    'mercado', v_m.key,
    'periodo', v_periodo,
    'horas', v_horas,
    'escaneo', (select escaneo from ult),
    'tamano', case when v_hay_cantidad then 'cantidad' else 'uniforme' end,
    'total', (select count(*) from fin),
    'con_variacion', (select count(*) from fin where variacion is not null),
    'familias', coalesce((select jsonb_agg(jsonb_build_object('familia', g.familia, 'objetos', g.objetos)
                                           order by array_position(_familias(), g.familia))
      from (select familia, jsonb_agg(jsonb_build_object(
              'id', item_id, 'nombre', nombre, 'calidad', calidad, 'icono', icono_url, 'estado', estado,
              'precio', case when estado = 'con_ofertas' then precio end,
              'precio_ref', case when variacion is not null then precio_ref end,
              'hora_ref', case when variacion is not null then hora_ref end,
              'hora', hora, 'variacion', variacion,
              'cantidad', case when estado = 'con_ofertas' then cantidad end)
              order by coalesce(case when v_hay_cantidad and estado = 'con_ofertas' then cantidad end, 0) desc, nombre) as objetos
              from fin group by familia) g), '[]'::jsonb)
  ) into v_res;
  return v_res;
end $$;

revoke execute on all functions in schema public from public, anon, authenticated;
