-- =====================================================================
-- 0004 — Datos de demostración y importación CSV, sin mezclar mercados.
--
--   * Nuevo mercado «importación manual» (provider csv) para el plan B.
--   * snapshots.origen: quién creó cada versión (tsm | csv | demo). Un trigger
--     impide guardar una versión con un origen distinto al de su mercado.
--   * price_hourly ↔ snapshots con clave compuesta (snapshot, mercado): la BD
--     rechaza cualquier precio cuyo mercado no coincida con el de su versión.
--   * importar_precios(): solo en mercados csv.
--   * generar_demo(): solo en mercados demo, con objetos [FICTICIO].
-- =====================================================================

insert into markets (key, provider, game_type, region, slug, label, is_demo, source_url) values
  ('csv:forever:us:pvp-horde', 'csv', 'forever', 'us', 'pvp-horde',
   'WoW Forever · US · PvP · Horda · importación manual', false, null)
on conflict (key) do nothing;

-- ---------- origen de cada versión ----------
alter table snapshots add column origen text;
alter table snapshots add column nombre_archivo text;
update snapshots s set origen = m.provider from markets m where m.id = s.market_id;
alter table snapshots alter column origen set not null;
alter table snapshots add constraint snapshots_origen_valido check (origen in ('tsm', 'csv', 'demo'));

create function _snapshot_origen_coherente() returns trigger language plpgsql as $$
declare
  v_provider text := (select provider from markets where id = new.market_id);
begin
  if new.origen is null then
    new.origen := v_provider;           -- registrar_snapshot (0001) no lo indica: se deduce
  elsif new.origen is distinct from v_provider then
    raise exception 'Origen % no corresponde al mercado % (%).', new.origen, new.market_id, v_provider;
  end if;
  return new;
end $$;

create trigger snapshots_origen_coherente
  before insert or update on snapshots
  for each row execute function _snapshot_origen_coherente();

-- ---------- precio y versión siempre del mismo mercado ----------
alter table snapshots add constraint snapshots_id_mercado unique (id, market_id);
alter table price_hourly drop constraint price_hourly_snapshot_id_fkey;
alter table price_hourly add constraint price_hourly_misma_version_mismo_mercado
  foreign key (snapshot_id, market_id) references snapshots (id, market_id) on delete cascade;

-- ---------- guardado común de una versión ----------
create function _guardar_version(
  p_market_id         smallint,
  p_origen            text,
  p_source_updated_at timestamptz,
  p_rows              jsonb,
  p_now               timestamptz,
  p_nombre_archivo    text default null
) returns jsonb language plpgsql as $$
declare
  v_count       integer := jsonb_array_length(p_rows);
  v_ultima      timestamptz;
  v_snapshot_id bigint;
begin
  if v_count = 0 then
    raise exception 'El archivo no tiene filas';
  end if;
  if exists (select 1 from jsonb_to_recordset(p_rows) as r(item_id integer, name text)
              where r.item_id is null or r.item_id <= 0 or coalesce(btrim(r.name), '') = '') then
    raise exception 'Hay filas sin itemId válido o sin nombre';
  end if;

  if exists (select 1 from snapshots where market_id = p_market_id and source_updated_at = p_source_updated_at) then
    return jsonb_build_object('estado', 'sin_cambios', 'filas', v_count,
                              'mensaje', 'Ya existe una versión con esa misma hora del dato');
  end if;
  select max(source_updated_at) into v_ultima from snapshots where market_id = p_market_id;
  if v_ultima is not null and p_source_updated_at < v_ultima then
    return jsonb_build_object('estado', 'sin_cambios', 'filas', v_count,
                              'mensaje', 'La hora del dato es anterior a la última versión guardada');
  end if;

  insert into snapshots (market_id, origen, source_updated_at, fetched_at, row_count, nombre_archivo)
  values (p_market_id, p_origen, p_source_updated_at, p_now, v_count, p_nombre_archivo)
  returning id into v_snapshot_id;

  insert into items (market_id, item_id, name, updated_at)
  select distinct on (r.item_id) p_market_id, r.item_id, btrim(r.name), p_now
    from jsonb_to_recordset(p_rows) as r(item_id integer, name text)
   order by r.item_id
  on conflict (market_id, item_id) do update
     set name = excluded.name, updated_at = excluded.updated_at
   where items.name is distinct from excluded.name;

  insert into price_hourly (market_id, item_id, hour, market_value, min_buyout, recent, historical, snapshot_id)
  select distinct on (r.item_id)
         p_market_id, r.item_id, date_trunc('hour', p_source_updated_at, 'UTC'),
         r.market_value, r.min_buyout, r.recent, r.historical, v_snapshot_id
    from jsonb_to_recordset(p_rows)
         as r(item_id integer, market_value bigint, min_buyout bigint, recent bigint, historical bigint)
   order by r.item_id
  on conflict (market_id, item_id, hour) do update
     set market_value = excluded.market_value, min_buyout = excluded.min_buyout,
         recent = excluded.recent, historical = excluded.historical,
         snapshot_id = excluded.snapshot_id;

  return jsonb_build_object('estado', 'nuevo_dato', 'filas', v_count, 'snapshot_id', v_snapshot_id);
