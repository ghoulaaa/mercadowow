-- 0033 · Nombres oficiales en español (API de Blizzard, locale es_MX).
--
-- Solo se guarda un nombre que la API oficial devuelve para ESE ID de objeto. Nunca una traducción
-- propia: si Blizzard no tiene el objeto, se queda el nombre en inglés.
-- El nombre en inglés (de AHledger) sigue siendo el de referencia; el español se muestra y se busca.

alter table catalogo add column nombre_es_fuente text;          -- p. ej. «blizzard:static-classic1x-us:es_MX»
alter table catalogo add column nombre_es_en timestamptz;       -- cuándo se obtuvo
alter table catalogo add column nombre_es_intento timestamptz;  -- último intento sin nombre (no repetir cada día)

insert into settings (key, value) values ('nombres_es_turno_hasta', '-infinity') on conflict (key) do nothing;

-- La búsqueda incluye los dos nombres (primero el español, así el orden A–Z sigue al español).
create function _busqueda_nombres() returns trigger language plpgsql as $$
begin
  if not new.sin_ficha then
    new.busqueda := _normalizar(coalesce(nullif(btrim(new.nombre_es), '') || ' · ', '') || new.nombre);
  end if;
  return new;
end $$;
-- Se llama «catalogo_zz…» para ejecutarse después de catalogo_sin_ficha (orden alfabético).
create trigger catalogo_zz_busqueda before insert or update on catalogo
  for each row execute function _busqueda_nombres();

-- Objetos sin nombre en español que toca pedir (nunca intentados o hace más de 30 días).
create function nombres_es_pendientes(p_game text, p_limite integer default 400, p_now timestamptz default now())
returns integer[] language sql stable as $$
  select coalesce(array_agg(item_id order by item_id), '{}')
    from (select item_id from catalogo
           where game_type = p_game and nombre_es is null and not sin_ficha
             and (nombre_es_intento is null or nombre_es_intento < p_now - interval '30 days')
           order by item_id
           limit greatest(1, least(p_limite, 1000))) x
$$;

-- p_encontrados: [{id, nombre}] tal cual los da la API; p_sin_nombre: IDs que la API no tiene.
create function guardar_nombres_es(p_game text, p_encontrados jsonb, p_sin_nombre integer[], p_fuente text,
                                   p_now timestamptz default now())
returns jsonb language plpgsql as $$
declare v_ok integer; v_no integer;
begin
  if jsonb_typeof(p_encontrados) <> 'array' then raise exception 'Se esperaba una lista'; end if;
  update catalogo c
     set nombre_es = btrim(x.nombre), nombre_es_fuente = p_fuente, nombre_es_en = p_now, nombre_es_intento = null
    from jsonb_to_recordset(p_encontrados) as x(id integer, nombre text)
   where c.game_type = p_game and c.item_id = x.id
     and coalesce(btrim(x.nombre), '') <> '' and length(btrim(x.nombre)) <= 200;
  get diagnostics v_ok = row_count;
  update catalogo set nombre_es_intento = p_now
   where game_type = p_game and item_id = any (coalesce(p_sin_nombre, '{}')) and nombre_es is null;
  get diagnostics v_no = row_count;
  return jsonb_build_object('guardados', v_ok, 'sin_nombre', v_no);
end $$;

create function tomar_turno_nombres_es(p_segundos integer default 300, p_now timestamptz default now())
returns boolean language sql as $$
  with t as (
    update settings set value = (p_now + make_interval(secs => p_segundos))::text
     where key = 'nombres_es_turno_hasta' and value::timestamptz <= p_now
    returning 1)
  select exists (select 1 from t)
$$;

-- Al terminar: libera el turno, o lo deja bloqueado un rato (p. ej. sin credenciales o límite de la API).
create function soltar_turno_nombres_es(p_pausa_segundos integer default 0, p_now timestamptz default now())
returns void language sql as $$
  update settings set value = case when p_pausa_segundos > 0
                                   then (p_now + make_interval(secs => p_pausa_segundos))::text else '-infinity' end
   where key = 'nombres_es_turno_hasta'
$$;

-- Para la página: {id: nombre en español} del juego del mercado (solo los que existen).
create function nombres_es(p_market_key text) returns jsonb language sql stable as $$
  select coalesce(jsonb_object_agg(c.item_id::text, c.nombre_es), '{}'::jsonb)
    from markets m join catalogo c on c.game_type = m.game_type
   where m.key = p_market_key and not m.is_demo and c.nombre_es is not null
$$;

-- Cobertura (para el aviso de la página y para comprobar el avance).
create function nombres_es_estado(p_game text) returns jsonb language sql stable as $$
  select jsonb_build_object(
    'total', count(*) filter (where not sin_ficha),
    'con_nombre', count(nombre_es),
    'sin_nombre_en_blizzard', count(*) filter (where nombre_es is null and nombre_es_intento is not null),
    'pendientes', count(*) filter (where nombre_es is null and nombre_es_intento is null and not sin_ficha),
    'fuente', max(nombre_es_fuente))
    from catalogo where game_type = p_game
$$;

revoke execute on all functions in schema public from public, anon, authenticated;
