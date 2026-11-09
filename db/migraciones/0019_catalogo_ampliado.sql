-- =====================================================================
-- 0019 — V4 del plan V3: ampliar y medir el catálogo con métodos permitidos y verificables.
--
-- La cola del catálogo (catalogo_pendientes, que la Edge Function recorre cada 5 min con
-- AHledger /v1/items) ahora incluye, además de los objetos vistos en los mercados:
--   * los resultados y materiales de las recetas de AHledger (/v1/crafting);
--   * los IDs que importe el usuario (CSV o lista).
-- Ningún ID entra en el catálogo sin que AHledger lo confirme (nombre real): si la fuente no
-- lo tiene, queda en catalogo_fallos con el motivo y no se reintenta hasta pasados 7 días.
-- No se recorren rangos de IDs a ciegas (sería extracción masiva sin permiso confirmado).
-- =====================================================================

create table catalogo_solicitudes (
  game_type     text not null,
  item_id       integer not null check (item_id > 0),
  origen        text not null check (origen in ('importacion')),
  solicitado_en timestamptz not null,
  primary key (game_type, item_id)
);
alter table catalogo_solicitudes enable row level security;
revoke all on catalogo_solicitudes from anon, authenticated;

-- Todos los IDs conocidos de una versión, con su procedencia (un ID puede tener varias).
create function _ids_conocidos(p_game text) returns table (item_id integer, origen text)
language sql stable as $$
  select distinct i.item_id, 'mercado'
    from items i join markets m on m.id = i.market_id and m.game_type = p_game and not m.is_demo
  union
  select r.resultado_id, 'receta' from recipes r where r.game_type = p_game
  union
  select rm.item_id, 'receta' from recipe_materials rm where rm.game_type = p_game
  union
  select s.item_id, 'importacion' from catalogo_solicitudes s where s.game_type = p_game
$$;

-- Pendientes: conocidos que faltan en el catálogo o llevan > 7 días sin verificar,
-- salvo los que fallaron en los últimos 7 días. Primero los que faltan.
create function _pendientes(p_game text, p_now timestamptz) returns table (item_id integer, prioridad integer)
language sql stable as $$
  select k.item_id, min(case when c.item_id is null then 0 else 1 end)
    from _ids_conocidos(p_game) k
    left join catalogo c on c.game_type = p_game and c.item_id = k.item_id
   where (c.item_id is null or c.verificado_en < p_now - interval '7 days')
     and not exists (select 1 from catalogo_fallos f
                      where f.game_type = p_game and f.item_id = k.item_id
                        and f.intentado_en > p_now - interval '7 days')
   group by k.item_id
$$;

create or replace function catalogo_pendientes(p_game text, p_limite integer default 150, p_now timestamptz default now())
returns integer[] language sql stable as $$
  select coalesce(array_agg(item_id order by prioridad, item_id), '{}') from (
    select item_id, prioridad from _pendientes(p_game, p_now)
     order by prioridad, item_id
     limit greatest(1, least(p_limite, 1000))) x
$$;

-- Importación verificable: los IDs quedan en la cola; AHledger los confirma uno a uno.
create function solicitar_catalogo(p_game text, p_ids integer[], p_now timestamptz default now())
returns jsonb language plpgsql as $$
declare v_validos integer[]; v_nuevos integer;
begin
  if p_ids is null or cardinality(p_ids) = 0 then raise exception 'No hay ningún ID'; end if;
  if cardinality(p_ids) > 5000 then raise exception 'Demasiados IDs (máximo 5000 por importación)'; end if;
  select coalesce(array_agg(distinct x), '{}') into v_validos
    from unnest(p_ids) x where x between 1 and 999999999;
  insert into catalogo_solicitudes (game_type, item_id, origen, solicitado_en)
  select p_game, x, 'importacion', p_now from unnest(v_validos) x
  on conflict (game_type, item_id) do nothing;
  get diagnostics v_nuevos = row_count;
  -- Un ID que falló antes se vuelve a intentar si el usuario lo pide expresamente.
  delete from catalogo_fallos f where f.game_type = p_game and f.item_id = any (v_validos);
  return jsonb_build_object(
    'recibidos', cardinality(p_ids),
    'validos', cardinality(v_validos),
    'invalidos', cardinality(p_ids) - (select count(*) from unnest(p_ids) x where x between 1 and 999999999),
    'nuevos_en_cola', v_nuevos,
    'ya_en_catalogo', (select count(*) from catalogo c where c.game_type = p_game and c.item_id = any (v_validos)),
    'cobertura', cobertura_catalogo(p_game, p_now));
end $$;

-- Cobertura medida (no se afirma «completo»: ninguna fuente permitida da la lista total).
create function cobertura_catalogo(p_game text, p_now timestamptz default now()) returns jsonb
language sql stable as $$
  with k as (select item_id, array_agg(origen) as origenes from _ids_conocidos(p_game) group by item_id)
  select jsonb_build_object(
    'catalogo', (select count(*) from catalogo c where c.game_type = p_game),
    'conocidos', (select count(*) from k),
    'por_origen', jsonb_build_object(
      'mercado', (select count(*) from k where 'mercado' = any (origenes)),
      'receta', (select count(*) from k where 'receta' = any (origenes)),
      'solo_receta', (select count(*) from k where origenes = array['receta']),
      'importacion', (select count(*) from k where 'importacion' = any (origenes))),
    'pendientes', (select count(*) from _pendientes(p_game, p_now) where prioridad = 0),
    'por_reverificar', (select count(*) from _pendientes(p_game, p_now) where prioridad = 1),
    'sin_ficha_en_fuente', (select count(*) from catalogo_fallos f where f.game_type = p_game
                              and not exists (select 1 from catalogo c where c.game_type = p_game and c.item_id = f.item_id)),
    'ultima_verificacion', (select max(verificado_en) from catalogo c where c.game_type = p_game),
    'fuente', 'AHledger /v1/items (datos de Blizzard)')
$$;

revoke execute on all functions in schema public from public, anon, authenticated;
