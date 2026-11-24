-- =====================================================================
-- 0045 — MercadoWoW Crafting Sniper: avisos a Discord de oportunidades de fabricación.
--
-- El análisis lo hace la Edge Function (tarea «sniper») con el MISMO motor que la página (app/static,
-- copiado con npm run motor). Aquí: la configuración, los webhooks (la URL, cifrada en Supabase Vault y
-- nunca devuelta a la página), el historial de avisos para no repetirlos, el historial de precios del
-- producto para detectar falsas gangas y un turno para que no haya dos análisis a la vez.
-- Solo análisis y avisos: nada compra, vende ni actúa en el juego.
-- =====================================================================

create table sniper_config (
  id                  smallint primary key default 1 check (id = 1),
  activo              boolean not null default false,
  market_key          text not null default 'tsm:forever:us:pvp-horde',
  roi_min             numeric not null default 30 check (roi_min between -100 and 100000),
  neta_min            bigint not null default 10000 check (neta_min between 0 and 10000000000),
  score_min           integer not null default 60 check (score_min between 0 and 100),
  riesgo_max          text not null default 'medio' check (riesgo_max in ('bajo', 'medio', 'alto')),
  profesiones         text[] not null default '{}',
  incluir             integer[] not null default '{}',
  excluir             integer[] not null default '{}',
  intervalo_min       integer not null default 30 check (intervalo_min between 5 and 1440),
  espera_repetir_min  integer not null default 360 check (espera_repetir_min between 10 and 43200),
  mejora_pct          numeric not null default 20 check (mejora_pct between 1 and 1000),
  bajada_coste_pct    numeric not null default 15 check (bajada_coste_pct between 1 and 99),
  edad_max_min        integer not null default 180 check (edad_max_min between 15 and 2880),
  comision_pct        numeric not null default 5 check (comision_pct between 0 and 50),
  recorte_pct         numeric not null default 5 check (recorte_pct between 0 and 50),
  max_por_ronda       integer not null default 10 check (max_por_ronda between 1 and 25),
  umbrales            jsonb not null default '{"rentable": 15, "ganga": 30, "epica": 60, "legendaria": 100, "excepcional": 200}',
  mencion_rol         text check (mencion_rol is null or mencion_rol ~ '^[0-9]{5,25}$'),
  mencion_desde       text not null default 'excepcional'
                      check (mencion_desde in ('rentable', 'ganga', 'epica', 'legendaria', 'excepcional')),
  sitio_url           text not null default 'https://mercadowow.vercel.app' check (sitio_url ~ '^https://[A-Za-z0-9.-]+(/.*)?$'),
  ultimo_analisis     timestamptz,
  ultimo_escaneo      timestamptz,
  ultimo_resultado    jsonb,
  turno_hasta         timestamptz not null default '-infinity',
  actualizado         timestamptz not null default now()
);
insert into sniper_config default values;

-- Webhooks. La URL va cifrada en Vault (secreto_id); si la base no tiene Vault (pruebas locales), en claro
-- en una columna que nadie más que el propietario puede leer. A la página solo llega la pista.
create table sniper_webhooks (
  id            serial primary key,
  nombre        text not null check (length(btrim(nombre)) between 1 and 60),
  secreto_id    uuid,
  secreto_plano text,
  pista         text not null,
  profesiones   text[] not null default '{}',   -- vacío = todas
  activo        boolean not null default true,
  creado        timestamptz not null default now(),
  check (secreto_id is not null or secreto_plano is not null)
);

-- Un aviso enviado (o intentado). clave = mercado|receta.
create table sniper_avisos (
  id          bigserial primary key,
  clave       text not null,
  market_key  text not null,
  spell       integer,
  item_id     integer,
  webhook_id  integer references sniper_webhooks(id) on delete set null,
  tipo        text not null check (tipo in ('auto', 'manual', 'prueba')),
  estado      text not null check (estado in ('enviado', 'error', 'omitido')),
  motivo      text,
  clase       text,
  score       integer,
  neta        bigint,
  coste       bigint,
  roi         numeric,
  datos       jsonb,
  error       text,
  enviado     timestamptz not null default now()
);
create index sniper_avisos_clave on sniper_avisos (clave, enviado desc);
create index sniper_avisos_fecha on sniper_avisos (enviado desc);

