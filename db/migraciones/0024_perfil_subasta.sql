-- =====================================================================
-- 0024 — X1 del plan V5: banda de precios para «Qué hacer con este objeto».
--
-- Ajustes del usuario (no datos de mercado). Por defecto, el preset de la comunidad de TSM:
-- mínimo 80 %, normal 100 % y máximo 300 % del valor de mercado, con suelos de 1,5× y 30× la
-- venta al NPC; undercut de 1 cobre; puja al 100 %; casa de facción a 24 h.
-- =====================================================================

create function _perfil_subasta_reglas() returns table (clave text, minimo numeric, maximo numeric, defecto text)
language sql immutable as $$
  values ('min_pct', 10, 500, '80'), ('normal_pct', 10, 1000, '100'), ('max_pct', 50, 5000, '300'),
         ('npc_min_mult', 0, 100, '1.5'), ('npc_max_mult', 0, 1000, '30'),
         ('undercut', 0, 1000000, '1'), ('puja_pct', 1, 100, '100'),
         ('duracion', 2, 24, '24'), ('tipo_casa', null, null, 'faccion')
$$;

create function leer_perfil_subasta() returns jsonb language sql stable as $$
  select jsonb_object_agg(r.clave,
           case when r.clave = 'tipo_casa' then to_jsonb(coalesce(s.value, r.defecto))
                else to_jsonb(coalesce(s.value, r.defecto)::numeric) end)
    from _perfil_subasta_reglas() r
    left join settings s on s.key = 'subasta.' || r.clave
$$;

create function guardar_perfil_subasta(p jsonb) returns jsonb language plpgsql as $$
declare
  k text; v text; r record; n numeric; actual jsonb := leer_perfil_subasta(); nuevo jsonb;
begin
  if jsonb_typeof(p) <> 'object' then raise exception 'Se esperaba un objeto con los ajustes'; end if;
  for k, v in select key, value #>> '{}' from jsonb_each(p) loop
    select * into r from _perfil_subasta_reglas() x where x.clave = k;
    if not found then raise exception 'Ajuste desconocido: %', k; end if;
    if k = 'tipo_casa' then
      if v not in ('faccion', 'neutral') then raise exception 'tipo_casa debe ser faccion o neutral'; end if;
    else
      if v is null or v !~ '^-?\d+(\.\d+)?$' then raise exception '«%» no es un número: %', k, v; end if;
      n := v::numeric;
      if n < r.minimo or n > r.maximo then raise exception '«%» fuera de rango (% a %)', k, r.minimo, r.maximo; end if;
      if k = 'duracion' and n not in (2, 8, 24) then raise exception 'duracion debe ser 2, 8 o 24'; end if;
      if k = 'undercut' and n <> trunc(n) then raise exception 'undercut debe ser un número entero de cobre'; end if;
    end if;
  end loop;
  nuevo := actual || p;
  if (nuevo->>'min_pct')::numeric > (nuevo->>'normal_pct')::numeric
     or (nuevo->>'normal_pct')::numeric > (nuevo->>'max_pct')::numeric then
    raise exception 'La banda debe cumplir mínimo ≤ normal ≤ máximo';
  end if;
  insert into settings (key, value)
  select 'subasta.' || key, value #>> '{}' from jsonb_each(p)
  on conflict (key) do update set value = excluded.value;
  return leer_perfil_subasta();
end $$;

revoke execute on all functions in schema public from public, anon, authenticated;
