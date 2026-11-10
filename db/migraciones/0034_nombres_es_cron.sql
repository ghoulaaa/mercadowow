-- =====================================================================
-- 0034 — Específico de Supabase: nombres en español por lotes.
-- Cada 5 minutos, si quedan objetos sin nombre en español y nadie lo está haciendo (ni hay una
-- pausa, p. ej. por faltar las credenciales de Blizzard), pide a la Edge Function {"tarea": "nombres_es"}.
-- Cuando ya no quedan pendientes, no hace nada.
-- =====================================================================

create function disparar_nombres_es() returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_url text := (select value from settings where key = 'url_funcion');
begin
  if v_url is null then return; end if;
  if (select value::timestamptz from settings where key = 'nombres_es_turno_hasta') > now() then return; end if;
  if cardinality(nombres_es_pendientes('forever', 1)) = 0 then return; end if;
  perform net.http_post(
    url                  := v_url,
    body                 := '{"tarea": "nombres_es"}'::jsonb,
    headers              := '{"Content-Type": "application/json"}'::jsonb,
    timeout_milliseconds := 120000);
end $$;

revoke execute on function disparar_nombres_es() from public, anon, authenticated;

select cron.schedule('mercado-nombres-es', '*/5 * * * *', 'select public.disparar_nombres_es()');
