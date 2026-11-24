-- =====================================================================
-- 0046 — Específico de Supabase: el Crafting Sniper funciona solo, sin la página abierta.
-- Cada 5 minutos, si está activo, hay algún webhook y llegó un escaneo nuevo (o pasó el intervalo
-- configurado) y nadie lo está analizando, pide a la Edge Function {"tarea": "sniper"}.
-- La página puede pedir una prueba, un envío manual o un análisis inmediato (sniper_solicitar).
-- =====================================================================

insert into settings (key, value) values ('sniper_ultima_solicitud', '-infinity') on conflict (key) do nothing;

create function disparar_sniper() returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_url text := (select value from settings where key = 'url_funcion');
begin
  if v_url is null or not sniper_toca() then return; end if;
  perform net.http_post(
    url                  := v_url,
    body                 := '{"tarea": "sniper"}'::jsonb,
    headers              := '{"Content-Type": "application/json"}'::jsonb,
    timeout_milliseconds := 120000);
end $$;

/**
 * Peticiones de la página: {accion: "prueba", webhook} · {accion: "manual", spell, webhook?} · {accion: "analizar"}.
 * Como mucho una cada 10 segundos (protección contra abuso y contra el límite de Discord).
 */
create function sniper_solicitar(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_url text := (select value from settings where key = 'url_funcion');
  v_cuerpo jsonb;
begin
  if v_url is null then raise exception 'La Edge Function no está configurada (url_funcion)'; end if;
  case p->>'accion'
  when 'prueba' then
    if not exists (select 1 from sniper_webhooks where id = (p->>'webhook')::integer) then raise exception 'Webhook desconocido'; end if;
    v_cuerpo := jsonb_build_object('tarea', 'sniper', 'modo', 'prueba', 'webhook', (p->>'webhook')::integer);
  when 'manual' then
    if (p->>'spell') !~ '^[0-9]{1,9}$' then raise exception 'Receta no válida'; end if;
    if p ? 'webhook' and not exists (select 1 from sniper_webhooks where id = (p->>'webhook')::integer) then
      raise exception 'Webhook desconocido';
    end if;
    v_cuerpo := jsonb_build_object('tarea', 'sniper', 'modo', 'manual', 'spell', (p->>'spell')::integer)
                || case when p ? 'webhook' then jsonb_build_object('webhook', (p->>'webhook')::integer) else '{}'::jsonb end;
  when 'analizar' then
    v_cuerpo := '{"tarea": "sniper", "modo": "analizar"}'::jsonb;
  else
    raise exception 'Acción desconocida';
  end case;
  update settings set value = now()::text
   where key = 'sniper_ultima_solicitud' and value::timestamptz <= now() - interval '10 seconds';
  if not found then raise exception 'Espera unos segundos antes de volver a pedirlo'; end if;
  perform net.http_post(url := v_url, body := v_cuerpo,
                        headers := '{"Content-Type": "application/json"}'::jsonb, timeout_milliseconds := 120000);
  return jsonb_build_object('ok', true);
end $$;

revoke execute on function disparar_sniper(), sniper_solicitar(jsonb) from public, anon, authenticated;

select cron.schedule('mercado-sniper', '4-59/5 * * * *', 'select public.disparar_sniper()');
