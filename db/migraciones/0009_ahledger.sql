-- =====================================================================
-- 0009 — Proveedor AHledger (R1).
--
-- * Mercado nuevo «ahledger:forever:us:pvp-horde», separado de TSM, CSV y DEMO.
-- * Precios con mediana, cantidad publicada y ventas estimadas por día
--   (estimación de AHledger: un escaneo no distingue venta de cancelación).
-- * Metadatos del catálogo: calidad, clase, nivel e icono oficial.
-- * AHledger exige citar «Prices from AHledger» con enlace donde se muestren sus datos.
-- =====================================================================

alter table snapshots drop constraint snapshots_origen_valido;
alter table snapshots add constraint snapshots_origen_valido check (origen in ('tsm', 'csv', 'demo', 'ahledger'));

alter table markets add column ruleset text;
alter table markets add column faction text;
alter table markets add column atribucion_texto text;
alter table markets add column atribucion_url text;
update markets set ruleset = 'pvp', faction = 'horde' where slug = 'pvp-horde';
update markets set label = 'WoW Forever · US · PvP · Horda (TSM)' where key = 'tsm:forever:us:pvp-horde';
update markets set label = 'WoW Forever · US · PvP · Horda (importación manual)' where key = 'csv:forever:us:pvp-horde';

insert into markets (key, provider, game_type, region, slug, label, is_demo, source_url, ruleset, faction,
                     atribucion_texto, atribucion_url)
values ('ahledger:forever:us:pvp-horde', 'ahledger', 'forever', 'us', 'pvp-horde',
        'WoW Forever · US · PvP · Horda (AHledger)', false,
        'https://api.ahledger.com/v1/pricetable/forever.pvp.horde.us', 'pvp', 'horde',
        'Prices from AHledger', 'https://ahledger.com')
on conflict (key) do nothing;

insert into fetch_state (market_id)
select id from markets where key = 'ahledger:forever:us:pvp-horde'
on conflict do nothing;

-- Catálogo: metadatos reales del objeto (vacíos si la fuente no los da).
alter table items add column quality text;
alter table items add column item_class text;
alter table items add column item_subclass text;
alter table items add column level integer;
alter table items add column required_level integer;

-- Precios: campos que TSM no publica y AHledger sí.
alter table price_hourly add column median bigint check (median >= 0);
alter table price_hourly add column quantity integer check (quantity >= 0);
alter table price_hourly add column auctions integer check (auctions >= 0);
alter table price_hourly add column sales_per_day numeric check (sales_per_day >= 0);

-- Mismo comportamiento que 0001 (turno, duplicados, versión antigua) + columnas nuevas.
create or replace function registrar_snapshot(
  p_market_key        text,
  p_run_id            uuid,
  p_etag              text,
  p_last_modified     text,
  p_source_updated_at timestamptz,
  p_rows              jsonb,
  p_now               timestamptz default now()
) returns jsonb language plpgsql as $$
declare
  v_state       fetch_state%rowtype := _turno_valido(p_market_key, p_run_id);
  v_snapshot_id bigint;
  v_count       integer := jsonb_array_length(p_rows);
  v_status      text;
  v_message     text;
begin
  if v_count = 0 then
    raise exception 'Archivo sin filas: no se registra nada';
  end if;

  if exists (select 1 from snapshots
              where market_id = v_state.market_id and source_updated_at = p_source_updated_at) then
    v_status  := 'sin_cambios';
    v_message := 'Mismo escaneo original que una versión ya guardada';
  elsif v_state.last_source_updated_at is not null
        and p_source_updated_at < v_state.last_source_updated_at then
    v_status  := 'sin_cambios';
    v_message := 'El archivo es más antiguo que el último guardado; se ignora';
  else
    insert into snapshots (market_id, source_etag, source_last_modified, source_updated_at, fetched_at, row_count)
    values (v_state.market_id, p_etag, p_last_modified, p_source_updated_at, p_now, v_count)
    returning id into v_snapshot_id;

    insert into items (market_id, item_id, name, updated_at)
    select distinct on (r.item_id) v_state.market_id, r.item_id, r.name, p_now
      from jsonb_to_recordset(p_rows) as r(item_id integer, name text)
     where r.name is not null
     order by r.item_id
    on conflict (market_id, item_id) do update
       set name = excluded.name, updated_at = excluded.updated_at
     where items.name is distinct from excluded.name;

    insert into price_hourly (market_id, item_id, hour, market_value, min_buyout, recent, historical,
                              median, quantity, auctions, sales_per_day, snapshot_id)
    select distinct on (r.item_id)
           v_state.market_id, r.item_id, date_trunc('hour', p_source_updated_at, 'UTC'),
           r.market_value, r.min_buyout, r.recent, r.historical,
           r.median, r.quantity, r.auctions, r.sales_per_day, v_snapshot_id
      from jsonb_to_recordset(p_rows)
           as r(item_id integer, market_value bigint, min_buyout bigint, recent bigint, historical bigint,
                median bigint, quantity integer, auctions integer, sales_per_day numeric)
     where exists (select 1 from items i where i.market_id = v_state.market_id and i.item_id = r.item_id)
     order by r.item_id
    on conflict (market_id, item_id, hour) do update
       set market_value = excluded.market_value, min_buyout = excluded.min_buyout,
           recent = excluded.recent, historical = excluded.historical,
           median = excluded.median, quantity = excluded.quantity,
           auctions = excluded.auctions, sales_per_day = excluded.sales_per_day,
           snapshot_id = excluded.snapshot_id;

    v_status := 'nuevo_dato';
  end if;

  update fetch_state
     set etag                   = p_etag,
         last_modified          = p_last_modified,
         last_source_updated_at = greatest(last_source_updated_at, p_source_updated_at),
         last_success_at        = p_now,
         last_new_data_at       = case when v_status = 'nuevo_dato' then p_now else last_new_data_at end,
         consecutive_failures   = 0,
         next_attempt_at        = p_now + make_interval(mins => ajuste_entero('intervalo_minutos', 60)),
         lease_run_id           = null,
         lease_expires_at       = null
   where market_id = v_state.market_id;

  insert into fetch_log (market_id, run_id, started_at, finished_at, status, http_status, rows_received, message)
  values (v_state.market_id, p_run_id, v_state.last_attempt_at, p_now, v_status, 200, v_count, v_message);

  return jsonb_build_object('estado', v_status, 'filas', v_count, 'snapshot_id', v_snapshot_id);
