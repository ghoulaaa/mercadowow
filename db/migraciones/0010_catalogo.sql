-- =====================================================================
-- 0010 — Catálogo de objetos (R2).
--
-- Un catálogo común por versión del juego (clave: game_type + item_id), con los
-- metadatos reales de AHledger /v1/items (que salen de los datos de Blizzard):
-- nombre, calidad, clase y subclase, nivel, nivel requerido, valor de venta al NPC
-- e icono oficial. Se guarda la fuente y la fecha de verificación.
-- No se inventa nada: lo que la fuente no da queda vacío (descripción, pila…).
-- =====================================================================

create function _normalizar(p text) returns text language sql immutable as $$
  select lower(translate(coalesce(p, ''), 'áéíóúüñàèìòùâêîôûäëïöÁÉÍÓÚÜÑÀÈÌÒÙÂÊÎÔÛÄËÏÖ',
                                          'aeiouunaeiouaeiouaeioaeiouunaeiouaeiouaeio'))
$$;

create table catalogo (
  game_type       text not null,
  item_id         integer not null check (item_id > 0),
  nombre          text not null,
  nombre_es       text,                      -- solo con traducción verificada (hoy, ninguna)
  calidad         text,
  clase           text,
  subclase        text,
  nivel           integer,
  nivel_requerido integer,
  venta_npc       bigint check (venta_npc >= 0),
  compra_npc      bigint check (compra_npc >= 0),
  icono_url       text check (icono_url is null or icono_url like 'https://render.worldofwarcraft.com/%'),
  wowhead_url     text not null,
  fuente          text not null,
  fuente_url      text,
  verificado_en   timestamptz not null,
  busqueda        text not null,
  primary key (game_type, item_id)
);
create index catalogo_busqueda on catalogo (game_type, busqueda text_pattern_ops);

create table catalogo_fallos (
  game_type    text not null,
  item_id      integer not null,
  intentado_en timestamptz not null,
  motivo       text not null,
  primary key (game_type, item_id)
);

alter table catalogo enable row level security;
alter table catalogo_fallos enable row level security;
revoke all on catalogo, catalogo_fallos from anon, authenticated;

-- IDs vistos en mercados reales de esa versión que faltan en el catálogo o llevan
-- más de 7 días sin verificar (y que no fallaron en los últimos 7 días).
create function catalogo_pendientes(p_game text, p_limite integer default 150, p_now timestamptz default now())
returns integer[] language sql stable as $$
  select coalesce(array_agg(item_id order by prioridad, item_id), '{}') from (
    select distinct i.item_id,
           case when c.item_id is null then 0 else 1 end as prioridad
      from items i
      join markets m on m.id = i.market_id and m.game_type = p_game and not m.is_demo
      left join catalogo c on c.game_type = p_game and c.item_id = i.item_id
     where (c.item_id is null or c.verificado_en < p_now - interval '7 days')
       and not exists (select 1 from catalogo_fallos f
                        where f.game_type = p_game and f.item_id = i.item_id
                          and f.intentado_en > p_now - interval '7 days')
     order by prioridad, i.item_id
     limit greatest(1, least(p_limite, 1000))) x
$$;

-- Guarda objetos tal como los devuelve AHledger /v1/items (JSON sin tocar) y
-- copia los metadatos a las filas de esos objetos en cada mercado de la versión.
create function guardar_catalogo(p_game text, p_items jsonb, p_fuente text default 'ahledger',
                                 p_now timestamptz default now())
