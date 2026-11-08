-- =====================================================================
-- 0005 — Tabla de precios, versión para refresco en vivo y favoritos.
-- =====================================================================

-- Último precio de cada objeto + precio de referencia hace ~24 h y ~7 días
-- (solo si existe una observación propia cerca de ese momento; si no, null).
-- 'ausente' = el objeto no estaba en la última versión del mercado: su precio NO es actual.
create function tabla_precios(p_market_key text) returns jsonb
language sql stable as $$
  with m as (
    select id from markets where key = p_market_key
  ),
  ultima as (
    select max(s.source_updated_at) as hora, max(s.id) as id
      from snapshots s, m where s.market_id = m.id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id',        i.item_id,
           'nombre',    i.name,
           'categoria', i.category,
           'icono',     i.icon_url,
           'favorito',  f.item_id is not null,
           'hora',      ult.hour,
           'ausente',   ult.hour < date_trunc('hour', (select hora from ultima), 'UTC'),
           'precio',    ult.min_buyout,
           'valor_mercado', ult.market_value,
           'historico', ult.historical,
           'reciente',  ult.recent,
           'precio_24h', h24.precio, 'hora_24h', h24.hour,
           'precio_7d',  d7.precio,  'hora_7d',  d7.hour
         ) order by i.name), '[]'::jsonb)
    from m
    join items i on i.market_id = m.id
    left join favorites f on f.market_id = m.id and f.item_id = i.item_id
    cross join lateral (
      select p.hour, p.min_buyout, p.market_value, p.historical, p.recent
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
$$;

-- Huella barata para saber si hay que recargar el panel (se consulta cada 30 s).
create function version_mercado(p_market_key text) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'mercado',    m.key,
    'version',    coalesce((select max(id) from snapshots where market_id = m.id), 0),
    'registro',   coalesce((select max(id) from fetch_log where market_id = m.id), 0),
    'favoritos',  (select count(*) from favorites where market_id = m.id),
    'en_curso',   coalesce((select lease_expires_at > now() from fetch_state where market_id = m.id), false))
  from markets m where m.key = p_market_key
$$;

create function marcar_favorito(p_market_key text, p_item_id integer, p_favorito boolean)
returns jsonb language plpgsql as $$
declare
  v_market_id smallint := (select id from markets where key = p_market_key);
begin
  if v_market_id is null then
    raise exception 'Mercado desconocido: %', p_market_key;
  end if;
  if not exists (select 1 from items where market_id = v_market_id and item_id = p_item_id) then
    raise exception 'El objeto % no existe en este mercado', p_item_id;
  end if;
  if p_favorito then
    insert into favorites (market_id, item_id) values (v_market_id, p_item_id) on conflict do nothing;
  else
    delete from favorites where market_id = v_market_id and item_id = p_item_id;
  end if;
  return jsonb_build_object('id', p_item_id, 'favorito', p_favorito);
end $$;

-- (La clave primaria (market_id, item_id, hour) ya sirve para buscar el último precio
-- de cada objeto recorriéndola al revés: no hace falta otro índice que ocupe disco.)

revoke execute on function tabla_precios(text) from public, anon, authenticated;
revoke execute on function version_mercado(text) from public, anon, authenticated;
revoke execute on function marcar_favorito(text, integer, boolean) from public, anon, authenticated;
