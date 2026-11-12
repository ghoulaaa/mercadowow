-- =====================================================================
-- 0041 — Específico de Supabase: fichas oficiales de los objetos por lotes.
-- Cada 5 minutos, si quedan objetos sin ficha y nadie lo está haciendo (ni hay pausa),
-- pide a la Edge Function {"tarea": "fichas"}. Cuando ya no quedan, no hace nada.
-- =====================================================================

create function disparar_fichas() returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_url text := (select value from settings where key = 'url_funcion');
begin
  if v_url is null then return; end if;
  if (select value::timestamptz from settings where key = 'fichas_turno_hasta') > now() then return; end if;
  if jsonb_array_length(fichas_pendientes('forever', 1)) = 0 then return; end if;
  perform net.http_post(
    url                  := v_url,
    body                 := '{"tarea": "fichas"}'::jsonb,
    headers              := '{"Content-Type": "application/json"}'::jsonb,
    timeout_milliseconds := 120000);
end $$;

revoke execute on function disparar_fichas() from public, anon, authenticated;

select cron.schedule('mercado-fichas', '2-59/5 * * * *', 'select public.disparar_fichas()');
