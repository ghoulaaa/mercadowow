-- =====================================================================
-- 0001 — Esquema base (Postgres estándar, sin extensiones de Supabase)
--
-- Reglas:
--   * Precios en COBRE, enteros bigint (1 oro = 10 000 cobre).
--   * Toda tabla de datos lleva market_id: ningún precio existe sin mercado.
--   * Horas en timestamptz (UTC).
-- Nunca editar esta migración una vez aplicada: añadir otra nueva.
-- =====================================================================

create table markets (
  id          smallint generated always as identity primary key,
  key         text not null unique,          -- tsm:forever:us:pvp-horde
  provider    text not null,                 -- tsm | demo | csv
  game_type   text not null,                 -- forever
  region      text not null,                 -- us
  slug        text not null,                 -- pvp-horde
  label       text not null,
  is_demo     boolean not null default false,
  source_url  text,                          -- null = sin descarga automática
  constraint demo_sin_fuente check (not is_demo or source_url is null)
);

insert into markets (key, provider, game_type, region, slug, label, is_demo, source_url) values
  ('tsm:forever:us:pvp-horde', 'tsm', 'forever', 'us', 'pvp-horde',
   'WoW Forever · US · PvP · Horda', false,
   'https://public-data.tradeskillmaster.com/forever/us/realm/pvp-horde/items.csv'),
  ('demo:forever:us:demo', 'demo', 'forever', 'us', 'demo',
   'DEMO · DATOS FICTICIOS', true, null);

create table settings (
  key   text primary key,
  value text not null
);

insert into settings (key, value) values
  ('intervalo_minutos', '60'),        -- espera tras una consulta correcta
  ('cooldown_manual_minutos', '5'),   -- protección del botón manual
  ('turno_segundos', '300'),          -- caducidad de la reserva anti-duplicados
  ('reintento_base_minutos', '5');    -- 5, 10, 20, 40… hasta intervalo_minutos

create table items (
  market_id       smallint not null references markets(id),
  item_id         integer not null,
  name            text not null,
  category        text,
  icon_url        text,
  vendor_price    bigint check (vendor_price >= 0),
  metadata_source text,
  updated_at      timestamptz not null default now(),
  primary key (market_id, item_id)
);

-- Una fila por cada versión NUEVA del archivo de origen (no por cada consulta).
create table snapshots (
  id                   bigint generated always as identity primary key,
  market_id            smallint not null references markets(id),
  source_etag          text,
  source_last_modified text,
  source_updated_at    timestamptz not null,   -- hora del escaneo original
  fetched_at           timestamptz not null default now(),
  row_count            integer not null,
  unique (market_id, source_updated_at)
);

create table price_hourly (
  market_id    smallint not null references markets(id),
  item_id      integer not null,
  hour         timestamptz not null,            -- hora UTC truncada
  market_value bigint check (market_value >= 0),
  min_buyout   bigint check (min_buyout >= 0),
  recent       bigint check (recent >= 0),
  historical   bigint check (historical >= 0),
  snapshot_id  bigint not null references snapshots(id) on delete cascade,
  primary key (market_id, item_id, hour)
);
create index price_hourly_market_hour on price_hourly (market_id, hour);

create table price_daily (
  market_id         smallint not null references markets(id),
  item_id           integer not null,
  day               date not null,
  market_value_med  bigint,
  min_buyout_med    bigint,
  min_buyout_min    bigint,
  min_buyout_max    bigint,
  samples           integer not null,
  primary key (market_id, item_id, day)
);

-- Estado de la descarga por mercado: caché HTTP, reintentos y reserva anti-duplicados.
create table fetch_state (
  market_id              smallint primary key references markets(id),
  etag                   text,
  last_modified          text,
  last_source_updated_at timestamptz,
  last_attempt_at        timestamptz,
  last_success_at        timestamptz,
  last_new_data_at       timestamptz,
  last_error             text,
  last_error_at          timestamptz,
  consecutive_failures   integer not null default 0,
  next_attempt_at        timestamptz not null default '-infinity',  -- toca ya
  lease_run_id           uuid,
  lease_expires_at       timestamptz,
  manual_requested_at    timestamptz
);

insert into fetch_state (market_id) select id from markets where source_url is not null;

