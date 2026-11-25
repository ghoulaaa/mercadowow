-- =====================================================================
-- 0049 — Informe diario del mercado (MercadoWoW · Market Intelligence).
--
-- Cada día, a la hora configurada (en la zona configurada), la Edge Function ({"tarea": "informe"}) calcula
-- un informe con las últimas 24 h de la casa de subastas frente a las 24 h anteriores, lo dibuja como PNG
-- y lo envía a los webhooks de Discord elegidos (los mismos del Crafting Sniper: la URL sigue cifrada en
-- Vault). Aquí: configuración, historial de informes (los datos, no la imagen: se vuelve a dibujar si hace
-- falta), los cálculos pesados (informe_base) y la tarea programada.
--
-- Integridad: solo datos reales. Las horas con un escaneo incompleto (menos del 90 % de los objetos
-- habituales o menos del 60 % de las unidades habituales) no se usan. Las ventas y el oro movido son la
-- estimación de ventas/día del proveedor (un escaneo no distingue una venta de una cancelación).
-- Solo análisis y avisos: nada compra, vende ni actúa en el juego.
-- =====================================================================

create table informe_config (
  id               smallint primary key default 1 check (id = 1),
  activo           boolean not null default false,
  market_key       text not null,
  hora             smallint not null default 9 check (hora between 0 and 23),
  zona             text not null default 'UTC',
  webhooks         integer[] not null default '{}',            -- vacío = todos los webhooks activos
  secciones        jsonb not null default '{}',                -- {"gangas": false} oculta una sección
  gangas_desc_min  numeric not null default 30 check (gangas_desc_min between 5 and 95),
  craft_roi_min    numeric not null default 20 check (craft_roi_min between 0 and 100000),
  neta_min         bigint not null default 10000 check (neta_min between 0 and 10000000000),
  liquidez_min     numeric not null default 0.5 check (liquidez_min between 0 and 10000),
  por_seccion      smallint not null default 5 check (por_seccion between 3 and 5),
  nombre           text not null default 'MercadoWoW | Market Intelligence'
                   check (length(btrim(nombre)) between 1 and 80 and nombre !~* '(discord|clyde)'),
  avatar           text check (avatar is null or avatar ~ '^https://[A-Za-z0-9.-]+/[^\s"<>]{1,400}$'),
  turno_hasta      timestamptz not null default '-infinity',
  actualizado      timestamptz not null default now()
);
-- Por defecto, el mercado con escaneos cada hora (AHledger) si existe.
insert into informe_config (market_key)
select coalesce((select key from markets where provider = 'ahledger' and not is_demo order by id limit 1),
                (select key from markets where not is_demo order by id limit 1), 'tsm:forever:us:pvp-horde');

create table informes (
  id          bigserial primary key,
  market_key  text not null,
  fecha       date not null,                 -- día del informe en la zona configurada
  desde       timestamptz not null,
  hasta       timestamptz not null,
  tipo        text not null check (tipo in ('auto', 'manual', 'vista')),
  estado      text not null check (estado in ('generado', 'enviado', 'parcial', 'error')),
  datos       jsonb,
  enviados    integer not null default 0,
  error       text,
  creado      timestamptz not null default now()
);
create index informes_creado on informes (creado desc);
create index informes_auto on informes (market_key, fecha) where tipo = 'auto';

alter table informe_config enable row level security;
alter table informes enable row level security;
revoke all on informe_config, informes from anon, authenticated;

insert into settings (key, value) values ('informe_ultima_solicitud', '-infinity') on conflict (key) do nothing;