returns integer language plpgsql as $$
declare v_n integer;
begin
  if jsonb_typeof(p_items) <> 'array' then
    raise exception 'Se esperaba una lista de objetos';
  end if;

  insert into catalogo (game_type, item_id, nombre, calidad, clase, subclase, nivel, nivel_requerido,
                        venta_npc, icono_url, wowhead_url, fuente, fuente_url, verificado_en, busqueda)
  select distinct on (x.id)
         p_game, x.id, btrim(x.name), x."quality", x."itemClass", x."itemSubclass", x."level",
         x."requiredLevel", x."vendorSell",
         case when x.icon like 'https://render.worldofwarcraft.com/%' then x.icon end,
         format('https://www.wowhead.com/%s/item=%s', p_game, x.id),
         p_fuente,
         -- Enlace a la ficha de la fuente, sin parámetros de seguimiento.
         split_part(x.url, '?', 1),
         p_now, _normalizar(x.name)
    from jsonb_to_recordset(p_items) as x(id integer, name text, "quality" text, "itemClass" text,
                                          "itemSubclass" text, "level" integer, "requiredLevel" integer,
                                          "vendorSell" bigint, icon text, url text)
   where x.id > 0 and coalesce(btrim(x.name), '') <> ''
     and (x."vendorSell" is null or x."vendorSell" >= 0)
   order by x.id
  on conflict (game_type, item_id) do update
     set nombre = excluded.nombre, calidad = excluded.calidad, clase = excluded.clase,
         subclase = excluded.subclase, nivel = excluded.nivel, nivel_requerido = excluded.nivel_requerido,
         venta_npc = excluded.venta_npc, icono_url = coalesce(excluded.icono_url, catalogo.icono_url),
         fuente = excluded.fuente, fuente_url = excluded.fuente_url,
         verificado_en = excluded.verificado_en, busqueda = excluded.busqueda;
  get diagnostics v_n = row_count;

  delete from catalogo_fallos f
   using jsonb_to_recordset(p_items) as x(id integer)
   where f.game_type = p_game and f.item_id = x.id;

  -- Metadatos a las filas de cada mercado (los datos de mercado no se tocan).
  update items i
     set quality = c.calidad, item_class = c.clase, item_subclass = c.subclase,
         category = c.clase, level = c.nivel, required_level = c.nivel_requerido,
         vendor_price = c.venta_npc, icon_url = coalesce(c.icono_url, i.icon_url)
    from catalogo c, markets m, jsonb_to_recordset(p_items) as x(id integer)
   where m.id = i.market_id and m.game_type = c.game_type and not m.is_demo
     and c.game_type = p_game and c.item_id = i.item_id and c.item_id = x.id;

  return v_n;
end $$;

create function registrar_fallo_catalogo(p_game text, p_ids integer[], p_motivo text,
                                         p_now timestamptz default now())
returns void language sql as $$
  insert into catalogo_fallos (game_type, item_id, intentado_en, motivo)
  select p_game, x, p_now, left(p_motivo, 200) from unnest(p_ids) as x
  on conflict (game_type, item_id) do update set intentado_en = excluded.intentado_en, motivo = excluded.motivo
$$;

-- Turno para completar el catálogo (evita dos lotes a la vez).
insert into settings (key, value) values ('catalogo_turno_hasta', '-infinity') on conflict do nothing;

create function tomar_turno_catalogo(p_segundos integer default 180, p_now timestamptz default now())
returns boolean language sql as $$
  with t as (
    update settings set value = (p_now + make_interval(secs => p_segundos))::text
     where key = 'catalogo_turno_hasta' and value::timestamptz <= p_now
    returning 1)
  select exists (select 1 from t)
$$;

create function soltar_turno_catalogo() returns void language sql as $$
  update settings set value = '-infinity' where key = 'catalogo_turno_hasta'
$$;