create table fetch_log (
  id            bigint generated always as identity primary key,
  market_id     smallint not null references markets(id),
  run_id        uuid,
  started_at    timestamptz,
  finished_at   timestamptz not null default now(),
  status        text not null check (status in ('nuevo_dato', 'sin_cambios', 'no_modificado', 'error')),
  http_status   integer,
  rows_received integer,
  message       text
);
create index fetch_log_market_time on fetch_log (market_id, finished_at desc);

create table inventory (
  id         bigint generated always as identity primary key,
  market_id  smallint not null references markets(id),
  item_id    integer not null,
  quantity   integer not null check (quantity > 0),
  unit_cost  bigint check (unit_cost >= 0),    -- null = coste desconocido
  note       text,
  created_at timestamptz not null default now()
);

create table favorites (
  market_id smallint not null references markets(id),
  item_id   integer not null,
  primary key (market_id, item_id)
);

create table sales (
  id           bigint generated always as identity primary key,
  market_id    smallint not null references markets(id),
  item_id      integer not null,
  quantity     integer not null check (quantity > 0),
  unit_price   bigint not null check (unit_price >= 0),
  sold_at      timestamptz not null,
  fee_paid     bigint check (fee_paid >= 0),
  deposit_lost bigint check (deposit_lost >= 0),
  note         text
);

create table recommendation_log (
  market_id      smallint not null references markets(id),
  item_id        integer not null,
  day            date not null,
  recommendation text not null check (recommendation in ('VENDER', 'GUARDAR', 'OBSERVACION')),
  confidence     integer not null check (confidence between 0 and 100),
  price          bigint,
  explanation    text not null,
  primary key (market_id, item_id, day)
);

-- ---------------------------------------------------------------------
-- Funciones de la actualización. Las llama la Edge Function (y el botón
-- manual). Reciben p_now para poder probarlas con horas simuladas.
-- ---------------------------------------------------------------------

create function ajuste_entero(p_key text, p_default integer) returns integer
language sql stable as $$
  select coalesce((select value::integer from settings where key = p_key), p_default)
$$;

-- Intenta reservar el turno de descarga. Solo una ejecución a la vez y solo si toca.
create function tomar_turno(p_market_key text, p_run_id uuid, p_now timestamptz default now())
returns jsonb language plpgsql as $$
declare
  v_market markets%rowtype;
  v_state  fetch_state%rowtype;
begin
  select * into v_market from markets where key = p_market_key;
  if not found then
    raise exception 'Mercado desconocido: %', p_market_key;
  end if;
  if v_market.source_url is null then
    return jsonb_build_object('ok', false, 'motivo', 'mercado_sin_fuente');
  end if;

  -- UPDATE condicional: si dos ejecuciones llegan a la vez, la segunda espera el
  -- bloqueo de fila, reevalúa el WHERE y ya no encuentra el turno libre.
  update fetch_state s
     set lease_run_id     = p_run_id,
         lease_expires_at = p_now + make_interval(secs => ajuste_entero('turno_segundos', 300)),
         last_attempt_at  = p_now
   where s.market_id = v_market.id
     and (s.lease_expires_at is null or s.lease_expires_at <= p_now)
     and s.next_attempt_at <= p_now
  returning * into v_state;

  if not found then
    select * into v_state from fetch_state where market_id = v_market.id;
    return jsonb_build_object(
      'ok', false,
      'motivo', case when v_state.lease_expires_at > p_now then 'en_curso' else 'no_toca' end,
      'proxima', v_state.next_attempt_at);
  end if;

  return jsonb_build_object(
    'ok', true,
    'url', v_market.source_url,
    'etag', v_state.etag,
    'last_modified', v_state.last_modified);
end $$;

-- Comprueba que el turno sigue siendo de esta ejecución y bloquea la fila de estado.
create function _turno_valido(p_market_key text, p_run_id uuid)
returns fetch_state language plpgsql as $$
declare
  v_state fetch_state%rowtype;
begin
  select s.* into v_state
    from fetch_state s join markets m on m.id = s.market_id
   where m.key = p_market_key and s.lease_run_id = p_run_id
   for update of s;
  if not found then
    raise exception 'El turno % ya no es válido para %', p_run_id, p_market_key;
  end if;
  return v_state;
end $$;

