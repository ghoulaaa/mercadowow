-- =====================================================================
-- 0027 — Específico de Supabase: archivo regional de TSM una vez al día.
-- Cada hora (minuto 37) mira si la última importación tiene más de ~1 día;
-- si es así y nadie lo está haciendo, pide a la Edge Function {"tarea": "region"}.
-- Es una sola descarga al día.
-- =====================================================================

create function disparar_region() returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_url text := (select value from settings where key = 'url_funcion');
begin
  if v_url is null then return; end if;
  if (select value::timestamptz from settings where key = 'region_turno_hasta') > now() then return; end if;
  if not region_pendiente('forever', 'us') then return; end if;
  perform net.http_post(
    url                  := v_url,
    body                 := '{"tarea": "region"}'::jsonb,
    headers              := '{"Content-Type": "application/json"}'::jsonb,
    timeout_milliseconds := 120000);
end $$;

revoke execute on function disparar_region() from public, anon, authenticated;

select cron.schedule('mercado-region', '37 * * * *', 'select public.disparar_region()');
