-- =====================================================================
-- 0048 — Crafting Sniper: tarjeta gráfica (PNG) para Discord.
--   * Opciones nuevas de apariencia («Diseño de Webhook»): estilo, tema, ancho, fondo, gráfico, barras,
--     Score, riesgo, período del gráfico, escala del ROI, presupuesto y zona horaria.
--   * sniper_serie: historial real (por hora) de la compra mínima de un producto, para el gráfico.
--   * Un token para que solo el propio sniper pueda pedir a la Edge Function que dibuje una tarjeta.
-- =====================================================================

/** Igual que en 0047, con las opciones de la tarjeta. Claves desconocidas o valores no válidos: excepción. */
create or replace function _sniper_apariencia(p_actual jsonb, p_cambios jsonb) returns jsonb
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
      if t ~* '(discord|clyde)' then raise exception 'Discord no permite «discord» ni «clyde» en el nombre del webhook'; end if;
      r := r || jsonb_build_object(k, t);
    when 'avatar' then
      t := btrim(v #>> '{}');
      if jsonb_typeof(v) <> 'string' or length(t) > 500 or t !~ '^https://[A-Za-z0-9.-]+\.[A-Za-z]{2,}(/[^\s<>"]*)?$' then
        raise exception 'El avatar debe ser una dirección https:// de una imagen';
      end if;
      r := r || jsonb_build_object(k, t);
    when 'imagen', 'materiales', 'historial', 'enlaces', 'fondo', 'grafico', 'barras', 'score', 'riesgo' then
      if jsonb_typeof(v) <> 'boolean' then raise exception 'Valor no válido en «%»', k; end if;
      r := r || jsonb_build_object(k, v);
    when 'modo' then
      if v #>> '{}' not in ('compacto', 'detallado') then raise exception 'Modo no válido (compacto o detallado)'; end if;
      r := r || jsonb_build_object(k, v);
    when 'estilo' then
      if v #>> '{}' not in ('tarjeta', 'texto') then raise exception 'Estilo no válido (tarjeta o texto)'; end if;
      r := r || jsonb_build_object(k, v);
    when 'tema' then
      if v #>> '{}' not in ('oscuro', 'negro') then raise exception 'Tema no válido'; end if;
      r := r || jsonb_build_object(k, v);
    when 'monedas' then
      if v #>> '{}' not in ('gsc', 'opc', 'emojis') then raise exception 'Formato de monedas no válido'; end if;
      r := r || jsonb_build_object(k, v);
    when 'ancho' then
      if jsonb_typeof(v) <> 'number' or (v #>> '{}')::numeric not in (800, 1000, 1200) then
        raise exception 'Ancho de la tarjeta no válido (800, 1000 o 1200)';
      end if;
      r := r || jsonb_build_object(k, (v #>> '{}')::integer);
    when 'periodo' then
      if jsonb_typeof(v) <> 'number' or (v #>> '{}')::numeric not in (24, 168, 336, 720) then
        raise exception 'Período del gráfico no válido (24 h, 7, 14 o 30 días)';
      end if;
      r := r || jsonb_build_object(k, (v #>> '{}')::integer);
    when 'escala_roi' then
      if jsonb_typeof(v) <> 'number' or (v #>> '{}')::numeric not between 50 and 10000 then
        raise exception 'La escala del ROI debe ir de 50 %% a 10 000 %%';
      end if;
      r := r || jsonb_build_object(k, (v #>> '{}')::numeric);
    when 'presupuesto' then
      if jsonb_typeof(v) <> 'number' or (v #>> '{}')::numeric not between 0 and 1000000000000 or (v #>> '{}')::numeric % 1 <> 0 then
        raise exception 'Presupuesto no válido';
      end if;
      r := r || jsonb_build_object(k, (v #>> '{}')::bigint);
    when 'zona' then
      t := v #>> '{}';
      if jsonb_typeof(v) <> 'string' or length(t) > 64 or t !~ '^[A-Za-z_]+(/[A-Za-z0-9_+-]+){0,2}$'
         or not exists (select 1 from pg_timezone_names where name = t) then
        raise exception 'Zona horaria no válida';
      end if;
      r := r || jsonb_build_object(k, t);
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

/**
 * Historial real de la compra mínima de un producto: [[milisegundos, cobre], …] por hora, de las últimas
 * p_horas (máx. 30 días). Sin datos: []. Nada se rellena: las horas sin escaneo no aparecen.
 */
create function sniper_serie(p_market_key text, p_item integer, p_horas integer, p_now timestamptz default now())
returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_array((extract(epoch from ph.hour) * 1000)::bigint, ph.min_buyout) order by ph.hour), '[]'::jsonb)
    from price_hourly ph join markets m on m.id = ph.market_id
   where m.key = p_market_key and ph.item_id = p_item and ph.min_buyout is not null
     and ph.hour > p_now - make_interval(hours => least(greatest(coalesce(p_horas, 168), 1), 720))
     and ph.hour <= p_now
$$;

/** Para la vista previa de la página: la misma serie, en el mercado y el período configurados. */
create function sniper_serie_pagina(p_item integer, p_horas integer default null) returns jsonb
language sql stable security definer set search_path = public as $$
  select sniper_serie(c.market_key, p_item, coalesce(p_horas, (c.apariencia->>'periodo')::integer, 168))
    from sniper_config c where c.id = 1
$$;

-- Token interno: la Edge Function solo dibuja tarjetas si se lo pide el propio sniper (protege la CPU).
insert into settings (key, value) values ('sniper_token', replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''))
  on conflict (key) do nothing;
create function sniper_token() returns text language sql stable security definer set search_path = public as $$
  select value from settings where key = 'sniper_token'
$$;
create function sniper_url_funcion() returns text language sql stable security definer set search_path = public as $$
  select value from settings where key = 'url_funcion'
$$;

revoke all on function _sniper_apariencia(jsonb, jsonb), sniper_serie(text, integer, integer, timestamptz),
  sniper_serie_pagina(integer, integer), sniper_token(), sniper_url_funcion() from public, anon, authenticated;
