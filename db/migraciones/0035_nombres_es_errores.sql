-- 0035 · Nombres en español: un objeto que da error en la API (p. ej. HTTP 500) ya no frena la importación.
-- Se salta y se vuelve a intentar al cabo de ~1 día (los que la API no tiene, a los 30 días, como antes).
drop function guardar_nombres_es(text, jsonb, integer[], text, timestamptz);
create function guardar_nombres_es(p_game text, p_encontrados jsonb, p_sin_nombre integer[], p_fuente text,
                                   p_now timestamptz default now(), p_errores integer[] default '{}')
returns jsonb language plpgsql as $$
declare v_ok integer; v_no integer; v_err integer;
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
  -- Error de la API: «intentado hace 29 días» → vuelve a estar pendiente dentro de ~1 día.
  update catalogo set nombre_es_intento = p_now - interval '29 days'
   where game_type = p_game and item_id = any (coalesce(p_errores, '{}')) and nombre_es is null;
  get diagnostics v_err = row_count;
  return jsonb_build_object('guardados', v_ok, 'sin_nombre', v_no, 'con_error', v_err);
end $$;

revoke execute on all functions in schema public from public, anon, authenticated;
