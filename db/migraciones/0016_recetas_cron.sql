-- =====================================================================
-- 0016 — Específico de Supabase: recetas una vez al día.
-- Cada hora (minuto 17) mira si alguna profesión lleva más de ~1 día sin descargar;
-- si es así y nadie lo está haciendo, pide a la Edge Function {"tarea": "recetas"}.
-- Son 11 peticiones a AHledger al día (muy por debajo de su límite de 300/min).
-- =====================================================================

create function disparar_recetas() returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_url text := (select value from settings where key = 'url_funcion');
begin
  if v_url is null then return; end if;
  if (select value::timestamptz from settings where key = 'recetas_turno_hasta') > now() then return; end if;
  if cardinality(recetas_pendientes('forever')) = 0 then return; end if;
  perform net.http_post(
    url                  := v_url,
    body                 := '{"tarea": "recetas"}'::jsonb,
    headers              := '{"Content-Type": "application/json"}'::jsonb,
    timeout_milliseconds := 120000);
end $$;

revoke execute on function disparar_recetas() from public, anon, authenticated;

select cron.schedule('mercado-recetas', '17 * * * *', 'select public.disparar_recetas()');
