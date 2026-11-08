-- =====================================================================
-- 0006 — Motor de recomendaciones: VENDER / GUARDAR / EN OBSERVACIÓN.
--
-- Reglas transparentes y configurables (tabla settings, claves motor.*).
-- Solo usa el historial PROPIO guardado por la app (no inventa nada):
--   * medianas de 7, 14 y 30 días, tendencia (pendiente) y volatilidad,
--   * persistencia de la subida en las últimas observaciones,
--   * evidencia de recuperación tras caídas anteriores (para GUARDAR).
-- La confianza es un ÍNDICE DE CALIDAD DE DATOS (0–100), no una probabilidad.
-- Sin datos de liquidez (TSM no los publica) la confianza se limita a «Media».
-- =====================================================================

insert into settings (key, value) values
  ('motor.vender_sobre_med7_pct',     '15'),   -- VENDER: precio ≥ mediana 7 d + 15 %
  ('motor.vender_sobre_med30_pct',    '10'),   --         y ≥ mediana 30 d + 10 %
  ('motor.vender_persistencia_obs',   '2'),    --         en al menos 2 de las 3 últimas observaciones
  ('motor.guardar_bajo_med30_pct',    '15'),   -- GUARDAR: precio ≤ mediana 30 d − 15 %
  ('motor.guardar_min_recuperaciones','2'),    --          con ≥ 2 días de caídas previas que se recuperaron
  ('motor.caida_fuerte_pct_dia',      '1.5'),  -- tendencia 14 d más negativa que −1,5 %/día = caída estructural
  ('motor.subida_fuerte_pct_dia',     '3'),    -- tendencia 7 d > +3 %/día: aviso «podría seguir subiendo»
  ('motor.min_dias_historial',        '7'),    -- menos días de historial propio → EN OBSERVACIÓN
  ('motor.min_observaciones',         '10'),   -- menos observaciones en 30 d → EN OBSERVACIÓN
  ('motor.dato_antiguo_horas',        '8'),    -- dato más viejo → EN OBSERVACIÓN
  ('motor.extremo_factor',            '3'),    -- precio > 3× o < 1/3 de la mediana 30 d → extremo
  ('motor.comision_pct',              '5'),    -- comisión de la casa de subastas de facción (ASUMIDA, sin verificar)
  ('motor.deposito_minimo_cobre',     '100')   -- depósito mínimo por publicación (1p según guías, sin verificar)
on conflict (key) do nothing;

create function ajuste_num(p_key text, p_default numeric) returns numeric
language sql stable as $$
  select coalesce((select value::numeric from settings where key = p_key), p_default)
$$;

-- ---------- formato para las explicaciones ----------
create function fmt_moneda(p_cobre numeric) returns text language plpgsql immutable as $$
declare
  v bigint; o bigint; pl bigint; c bigint; partes text[] := '{}';
begin
  if p_cobre is null then return '—'; end if;
  v := abs(round(p_cobre));
  o := v / 10000; pl := (v % 10000) / 100; c := v % 100;
  if o > 0 then partes := partes || (o::text || 'o'); end if;
  if pl > 0 then partes := partes || (pl::text || 'p'); end if;
  if c > 0 or cardinality(partes) = 0 then partes := partes || (c::text || 'c'); end if;
  return case when p_cobre < 0 then '−' else '' end || array_to_string(partes, ' ');
end $$;

create function fmt_pct(p numeric) returns text language sql immutable as $$
  select case when p is null then '—'
              else case when p > 0 then '+' when p < 0 then '−' else '' end
                   || replace(to_char(abs(round(p * 100, 1)), 'FM9999990.0'), '.', ',') || ' %' end
$$;

create function fmt_num(p numeric, p_dec integer default 1) returns text language sql immutable as $$
  select replace(round(p, p_dec)::text, '.', ',')
$$;

create function fmt_hora(p timestamptz) returns text language sql immutable as $$
  select to_char(p at time zone 'UTC', 'DD/MM HH24:MI') || ' UTC'
$$;