-- Oportunidades vigentes en el último análisis (para saber cuándo una desaparece y vuelve).
create table sniper_vigentes (
  clave   text primary key,
  visto   timestamptz not null
);

alter table sniper_config enable row level security;
alter table sniper_webhooks enable row level security;
alter table sniper_avisos enable row level security;
alter table sniper_vigentes enable row level security;
revoke all on sniper_config, sniper_webhooks, sniper_avisos, sniper_vigentes from anon, authenticated;

-- ---------- secretos: Vault si existe ----------
create function _sniper_hay_vault() returns boolean language sql stable as $$
  select exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'vault' and p.proname = 'create_secret')
$$;

/** Valida una URL de webhook de Discord (solo dominios de Discord y la forma /api/webhooks/ID/TOKEN). */
create function _sniper_url_valida(p_url text) returns boolean language sql immutable as $$
  select p_url ~ '^https://(discord\.com|discordapp\.com|ptb\.discord\.com|canary\.discord\.com)/api/webhooks/[0-9]{15,25}/[A-Za-z0-9_-]{50,100}$'
$$;

/** «discord.com/api/webhooks/1234…5678/••••»: lo único que se muestra de la URL. */
create function _sniper_pista(p_url text) returns text language sql immutable as $$
  select 'discord.com/api/webhooks/' || left(m[1], 4) || '…' || right(m[1], 4) || '/••••'
    from regexp_match(p_url, '/api/webhooks/([0-9]+)/') m
$$;

create function _sniper_guardar_secreto(p_url text, p_nombre text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not _sniper_hay_vault() then return null; end if;
  execute 'select vault.create_secret($1, $2, $3)' into v_id
    using p_url, p_nombre || '_' || replace(gen_random_uuid()::text, '-', ''), 'Webhook de Discord de MercadoWoW Crafting Sniper';
  return v_id;
end $$;

create function _sniper_borrar_secreto(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_id is null or not _sniper_hay_vault() then return; end if;
  execute 'delete from vault.secrets where id = $1' using p_id;
end $$;

/** URL en claro de un webhook. Solo la usa la Edge Function (servidor); nunca se expone por la API. */
create function sniper_webhook_url(p_id integer) returns text
language plpgsql security definer set search_path = public as $$
declare w sniper_webhooks%rowtype; v text;
begin
  select * into w from sniper_webhooks where id = p_id;
  if not found then return null; end if;
  if w.secreto_id is not null and _sniper_hay_vault() then
    execute 'select decrypted_secret from vault.decrypted_secrets where id = $1' into v using w.secreto_id;
    return v;
  end if;
  return w.secreto_plano;
end $$;

-- ---------- configuración y webhooks (los cambia la página por /api/sniper) ----------
/** Lo que ve la página: configuración, webhooks sin URL, último análisis e historial reciente. */
create function sniper_estado() returns jsonb language sql stable as $$
  select jsonb_build_object(
    'config', (select to_jsonb(c) - 'turno_hasta' from sniper_config c where id = 1),
    'webhooks', coalesce((select jsonb_agg(jsonb_build_object('id', w.id, 'nombre', w.nombre, 'pista', w.pista,
                    'profesiones', w.profesiones, 'activo', w.activo, 'creado', w.creado,
                    'cifrado', w.secreto_id is not null) order by w.id) from sniper_webhooks w), '[]'::jsonb),
    'vault', _sniper_hay_vault(),
    'mercados', coalesce((select jsonb_agg(jsonb_build_object('key', m.key, 'nombre', m.label, 'proveedor', m.provider) order by m.key)
                            from markets m where not m.is_demo), '[]'::jsonb),
    'avisos', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'spell', a.spell, 'item_id', a.item_id, 'tipo', a.tipo,
                    'estado', a.estado, 'motivo', a.motivo, 'clase', a.clase, 'score', a.score, 'neta', a.neta,
                    'roi', a.roi, 'error', a.error, 'enviado', a.enviado,
                    'webhook', (select w.nombre from sniper_webhooks w where w.id = a.webhook_id),
                    'nombre', a.datos->>'nombre', 'icono', a.datos->>'icono') order by a.enviado desc)
                  from (select * from sniper_avisos order by enviado desc limit 100) a), '[]'::jsonb)
  )