-- Búsqueda: ID exacto, o nombre (sin mayúsculas ni tildes): primero los que EMPIEZAN
-- por el texto y después los que lo contienen. Marca si el objeto tiene precio en el mercado.
create function buscar_catalogo(p_market_key text, p_q text, p_limite integer default 20)
returns jsonb language sql stable as $$
  with m as (select id, game_type from markets where key = p_market_key),
  -- substring devuelve null si no es un número: la conversión nunca falla.
  q0 as (select _normalizar(btrim(p_q)) as t, (substring(btrim(p_q) from '^(\d{1,9})$'))::integer as id),
  -- % y _ escritos por el usuario se buscan como texto, no como comodines.
  q as (select t, id, replace(replace(replace(t, '\', '\\'), '%', '\%'), '_', '\_') as tl from q0),
  candidatos as (
    select c.*, case when c.item_id = q.id then 0
                     when c.busqueda like q.tl || '%' then 1
                     else 2 end as orden
      from catalogo c, m, q
     where c.game_type = m.game_type and length(q.t) >= 1
       and (c.item_id = q.id
            or c.busqueda like q.tl || '%'
            or (length(q.t) >= 2 and c.busqueda like '%' || q.tl || '%'))
     order by orden, length(c.nombre), c.nombre
     limit least(greatest(p_limite, 1), 50)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', item_id, 'nombre', nombre, 'calidad', calidad, 'clase', clase, 'subclase', subclase,
           'nivel', nivel, 'icono', icono_url,
           'en_mercado', exists (select 1 from items i, m where i.market_id = m.id and i.item_id = candidatos.item_id))
         order by orden, length(nombre), nombre), '[]'::jsonb)
    from candidatos
$$;

-- Ficha de catálogo + resumen de mercado (si lo hay) de un objeto.
create function ficha_objeto(p_market_key text, p_item_id integer) returns jsonb
language sql stable as $$
  with m as (select id, game_type, is_demo from markets where key = p_market_key)
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

-- Árbol de categorías REAL (clase › subclase) de los objetos con precio en el mercado.
create function categorias_mercado(p_market_key text) returns jsonb
language sql stable as $$
  with m as (select id from markets where key = p_market_key),
  base as (
    select coalesce(i.item_class, 'Sin clasificar') as clase, i.item_subclass as subclase
      from items i, m where i.market_id = m.id
  ),
  sub as (
    select clase, subclase, count(*) n from base group by clase, subclase
  )
  select coalesce(jsonb_agg(jsonb_build_object('clase', clase, 'n', total, 'subclases', subclases)
                            order by clase = 'Sin clasificar', clase), '[]'::jsonb)
    from (select clase, sum(n)::integer as total,
                 coalesce(jsonb_agg(jsonb_build_object('subclase', subclase, 'n', n) order by subclase)
                          filter (where subclase is not null), '[]'::jsonb) as subclases
            from sub group by clase) t
$$;

-- Al llegar objetos nuevos a un mercado, se rellenan sus metadatos desde el catálogo si ya existen.
create or replace function guardar_metadatos(p_market_key text, p_items jsonb, p_now timestamptz default now())
returns integer language plpgsql as $$
declare v_mid smallint := _mercado_id(p_market_key); v_n integer;
begin
  insert into items (market_id, item_id, name, quality, item_class, item_subclass, level, required_level,
                     vendor_price, icon_url, category, metadata_source, updated_at)
  select distinct on (r.item_id) v_mid, r.item_id, r.name,
         coalesce(c.calidad, r.quality), coalesce(c.clase, r.item_class), coalesce(c.subclase, r.item_subclass),
         coalesce(c.nivel, r.level), coalesce(c.nivel_requerido, r.required_level),
         coalesce(c.venta_npc, r.vendor_price),
         coalesce(c.icono_url, case when r.icon_url like 'https://render.worldofwarcraft.com/%' then r.icon_url end),
         coalesce(c.clase, r.item_class), coalesce(r.fuente, 'ahledger'), p_now
    from jsonb_to_recordset(p_items) as r(item_id integer, name text, quality text, item_class text,
                                           item_subclass text, level integer, required_level integer,
                                           vendor_price bigint, icon_url text, fuente text)
    left join markets mk on mk.id = v_mid
    left join catalogo c on c.game_type = mk.game_type and c.item_id = r.item_id and not mk.is_demo
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

revoke execute on all functions in schema public from public, anon, authenticated;
