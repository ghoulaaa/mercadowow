-- =====================================================================
-- 0037 — Específico de Supabase: la tarea de cada 5 minutos también hace la segunda pasada
-- (objetos nuevos de Forever) cuando la primera ya no tiene pendientes.
-- =====================================================================

create or replace function disparar_nombres_es() returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_url  text := (select value from settings where key = 'url_funcion');
  v_body jsonb;
begin
  if v_url is null then return; end if;
  if (select value::timestamptz from settings where key = 'nombres_es_turno_hasta') > now() then return; end if;
  if cardinality(nombres_es_pendientes('forever', 1)) > 0 then v_body := '{"tarea": "nombres_es"}';
  elsif jsonb_array_length(nombres_es_pendientes_extra('forever', 1)) > 0 then v_body := '{"tarea": "nombres_es_extra"}';
  else return;
  end if;
  perform net.http_post(url := v_url, body := v_body,
                        headers := '{"Content-Type": "application/json"}'::jsonb, timeout_milliseconds := 120000);
end $$;

revoke execute on function disparar_nombres_es() from public, anon, authenticated;