end $$;

-- Nombres e información de los objetos (de /v1/tooltip o /v1/items). Idempotente.
create function guardar_metadatos(p_market_key text, p_items jsonb, p_now timestamptz default now())
returns integer language plpgsql as $$
declare v_mid smallint := _mercado_id(p_market_key); v_n integer;
begin
  insert into items (market_id, item_id, name, quality, item_class, item_subclass, level, required_level,
                     vendor_price, icon_url, category, metadata_source, updated_at)
  select distinct on (r.item_id) v_mid, r.item_id, r.name, r.quality, r.item_class, r.item_subclass, r.level,
         r.required_level, r.vendor_price,
         -- Solo iconos del CDN oficial de Blizzard (lo único que la página puede mostrar); otro → sin icono.
         case when r.icon_url like 'https://render.worldofwarcraft.com/%' then r.icon_url end,
         r.item_class, coalesce(r.fuente, 'ahledger'), p_now
    from jsonb_to_recordset(p_items) as r(item_id integer, name text, quality text, item_class text,
                                           item_subclass text, level integer, required_level integer,
                                           vendor_price bigint, icon_url text, fuente text)
   where r.item_id > 0 and coalesce(btrim(r.name), '') <> ''
   order by r.item_id
  on conflict (market_id, item_id) do update
     set name = excluded.name,
         quality = coalesce(excluded.quality, items.quality),
         item_class = coalesce(excluded.item_class, items.item_class),
         item_subclass = coalesce(excluded.item_subclass, items.item_subclass),
         level = coalesce(excluded.level, items.level),
         required_level = coalesce(excluded.required_level, items.required_level),
         vendor_price = coalesce(excluded.vendor_price, items.vendor_price),
         icon_url = coalesce(excluded.icon_url, items.icon_url),
         category = coalesce(excluded.category, items.category),
         metadata_source = excluded.metadata_source,
         updated_at = excluded.updated_at;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- IDs de la lista que todavía no tienen nombre real en este mercado.
create function objetos_sin_metadatos(p_market_key text, p_ids integer[]) returns integer[]
language sql stable as $$
  select coalesce(array_agg(x order by x), '{}')
    from unnest(p_ids) as x
   where not exists (select 1 from items i join markets m on m.id = i.market_id
                      where m.key = p_market_key and i.item_id = x
                        and i.metadata_source is not null and i.metadata_source <> 'pendiente')
$$;

create or replace function listar_mercados() returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'clave', key, 'nombre', label, 'proveedor', provider, 'ficticio', is_demo,
           'automatico', source_url is not null)
         order by is_demo, case provider when 'ahledger' then 0 when 'tsm' then 1 when 'csv' then 2 else 3 end), '[]'::jsonb)
    from markets
$$;

