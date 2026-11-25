-- =====================================================================
-- 0050 — Específico de Supabase: el informe diario sale solo, sin la página abierta.
-- Cada 15 minutos, si toca (informe_toca: activo, pasada la hora del día en su zona, sin enviar hoy, menos
-- de 3 fallos), pide a la Edge Function {"tarea": "informe", "modo": "auto"}. La página puede pedir una
-- vista previa, un envío inmediato o una prueba del webhook (informe_solicitar).
-- =====================================================================

create function disparar_informe() returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_url text := (select value from settings where key = 'url_funcion');
begin
  if v_url is null or not informe_toca() then return; end if;
  perform net.http_post(
    url                  := v_url,
    body                 := '{"tarea": "informe", "modo": "auto"}'::jsonb,
    headers              := '{"Content-Type": "application/json"}'::jsonb,
    timeout_milliseconds := 150000);
end $$;

/**
 * Peticiones de la página: {accion: "generar"} (vista previa, sin enviar) · {accion: "enviar"} (genera y envía
 * ahora) · {accion: "prueba", webhook}. Como mucho una cada 10 segundos.
 */
create function informe_solicitar(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_url text := (select value from settings where key = 'url_funcion');
  v_cuerpo jsonb;
begin
  if v_url is null then raise exception 'La Edge Function no está configurada (url_funcion)'; end if;
  case p->>'accion'
  when 'generar' then v_cuerpo := '{"tarea": "informe", "modo": "generar"}'::jsonb;
  when 'enviar' then v_cuerpo := '{"tarea": "informe", "modo": "enviar"}'::jsonb;
  when 'prueba' then
    if (p->>'webhook') !~ '^[0-9]{1,9}$' or not exists (select 1 from sniper_webhooks where id = (p->>'webhook')::integer) then
      raise exception 'Webhook desconocido';
    end if;
    v_cuerpo := jsonb_build_object('tarea', 'informe', 'modo', 'prueba', 'webhook', (p->>'webhook')::integer);
  else
    raise exception 'Acción desconocida';
  end case;
  update settings set value = now()::text
   where key = 'informe_ultima_solicitud' and value::timestamptz <= now() - interval '10 seconds';
  if not found then raise exception 'Espera unos segundos antes de volver a pedirlo'; end if;
  perform net.http_post(url := v_url, body := v_cuerpo,
                        headers := '{"Content-Type": "application/json"}'::jsonb, timeout_milliseconds := 150000);
  return jsonb_build_object('ok', true);
end $$;

revoke execute on function disparar_informe(), informe_solicitar(jsonb) from public, anon, authenticated;

select cron.schedule('mercado-informe', '7-59/15 * * * *', 'select public.disparar_informe()');
