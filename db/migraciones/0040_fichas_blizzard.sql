-- 0040 · Fichas oficiales de los objetos (texto del juego en español, API de Blizzard es_MX).
--
-- Para el cuadro al pasar el cursor por el icono de un objeto (como en el juego): nivel, ligado, único,
-- efectos «Uso:», estadísticas, requisitos… Es la «vista previa» que publica Blizzard para ese ID, tal cual.
-- Solo para objetos cuyo nombre en español ya se comprobó con Blizzard (se usa el mismo espacio de datos).

create table fichas_objeto (
  game_type text    not null,
  item_id   integer not null check (item_id > 0),
  locale    text    not null default 'es_MX',
  datos     jsonb,                 -- preview_item de Blizzard (null = Blizzard no la tiene)
  fuente    text,                  -- p. ej. «blizzard:static-classic1x-us:es_MX»
  obtenido  timestamptz,
  intento   timestamptz,           -- último intento sin ficha o con error
  primary key (game_type, item_id, locale)
);
alter table fichas_objeto enable row level security;
revoke all on fichas_objeto from anon, authenticated;

insert into settings (key, value) values ('fichas_turno_hasta', '-infinity') on conflict (key) do nothing;

-- Objetos con nombre comprobado en Blizzard y sin ficha (o con un intento fallido de hace tiempo):
-- [{id, ns}] con el espacio de datos en que se encontró su nombre.
create function fichas_pendientes(p_game text, p_limite integer default 300, p_now timestamptz default now())
returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', x.item_id, 'ns', x.ns) order by x.item_id), '[]'::jsonb)
    from (select c.item_id, split_part(c.nombre_es_fuente, ':', 2) as ns
            from catalogo c
            left join fichas_objeto f on f.game_type = c.game_type and f.item_id = c.item_id and f.locale = 'es_MX'
           where c.game_type = p_game and c.nombre_es_fuente like 'blizzard:%:%'
             and (f.item_id is null or (f.datos is null and f.intento < p_now - interval '1 day'))
           order by c.item_id
           limit greatest(1, least(p_limite, 1000))) x
$$;

-- p_filas: [{id, datos, fuente}]; p_sin: IDs sin ficha en Blizzard (se reintenta en 30 días);
-- p_errores: IDs con error de la API (se reintenta en ~1 día).
create function guardar_fichas(p_game text, p_filas jsonb, p_sin integer[], p_errores integer[] default '{}',
                               p_now timestamptz default now())
returns jsonb language plpgsql as $$
declare v_ok integer; v_no integer; v_err integer;
begin
  if jsonb_typeof(p_filas) <> 'array' then raise exception 'Se esperaba una lista'; end if;
  insert into fichas_objeto (game_type, item_id, locale, datos, fuente, obtenido, intento)
  select p_game, (x->>'id')::integer, 'es_MX', x->'datos', x->>'fuente', p_now, null
    from jsonb_array_elements(p_filas) x
   where jsonb_typeof(x->'datos') = 'object' and length((x->'datos')::text) <= 20000
     and (x->>'fuente') like 'blizzard:%'
  on conflict (game_type, item_id, locale) do update
     set datos = excluded.datos, fuente = excluded.fuente, obtenido = excluded.obtenido, intento = null;
  get diagnostics v_ok = row_count;
  insert into fichas_objeto (game_type, item_id, locale, intento)
  select p_game, i, 'es_MX', p_now from unnest(coalesce(p_sin, '{}')) i
  on conflict (game_type, item_id, locale) do update set intento = excluded.intento where fichas_objeto.datos is null;
  get diagnostics v_no = row_count;
  -- Error de la API: «intentado hace 29 días y 23 h»… basta con «hace más de 1 día» para reintentar mañana.
  insert into fichas_objeto (game_type, item_id, locale, intento)
  select p_game, i, 'es_MX', p_now from unnest(coalesce(p_errores, '{}')) i
  on conflict (game_type, item_id, locale) do update set intento = excluded.intento where fichas_objeto.datos is null;
  get diagnostics v_err = row_count;
  return jsonb_build_object('guardadas', v_ok, 'sin_ficha', v_no, 'con_error', v_err);
end $$;

create function tomar_turno_fichas(p_segundos integer default 300, p_now timestamptz default now())
returns boolean language sql as $$
  with t as (
    update settings set value = (p_now + make_interval(secs => p_segundos))::text
     where key = 'fichas_turno_hasta' and value::timestamptz <= p_now
    returning 1)
  select exists (select 1 from t)
$$;

create function soltar_turno_fichas(p_pausa_segundos integer default 0, p_now timestamptz default now())
returns void language sql as $$
  update settings set value = case when p_pausa_segundos > 0
                                   then (p_now + make_interval(secs => p_pausa_segundos))::text else '-infinity' end
   where key = 'fichas_turno_hasta'
$$;

-- Para la página: la ficha de un objeto (o null).
create function ficha_blizzard(p_market_key text, p_item_id integer) returns jsonb language sql stable as $$
  select jsonb_build_object('datos', f.datos, 'fuente', f.fuente, 'obtenido', f.obtenido)
    from markets m join fichas_objeto f on f.game_type = m.game_type and f.item_id = p_item_id and f.locale = 'es_MX'
   where m.key = p_market_key and not m.is_demo and f.datos is not null
$$;

create function fichas_estado(p_game text) returns jsonb language sql stable as $$
  select jsonb_build_object(
    'con_ficha', (select count(*) from fichas_objeto where game_type = p_game and datos is not null),
    'sin_ficha', (select count(*) from fichas_objeto where game_type = p_game and datos is null),
    'pendientes', jsonb_array_length(fichas_pendientes(p_game, 1000)))
$$;

revoke all on function fichas_pendientes(text, integer, timestamptz), guardar_fichas(text, jsonb, integer[], integer[], timestamptz),
  tomar_turno_fichas(integer, timestamptz), soltar_turno_fichas(integer, timestamptz), ficha_blizzard(text, integer),
  fichas_estado(text) from public, anon, authenticated;