-- ---------- almacenamiento del resultado ----------
create table recomendaciones (
  market_id      smallint not null references markets(id),
  item_id        integer not null,
  recomendacion  text not null check (recomendacion in ('VENDER', 'GUARDAR', 'OBSERVACION')),
  puntos_base    integer not null check (puntos_base between 0 and 100),
  resumen        text not null,
  cifras         jsonb not null,
  motivos        jsonb not null,
  riesgos        jsonb not null,
  desglose       jsonb not null,
  horizonte      text,
  calculado_en   timestamptz not null,
  primary key (market_id, item_id)
);

create table recomendaciones_estado (
  market_id    smallint primary key references markets(id),
  firma        text not null,
  calculado_en timestamptz not null,
  objetos      integer not null,
  milisegundos integer not null
);

alter table recomendaciones enable row level security;
alter table recomendaciones_estado enable row level security;
revoke all on recomendaciones, recomendaciones_estado from anon, authenticated;

-- Firma = última versión de datos + ajustes del motor. Si no cambia, no se recalcula.
create function _firma_motor(p_market_id smallint) returns text language sql stable as $$
  select coalesce((select max(id) from snapshots where market_id = p_market_id), 0)::text || ':' ||
         md5(coalesce((select string_agg(key || '=' || value, ',' order by key)
                         from settings where key like 'motor.%'), ''))
$$;

-- ---------- cálculo ----------
create function recalcular_recomendaciones(p_market_key text, p_forzar boolean default false)
returns jsonb language plpgsql as $$
declare
  v_mid        smallint;
  v_firma      text;
  v_ref        timestamptz;
  v_t0         timestamptz := clock_timestamp();
  v_n          integer := 0;
  -- ajustes
  u7           numeric := ajuste_num('motor.vender_sobre_med7_pct', 15) / 100;
  u30          numeric := ajuste_num('motor.vender_sobre_med30_pct', 10) / 100;
  persist_min  integer := ajuste_num('motor.vender_persistencia_obs', 2);
  g30          numeric := ajuste_num('motor.guardar_bajo_med30_pct', 15) / 100;
  rec_min      integer := ajuste_num('motor.guardar_min_recuperaciones', 2);
  caida_fuerte numeric := ajuste_num('motor.caida_fuerte_pct_dia', 1.5) / 100;
  subida_fuerte numeric := ajuste_num('motor.subida_fuerte_pct_dia', 3) / 100;
  min_dias     numeric := ajuste_num('motor.min_dias_historial', 7);
  min_obs      integer := ajuste_num('motor.min_observaciones', 10);
  extremo_f    numeric := ajuste_num('motor.extremo_factor', 3);
  r            record;
  v_rec        text;
  v_resumen    text;
  v_motivos    jsonb;
  v_riesgos    jsonb;
  v_horizonte  text;
  d7           numeric;
  d30          numeric;
  v_pers       integer;
  v_extremo    boolean;
  p_hist       integer;
  p_obs        integer;
  p_cal        integer;
  v_desglose   jsonb;