$$;

create function _sniper_textos(p jsonb, p_clave text) returns text[] language sql immutable as $$
  select case when p ? p_clave then coalesce((select array_agg(distinct btrim(t)) from jsonb_array_elements_text(p->p_clave) t
                                             where btrim(t) <> '' and length(t) <= 40), '{}') end
$$;
create function _sniper_ids(p jsonb, p_clave text) returns integer[] language plpgsql immutable as $$
declare r integer[];
begin
  if not p ? p_clave then return null; end if;
  if jsonb_typeof(p->p_clave) <> 'array' or jsonb_array_length(p->p_clave) > 500 then
    raise exception 'La lista «%» no es válida (como mucho 500 IDs)', p_clave;
  end if;
  select coalesce(array_agg(distinct (v #>> '{}')::integer), '{}') into r from jsonb_array_elements(p->p_clave) v
   where (v #>> '{}') ~ '^[0-9]{1,9}$' and (v #>> '{}')::integer > 0;
  return r;
end $$;

/**
 * Acciones de la página: {accion: "config", cambios: {...}} | {accion: "webhook_alta", nombre, url, profesiones}
 * | {accion: "webhook_editar", id, nombre?, profesiones?, activo?} | {accion: "webhook_borrar", id}.
 * Los errores de validación salen como excepción (la API los devuelve como 422).
 */
create function gestionar_sniper(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c jsonb; v_id integer; v_url text; v_sec uuid; w sniper_webhooks%rowtype;
begin
  case p->>'accion'
  when 'config' then
    c := coalesce(p->'cambios', '{}'::jsonb);
    if jsonb_typeof(c) <> 'object' then raise exception 'Cambios no válidos'; end if;
    if c ? 'umbrales' then
      if jsonb_typeof(c->'umbrales') <> 'object' then raise exception 'Umbrales no válidos'; end if;
      if not ((c->'umbrales'->>'rentable')::numeric < (c->'umbrales'->>'ganga')::numeric
              and (c->'umbrales'->>'ganga')::numeric < (c->'umbrales'->>'epica')::numeric
              and (c->'umbrales'->>'epica')::numeric < (c->'umbrales'->>'legendaria')::numeric
              and (c->'umbrales'->>'legendaria')::numeric < (c->'umbrales'->>'excepcional')::numeric
              and (c->'umbrales'->>'rentable')::numeric > 0) then
        raise exception 'Los umbrales de ROI deben ir de menor a mayor y empezar por encima de 0 %%';
      end if;
    end if;
    if c ? 'market_key' and not exists (select 1 from markets where key = c->>'market_key' and not is_demo) then
      raise exception 'Mercado desconocido';
    end if;
    update sniper_config set
      activo = coalesce((c->>'activo')::boolean, activo),
      market_key = coalesce(c->>'market_key', market_key),
      roi_min = coalesce((c->>'roi_min')::numeric, roi_min),
      neta_min = coalesce((c->>'neta_min')::bigint, neta_min),
      score_min = coalesce((c->>'score_min')::integer, score_min),
      riesgo_max = coalesce(c->>'riesgo_max', riesgo_max),
      profesiones = coalesce(_sniper_textos(c, 'profesiones'), profesiones),
      incluir = coalesce(_sniper_ids(c, 'incluir'), incluir),
      excluir = coalesce(_sniper_ids(c, 'excluir'), excluir),
      intervalo_min = coalesce((c->>'intervalo_min')::integer, intervalo_min),
      espera_repetir_min = coalesce((c->>'espera_repetir_min')::integer, espera_repetir_min),
      mejora_pct = coalesce((c->>'mejora_pct')::numeric, mejora_pct),
      bajada_coste_pct = coalesce((c->>'bajada_coste_pct')::numeric, bajada_coste_pct),
      edad_max_min = coalesce((c->>'edad_max_min')::integer, edad_max_min),
      comision_pct = coalesce((c->>'comision_pct')::numeric, comision_pct),
      recorte_pct = coalesce((c->>'recorte_pct')::numeric, recorte_pct),
      max_por_ronda = coalesce((c->>'max_por_ronda')::integer, max_por_ronda),
      umbrales = coalesce(c->'umbrales', umbrales),
      mencion_rol = case when c ? 'mencion_rol' then nullif(btrim(c->>'mencion_rol'), '') else mencion_rol end,
      mencion_desde = coalesce(c->>'mencion_desde', mencion_desde),
      sitio_url = coalesce(nullif(btrim(c->>'sitio_url'), ''), sitio_url),
      actualizado = now()
     where id = 1;
  when 'webhook_alta' then
    v_url := btrim(coalesce(p->>'url', ''));
    if not _sniper_url_valida(v_url) then
      raise exception 'La URL no es un webhook de Discord (https://discord.com/api/webhooks/…)';
    end if;
    if (select count(*) from sniper_webhooks) >= 10 then raise exception 'Como mucho 10 webhooks'; end if;
    v_sec := _sniper_guardar_secreto(v_url, 'sniper_webhook');
    insert into sniper_webhooks (nombre, secreto_id, secreto_plano, pista, profesiones)
    values (left(btrim(coalesce(nullif(p->>'nombre', ''), 'Discord')), 60), v_sec,
            case when v_sec is null then v_url end, _sniper_pista(v_url),
            coalesce(_sniper_textos(p, 'profesiones'), '{}'))
    returning id into v_id;
  when 'webhook_editar' then
    update sniper_webhooks set
      nombre = coalesce(left(nullif(btrim(p->>'nombre'), ''), 60), nombre),
      profesiones = coalesce(_sniper_textos(p, 'profesiones'), profesiones),
      activo = coalesce((p->>'activo')::boolean, activo)
     where id = (p->>'id')::integer;
    if not found then raise exception 'Webhook desconocido'; end if;
  when 'webhook_borrar' then
    delete from sniper_webhooks where id = (p->>'id')::integer returning * into w;
    if not found then raise exception 'Webhook desconocido'; end if;
    perform _sniper_borrar_secreto(w.secreto_id);
  else
    raise exception 'Acción desconocida';
  end case;
  return sniper_estado();
exception
  when invalid_text_representation or numeric_value_out_of_range or check_violation or datatype_mismatch then
    raise exception 'Valor no válido en la configuración: %', sqlerrm;
end $$;

-- ---------- para la Edge Function ----------
/**
 * Medianas de la compra mínima del producto en las últimas 24 h, 7 y 30 días (y cuántos escaneos hay),
 * más el enlace a Wowhead del catálogo. Solo de los IDs pedidos (candidatos), para no recorrer todo.
 */
create function sniper_historial(p_market_key text, p_ids integer[], p_now timestamptz default now())
returns jsonb language sql stable as $$
  with m as (select id, game_type from markets where key = p_market_key),
  p as (
    select ph.item_id, ph.hour, ph.min_buyout from price_hourly ph, m
     where ph.market_id = m.id and ph.item_id = any (p_ids) and ph.min_buyout is not null
       and ph.hour > p_now - interval '30 days')
  select coalesce(jsonb_object_agg(x.item_id::text, jsonb_strip_nulls(jsonb_build_object(
           'm24', x.m24, 'm7', x.m7, 'm30', x.m30, 'n7', x.n7, 'n30', x.n30, 'wh', x.wh))), '{}'::jsonb)
    from (
      select i.item_id,
             (select round(percentile_cont(0.5) within group (order by min_buyout))::bigint from p where p.item_id = i.item_id and p.hour > p_now - interval '24 hours') as m24,
             (select round(percentile_cont(0.5) within group (order by min_buyout))::bigint from p where p.item_id = i.item_id and p.hour > p_now - interval '7 days') as m7,
             (select round(percentile_cont(0.5) within group (order by min_buyout))::bigint from p where p.item_id = i.item_id) as m30,
             (select count(*) from p where p.item_id = i.item_id and p.hour > p_now - interval '7 days') as n7,
             (select count(*) from p where p.item_id = i.item_id) as n30,
             (select c.wowhead_url from catalogo c, m where c.game_type = m.game_type and c.item_id = i.item_id) as wh
        from unnest(p_ids) as i(item_id)) x
$$;

/** Último aviso enviado de cada clave pedida, y si desapareció desde entonces. */
create function sniper_previos(p_claves text[]) returns jsonb language sql stable as $$
  select coalesce(jsonb_object_agg(a.clave, jsonb_build_object('enviado', a.enviado, 'neta', a.neta, 'coste', a.coste,
           'clase', a.clase, 'desaparecida', not exists (select 1 from sniper_vigentes v where v.clave = a.clave))), '{}'::jsonb)
    from (select distinct on (clave) * from sniper_avisos
           where clave = any (p_claves) and estado = 'enviado' and tipo = 'auto'
           order by clave, enviado desc) a
$$;

/** Guarda lo enviado (o el error) de una ronda y las oportunidades vigentes. */
create function sniper_registrar(p_avisos jsonb, p_vigentes text[], p_resultado jsonb, p_escaneo timestamptz,
                                 p_now timestamptz default now()) returns void
language plpgsql as $$
begin
  insert into sniper_avisos (clave, market_key, spell, item_id, webhook_id, tipo, estado, motivo, clase, score, neta, coste, roi, datos, error, enviado)
  select x->>'clave', x->>'market_key', (x->>'spell')::integer, (x->>'item_id')::integer, (x->>'webhook_id')::integer,
         x->>'tipo', x->>'estado', left(x->>'motivo', 200), x->>'clase', (x->>'score')::integer, (x->>'neta')::bigint,
         (x->>'coste')::bigint, (x->>'roi')::numeric, x->'datos', left(x->>'error', 500), p_now
    from jsonb_array_elements(coalesce(p_avisos, '[]'::jsonb)) x;
  if p_vigentes is not null then
    delete from sniper_vigentes v where not (v.clave = any (p_vigentes));
    insert into sniper_vigentes (clave, visto) select unnest(p_vigentes), p_now
      on conflict (clave) do update set visto = excluded.visto;
  end if;
  -- Solo un análisis cambia «último análisis» (una prueba o un envío manual no).
  if p_resultado is not null then
    update sniper_config set ultimo_analisis = p_now, ultimo_escaneo = coalesce(p_escaneo, ultimo_escaneo),
                             ultimo_resultado = p_resultado where id = 1;
  end if;
  -- El historial no crece sin límite: se conservan 90 días.
  delete from sniper_avisos where enviado < p_now - interval '90 days';
end $$;

create function sniper_tomar_turno(p_segundos integer default 240, p_now timestamptz default now())
returns boolean language sql as $$
  with t as (update sniper_config set turno_hasta = p_now + make_interval(secs => p_segundos)
              where id = 1 and turno_hasta <= p_now returning 1)
  select exists (select 1 from t)
$$;
create function sniper_soltar_turno() returns void language sql as $$
  update sniper_config set turno_hasta = '-infinity' where id = 1
$$;

/** ¿Toca analizar? Activo, con algún webhook activo, sin otro análisis en curso, y escaneo nuevo o intervalo cumplido. */
create function sniper_toca(p_now timestamptz default now()) returns boolean language sql stable as $$
  select c.activo
     and exists (select 1 from sniper_webhooks w where w.activo)
     and c.turno_hasta <= p_now
     and (c.ultimo_analisis is null
          or c.ultimo_analisis <= p_now - make_interval(mins => c.intervalo_min)
          or coalesce((select max(s.source_updated_at) from snapshots s join markets m on m.id = s.market_id
                        where m.key = c.market_key), '-infinity') > coalesce(c.ultimo_escaneo, '-infinity'))
    from sniper_config c where c.id = 1
$$;

revoke all on function _sniper_hay_vault(), _sniper_url_valida(text), _sniper_pista(text), _sniper_guardar_secreto(text, text),
  _sniper_borrar_secreto(uuid), sniper_webhook_url(integer), sniper_estado(), _sniper_textos(jsonb, text), _sniper_ids(jsonb, text),
  gestionar_sniper(jsonb), sniper_historial(text, integer[], timestamptz), sniper_previos(text[]),
  sniper_registrar(jsonb, text[], jsonb, timestamptz, timestamptz), sniper_tomar_turno(integer, timestamptz),
  sniper_soltar_turno(), sniper_toca(timestamptz) from public, anon, authenticated;