/** Categoría del informe a partir de la clase y subclase del catálogo (null = solo «Mercado general»). */
create function _informe_categoria(p_clase text, p_subclase text, p_nombre text) returns text
language sql immutable as $$
  select case
    when p_clase = 'Miscellaneous' and p_subclase in ('Pet', 'Mount') then 'mascotas'
    when p_clase = 'Recipe' then 'recetas'
    when p_clase = 'Trade Goods' and p_subclase = 'Enchanting' then 'encantamiento'
    when p_clase = 'Consumable' then 'consumibles'
    when p_clase = 'Trade Goods' and p_subclase = 'Herb' then 'hierbas'
    when p_clase = 'Trade Goods' and p_subclase = 'Metal & Stone' and p_nombre ~* '\mbar$' then 'barras'
    when p_clase = 'Trade Goods' and p_subclase = 'Metal & Stone' then 'minerales'
    when p_clase = 'Trade Goods' and p_subclase = 'Cloth' then 'telas'
    when p_clase = 'Trade Goods' and p_subclase = 'Leather' then 'cueros'
    when p_clase in ('Armor', 'Weapon') then 'equipo'
  end
$$;

/**
 * Datos del informe: 48 h hasta p_hasta (las 24 h del informe y las 24 anteriores).
 *   serie: [[ms, unidades publicadas, objetos, válida], …] por hora con escaneo (nada se rellena).
 *   objetos: [[id, mediana 24 h, mediana 24 h anteriores, escaneos 24 h, escaneos antes, cantidad mediana 24 h,
 *              cantidad mediana antes, compra mínima ahora, cantidad ahora, ventas/día ahora, ventas/día antes,
 *              mediana 30 días del proveedor, venta al NPC, categoría], …] — precios por UNIDAD, en cobre.
 * Solo se usan las horas válidas (escaneo completo).
 */
create function informe_base(p_market_key text, p_hasta timestamptz default now()) returns jsonb
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
                                  _informe_categoria(c.clase, c.subclase, c.nombre))), '[]'::jsonb)
                  from est e join ult u using (item_id) left join ant a using (item_id)
                  left join catalogo c on c.game_type = v_m.game_type and c.item_id = e.item_id)
  ) into r;
  return r;
end $$;

/** Mediana de la compra mínima de los últimos 7 días de unos objetos (referencia de las gangas): {id: cobre}. */
create function informe_ref7(p_market_key text, p_ids integer[], p_hasta timestamptz default now()) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_object_agg(item_id, med), '{}'::jsonb) from (
    select ph.item_id, round(percentile_cont(0.5) within group (order by ph.min_buyout)) as med
      from price_hourly ph join markets m on m.id = ph.market_id
     where m.key = p_market_key and ph.item_id = any(p_ids) and ph.min_buyout is not null
       and ph.hour > p_hasta - interval '7 days' and ph.hour <= p_hasta
     group by ph.item_id having count(*) >= 12) t
$$;

/** Nombre (en español si se conoce), icono y calidad de unos objetos: {id: {n, i, q}}. */
create function informe_objetos(p_juego text, p_ids integer[]) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_object_agg(c.item_id, jsonb_build_object('n', coalesce(nullif(c.nombre_es, ''), c.nombre),
                                                                 'i', c.icono_url, 'q', c.calidad)), '{}'::jsonb)
    from catalogo c where c.game_type = p_juego and c.item_id = any(p_ids)
$$;

/** Siguiente informe automático (null si están desactivados). */
create function _informe_proximo(c informe_config) returns timestamptz language sql stable as $$
  select case when c.activo then
    case when not exists (select 1 from informes i where i.market_key = c.market_key and i.tipo = 'auto'
                            and i.fecha = (now() at time zone c.zona)::date and i.estado in ('enviado', 'parcial'))
              and (date_trunc('day', now() at time zone c.zona) + make_interval(hours => c.hora)) at time zone c.zona <= now()
         then now()
         else (date_trunc('day', now() at time zone c.zona) + make_interval(hours => c.hora)
               + case when (date_trunc('day', now() at time zone c.zona) + make_interval(hours => c.hora)) at time zone c.zona <= now()
                      then interval '1 day' else interval '0' end) at time zone c.zona
    end end
$$;