begin
  select id into v_mid from markets where key = p_market_key;
  if v_mid is null then
    raise exception 'Mercado desconocido: %', p_market_key;
  end if;

  -- Un solo cálculo a la vez por mercado; el segundo espera y luego ve que ya está al día.
  perform pg_advisory_xact_lock(hashtext('recomendaciones'), v_mid);
  v_firma := _firma_motor(v_mid);
  if not p_forzar and exists (select 1 from recomendaciones_estado where market_id = v_mid and firma = v_firma) then
    return jsonb_build_object('estado', 'al_dia');
  end if;

  delete from recomendaciones where market_id = v_mid;
  select max(source_updated_at) into v_ref from snapshots where market_id = v_mid;

  if v_ref is not null then
    -- Observaciones de los últimos 30 días (precio = compra mínima o, si falta, valor de mercado).
    drop table if exists _obs;
    create temporary table _obs on commit drop as
      select p.item_id, p.hour, coalesce(p.min_buyout, p.market_value)::numeric as precio,
             p.min_buyout, p.market_value, p.historical
        from price_hourly p
       where p.market_id = v_mid
         and p.hour > v_ref - interval '30 days'
         and coalesce(p.min_buyout, p.market_value) is not null;
    create index on _obs (item_id, hour);
    analyze _obs;

    drop table if exists _est;
    create temporary table _est on commit drop as
      select item_id,
             count(*)                                                              as n30,
             count(*) filter (where hour > v_ref - interval '7 days')              as n7,
             percentile_cont(0.5) within group (order by precio)
               filter (where hour > v_ref - interval '7 days')::numeric            as med7,
             percentile_cont(0.5) within group (order by precio)
               filter (where hour > v_ref - interval '14 days')::numeric           as med14,
             (percentile_cont(0.5) within group (order by precio))::numeric       as med30,
             (stddev_samp(precio) / nullif(avg(precio), 0))::numeric               as cv30,
             (extract(epoch from (v_ref - min(hour))) / 86400.0)::numeric          as dias_hist,
             regr_slope(precio, extract(epoch from hour) / 86400.0)
               filter (where hour > v_ref - interval '7 days')::numeric            as pend7_abs,
             regr_slope(precio, extract(epoch from hour) / 86400.0)
               filter (where hour > v_ref - interval '14 days')::numeric           as pend14_abs,
             -- Tendencia ANTERIOR a la caída actual (de −17 a −3 días): distingue una bajada
             -- puntual de una caída que ya venía de antes (estructural).
             regr_slope(precio, extract(epoch from hour) / 86400.0)
               filter (where hour > v_ref - interval '17 days'
                         and hour <= v_ref - interval '3 days')::numeric           as pendprev_abs
        from _obs
       group by item_id;
    create index on _est (item_id);

    -- Caídas anteriores (≥ 3 días antes de la referencia) y si el precio volvió a ≥ 95 % de la mediana.
    drop table if exists _rec;
    create temporary table _rec on commit drop as
      with caidas as (
        select o.item_id, o.hour, e.med30
          from _obs o join _est e using (item_id)
         where o.precio <= e.med30 * (1 - g30)
           and o.hour < v_ref - interval '3 days'
      ),
      vueltas as (
        select c.item_id, c.hour,
               (select min(o2.hour) from _obs o2
                 where o2.item_id = c.item_id and o2.hour > c.hour and o2.precio >= c.med30 * 0.95) as hora_vuelta
          from caidas c
      )
      select item_id,
             count(distinct date_trunc('day', hour, 'UTC'))                              as dias_caida,
             count(distinct date_trunc('day', hour, 'UTC')) filter (where hora_vuelta is not null) as dias_recuperados,
             percentile_cont(0.5) within group (order by extract(epoch from (hora_vuelta - hour)) / 86400.0)
               filter (where hora_vuelta is not null)::numeric                            as dias_recuperacion
        from vueltas
       group by item_id;

    for r in
      select i.item_id, i.name,
             u.hour as ult_hora, u.precio, u.min_buyout, u.market_value, u.historical,
             e.n30, e.n7, e.med7, e.med14, e.med30, e.cv30, e.dias_hist,
             e.pend7_abs / nullif(e.med7, 0)   as pend7,
             e.pend14_abs / nullif(e.med14, 0) as pend14,
             e.pendprev_abs / nullif(e.med30, 0) as pendprev,
             (select array_agg(x.precio order by x.hour desc)
                from (select o.precio, o.hour from _obs o where o.item_id = i.item_id
                       order by o.hour desc limit 3) x) as ultimos,
             coalesce(rc.dias_caida, 0) as dias_caida,
             coalesce(rc.dias_recuperados, 0) as dias_recuperados,
             rc.dias_recuperacion
        from items i
        left join lateral (
          select o.hour, o.precio, o.min_buyout, o.market_value, o.historical
            from _obs o where o.item_id = i.item_id order by o.hour desc limit 1
        ) u on true
        left join _est e on e.item_id = i.item_id
        left join _rec rc on rc.item_id = i.item_id
       where i.market_id = v_mid
    loop
      v_rec := 'OBSERVACION'; v_motivos := '[]'; v_horizonte := null;
      v_riesgos := '["Sin datos de volumen ni de unidades en venta: no se puede saber lo rápido que se venderá."]'::jsonb;
      d7 := case when r.med7 > 0 then r.precio / r.med7 - 1 end;
      d30 := case when r.med30 > 0 then r.precio / r.med30 - 1 end;
      v_pers := coalesce((select count(*) from unnest(r.ultimos) x where r.med7 > 0 and x >= r.med7 * (1 + u7)), 0);
      v_extremo := coalesce(
                     (r.med30 > 0 and (r.precio > r.med30 * extremo_f or r.precio < r.med30 / extremo_f))
                     or (r.min_buyout > 0 and r.market_value > 0
                         and greatest(r.min_buyout, r.market_value) > least(r.min_buyout, r.market_value) * extremo_f),
                     false);

      if r.precio is null then
        v_resumen := 'Sin precios en los últimos 30 días';
        v_motivos := jsonb_build_array('No hay ninguna observación de este objeto en los últimos 30 días.');
      elsif r.ult_hora < date_trunc('hour', v_ref, 'UTC') then
        v_resumen := 'No aparece en el último escaneo';
        v_motivos := jsonb_build_array(format(
          'Visto por última vez el %s a %s. Que desaparezca no significa que se haya vendido.',
          fmt_hora(r.ult_hora), fmt_moneda(r.precio)));
      elsif r.dias_hist < min_dias or r.n30 < min_obs then
        v_resumen := format('Historial insuficiente (%s días, %s observaciones)', fmt_num(r.dias_hist), r.n30);
        v_motivos := jsonb_build_array(format(
          'Se necesitan al menos %s días y %s observaciones propias para comparar con medianas; hay %s días y %s.',
          fmt_num(min_dias, 0), min_obs, fmt_num(r.dias_hist), r.n30));
        if r.historical > 0 then
          v_motivos := v_motivos || to_jsonb(format(
            'Solo como dato informativo: el precio actual (%s) está %s respecto al valor histórico de TSM (%s).',
            fmt_moneda(r.precio), fmt_pct(r.precio / r.historical - 1), fmt_moneda(r.historical)));
        end if;
      elsif v_extremo then
        v_resumen := 'Precio extremo: posible error o muy poca oferta';
        v_motivos := jsonb_build_array(format(
          'El precio actual (%s) se aleja más de %s veces de la mediana de 30 días (%s) o del valor de mercado (%s).',
          fmt_moneda(r.precio), fmt_num(extremo_f, 0), fmt_moneda(r.med30), fmt_moneda(r.market_value)));
        v_riesgos := v_riesgos || to_jsonb('Puede ser un único anuncio con precio fuera de lugar.'::text);
      else
        v_motivos := jsonb_build_array(format(
          'Precio actual %s (%s). Medianas propias: 7 días %s · 14 días %s · 30 días %s (%s observaciones en %s días).',
          fmt_moneda(r.precio), fmt_hora(r.ult_hora), fmt_moneda(r.med7), fmt_moneda(r.med14), fmt_moneda(r.med30),
          r.n30, fmt_num(r.dias_hist)));

        if d7 >= u7 and d30 >= u30 and v_pers >= persist_min then
          v_rec := 'VENDER';
          v_resumen := format('%s sobre la mediana de 30 días', fmt_pct(d30));
          v_motivos := v_motivos || to_jsonb(format(
            'Está %s sobre la mediana de 7 días (umbral %s) y %s sobre la de 30 días (umbral %s).',
            fmt_pct(d7), fmt_pct(u7), fmt_pct(d30), fmt_pct(u30)))
            || to_jsonb(format('La subida se mantiene en %s de las últimas %s observaciones (mínimo %s).',
                               v_pers, coalesce(cardinality(r.ultimos), 0), persist_min));
          v_horizonte := 'Corto plazo: los precios altos suelen volver hacia la mediana. Orientativo, sin garantía de venta.';
          v_riesgos := v_riesgos || to_jsonb('Si muchos vendedores reaccionan igual, el precio puede bajar antes de que vendas.'::text);
          if r.cv30 > 0.15 then
            v_riesgos := v_riesgos || to_jsonb(format(
              'Precio muy variable (volatilidad %s en 30 días): parte de la subida puede ser ruido.', fmt_pct(r.cv30)));
          end if;
          if r.pend7 > subida_fuerte then
            v_riesgos := v_riesgos || to_jsonb(format(
              'Tendencia de 7 días muy alcista (%s por día): podría seguir subiendo; vender ahora puede dejar dinero sobre la mesa.',
              fmt_pct(r.pend7)));
          end if;
        elsif d7 >= u7 and d30 >= u30 then
          v_resumen := 'Subida reciente todavía sin confirmar';
          v_motivos := v_motivos || to_jsonb(format(
            'Está %s sobre la mediana de 30 días, pero solo %s de las últimas observaciones superan el umbral (se piden %s).',
            fmt_pct(d30), v_pers, persist_min));
        elsif d30 <= -g30 then
          if r.dias_recuperados >= rec_min and coalesce(r.pendprev, 0) > -caida_fuerte then
            v_rec := 'GUARDAR';
            v_resumen := format('%s bajo la mediana; antes se recuperó', fmt_pct(d30));
            v_motivos := v_motivos || to_jsonb(format(
              'Está %s respecto a la mediana de 30 días (umbral %s).', fmt_pct(d30), fmt_pct(-g30)))
              || to_jsonb(format(
              'En el historial hubo %s días con caídas parecidas y en %s el precio volvió a ≥ 95 %% de la mediana.',
              r.dias_caida, r.dias_recuperados))
              || to_jsonb(format('Antes de esta bajada (de hace 17 a hace 3 días) la tendencia era %s por día: no venía cayendo de forma continuada.',
                                 fmt_pct(r.pendprev)));
            v_horizonte := format(
              'Orientativo: unos %s días (mediana de lo que tardó en recuperarse antes). No está garantizado que vuelva a subir.',
              fmt_num(r.dias_recuperacion));
            v_riesgos := v_riesgos || to_jsonb('El historial disponible es corto: que se recuperara antes no asegura que vuelva a pasar.'::text);
          elsif coalesce(r.pendprev, 0) <= -caida_fuerte then
            v_resumen := 'Precio bajo en caída continuada';
            v_motivos := v_motivos || to_jsonb(format(
              'Está %s respecto a la mediana de 30 días, y ya antes (de hace 17 a hace 3 días) bajaba %s por día: puede ser una bajada duradera.',
              fmt_pct(d30), fmt_pct(r.pendprev)));
          else
            v_resumen := 'Precio bajo sin evidencia de recuperación';
            v_motivos := v_motivos || to_jsonb(format(
              'Está %s respecto a la mediana de 30 días, pero solo hay %s días de caídas anteriores recuperadas (se piden %s). Un precio bajo por sí solo no justifica guardar.',
              fmt_pct(d30), r.dias_recuperados, rec_min));
          end if;
        elsif d7 >= u7 or d30 >= u30 then
          v_resumen := 'Señales contradictorias';
          v_motivos := v_motivos || to_jsonb(format(
            'Frente a 7 días: %s (umbral %s); frente a 30 días: %s (umbral %s). Solo una de las dos comparaciones es favorable.',
            fmt_pct(d7), fmt_pct(u7), fmt_pct(d30), fmt_pct(u30)));
        else
          v_resumen := 'Precio dentro de lo habitual';
          v_motivos := v_motivos || to_jsonb(format(
            'Frente a 7 días: %s y frente a 30 días: %s; no supera ningún umbral de venta ni de compra.',
            fmt_pct(d7), fmt_pct(d30)));
        end if;
      end if;

      -- Índice de calidad de datos (sin la parte de antigüedad, que se suma al leer).
      p_hist := round(30 * least(coalesce(r.dias_hist, 0) / 30.0, 1));
      p_obs  := round(25 * least(coalesce(r.n30, 0) / 120.0, 1));
      p_cal  := case when r.precio is null then 0
                     when v_extremo then 0
                     when r.cv30 > 0.5 then 5
                     when r.cv30 > 0.25 then 10
                     else 15 end;
      v_desglose := jsonb_build_array(
        jsonb_build_object('k', 'Días de historial propio', 'puntos', p_hist, 'max', 30,
                           'detalle', format('%s de 30 días', fmt_num(coalesce(r.dias_hist, 0)))),
        jsonb_build_object('k', 'Observaciones en 30 días', 'puntos', p_obs, 'max', 25,
                           'detalle', format('%s (se buscan 120 o más)', coalesce(r.n30, 0))),
        jsonb_build_object('k', 'Calidad del precio', 'puntos', p_cal, 'max', 15,
                           'detalle', case when v_extremo then 'precio extremo'
                                           when r.cv30 is null then 'sin datos'
                                           else 'volatilidad ' || fmt_pct(r.cv30) end),
        jsonb_build_object('k', 'Liquidez (volumen, unidades)', 'puntos', 0, 'max', 10,
                           'detalle', 'sin dato: TSM no lo publica'));

      insert into recomendaciones (market_id, item_id, recomendacion, puntos_base, resumen, cifras,
                                   motivos, riesgos, desglose, horizonte, calculado_en)
      values (v_mid, r.item_id, v_rec, p_hist + p_obs + p_cal, v_resumen,
              jsonb_build_object('precio', r.precio, 'hora', r.ult_hora, 'med7', round(r.med7), 'med14', round(r.med14),
                                 'med30', round(r.med30), 'n30', r.n30, 'n7', r.n7, 'dias_hist', round(r.dias_hist, 2),
                                 'dif7', round(d7, 4), 'dif30', round(d30, 4), 'pend7', round(r.pend7, 4),
                                 'pend14', round(r.pend14, 4), 'pendprev', round(r.pendprev, 4),
                                 'cv30', round(r.cv30, 4), 'extremo', v_extremo,
                                 'dias_caida', r.dias_caida, 'dias_recuperados', r.dias_recuperados,
                                 'dias_recuperacion', round(r.dias_recuperacion, 1), 'persistencia', v_pers),
              v_motivos, v_riesgos, v_desglose, v_horizonte, now());
      v_n := v_n + 1;
    end loop;

    -- Registro diario para evaluar después (Hito 7): solo VENDER/GUARDAR y favoritos, para no llenar el disco.
    insert into recommendation_log (market_id, item_id, day, recommendation, confidence, price, explanation)
    select rr.market_id, rr.item_id, (now() at time zone 'UTC')::date, rr.recomendacion, rr.puntos_base,
           round((rr.cifras->>'precio')::numeric)::bigint, rr.resumen
      from recomendaciones rr
     where rr.market_id = v_mid
       and (rr.recomendacion <> 'OBSERVACION'
            or exists (select 1 from favorites f where f.market_id = rr.market_id and f.item_id = rr.item_id))
    on conflict (market_id, item_id, day) do update
       set recommendation = excluded.recommendation, confidence = excluded.confidence,
           price = excluded.price, explanation = excluded.explanation;
  end if;

  insert into recomendaciones_estado (market_id, firma, calculado_en, objetos, milisegundos)
  values (v_mid, v_firma, now(), v_n, extract(epoch from (clock_timestamp() - v_t0)) * 1000)
  on conflict (market_id) do update
     set firma = excluded.firma, calculado_en = excluded.calculado_en,
         objetos = excluded.objetos, milisegundos = excluded.milisegundos;

  return jsonb_build_object('estado', 'recalculado', 'objetos', v_n,
                            'milisegundos', round(extract(epoch from (clock_timestamp() - v_t0)) * 1000));
