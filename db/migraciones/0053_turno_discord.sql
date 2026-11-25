-- =====================================================================
-- 0053 — Un solo envío a Discord a la vez: el Crafting Sniper y el informe diario comparten turno.
-- Mientras uno prepara o envía sus mensajes, el otro no empieza (así el informe llega entero, sin avisos del
-- sniper intercalados). El automático que encuentra el turno ocupado lo intenta en su siguiente vuelta de
-- pg_cron (sniper: 5 min; informe: 15 min). Un candado de transacción evita que los dos lo tomen a la vez.
-- =====================================================================

create or replace function sniper_tomar_turno(p_segundos integer default 240, p_now timestamptz default now())
returns boolean language plpgsql as $$
begin
  perform pg_advisory_xact_lock(hashtext('mercadowow:turno_discord'));
  if exists (select 1 from informe_config where id = 1 and turno_hasta > p_now) then return false; end if;
  update sniper_config set turno_hasta = p_now + make_interval(secs => p_segundos) where id = 1 and turno_hasta <= p_now;
  return found;
end $$;

create or replace function informe_tomar_turno(p_segundos integer, p_now timestamptz default now()) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  perform pg_advisory_xact_lock(hashtext('mercadowow:turno_discord'));
  if exists (select 1 from sniper_config where id = 1 and turno_hasta > p_now) then return false; end if;
  update informe_config set turno_hasta = p_now + make_interval(secs => p_segundos) where id = 1 and turno_hasta <= p_now;
  return found;
end $$;

/** ¿Toca analizar? Activo, con algún webhook activo, sin otro análisis ni informe en curso, y escaneo nuevo o intervalo cumplido. */
create or replace function sniper_toca(p_now timestamptz default now()) returns boolean language sql stable as $$
  select c.activo
     and exists (select 1 from sniper_webhooks w where w.activo)
     and c.turno_hasta <= p_now
     and not exists (select 1 from informe_config i where i.id = 1 and i.turno_hasta > p_now)
     and (c.ultimo_analisis is null
          or c.ultimo_analisis <= p_now - make_interval(mins => c.intervalo_min)
          or coalesce((select max(s.source_updated_at) from snapshots s join markets m on m.id = s.market_id
                        where m.key = c.market_key), '-infinity') > coalesce(c.ultimo_escaneo, '-infinity'))
    from sniper_config c where c.id = 1
$$;

/** ¿Toca el informe automático? (igual que en 0049) y además sin un análisis del sniper en curso. */
create or replace function informe_toca(p_now timestamptz default now()) returns boolean
language sql stable security definer set search_path = public as $$
  select c.activo
     and exists (select 1 from sniper_webhooks w where w.activo and (cardinality(c.webhooks) = 0 or w.id = any(c.webhooks)))
     and (date_trunc('day', p_now at time zone c.zona) + make_interval(hours => c.hora)) at time zone c.zona <= p_now
     and not exists (select 1 from informes i where i.market_key = c.market_key and i.tipo = 'auto'
                       and i.fecha = (p_now at time zone c.zona)::date and i.estado in ('enviado', 'parcial'))
     and (select count(*) from informes i where i.market_key = c.market_key and i.tipo = 'auto'
            and i.fecha = (p_now at time zone c.zona)::date and i.estado in ('error', 'generado')) < 3
     and not exists (select 1 from informes i where i.market_key = c.market_key and i.tipo = 'auto'
                       and i.fecha = (p_now at time zone c.zona)::date and i.estado in ('error', 'generado')
                       and i.creado > p_now - interval '20 minutes')
     and c.turno_hasta <= p_now
     and not exists (select 1 from sniper_config s where s.id = 1 and s.turno_hasta > p_now)
    from informe_config c where c.id = 1
$$;

revoke all on function sniper_tomar_turno(integer, timestamptz), informe_tomar_turno(integer, timestamptz),
  sniper_toca(timestamptz), informe_toca(timestamptz) from public, anon, authenticated;