create or replace function estado_mercado(p_market_key text) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'hora_servidor', now(),
    'mercado', jsonb_build_object(
      'clave', m.key, 'nombre', m.label, 'proveedor', upper(m.provider),
      'ficticio', m.is_demo, 'fuente', m.source_url,
      'automatico', m.source_url is not null,
      'atribucion', case when m.atribucion_texto is not null
                         then jsonb_build_object('texto', m.atribucion_texto, 'url', m.atribucion_url) end),
    'actualizacion', jsonb_build_object(
      'configurada',         m.source_url is not null and exists (select 1 from settings where key = 'url_funcion'),
      'en_curso',            coalesce(s.lease_expires_at > now(), false),
      'hora_dato_original',  coalesce(s.last_source_updated_at,
                                      (select max(source_updated_at) from snapshots x where x.market_id = m.id)),
      'ultima_consulta_ok',  s.last_success_at,
      'ultimo_dato_nuevo',   coalesce(s.last_new_data_at,
                                      (select max(fetched_at) from snapshots x where x.market_id = m.id)),
      'ultimo_intento',      s.last_attempt_at,
      'proxima',             case when isfinite(s.next_attempt_at) then s.next_attempt_at end,
      'fallos_seguidos',     coalesce(s.consecutive_failures, 0),
      'ultimo_error',        s.last_error,
      'ultimo_error_hora',   s.last_error_at,
      'versiones_guardadas', (select count(*) from snapshots x where x.market_id = m.id),
      'objetos',             (select count(*) from items i where i.market_id = m.id)),
    'registro', coalesce((
      select jsonb_agg(r order by r.hora desc)
        from (select l.finished_at as hora, l.status as estado, l.http_status as http,
                     l.rows_received as filas, l.message as mensaje
                from fetch_log l
               where l.market_id = m.id
               order by l.finished_at desc
               limit 8) r), '[]'::jsonb))
  from markets m
  left join fetch_state s on s.market_id = m.id
  where m.key = p_market_key
$$;

-- Tabla de precios con los campos nuevos (cantidad, mediana, ventas estimadas, calidad).
create or replace function tabla_precios(p_market_key text) returns jsonb
language sql stable as $$
  with m as (
    select id from markets where key = p_market_key
  ),
  ultima as (
    select max(s.source_updated_at) as hora from snapshots s, m where s.market_id = m.id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id',        i.item_id,
           'nombre',    i.name,
           'categoria', i.category,
           'subcategoria', i.item_subclass,
           'calidad',   i.quality,
           'nivel_objeto', i.level,
           'icono',     i.icon_url,
           'favorito',  f.item_id is not null,
           'hora',      ult.hour,
           'ausente',   ult.hour < date_trunc('hour', (select hora from ultima), 'UTC'),
           'precio',    ult.min_buyout,
           'valor_mercado', ult.market_value,
           'mediana',   ult.median,
           'cantidad',  ult.quantity,
           'subastas',  ult.auctions,
           'ventas_dia', ult.sales_per_day,
           'historico', ult.historical,
           'reciente',  ult.recent,
           'precio_24h', h24.precio, 'hora_24h', h24.hour,
           'precio_7d',  d7.precio,  'hora_7d',  d7.hour,
           'med7',      (r.cifras->>'med7')::numeric,
           'med30',     (r.cifras->>'med30')::numeric,
           'neto',      round(coalesce(ult.min_buyout, ult.market_value) * (1 - ajuste_num('motor.comision_pct', 5) / 100)),
           'rec',       l->>'rec',
           'resumen',   l->>'resumen',
           'puntos',    (l->>'puntos')::integer,
           'nivel',     l->>'nivel'      -- nivel de CONFIANZA (Media/Baja), como hasta ahora
         ) order by i.name), '[]'::jsonb)
    from m
    join items i on i.market_id = m.id
    left join favorites f on f.market_id = m.id and f.item_id = i.item_id
    left join recomendaciones r on r.market_id = m.id and r.item_id = i.item_id
    cross join lateral (
      select p.hour, p.min_buyout, p.market_value, p.historical, p.recent,
             p.median, p.quantity, p.auctions, p.sales_per_day
        from price_hourly p
       where p.market_id = m.id and p.item_id = i.item_id
       order by p.hour desc
       limit 1
    ) ult
    left join lateral (
      select p.hour, coalesce(p.min_buyout, p.market_value) as precio
        from price_hourly p
       where p.market_id = m.id and p.item_id = i.item_id
         and p.hour <= ult.hour - interval '24 hours'
         and p.hour >= ult.hour - interval '30 hours'
       order by p.hour desc
       limit 1
    ) h24 on true
    left join lateral (
      select p.hour, coalesce(p.min_buyout, p.market_value) as precio
        from price_hourly p
       where p.market_id = m.id and p.item_id = i.item_id
         and p.hour <= ult.hour - interval '7 days'
         and p.hour >= ult.hour - interval '7 days 12 hours'
       order by p.hour desc
       limit 1
    ) d7 on true
    left join lateral (
      select case when r.item_id is null then null
                  else _rec_al_leer(r.recomendacion, r.resumen, r.puntos_base, (select hora from ultima), now()) end as l
    ) lectura on true
$$;

revoke execute on all functions in schema public from public, anon, authenticated;
