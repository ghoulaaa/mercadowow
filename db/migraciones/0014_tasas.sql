-- =====================================================================
-- 0014 — Reglas de comisión y depósito de la casa de subastas (R4).
--
-- Valores INICIALES por verificar (especificación del usuario y guías de Classic):
--   comisión 5 % en la casa de facción y 15 % en la neutral;
--   depósito 5 % / 20 % / 60 % del valor de venta al NPC para 2 / 8 / 24 h;
--   depósito mínimo 1 plata por subasta (anunciado el cambio a 1 cobre, sin fecha).
-- Blizzard no publica estas reglas para Forever: quedan con verificado = false hasta
-- que el usuario las confirme en el juego. Se guarda la fecha de vigencia y la fuente.
-- =====================================================================

create table auction_fee_rules (
  id              smallint generated always as identity primary key,
  game_type       text not null default 'forever',
  tipo_casa       text not null check (tipo_casa in ('faccion', 'neutral')),
  duracion_horas  integer not null check (duracion_horas > 0),
  comision_pct    numeric not null check (comision_pct >= 0 and comision_pct <= 50),
  deposito_pct    numeric not null check (deposito_pct >= 0 and deposito_pct <= 500),
  deposito_minimo bigint not null check (deposito_minimo >= 0),
  redondeo        text not null default 'floor' check (redondeo in ('floor', 'round', 'ceil')),
  vigente_desde   date not null,
  verificado      boolean not null default false,
  fuente          text not null,
  nota            text,
  unique (game_type, tipo_casa, duracion_horas)
);
alter table auction_fee_rules enable row level security;
revoke all on auction_fee_rules from anon, authenticated;

insert into auction_fee_rules (tipo_casa, duracion_horas, comision_pct, deposito_pct, deposito_minimo, vigente_desde, fuente, nota)
values
  ('faccion', 2,  5, 5,  100, '2026-11-08', 'Guías de terceros (reglas de Classic)', 'Sin confirmación oficial para Forever'),
  ('faccion', 8,  5, 20, 100, '2026-11-08', 'Guías de terceros (reglas de Classic)', 'Sin confirmación oficial para Forever'),
  ('faccion', 24, 5, 60, 100, '2026-11-08', 'Guías de terceros (reglas de Classic)', 'Sin confirmación oficial para Forever'),
  ('neutral', 2,  15, 5,  100, '2026-11-08', 'Guías de terceros (reglas de Classic)', 'Depósito de la casa neutral desconocido: se usan los % de la de facción'),
  ('neutral', 8,  15, 20, 100, '2026-11-08', 'Guías de terceros (reglas de Classic)', 'Depósito de la casa neutral desconocido: se usan los % de la de facción'),
  ('neutral', 24, 15, 60, 100, '2026-11-08', 'Guías de terceros (reglas de Classic)', 'Depósito de la casa neutral desconocido: se usan los % de la de facción');

create function leer_tasas(p_game text default 'forever') returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(to_jsonb(r) order by r.tipo_casa, r.duracion_horas), '[]'::jsonb)
    from auction_fee_rules r where r.game_type = p_game
$$;

-- Edita una regla. La comisión y el depósito mínimo no dependen de la duración: se aplican
-- a todas las duraciones de ese tipo de casa. Los de la casa de facción se copian a los
-- ajustes del motor (motor.comision_pct y motor.deposito_minimo_cobre) para que el
-- inventario, las recomendaciones y la calculadora usen lo mismo.
create function guardar_tasa(p_id smallint, p_cambios jsonb, p_hoy date default current_date)
returns jsonb language plpgsql as $$
declare
  v_regla auction_fee_rules%rowtype;
  k text;
  permitidas constant text[] := array['comision_pct', 'deposito_pct', 'deposito_minimo', 'redondeo', 'verificado', 'fuente', 'nota'];
begin
  select * into v_regla from auction_fee_rules where id = p_id for update;
  if not found then
    raise exception 'Regla desconocida: %', p_id;
  end if;
  if jsonb_typeof(p_cambios) <> 'object' then
    raise exception 'Se esperaba un objeto con cambios';
  end if;
  for k in select jsonb_object_keys(p_cambios) loop
    if not k = any(permitidas) then
      raise exception 'Campo no editable: %', k;
    end if;
  end loop;

  begin
    if p_cambios ? 'comision_pct' then
      update auction_fee_rules set comision_pct = (p_cambios->>'comision_pct')::numeric
       where game_type = v_regla.game_type and tipo_casa = v_regla.tipo_casa;
    end if;
    if p_cambios ? 'deposito_minimo' then
      if (p_cambios->>'deposito_minimo')::numeric <> trunc((p_cambios->>'deposito_minimo')::numeric) then
        raise exception 'El depósito mínimo debe ser un número entero de cobres';
      end if;
      update auction_fee_rules set deposito_minimo = (p_cambios->>'deposito_minimo')::bigint
       where game_type = v_regla.game_type and tipo_casa = v_regla.tipo_casa;
    end if;
    if p_cambios ? 'deposito_pct' then
      update auction_fee_rules set deposito_pct = (p_cambios->>'deposito_pct')::numeric where id = p_id;
    end if;
    if p_cambios ? 'redondeo' then
      update auction_fee_rules set redondeo = p_cambios->>'redondeo' where game_type = v_regla.game_type;
    end if;
    if p_cambios ? 'verificado' then
      update auction_fee_rules set verificado = (p_cambios->>'verificado')::boolean where id = p_id;
    end if;
    if p_cambios ? 'fuente' then
      update auction_fee_rules set fuente = left(coalesce(nullif(btrim(p_cambios->>'fuente'), ''), 'Usuario'), 200) where id = p_id;
    end if;
    if p_cambios ? 'nota' then
      update auction_fee_rules set nota = left(nullif(btrim(p_cambios->>'nota'), ''), 300) where id = p_id;
    end if;
  exception
    when check_violation then
      raise exception 'Valor fuera de rango (comisión 0–50 %%, depósito 0–500 %%, mínimo ≥ 0)';
    when invalid_text_representation then
      raise exception 'Algún valor no es un número válido';
  end;

  update auction_fee_rules set vigente_desde = p_hoy
   where game_type = v_regla.game_type and tipo_casa = v_regla.tipo_casa;

  if v_regla.tipo_casa = 'faccion' then
    insert into settings (key, value)
    select 'motor.comision_pct', comision_pct::text from auction_fee_rules where id = p_id
    on conflict (key) do update set value = excluded.value;
    insert into settings (key, value)
    select 'motor.deposito_minimo_cobre', deposito_minimo::text from auction_fee_rules where id = p_id
    on conflict (key) do update set value = excluded.value;
  end if;
  return leer_tasas(v_regla.game_type);
end $$;

revoke execute on all functions in schema public from public, anon, authenticated;
