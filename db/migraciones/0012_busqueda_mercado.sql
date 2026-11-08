-- =====================================================================
-- 0012 — La búsqueda también encuentra los objetos del mercado elegido que
-- todavía no tienen ficha completa en el catálogo (mientras se completa por lotes).
-- =====================================================================

create or replace function buscar_catalogo(p_market_key text, p_q text, p_limite integer default 20)
returns jsonb language sql stable as $$
  with m as (select id, game_type, is_demo from markets where key = p_market_key),
  q0 as (select _normalizar(btrim(p_q)) as t, (substring(btrim(p_q) from '^(\d{1,9})$'))::integer as id),
  q as (select t, id, replace(replace(replace(t, '\', '\\'), '%', '\%'), '_', '\_') as tl from q0),
  fuente as (
    select c.item_id, c.nombre, c.calidad, c.clase, c.subclase, c.nivel, c.icono_url, c.busqueda
      from catalogo c, m where c.game_type = m.game_type and not m.is_demo
    union all
    select i.item_id, i.name, i.quality, i.item_class, i.item_subclass, i.level, i.icon_url, _normalizar(i.name)
      from items i, m
     where i.market_id = m.id
       and (m.is_demo or not exists (select 1 from catalogo c where c.game_type = m.game_type and c.item_id = i.item_id))
  ),
  candidatos as (
    select f.*, case when f.item_id = q.id then 0
                     when f.busqueda like q.tl || '%' then 1
                     else 2 end as orden
      from fuente f, q
     where length(q.t) >= 1
       and (f.item_id = q.id
            or f.busqueda like q.tl || '%'
            or (length(q.t) >= 2 and f.busqueda like '%' || q.tl || '%'))
     order by orden, length(f.nombre), f.nombre
     limit least(greatest(p_limite, 1), 50)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', item_id, 'nombre', nombre, 'calidad', calidad, 'clase', clase, 'subclase', subclase,
           'nivel', nivel, 'icono', icono_url,
           'en_mercado', exists (select 1 from items i, m where i.market_id = m.id and i.item_id = candidatos.item_id))
         order by orden, length(nombre), nombre), '[]'::jsonb)
    from candidatos
$$;

revoke execute on function buscar_catalogo(text, text, integer) from public, anon, authenticated;