/** Lo que ve la página: configuración, webhooks (sin URL), mercados, próximo envío e historial. */
create function informe_estado() returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'config', (select to_jsonb(c) - 'turno_hasta' from informe_config c where id = 1),
    'proximo', (select _informe_proximo(c) from informe_config c where id = 1),
    'webhooks', coalesce((select jsonb_agg(jsonb_build_object('id', w.id, 'nombre', w.nombre, 'pista', w.pista, 'activo', w.activo) order by w.id)
                            from sniper_webhooks w), '[]'::jsonb),
    'mercados', coalesce((select jsonb_agg(jsonb_build_object('key', m.key, 'nombre', m.label, 'proveedor', m.provider) order by m.id)
                            from markets m where not m.is_demo), '[]'::jsonb),
    'sitio_url', (select sitio_url from sniper_config where id = 1),
    'historial', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'fecha', i.fecha, 'tipo', i.tipo, 'estado', i.estado,
                              'enviados', i.enviados, 'error', i.error, 'creado', i.creado, 'market_key', i.market_key) order by i.creado desc)
                            from (select * from informes order by creado desc limit 30) i), '[]'::jsonb),
    'ultimo', (select jsonb_build_object('id', i.id, 'datos', i.datos) from informes i where i.datos is not null order by i.creado desc limit 1)
  )
$$;

/** Datos guardados de un informe (vista previa y PNG). */
create function informe_datos(p_id bigint) returns jsonb language sql stable security definer set search_path = public as $$
  select datos from informes where id = p_id
$$;