create function registrar_snapshot(
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
    -- Cambió el ETag pero el escaneo original es el mismo: NO es un precio nuevo.
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
     order by r.item_id
    on conflict (market_id, item_id) do update
       set name = excluded.name, updated_at = excluded.updated_at
     where items.name is distinct from excluded.name;

    insert into price_hourly (market_id, item_id, hour, market_value, min_buyout, recent, historical, snapshot_id)
    select distinct on (r.item_id)
           v_state.market_id, r.item_id, date_trunc('hour', p_source_updated_at, 'UTC'),
           r.market_value, r.min_buyout, r.recent, r.historical, v_snapshot_id
      from jsonb_to_recordset(p_rows)
           as r(item_id integer, market_value bigint, min_buyout bigint, recent bigint, historical bigint)
     order by r.item_id
    on conflict (market_id, item_id, hour) do update
       set market_value = excluded.market_value,
           min_buyout   = excluded.min_buyout,
           recent       = excluded.recent,
           historical   = excluded.historical,
           snapshot_id  = excluded.snapshot_id;

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

create function registrar_no_modificado(
  p_market_key text, p_run_id uuid, p_now timestamptz default now()
) returns jsonb language plpgsql as $$
declare
  v_state fetch_state%rowtype := _turno_valido(p_market_key, p_run_id);
begin
  update fetch_state
     set last_success_at      = p_now,
         consecutive_failures = 0,
         next_attempt_at      = p_now + make_interval(mins => ajuste_entero('intervalo_minutos', 60)),
         lease_run_id         = null,
         lease_expires_at     = null
   where market_id = v_state.market_id;

  insert into fetch_log (market_id, run_id, started_at, finished_at, status, http_status)
  values (v_state.market_id, p_run_id, v_state.last_attempt_at, p_now, 'no_modificado', 304);

  return jsonb_build_object('estado', 'no_modificado');
end $$;

-- Fallo: se conserva el último dato válido y se reintenta con espera creciente.
create function registrar_fallo(
  p_market_key          text,
  p_run_id              uuid,
  p_http_status         integer,
  p_message             text,
  p_retry_after_seconds integer default null,
  p_now                 timestamptz default now()
) returns jsonb language plpgsql as $$
declare
  v_state    fetch_state%rowtype := _turno_valido(p_market_key, p_run_id);
  v_failures integer := v_state.consecutive_failures + 1;
  v_wait     interval;
begin
  v_wait := make_interval(mins => least(
              ajuste_entero('intervalo_minutos', 60),
              ajuste_entero('reintento_base_minutos', 5) * (2 ^ least(v_failures - 1, 10))::integer));
  if p_retry_after_seconds is not null then
    v_wait := greatest(v_wait, make_interval(secs => p_retry_after_seconds));
  end if;

  update fetch_state
     set last_error           = left(p_message, 1000),
         last_error_at        = p_now,
         consecutive_failures = v_failures,
         next_attempt_at      = p_now + v_wait,
         lease_run_id         = null,
         lease_expires_at     = null
   where market_id = v_state.market_id;

  insert into fetch_log (market_id, run_id, started_at, finished_at, status, http_status, message)
  values (v_state.market_id, p_run_id, v_state.last_attempt_at, p_now, 'error', p_http_status, left(p_message, 1000));

  return jsonb_build_object('estado', 'error', 'fallos_seguidos', v_failures, 'proximo_intento', p_now + v_wait);
end $$;

-- Botón manual: adelanta la próxima consulta, con protección contra pulsaciones repetidas.
create function solicitar_actualizacion(p_market_key text, p_now timestamptz default now())
returns jsonb language plpgsql as $$
declare
  v_state    fetch_state%rowtype;
  v_cooldown interval := make_interval(mins => ajuste_entero('cooldown_manual_minutos', 5));
  v_desde    timestamptz;
begin
  select s.* into v_state
    from fetch_state s join markets m on m.id = s.market_id
   where m.key = p_market_key
   for update of s;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'mercado_sin_fuente');
  end if;

  if v_state.lease_expires_at > p_now then
    return jsonb_build_object('ok', false, 'motivo', 'en_curso');
  end if;

  v_desde := greatest(v_state.last_attempt_at, v_state.manual_requested_at);
  if v_desde is not null and v_desde + v_cooldown > p_now then
    return jsonb_build_object('ok', false, 'motivo', 'espera',
      'segundos', ceil(extract(epoch from (v_desde + v_cooldown - p_now)))::integer);
  end if;

  update fetch_state
     set next_attempt_at = p_now, manual_requested_at = p_now
   where market_id = v_state.market_id;
  return jsonb_build_object('ok', true);
end $$;
