-- =====================================================================
-- 0002 — Específico de Supabase: seguridad y programación horaria.
-- =====================================================================

-- Seguridad: nadie desde la API pública (claves anon/publishable) puede leer
-- ni escribir. Solo el servidor (conexión directa a Postgres) y la Edge Function.
alter table markets            enable row level security;
alter table settings           enable row level security;
alter table items              enable row level security;
alter table snapshots          enable row level security;
alter table price_hourly       enable row level security;
alter table price_daily        enable row level security;
alter table fetch_state        enable row level security;
alter table fetch_log          enable row level security;
alter table inventory          enable row level security;
alter table favorites          enable row level security;
alter table sales              enable row level security;
alter table recommendation_log enable row level security;

revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;

-- Programación: cada 5 minutos se comprueba si TOCA consultar (normalmente cada
-- 60 min, o antes si hubo un fallo o se pulsó el botón manual). Si no toca, no
-- se llama a nada: no gasta invocaciones de la Edge Function.
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

create function disparar_si_corresponde() returns void
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_url text := (select value from settings where key = 'url_funcion');
begin
  if v_url is null then
    return;  -- todavía no se configuró la URL de la Edge Function
  end if;
  if exists (select 1 from fetch_state
              where next_attempt_at <= now()
                and (lease_expires_at is null or lease_expires_at <= now())) then
    perform net.http_post(
      url                  := v_url,
      body                 := '{}'::jsonb,
      headers              := '{"Content-Type": "application/json"}'::jsonb,
      timeout_milliseconds := 60000);
  end if;
end $$;

revoke execute on function disparar_si_corresponde() from public, anon, authenticated;

select cron.schedule('mercado-actualizar', '*/5 * * * *', 'select public.disparar_si_corresponde()');