/** Cambios de la página: {accion: "config", cambios: {...}}. Errores de validación como excepción (422). */
create function gestionar_informe(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c jsonb := coalesce(p->'cambios', '{}'::jsonb); k text; v jsonb;
begin
  if p->>'accion' <> 'config' then raise exception 'Acción desconocida'; end if;
  if jsonb_typeof(c) <> 'object' then raise exception 'Cambios no válidos'; end if;
  if c ? 'market_key' and not exists (select 1 from markets where key = c->>'market_key' and not is_demo) then
    raise exception 'Mercado desconocido';
  end if;
  if c ? 'zona' and not exists (select 1 from pg_timezone_names where name = c->>'zona') then
    raise exception 'Zona horaria desconocida';
  end if;
  if c ? 'webhooks' then
    if jsonb_typeof(c->'webhooks') <> 'array' then raise exception 'Webhooks no válidos'; end if;
    if exists (select 1 from jsonb_array_elements_text(c->'webhooks') t
                where t !~ '^[0-9]{1,9}$' or not exists (select 1 from sniper_webhooks w where w.id = t::integer)) then
      raise exception 'Webhook desconocido';
    end if;
  end if;
  if c ? 'secciones' then
    if jsonb_typeof(c->'secciones') <> 'object' then raise exception 'Secciones no válidas'; end if;
    for k, v in select key, value from jsonb_each(c->'secciones') loop
      if k not in ('kpi', 'grafico', 'volumen', 'comerciados', 'subidas', 'caidas', 'arbitraje', 'gangas', 'crafteos',
                   'categorias', 'destacados') then raise exception 'Sección desconocida: %', k; end if;
      if jsonb_typeof(v) <> 'boolean' then raise exception 'La sección «%» debe ser sí o no', k; end if;
    end loop;
  end if;
  if c ? 'nombre' and (c->>'nombre') ~* '(discord|clyde)' then
    raise exception 'Discord no permite «discord» ni «clyde» en el nombre del webhook';
  end if;
  update informe_config set
    activo = coalesce((c->>'activo')::boolean, activo),
    market_key = coalesce(c->>'market_key', market_key),
    hora = coalesce((c->>'hora')::smallint, hora),
    zona = coalesce(c->>'zona', zona),
    webhooks = case when c ? 'webhooks' then array(select distinct t::integer from jsonb_array_elements_text(c->'webhooks') t) else webhooks end,
    secciones = coalesce(c->'secciones', secciones),
    gangas_desc_min = coalesce((c->>'gangas_desc_min')::numeric, gangas_desc_min),
    craft_roi_min = coalesce((c->>'craft_roi_min')::numeric, craft_roi_min),
    neta_min = coalesce((c->>'neta_min')::bigint, neta_min),
    liquidez_min = coalesce((c->>'liquidez_min')::numeric, liquidez_min),
    por_seccion = coalesce((c->>'por_seccion')::smallint, por_seccion),
    nombre = coalesce(nullif(btrim(c->>'nombre'), ''), nombre),
    avatar = case when c ? 'avatar' then nullif(btrim(c->>'avatar'), '') else avatar end,
    actualizado = now()
   where id = 1;
  return informe_estado();
exception
  when invalid_text_representation or numeric_value_out_of_range or check_violation or datatype_mismatch then
    raise exception 'Valor no válido en la configuración: %', sqlerrm;
end $$;

-- ---------- para la Edge Function ----------
create function informe_tomar_turno(p_segundos integer, p_now timestamptz default now()) returns boolean
language sql security definer set search_path = public as $$
  update informe_config set turno_hasta = p_now + make_interval(secs => p_segundos)
   where id = 1 and turno_hasta <= p_now returning true
$$;
create function informe_soltar_turno() returns void language sql security definer set search_path = public as $$
  update informe_config set turno_hasta = '-infinity' where id = 1
$$;

/** Guarda un informe (y deja solo los 90 más recientes). Devuelve su id. */
create function informe_guardar(p jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  insert into informes (market_key, fecha, desde, hasta, tipo, estado, datos, enviados, error)
  values (p->>'market_key', (p->>'fecha')::date, (p->>'desde')::timestamptz, (p->>'hasta')::timestamptz, p->>'tipo',
          p->>'estado', p->'datos', coalesce((p->>'enviados')::integer, 0), p->>'error')
  returning id into v_id;
  delete from informes where id in (select id from informes order by creado desc offset 90);
  return v_id;
end $$;

create function informe_actualizar(p_id bigint, p_estado text, p_enviados integer, p_error text) returns void
language sql security definer set search_path = public as $$
  update informes set estado = p_estado, enviados = p_enviados, error = p_error where id = p_id
$$;

/**
 * ¿Toca el informe automático? Activo, con webhooks, pasada la hora de hoy (en su zona), sin informe enviado
 * hoy, menos de 3 intentos fallidos o a medias (el último hace más de 20 min) y nadie generándolo.
 */
create function informe_toca(p_now timestamptz default now()) returns boolean
language sql stable security definer set search_path = public as $$
  select c.activo
     and exists (select 1 from sniper_webhooks w where w.activo and (cardinality(c.webhooks) = 0 or w.id = any(c.webhooks)))
     and (date_trunc('day', p_now at time zone c.zona) + make_interval(hours => c.hora)) at time zone c.zona <= p_now
     and not exists (select 1 from informes i where i.market_key = c.market_key and i.tipo = 'auto'
                       and i.fecha = (p_now at time zone c.zona)::date and i.estado in ('enviado', 'parcial'))
     and (select count(*) from informes i where i.market_key = c.market_key and i.tipo = 'auto'
            and i.fecha = (p_now at time zone c.zona)::date and i.estado in ('error', 'generado')) < 3
     and not exists (select 1 from informes i where i.market_key = c.market_key and i.tipo = 'auto'
                       and i.fecha = (p_now at time zone c.zona)::date and i.estado in ('error', 'generado') and i.creado > p_now - interval '20 minutes')
     and c.turno_hasta <= p_now
    from informe_config c where c.id = 1
$$;

revoke all on function _informe_categoria(text, text, text), informe_base(text, timestamptz), informe_ref7(text, integer[], timestamptz),
  informe_objetos(text, integer[]), _informe_proximo(informe_config), informe_estado(), informe_datos(bigint), gestionar_informe(jsonb),
  informe_tomar_turno(integer, timestamptz), informe_soltar_turno(), informe_guardar(jsonb), informe_actualizar(bigint, text, integer, text),
  informe_toca(timestamptz) from public, anon, authenticated;