end $$;

-- ---------- lectura: aplica la regla de «dato antiguo» y la antigüedad en la confianza ----------
-- Se hace al leer porque depende de la hora actual, no de los datos.
create function _rec_al_leer(p_rec text, p_resumen text, p_puntos integer, p_hora_dato timestamptz, p_now timestamptz)
returns jsonb language sql stable as $$
  with x as (
    select extract(epoch from (p_now - p_hora_dato)) / 3600.0 as horas,
           ajuste_num('motor.dato_antiguo_horas', 8) as limite
  ), y as (
    select horas, limite,
           case when horas is null then 0 when horas < 2 then 20 when horas < limite then 10 else 0 end as p_edad
      from x
  )
  select jsonb_build_object(
    'rec',       case when horas > limite then 'OBSERVACION' else p_rec end,
    'resumen',   case when horas > limite then format('Datos antiguos (%s h): %s', round(horas), p_resumen) else p_resumen end,
    'puntos',    p_puntos + p_edad,
    'p_edad',    p_edad,
    'horas_dato', round(horas, 1),
    'antiguo',   horas > limite,
    -- Escala: ≥ 70 Alta, ≥ 40 Media, resto Baja. Pero sin datos de liquidez (TSM no los
    -- publica) el nivel se limita a «Media», así que hoy nunca sale «Alta».
    'nivel',     case when p_puntos + p_edad >= 40 then 'Media' else 'Baja' end)
  from y
