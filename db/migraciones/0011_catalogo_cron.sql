-- =====================================================================
-- 0011 — Específico de Supabase: completar el catálogo poco a poco.
-- Cada 5 minutos, si hay objetos pendientes y nadie lo está haciendo, se pide a la
-- Edge Function un lote (≈150 objetos). Respeta el límite de AHledger (300/min).
-- =====================================================================

create function disparar_catalogo() returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_url text := (select value from settings where key = 'url_funcion');
begin
  if v_url is null then return; end if;
  if (select value::timestamptz from settings where key = 'catalogo_turno_hasta') > now() then return; end if;
  if cardinality(catalogo_pendientes('forever', 1)) = 0 then return; end if;
  perform net.http_post(
    url                  := v_url,
    body                 := '{"tarea": "catalogo"}'::jsonb,
    headers              := '{"Content-Type": "application/json"}'::jsonb,
    timeout_milliseconds := 60000);
end $$;

revoke execute on function disparar_catalogo() from public, anon, authenticated;

select cron.schedule('mercado-catalogo', '*/5 * * * *', 'select public.disparar_catalogo()');
