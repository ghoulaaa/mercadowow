-- 0032 · Interfaz V6: la estrella de cada fila necesita saber qué objetos están en «Favoritos».
-- listar_listas devuelve además 'favoritos': los IDs de la lista «Favoritos» (vacío si no existe).
create or replace function listar_listas(p_item_id integer default null) returns jsonb language sql stable as $$
  select jsonb_build_object(
    'listas', coalesce((select jsonb_agg(jsonb_build_object(
        'id', l.id, 'nombre', l.nombre, 'perfil', l.perfil,
        'n', (select count(*) from lista_objetos lo where lo.lista_id = l.id),
        'contiene', case when p_item_id is null then null
                         else exists (select 1 from lista_objetos lo where lo.lista_id = l.id and lo.item_id = p_item_id) end)
        order by l.nombre = 'Favoritos' desc, lower(l.nombre), l.id) from listas l), '[]'::jsonb),
    'favoritos', coalesce((select jsonb_agg(lo.item_id order by lo.item_id)
                             from lista_objetos lo join listas l on l.id = lo.lista_id
                            where l.nombre = 'Favoritos'), '[]'::jsonb),
    'perfil_general', leer_perfil_subasta())
$$;

revoke execute on all functions in schema public from public, anon, authenticated;