$$;

create or replace function tabla_precios(p_market_key text) returns jsonb
language sql stable as $$
  with m as (
    select id from markets where key = p_market_key
  ),
  ultima as (
    select max(s.source_updated_at) as hora from snapshots s, m where s.market_id = m.id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id',        i.item_id,
           'nombre',    i.name,
           'categoria', i.category,
           'icono',     i.icon_url,
           'favorito',  f.item_id is not null,
           'hora',      ult.hour,
           'ausente',   ult.hour < date_trunc('hour', (select hora from ultima), 'UTC'),
           'precio',    ult.min_buyout,
           'valor_mercado', ult.market_value,
           'historico', ult.historical,
           'reciente',  ult.recent,
           'precio_24h', h24.precio, 'hora_24h', h24.hour,
           'precio_7d',  d7.precio,  'hora_7d',  d7.hour,
           'med7',      (r.cifras->>'med7')::numeric,
           'med30',     (r.cifras->>'med30')::numeric,
           'neto',      round(coalesce(ult.min_buyout, ult.market_value) * (1 - ajuste_num('motor.comision_pct', 5) / 100)),
           'rec',       l->>'rec',
           'resumen',   l->>'resumen',
           'puntos',    (l->>'puntos')::integer,
           'nivel',     l->>'nivel'
         ) order by i.name), '[]'::jsonb)
    from m
    join items i on i.market_id = m.id
    left join favorites f on f.market_id = m.id and f.item_id = i.item_id
    left join recomendaciones r on r.market_id = m.id and r.item_id = i.item_id
    cross join lateral (
      select p.hour, p.min_buyout, p.market_value, p.historical, p.recent
        from price_hourly p
       where p.market_id = m.id and p.item_id = i.item_id
       order by p.hour desc
       limit 1
    ) ult
    left join lateral (
      select p.hour, coalesce(p.min_buyout, p.market_value) as precio
        from price_hourly p
       where p.market_id = m.id and p.item_id = i.item_id
         and p.hour <= ult.hour - interval '24 hours'
         and p.hour >= ult.hour - interval '30 hours'
       order by p.hour desc
       limit 1
    ) h24 on true
    left join lateral (
      select p.hour, coalesce(p.min_buyout, p.market_value) as precio
        from price_hourly p
       where p.market_id = m.id and p.item_id = i.item_id
         and p.hour <= ult.hour - interval '7 days'
         and p.hour >= ult.hour - interval '7 days 12 hours'
       order by p.hour desc
       limit 1
    ) d7 on true
    left join lateral (
      select case when r.item_id is null then null
                  else _rec_al_leer(r.recomendacion, r.resumen, r.puntos_base, (select hora from ultima), now()) end as l
    ) lectura on true
