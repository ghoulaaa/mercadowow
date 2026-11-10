-- 0036 · Nombres en español, segunda pasada: objetos nuevos de Forever que no están en los datos de Classic.
-- Se prueban otros espacios de datos de Blizzard (Classic progresión y el juego actual). Solo se acepta un
-- nombre si, para ESE mismo ID, Blizzard da exactamente el mismo nombre en inglés que el catálogo:
-- así no se confunde con otro objeto que tenga el mismo número en otra versión del juego.

alter table catalogo add column nombre_es_intento2 timestamptz;   -- último intento de la segunda pasada

-- Objetos que la primera pasada no encontró y que toca probar: [{id, nombre}] (el nombre en inglés, para comprobar).
create function nombres_es_pendientes_extra(p_game text, p_limite integer default 200, p_now timestamptz default now())
returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', item_id, 'nombre', nombre) order by item_id), '[]'::jsonb)
    from (select item_id, nombre from catalogo
           where game_type = p_game and nombre_es is null and not sin_ficha and nombre_es_intento is not null
             and (nombre_es_intento2 is null or nombre_es_intento2 < p_now - interval '30 days')
           order by item_id
           limit greatest(1, least(p_limite, 1000))) x
$$;

-- p_encontrados: [{id, nombre, fuente}]; p_sin_nombre: probados sin coincidencia; p_errores: reintentar en ~1 día.
create function guardar_nombres_es_extra(p_game text, p_encontrados jsonb, p_sin_nombre integer[],
                                         p_errores integer[] default '{}', p_now timestamptz default now())
returns jsonb language plpgsql as $$
declare v_ok integer; v_no integer; v_err integer;
begin
  if jsonb_typeof(p_encontrados) <> 'array' then raise exception 'Se esperaba una lista'; end if;
  update catalogo c
     set nombre_es = btrim(x.nombre), nombre_es_fuente = x.fuente, nombre_es_en = p_now, nombre_es_intento2 = p_now
    from jsonb_to_recordset(p_encontrados) as x(id integer, nombre text, fuente text)
   where c.game_type = p_game and c.item_id = x.id and c.nombre_es is null
     and coalesce(btrim(x.nombre), '') <> '' and length(btrim(x.nombre)) <= 200 and x.fuente like 'blizzard:%';
  get diagnostics v_ok = row_count;
  update catalogo set nombre_es_intento2 = p_now
   where game_type = p_game and item_id = any (coalesce(p_sin_nombre, '{}')) and nombre_es is null;
  get diagnostics v_no = row_count;
  update catalogo set nombre_es_intento2 = p_now - interval '29 days'
   where game_type = p_game and item_id = any (coalesce(p_errores, '{}')) and nombre_es is null;
  get diagnostics v_err = row_count;
  return jsonb_build_object('guardados', v_ok, 'sin_nombre', v_no, 'con_error', v_err);
end $$;

-- Estado: cuántos quedan por probar en la segunda pasada.
create or replace function nombres_es_estado(p_game text) returns jsonb language sql stable as $$
  select jsonb_build_object(
    'total', count(*) filter (where not sin_ficha),
    'con_nombre', count(nombre_es),
    'sin_nombre_en_blizzard', count(*) filter (where nombre_es is null and nombre_es_intento is not null),
    'pendientes', count(*) filter (where nombre_es is null and nombre_es_intento is null and not sin_ficha),
    'pendientes_extra', count(*) filter (where nombre_es is null and nombre_es_intento is not null
                                           and nombre_es_intento2 is null and not sin_ficha),
    'fuentes', (select jsonb_object_agg(f, n) from (select nombre_es_fuente f, count(*) n from catalogo
                                                     where game_type = p_game and nombre_es_fuente is not null group by 1) x))
    from catalogo where game_type = p_game
$$;

revoke execute on all functions in schema public from public, anon, authenticated;
