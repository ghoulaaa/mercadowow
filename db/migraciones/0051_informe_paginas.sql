-- =====================================================================
-- 0051 — Informe diario en páginas: la sección «Más comercializados» se sustituye por «Consumibles más
-- vendidos». gestionar_informe acepta la clave nueva («consumibles») y deja de aceptar «comerciados».
-- (El dibujo en páginas apaisadas, una por embed de Discord, está en app/static/informe.js.)
-- =====================================================================

update informe_config set secciones = secciones - 'comerciados' where secciones ? 'comerciados';

create or replace function gestionar_informe(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c jsonb := coalesce(p->'cambios', '{}'::jsonb); k text; v jsonb;
begin
  if p->>'accion' <> 'config' then raise exception 'Acción desconocida'; end if;
  if jsonb_typeof(c) <> 'object' then raise exception 'Cambios no válidos'; end if;
  if c ? 'market_key' and not exists (select 1 from markets where key = c->>'market_key' and not is_demo) then
    raise exception 'Mercado desconocido';
  end if;
  if c ? 'zona' and not exists (select 1 from pg_timezone_names where name = c->>'zona') then
    raise exception 'Zona horaria desconocida';
  end if;
  if c ? 'webhooks' then
    if jsonb_typeof(c->'webhooks') <> 'array' then raise exception 'Webhooks no válidos'; end if;
    if exists (select 1 from jsonb_array_elements_text(c->'webhooks') t
                where t !~ '^[0-9]{1,9}$' or not exists (select 1 from sniper_webhooks w where w.id = t::integer)) then
      raise exception 'Webhook desconocido';
    end if;
  end if;
  if c ? 'secciones' then
    if jsonb_typeof(c->'secciones') <> 'object' then raise exception 'Secciones no válidas'; end if;
    for k, v in select key, value from jsonb_each(c->'secciones') loop
      if k not in ('kpi', 'grafico', 'volumen', 'consumibles', 'subidas', 'caidas', 'arbitraje', 'gangas', 'crafteos',
                   'categorias', 'destacados') then raise exception 'Sección desconocida: %', k; end if;
      if jsonb_typeof(v) <> 'boolean' then raise exception 'La sección «%» debe ser sí o no', k; end if;
    end loop;
  end if;
  if c ? 'nombre' and (c->>'nombre') ~* '(discord|clyde)' then
    raise exception 'Discord no permite «discord» ni «clyde» en el nombre del webhook';
  end if;
  update informe_config set
    activo = coalesce((c->>'activo')::boolean, activo),
    market_key = coalesce(c->>'market_key', market_key),
    hora = coalesce((c->>'hora')::smallint, hora),
    zona = coalesce(c->>'zona', zona),
    webhooks = case when c ? 'webhooks' then array(select distinct t::integer from jsonb_array_elements_text(c->'webhooks') t) else webhooks end,
    secciones = coalesce(c->'secciones', secciones),
    gangas_desc_min = coalesce((c->>'gangas_desc_min')::numeric, gangas_desc_min),
    craft_roi_min = coalesce((c->>'craft_roi_min')::numeric, craft_roi_min),
    neta_min = coalesce((c->>'neta_min')::bigint, neta_min),
    liquidez_min = coalesce((c->>'liquidez_min')::numeric, liquidez_min),
    por_seccion = coalesce((c->>'por_seccion')::smallint, por_seccion),
    nombre = coalesce(nullif(btrim(c->>'nombre'), ''), nombre),
    avatar = case when c ? 'avatar' then nullif(btrim(c->>'avatar'), '') else avatar end,
    actualizado = now()
   where id = 1;
  return informe_estado();
exception
  when invalid_text_representation or numeric_value_out_of_range or check_violation or datatype_mismatch then
    raise exception 'Valor no válido en la configuración: %', sqlerrm;
end $$;

revoke all on function gestionar_informe(jsonb) from public, anon, authenticated;