$$;

-- Explicación completa de un objeto (panel de detalle).
create function explicar_objeto(p_market_key text, p_item_id integer) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'id', r.item_id,
    'nombre', i.name,
    'categoria', i.category,
    'mercado', mk.key,
    'ficticio', mk.is_demo,
    'calculado_en', r.calculado_en,
    'hora_dato', (select max(source_updated_at) from snapshots s where s.market_id = mk.id),
    'recomendacion_motor', r.recomendacion,
    'lectura', _rec_al_leer(r.recomendacion, r.resumen, r.puntos_base,
                            (select max(source_updated_at) from snapshots s where s.market_id = mk.id), now()),
    'cifras', r.cifras,
    'motivos', r.motivos,
    'riesgos', r.riesgos,
    'desglose', r.desglose,
    'horizonte', r.horizonte,
    'comision_pct', ajuste_num('motor.comision_pct', 5),
    'deposito_minimo', ajuste_num('motor.deposito_minimo_cobre', 100),
    'ingreso_neto_unidad', round((r.cifras->>'precio')::numeric * (1 - ajuste_num('motor.comision_pct', 5) / 100)))
  from markets mk
  join recomendaciones r on r.market_id = mk.id and r.item_id = p_item_id
  join items i on i.market_id = mk.id and i.item_id = p_item_id
  where mk.key = p_market_key
