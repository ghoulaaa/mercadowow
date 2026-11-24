-- =====================================================================
-- 0047 — Crafting Sniper: apariencia del mensaje de Discord (nombre y avatar del webhook, imagen,
-- materiales, historial, enlaces, modo compacto o detallado, formato de monedas y colores por clase).
-- Se guarda en sniper_config.apariencia y se cambia con {accion: "config", cambios: {apariencia: {...}}}.
-- Lo que no se indique queda con el valor por defecto (app/static/sniper.js, APARIENCIA_DEFECTO).
-- =====================================================================

alter table sniper_config add column apariencia jsonb not null default '{}'::jsonb;

/**
 * Valida y fusiona la apariencia guardada con los cambios. Claves desconocidas o valores no válidos: excepción
 * (la API la devuelve como 422). Un valor null borra la clave (vuelve al valor por defecto).
 */
create function _sniper_apariencia(p_actual jsonb, p_cambios jsonb) returns jsonb
language plpgsql immutable as $$
declare
  r jsonb := coalesce(p_actual, '{}'::jsonb);
  k text; v jsonb; t text; sub text;
begin
  if jsonb_typeof(p_cambios) <> 'object' then raise exception 'Apariencia no válida'; end if;
  for k, v in select * from jsonb_each(p_cambios) loop
    if jsonb_typeof(v) = 'null' then r := r - k; continue; end if;
    case k
    when 'nombre' then
      t := btrim(v #>> '{}');
      if jsonb_typeof(v) <> 'string' or length(t) not between 1 and 80 then
        raise exception 'El nombre del webhook debe tener entre 1 y 80 caracteres';
      end if;
      -- Discord rechaza los nombres de webhook que contienen «discord» o «clyde».
      if t ~* '(discord|clyde)' then raise exception 'Discord no permite «discord» ni «clyde» en el nombre del webhook'; end if;
      r := r || jsonb_build_object(k, t);
    when 'avatar' then
      t := btrim(v #>> '{}');
      if jsonb_typeof(v) <> 'string' or length(t) > 500 or t !~ '^https://[A-Za-z0-9.-]+\.[A-Za-z]{2,}(/[^\s<>"]*)?$' then
        raise exception 'El avatar debe ser una dirección https:// de una imagen';
      end if;
      r := r || jsonb_build_object(k, t);
    when 'imagen', 'materiales', 'historial', 'enlaces' then
      if jsonb_typeof(v) <> 'boolean' then raise exception 'Valor no válido en «%»', k; end if;
      r := r || jsonb_build_object(k, v);
    when 'modo' then
      if v #>> '{}' not in ('compacto', 'detallado') then raise exception 'Modo no válido (compacto o detallado)'; end if;
      r := r || jsonb_build_object(k, v);
    when 'monedas' then
      if v #>> '{}' not in ('gsc', 'opc', 'emojis') then raise exception 'Formato de monedas no válido'; end if;
      r := r || jsonb_build_object(k, v);
    when 'emojis' then
      if jsonb_typeof(v) <> 'object' then raise exception 'Emojis no válidos'; end if;
      for sub, t in select key, value #>> '{}' from jsonb_each(v) loop
        if sub not in ('oro', 'plata', 'cobre') then raise exception 'Emoji desconocido: %', sub; end if;
        if t is not null and t <> '' and t !~ '^<a?:[A-Za-z0-9_]{2,32}:[0-9]{5,25}>$' then
          raise exception 'El emoji de % debe tener la forma <:nombre:id> (en Discord: \:emoji: y copiar)', sub;
        end if;
      end loop;
      r := r || jsonb_build_object(k, (select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) from jsonb_each(v)
                                         where nullif(value #>> '{}', '') is not null));
    when 'colores' then
      if jsonb_typeof(v) <> 'object' then raise exception 'Colores no válidos'; end if;
      for sub, t in select key, value #>> '{}' from jsonb_each(v) loop
        if sub not in ('rentable', 'ganga', 'epica', 'legendaria', 'excepcional') then raise exception 'Clase desconocida: %', sub; end if;
        if t !~ '^#[0-9A-Fa-f]{6}$' then raise exception 'El color de «%» debe ser #RRGGBB', sub; end if;
      end loop;
      r := r || jsonb_build_object(k, v);
    else
      raise exception 'Opción de apariencia desconocida: %', k;
    end case;
  end loop;
  return r;
end $$;

-- gestionar_sniper de 0045 sigue haciendo todo lo demás; la nueva versión solo añade la apariencia.
alter function gestionar_sniper(jsonb) rename to _gestionar_sniper_0045;

create function gestionar_sniper(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if p->>'accion' = 'config' and jsonb_typeof(p->'cambios') = 'object' and p->'cambios' ? 'apariencia' then
    update sniper_config set apariencia = _sniper_apariencia(apariencia, p->'cambios'->'apariencia'), actualizado = now()
     where id = 1;
    if p->'cambios' = jsonb_build_object('apariencia', p->'cambios'->'apariencia') then return sniper_estado(); end if;
    return _gestionar_sniper_0045(jsonb_set(p, '{cambios}', (p->'cambios') - 'apariencia'));
  end if;
  return _gestionar_sniper_0045(p);
end $$;

revoke all on function _sniper_apariencia(jsonb, jsonb), _gestionar_sniper_0045(jsonb), gestionar_sniper(jsonb)
  from public, anon, authenticated;