end $$;

-- ---------- importación CSV (plan B) ----------
create function importar_precios(
  p_market_key        text,
  p_source_updated_at timestamptz,
  p_rows              jsonb,
  p_nombre_archivo    text,
  p_now               timestamptz default now()
) returns jsonb language plpgsql as $$
declare
  v_market    markets%rowtype;
  v_resultado jsonb;
begin
  select * into v_market from markets where key = p_market_key;
  if not found then
    raise exception 'Mercado desconocido: %', p_market_key;
  end if;
  if v_market.provider <> 'csv' then
    raise exception 'Solo se puede importar en un mercado de importación manual (no en %)', p_market_key;
  end if;
  if p_source_updated_at is null or p_source_updated_at > p_now + interval '10 minutes' then
    raise exception 'La hora del dato falta o está en el futuro';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 20000 then
    raise exception 'Se esperaba una lista de como máximo 20 000 filas';
  end if;

  v_resultado := _guardar_version(v_market.id, 'csv', p_source_updated_at, p_rows, p_now, left(p_nombre_archivo, 200));

  insert into fetch_log (market_id, started_at, finished_at, status, rows_received, message)
  values (v_market.id, p_now, p_now, v_resultado->>'estado', (v_resultado->>'filas')::integer,
          left('Importación CSV: ' || coalesce(p_nombre_archivo, 'sin nombre')
               || coalesce(' · ' || (v_resultado->>'mensaje'), ''), 1000));
  return v_resultado;
end $$;

-- ---------- datos de demostración (FICTICIOS) ----------
-- Perfiles pensados para probar el motor de recomendaciones más adelante.
create function generar_demo(p_dias integer default 30, p_now timestamptz default now())
returns jsonb language plpgsql as $$
declare
  v_market_id smallint;
  v_fin       timestamptz := date_trunc('hour', p_now, 'UTC');
  v_inicio    timestamptz;
  v_filas     integer;
