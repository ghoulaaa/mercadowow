-- =====================================================================
-- 0023 — W4 del plan V4: iconos de la fuente, objetos sin ficha e informe del catálogo.
--
-- * Iconos permitidos: el CDN de Blizzard y los que la API de AHledger sirve desde su propio
--   dominio (`https://ahledger.com/icons/<FileDataID>.jpg`, objetos nuevos de Forever). Se usan
--   con la atribución de AHledger. Ningún otro dominio.
-- * Objetos sin ficha: AHledger publica algunos objetos nuevos como «Item 216483», sin calidad,
--   clase ni icono, y TSM tampoco da su nombre. Ese texto NO es un nombre: se guardan como
--   «#216483» y se marcan `sin_ficha` (regla en la propia tabla, también para el futuro).
-- * Informe del catálogo por categoría: totales, sin ficha, iconos, calidad, precio TSM,
--   duplicados (imposibles: clave primaria por ID y versión), errores y cola pendiente.
-- =====================================================================

create function _icono_permitido(p text) returns boolean language sql immutable as $$
  select p is not null and (p like 'https://render.worldofwarcraft.com/%'
                            or p ~ '^https://ahledger\.com/icons/[0-9]+\.(jpg|png)$')
$$;

alter table catalogo drop constraint if exists catalogo_icono_url_check;
alter table catalogo add constraint catalogo_icono_url_check check (icono_url is null or _icono_permitido(icono_url));

-- ---------- Objetos sin ficha en la fuente ----------
alter table catalogo add column sin_ficha boolean not null default false;

create function _marcar_sin_ficha() returns trigger language plpgsql as $$
begin
  if new.nombre ~ '^Item [0-9]+$' and new.clase is null then
    new.sin_ficha := true;
    new.nombre := '#' || new.item_id;
    -- Al final del orden A–Z (sin nombre real); la búsqueda por ID va por item_id, no por este texto.
    new.busqueda := 'zzz sin ficha ' || new.item_id;
  else
    new.sin_ficha := false;
  end if;
  return new;
end $$;
create trigger catalogo_sin_ficha before insert or update on catalogo
  for each row execute function _marcar_sin_ficha();

create function _nombre_items() returns trigger language plpgsql as $$
begin
  if new.name ~ '^Item [0-9]+$' then new.name := '#' || new.item_id; end if;
  return new;
end $$;
create trigger items_nombre_provisional before insert or update of name on items
  for each row execute function _nombre_items();

update catalogo set nombre = nombre where nombre ~ '^Item [0-9]+$';
update items set name = name where name ~ '^Item [0-9]+$';

-- ---------- Guardado con los iconos permitidos ----------
create or replace function guardar_catalogo(p_game text, p_items jsonb, p_fuente text default 'ahledger',
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
         case when _icono_permitido(x.icon) then x.icon end,
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
         coalesce(c.icono_url, case when _icono_permitido(r.icon_url) then r.icon_url end),
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


-- Los que se quedaron sin icono por el filtro anterior vuelven a la cola (se piden de nuevo a AHledger).
update catalogo set verificado_en = verificado_en - interval '8 days'
 where icono_url is null and not sin_ficha;

-- ---------- Informe ----------
create function informe_catalogo(p_game text, p_now timestamptz default now()) returns jsonb
language sql stable as $$
  with tsm as (select id from markets where game_type = p_game and provider = 'tsm' order by key limit 1),
  ult as (select date_trunc('hour', max(s.source_updated_at), 'UTC') as hora from snapshots s, tsm where s.market_id = tsm.id),
  c as (
    select c.*, coalesce(c.clase, 'Sin clasificar') as categoria,
           exists (select 1 from price_hourly p, tsm where p.market_id = tsm.id and p.item_id = c.item_id) as visto_tsm,
           exists (select 1 from price_hourly p, tsm, ult where p.market_id = tsm.id and p.item_id = c.item_id
                                                          and p.hour >= ult.hora and p.min_buyout is not null) as ofertas_tsm
      from catalogo c where c.game_type = p_game
  ),
  por_cat as (
    select categoria, count(*) as total,
           count(*) filter (where sin_ficha) as sin_ficha,
           count(*) filter (where icono_url like 'https://render.worldofwarcraft.com/%') as icono_blizzard,
           count(*) filter (where icono_url like 'https://ahledger.com/icons/%') as icono_ahledger,
           count(*) filter (where icono_url is null) as sin_icono,
           count(*) filter (where calidad is null) as sin_calidad,
           count(*) filter (where visto_tsm) as visto_tsm,
           count(*) filter (where ofertas_tsm) as ofertas_tsm
      from c group by categoria
  )
  select jsonb_build_object(
    'juego', p_game,
    'total', (select count(*) from c),
    'ids_unicos', (select count(distinct item_id) from c),
    'duplicados', (select count(*) - count(distinct item_id) from c),
    'sin_ficha', (select count(*) from c where sin_ficha),
    'iconos', jsonb_build_object(
      'blizzard', (select count(*) from c where icono_url like 'https://render.worldofwarcraft.com/%'),
      'ahledger', (select count(*) from c where icono_url like 'https://ahledger.com/icons/%'),
      'sin_icono', (select count(*) from c where icono_url is null),
      'sin_icono_con_ficha', (select count(*) from c where icono_url is null and not sin_ficha),
      'archivos_distintos', (select count(distinct icono_url) from c)),
    'precios_tsm', jsonb_build_object(
      'vistos', (select count(*) from c where visto_tsm),
      'con_ofertas_ultimo_escaneo', (select count(*) from c where ofertas_tsm)),
    'errores', coalesce((select jsonb_agg(jsonb_build_object('motivo', motivo, 'n', n) order by n desc)
                           from (select motivo, count(*) as n from catalogo_fallos where game_type = p_game group by motivo) f), '[]'::jsonb),
    'pendientes', (select count(*) from _pendientes(p_game, p_now) where prioridad = 0),
    'por_reverificar', (select count(*) from _pendientes(p_game, p_now) where prioridad = 1),
    'ultima_verificacion', (select max(verificado_en) from c),
    'por_categoria', coalesce((select jsonb_agg(to_jsonb(x) order by x.categoria = 'Sin clasificar', x.total desc) from por_cat x), '[]'::jsonb))
$$;

revoke execute on all functions in schema public from public, anon, authenticated;
