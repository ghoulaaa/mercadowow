-- =====================================================================
-- 0003 — Soporte para la página web pública (Netlify):
--   * estado_mercado(): una sola fuente para el panel (Python y Netlify).
--   * Registro de intentos de acceso para frenar ataques de fuerza bruta.
-- Requiere que existan los roles anon/authenticated (Supabase los trae).
-- =====================================================================

create function estado_mercado(p_market_key text) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'hora_servidor', now(),
    'mercado', jsonb_build_object(
      'clave', m.key, 'nombre', m.label, 'proveedor', upper(m.provider),
      'ficticio', m.is_demo, 'fuente', m.source_url),
    'actualizacion', jsonb_build_object(
      'configurada',         exists (select 1 from settings where key = 'url_funcion'),
      'en_curso',            coalesce(s.lease_expires_at > now(), false),
      'hora_dato_original',  s.last_source_updated_at,
      'ultima_consulta_ok',  s.last_success_at,
      'ultimo_dato_nuevo',   s.last_new_data_at,
      'ultimo_intento',      s.last_attempt_at,
      'proxima',             case when isfinite(s.next_attempt_at) then s.next_attempt_at end,
      'fallos_seguidos',     coalesce(s.consecutive_failures, 0),
      'ultimo_error',        s.last_error,
      'ultimo_error_hora',   s.last_error_at,
      'versiones_guardadas', (select count(*) from snapshots x where x.market_id = m.id),
      'objetos',             (select count(*) from items i where i.market_id = m.id)),
    'registro', coalesce((
      select jsonb_agg(r order by r.hora desc)
        from (select l.finished_at as hora, l.status as estado, l.http_status as http,
                     l.rows_received as filas, l.message as mensaje
                from fetch_log l
               where l.market_id = m.id
               order by l.finished_at desc
               limit 8) r), '[]'::jsonb))
  from markets m
  left join fetch_state s on s.market_id = m.id
  where m.key = p_market_key
$$;

create table login_intentos (
  id  bigint generated always as identity primary key,
  ip  text not null,
  ok  boolean not null,
  at  timestamptz not null default now()
);
create index login_intentos_ip_at on login_intentos (ip, at);
create index login_intentos_at on login_intentos (at);

-- ¿Hay que rechazar el intento? 10 fallos por IP o 50 en total en 15 minutos.
create function login_bloqueado(p_ip text, p_now timestamptz default now()) returns boolean
language sql stable as $$
  select (select count(*) from login_intentos
           where ip = p_ip and not ok and at > p_now - interval '15 minutes') >= 10
      or (select count(*) from login_intentos
           where not ok and at > p_now - interval '15 minutes') >= 50
$$;

create function registrar_login(p_ip text, p_ok boolean, p_now timestamptz default now()) returns void
language sql as $$
  delete from login_intentos where at < p_now - interval '30 days';
  insert into login_intentos (ip, ok, at) values (left(p_ip, 100), p_ok, p_now);
$$;

alter table login_intentos enable row level security;
revoke all on login_intentos from anon, authenticated;
revoke execute on function estado_mercado(text) from public, anon, authenticated;
revoke execute on function login_bloqueado(text, timestamptz) from public, anon, authenticated;
revoke execute on function registrar_login(text, boolean, timestamptz) from public, anon, authenticated;