begin
  select id into v_market_id from markets where key = 'demo:forever:us:demo' and is_demo;
  if v_market_id is null then
    raise exception 'No existe el mercado demo';
  end if;
  if p_dias not between 1 and 60 then
    raise exception 'p_dias debe estar entre 1 y 60';
  end if;
  v_inicio := v_fin - make_interval(days => p_dias) + interval '1 hour';

  -- Borra SOLO datos del mercado demo.
  delete from snapshots where market_id = v_market_id;   -- arrastra price_hourly (cascade)
  delete from price_daily where market_id = v_market_id;
  delete from items where market_id = v_market_id;
  delete from fetch_log where market_id = v_market_id;

  drop table if exists _demo_items;
  create temporary table _demo_items (
    item_id integer, name text, category text, base bigint, perfil text, vol numeric
  ) on commit drop;
  insert into _demo_items values
    (900001, '[FICTICIO] Hierba de prueba',          'Hierbas',       1500,    'estable',     0.04),
    (900002, '[FICTICIO] Hierba escasa',             'Hierbas',       9000,    'escaso',      0.10),
    (900003, '[FICTICIO] Mineral común',             'Minerales',     800,     'estable',     0.03),
    (900004, '[FICTICIO] Mineral en alza',           'Minerales',     4000,    'alcista',     0.05),
    (900005, '[FICTICIO] Barra en caída',            'Minerales',     12000,   'bajista',     0.05),
    (900006, '[FICTICIO] Cuero de ejemplo',          'Cuero',         2500,    'deprimido',   0.06),
    (900007, '[FICTICIO] Tela volátil',              'Tela',          3000,    'volatil',     0.25),
    (900008, '[FICTICIO] Tela estable',              'Tela',          600,     'estable',     0.02),
    (900009, '[FICTICIO] Poción con pico',           'Consumibles',   7000,    'pico',        0.05),
    (900010, '[FICTICIO] Elixir de prueba',          'Consumibles',   15000,   'ciclico',     0.05),
    (900011, '[FICTICIO] Encantamiento raro',        'Encantamiento', 450000,  'escaso',      0.12),
    (900012, '[FICTICIO] Polvo mágico',              'Encantamiento', 5000,    'deprimido',   0.05),
    (900013, '[FICTICIO] Arma épica imaginaria',     'Equipo',        2500000, 'volatil',     0.30),
    (900014, '[FICTICIO] Anillo de pruebas',         'Equipo',        80000,   'bajista',     0.08),
    (900015, '[FICTICIO] Receta inventada',          'Recetas',       35000,   'alcista',     0.06),
    (900016, '[FICTICIO] Gema de ejemplo',           'Gemas',         60000,   'pico',        0.07);

  insert into items (market_id, item_id, name, category, metadata_source, updated_at)
  select v_market_id, item_id, name, category, 'demo', p_now from _demo_items;

  insert into snapshots (market_id, origen, source_updated_at, fetched_at, row_count, nombre_archivo)
  select v_market_id, 'demo', h, h, (select count(*) from _demo_items), 'generar_demo()'
    from generate_series(v_inicio, v_fin, interval '1 hour') as h;

  -- Precio = base × tendencia × ciclo diario × perfil × ruido determinista (sin aleatoriedad real).
  insert into price_hourly (market_id, item_id, hour, market_value, min_buyout, recent, historical, snapshot_id)
  select v_market_id, x.item_id, x.h,
         greatest(1, round(x.ref))::bigint,
         greatest(1, round(x.ref * (1 + x.vol * x.ruido)))::bigint,
         greatest(1, round(x.ref * (1 + x.vol * x.ruido)))::bigint,
         x.base,
         s.id
    from (
      select i.item_id, i.base, i.vol, g.h,
             ((abs(hashtext(i.item_id || '@' || g.h::text)) % 2001) - 1000) / 1000.0 as ruido,
             abs(hashtext('falta' || i.item_id || '@' || g.h::text)) % 100 as dado,
             i.perfil,
             i.base
             * (1 + 0.04 * sin(2 * pi() * extract(hour from g.h at time zone 'UTC') / 24))
             * case i.perfil
                 when 'alcista'   then 1 + 0.6 * g.t
                 when 'bajista'   then 1 - 0.45 * g.t
                 when 'ciclico'   then 1 + 0.25 * sin(2 * pi() * g.dias / 7)
                 when 'pico'      then case when g.dias_restantes < 2 then 1.7 else 1 end
                 when 'deprimido' then case when g.dias_restantes < 3 then 0.65
                                            else 1 + 0.30 * sin(2 * pi() * g.dias / 9) end
                 else 1
               end as ref
        from _demo_items i
        cross join lateral (
          select h,
                 extract(epoch from (h - v_inicio)) / extract(epoch from (v_fin - v_inicio + interval '1 hour')) as t,
                 extract(epoch from (h - v_inicio)) / 86400.0 as dias,
                 extract(epoch from (v_fin - h)) / 86400.0 as dias_restantes
            from generate_series(v_inicio, v_fin, interval '1 hour') as h
        ) g
    ) x
    join snapshots s on s.market_id = v_market_id and s.source_updated_at = x.h
   where not (x.perfil = 'escaso' and x.dado >= 35);    -- los escasos solo aparecen ~35 % de las horas

  get diagnostics v_filas = row_count;
  update snapshots s
     set row_count = (select count(*) from price_hourly p where p.snapshot_id = s.id)
   where s.market_id = v_market_id;

  insert into fetch_log (market_id, started_at, finished_at, status, rows_received, message)
  values (v_market_id, p_now, p_now, 'nuevo_dato', v_filas,
          format('Datos FICTICIOS generados: %s días, %s objetos', p_dias, (select count(*) from items where market_id = v_market_id)));

  return jsonb_build_object('estado', 'nuevo_dato', 'dias', p_dias, 'filas', v_filas,
                            'objetos', (select count(*) from items where market_id = v_market_id));
end $$;

-- ---------- estado y lista de mercados para la interfaz ----------
create or replace function estado_mercado(p_market_key text) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'hora_servidor', now(),
    'mercado', jsonb_build_object(
      'clave', m.key, 'nombre', m.label, 'proveedor', upper(m.provider),
      'ficticio', m.is_demo, 'fuente', m.source_url,
      'automatico', m.source_url is not null),
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

create function listar_mercados() returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'clave', key, 'nombre', label, 'proveedor', provider, 'ficticio', is_demo,
           'automatico', source_url is not null) order by is_demo, provider desc), '[]'::jsonb)
    from markets
$$;

revoke execute on function _guardar_version(smallint, text, timestamptz, jsonb, timestamptz, text) from public, anon, authenticated;
revoke execute on function importar_precios(text, timestamptz, jsonb, text, timestamptz) from public, anon, authenticated;
revoke execute on function generar_demo(integer, timestamptz) from public, anon, authenticated;
revoke execute on function listar_mercados() from public, anon, authenticated;
revoke execute on function estado_mercado(text) from public, anon, authenticated;
revoke execute on function _snapshot_origen_coherente() from public, anon, authenticated;