$$;

-- Resumen para las tarjetas del panel.
create function resumen_recomendaciones(p_market_key text) returns jsonb
language sql stable as $$
  with m as (select id from markets where key = p_market_key),
  l as (
    select r.item_id, _rec_al_leer(r.recomendacion, r.resumen, r.puntos_base,
                                   (select max(source_updated_at) from snapshots s, m where s.market_id = m.id), now()) as x
      from recomendaciones r, m where r.market_id = m.id
  )
  select jsonb_build_object(
    'vender',      count(*) filter (where x->>'rec' = 'VENDER'),
    'guardar',     count(*) filter (where x->>'rec' = 'GUARDAR'),
    'observacion', count(*) filter (where x->>'rec' = 'OBSERVACION'),
    'calculado_en', (select calculado_en from recomendaciones_estado e, m where e.market_id = m.id),
    'milisegundos', (select milisegundos from recomendaciones_estado e, m where e.market_id = m.id))
  from l
$$;

-- ---------- ajustes editables desde la página ----------
create function leer_ajustes() returns jsonb language sql stable as $$
  select coalesce(jsonb_object_agg(key, value::numeric order by key), '{}'::jsonb)
    from settings where key like 'motor.%'
$$;

create function guardar_ajustes(p_ajustes jsonb) returns jsonb language plpgsql as $$
declare
  k text; v numeric;
  rangos constant jsonb := '{
    "motor.vender_sobre_med7_pct":      [1, 200],
    "motor.vender_sobre_med30_pct":     [1, 200],
    "motor.vender_persistencia_obs":    [1, 3],
    "motor.guardar_bajo_med30_pct":     [1, 90],
    "motor.guardar_min_recuperaciones": [1, 30],
    "motor.caida_fuerte_pct_dia":       [0.1, 50],
    "motor.subida_fuerte_pct_dia":      [0.1, 100],
    "motor.min_dias_historial":         [1, 30],
    "motor.min_observaciones":          [3, 1000],
    "motor.dato_antiguo_horas":         [1, 168],
    "motor.extremo_factor":             [1.5, 100],
    "motor.comision_pct":               [0, 50],
    "motor.deposito_minimo_cobre":      [0, 1000000]
  }';
begin
  if jsonb_typeof(p_ajustes) <> 'object' then
    raise exception 'Se esperaba un objeto con ajustes';
  end if;
  for k in select jsonb_object_keys(p_ajustes) loop
    if not rangos ? k then
      raise exception 'Ajuste desconocido: %', k;
    end if;
    begin
      v := (p_ajustes->>k)::numeric;
    exception when others then
      raise exception 'El ajuste % debe ser un número', k;
    end;
    if v is null or v < (rangos->k->>0)::numeric or v > (rangos->k->>1)::numeric then
      raise exception 'El ajuste % debe estar entre % y %', k, rangos->k->>0, rangos->k->>1;
    end if;
    if k in ('motor.vender_persistencia_obs', 'motor.guardar_min_recuperaciones', 'motor.min_observaciones',
             'motor.deposito_minimo_cobre') and v <> trunc(v) then
      raise exception 'El ajuste % debe ser un número entero', k;
    end if;
  end loop;
  insert into settings (key, value)
  select key, value #>> '{}' from jsonb_each(p_ajustes)
  on conflict (key) do update set value = excluded.value;
  return leer_ajustes();
end $$;

revoke execute on all functions in schema public from public, anon, authenticated;
