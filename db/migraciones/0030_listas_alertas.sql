-- 0030 · X6 (plan V5): listas propias y alertas por umbral.
--
-- Listas: grupos de objetos con nombre (los favoritos pasan a la lista «Favoritos»). Cada lista
-- puede tener su propia banda de precios para «Qué hacer con este objeto»; si no, usa la general.
-- Alertas: «avísame si la compra mínima baja a X o menos / sube a X o más» en un mercado. Se
-- comprueban en la base de datos al guardar cada escaneo nuevo (la consulta horaria) y solo avisan
-- cuando la condición PASA a cumplirse (no en cada escaneo mientras siga cumpliéndose).
-- Los avisos se ven en la página al abrirla. Un aviso fuera de la página (correo, Discord) no se hace:
-- necesitaría un servicio y credenciales propias.

-- ---------- Listas ----------
create table listas (
  id      bigint generated always as identity primary key,
  nombre  text not null check (length(btrim(nombre)) between 1 and 40),
  perfil  jsonb,                          -- banda propia (todos los ajustes) o null = la general
  creada  timestamptz not null default now()
);
create unique index listas_nombre on listas (lower(btrim(nombre)));

create table lista_objetos (
  lista_id bigint  not null references listas(id) on delete cascade,
  item_id  integer not null check (item_id > 0),
  anadido  timestamptz not null default now(),
  primary key (lista_id, item_id)
);
create index lista_objetos_item on lista_objetos (item_id);

alter table listas enable row level security;
alter table lista_objetos enable row level security;
revoke all on listas, lista_objetos from anon, authenticated;

-- Los favoritos de siempre pasan a la lista «Favoritos» (la tabla favorites se mantiene).
insert into listas (nombre) values ('Favoritos');
insert into lista_objetos (lista_id, item_id)
select (select id from listas where nombre = 'Favoritos'), item_id from (select distinct item_id from favorites) f;

-- Comprueba una banda (mismas reglas que la general) y la devuelve completa.
create function _validar_perfil_subasta(p jsonb) returns jsonb language plpgsql stable as $$
declare
  k text; v text; r record; n numeric; nuevo jsonb;
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
  nuevo := leer_perfil_subasta() || coalesce((select jsonb_object_agg(key, case when key = 'tipo_casa' then value
                                                                      else to_jsonb((value #>> '{}')::numeric) end)
                                       from jsonb_each(p)), '{}'::jsonb);
  if (nuevo->>'min_pct')::numeric > (nuevo->>'normal_pct')::numeric
     or (nuevo->>'normal_pct')::numeric > (nuevo->>'max_pct')::numeric then
    raise exception 'La banda debe cumplir mínimo ≤ normal ≤ máximo';
  end if;
  return nuevo;
end $$;

-- Listas con su número de objetos y, si se pide un objeto, si lo contiene.
create function listar_listas(p_item_id integer default null) returns jsonb language sql stable as $$
  select jsonb_build_object(
    'listas', coalesce((select jsonb_agg(jsonb_build_object(
        'id', l.id, 'nombre', l.nombre, 'perfil', l.perfil,
        'n', (select count(*) from lista_objetos lo where lo.lista_id = l.id),
        'contiene', case when p_item_id is null then null
                         else exists (select 1 from lista_objetos lo where lo.lista_id = l.id and lo.item_id = p_item_id) end)
        order by l.nombre = 'Favoritos' desc, lower(l.nombre), l.id) from listas l), '[]'::jsonb),
    'perfil_general', leer_perfil_subasta())
$$;

-- Crear, renombrar, borrar, poner/quitar un objeto y fijar la banda de una lista.
-- p: {accion: crear|renombrar|borrar|poner|perfil, id?, nombre?, objeto?, dentro?, perfil?}
create function gestionar_lista(p jsonb) returns jsonb language plpgsql as $$
declare
  v_acc  text := p->>'accion';
  v_id   bigint := _param_entero(p, 'id');
  v_nom  text := btrim(coalesce(p->>'nombre', ''));
  v_obj  bigint := _param_entero(p, 'objeto');
begin
  if v_acc not in ('crear', 'renombrar', 'borrar', 'poner', 'perfil') then
    raise exception 'Acción no válida: % (crear, renombrar, borrar, poner o perfil)', v_acc;
  end if;
  if v_acc <> 'crear' and not exists (select 1 from listas where id = v_id) then
    raise exception 'Lista desconocida: %', v_id;
  end if;
  if v_acc in ('crear', 'renombrar') then
    if length(v_nom) not between 1 and 40 then raise exception 'El nombre debe tener entre 1 y 40 caracteres'; end if;
    if exists (select 1 from listas where lower(btrim(nombre)) = lower(v_nom) and id is distinct from v_id) then
      raise exception 'Ya hay una lista llamada «%»', v_nom;
    end if;
  end if;
  case v_acc
    when 'crear' then
      if (select count(*) from listas) >= 50 then raise exception 'Máximo 50 listas'; end if;
      insert into listas (nombre) values (v_nom) returning id into v_id;
      if v_obj is not null then insert into lista_objetos (lista_id, item_id) values (v_id, v_obj::integer); end if;
    when 'renombrar' then update listas set nombre = v_nom where id = v_id;
    when 'borrar' then delete from listas where id = v_id;
    when 'poner' then
      if v_obj is null or v_obj < 1 or v_obj > 2147483647 then raise exception 'Falta el objeto'; end if;
      if coalesce((p->>'dentro')::boolean, true) then
        if (select count(*) from lista_objetos where lista_id = v_id) >= 5000 then raise exception 'Máximo 5000 objetos por lista'; end if;
        insert into lista_objetos (lista_id, item_id) values (v_id, v_obj::integer) on conflict do nothing;
      else
        delete from lista_objetos where lista_id = v_id and item_id = v_obj;
      end if;
    when 'perfil' then
      update listas set perfil = case when jsonb_typeof(p->'perfil') = 'object' then _validar_perfil_subasta(p->'perfil') end
       where id = v_id;
  end case;
  return listar_listas(v_obj::integer) || jsonb_build_object('id', v_id);
end $$;

-- Listas a las que pertenece un objeto (con su banda, si tienen).
create function _listas_objeto(p_item_id integer) returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'nombre', l.nombre, 'perfil', l.perfil)
                            order by l.nombre = 'Favoritos' desc, lower(l.nombre), l.id), '[]'::jsonb)
    from lista_objetos lo join listas l on l.id = lo.lista_id
   where lo.item_id = p_item_id
$$;

create or replace function ficha_objeto(p_market_key text, p_item_id integer) returns jsonb language sql stable as $$
  select b.f || jsonb_build_object('region', _region_objeto(p_market_key, p_item_id),
                                   'region_estado', _region_estado(p_market_key),
                                   'listas', _listas_objeto(p_item_id))
             || case when pn.precio is not null
                     then jsonb_build_object('compra_npc', pn.precio, 'compra_npc_origen', 'usuario',
                                             'compra_npc_fecha', pn.actualizado)
                     when b.f->'compra_npc' is not null and b.f->'compra_npc' <> 'null'::jsonb
                     then jsonb_build_object('compra_npc_origen', 'catalogo')
                     else '{}'::jsonb end
    from (select _ficha_objeto_base(p_market_key, p_item_id) as f) b
    left join markets m on m.key = p_market_key and not m.is_demo
    left join precios_npc pn on pn.game_type = m.game_type and pn.item_id = p_item_id
   where b.f is not null
$$;

-- ---------- Alertas ----------
create table alertas (
  id        bigint generated always as identity primary key,
  market_id smallint not null references markets(id),
  item_id   integer  not null check (item_id > 0),
  condicion text     not null check (condicion in ('menor', 'mayor')),   -- menor: baja a X o menos; mayor: sube a X o más
  umbral    bigint   not null check (umbral > 0 and umbral <= 100000000000),
  cumplida  boolean  not null default false,    -- estado en el último escaneo revisado
  creada    timestamptz not null default now(),
  revisada  timestamptz
);
create index alertas_mercado on alertas (market_id);

create table avisos (
  id        bigint generated always as identity primary key,
  alerta_id bigint not null references alertas(id) on delete cascade,
  escaneo   timestamptz not null,            -- hora del escaneo original en que se cumplió
  precio    bigint not null,
  creado    timestamptz not null default now(),
  visto     boolean not null default false
);
create index avisos_alerta on avisos (alerta_id);

alter table alertas enable row level security;
alter table avisos enable row level security;
revoke all on alertas, avisos from anon, authenticated;

create function _cumple(p_condicion text, p_precio bigint, p_umbral bigint) returns boolean language sql immutable as $$
  select coalesce(case p_condicion when 'menor' then p_precio <= p_umbral when 'mayor' then p_precio >= p_umbral end, false)
$$;

-- Revisa las alertas de un mercado con la compra mínima de un escaneo. Solo con el escaneo más reciente.
-- Crea un aviso cuando una alerta PASA a cumplirse. Devuelve cuántos avisos ha creado.
create function revisar_alertas(p_market_id smallint, p_escaneo timestamptz) returns integer
language plpgsql as $$
declare v_n integer;
begin
  if p_escaneo < (select max(source_updated_at) from snapshots where market_id = p_market_id) then return 0; end if;
  with est as (
    select a.id, a.cumplida as antes, p.min_buyout as precio, _cumple(a.condicion, p.min_buyout, a.umbral) as ahora
      from alertas a
      left join price_hourly p on p.market_id = a.market_id and p.item_id = a.item_id
                              and p.hour = date_trunc('hour', p_escaneo, 'UTC')
     where a.market_id = p_market_id
  ),
  nuevos as (
    insert into avisos (alerta_id, escaneo, precio)
    select id, p_escaneo, precio from est where ahora and not antes
    returning 1
  ),
  act as (
    update alertas a set cumplida = est.ahora, revisada = now() from est where a.id = est.id returning 1
  )
  select count(*) into v_n from nuevos;
  return v_n;
end $$;

-- Al guardar un escaneo: se revisa al terminar la transacción (cuando ya están todos sus precios).
create function _trg_revisar_alertas() returns trigger language plpgsql as $$
begin
  perform revisar_alertas(new.market_id, new.source_updated_at);
  return null;
end $$;
create constraint trigger alertas_tras_escaneo after insert on snapshots
  deferrable initially deferred for each row execute function _trg_revisar_alertas();

-- Nombre de un objeto en un mercado (catálogo, o el que da la fuente, o su ID).
create function _nombre_objeto(p_market_id smallint, p_item_id integer) returns text language sql stable as $$
  select coalesce((select c.nombre from catalogo c join markets m on m.game_type = c.game_type
                    where m.id = p_market_id and c.item_id = p_item_id and not m.is_demo),
                  (select nullif(btrim(i.name), '') from items i where i.market_id = p_market_id and i.item_id = p_item_id),
                  '#' || p_item_id)
$$;

-- Alertas de un mercado (o de un objeto) con su precio actual, y los avisos (sin ver primero).
create function leer_alertas(p_market_key text, p_item_id integer default null) returns jsonb language sql stable as $$
  with m as (select id from markets where key = p_market_key),
  h as (select date_trunc('hour', max(s.source_updated_at), 'UTC') as hora, max(s.source_updated_at) as escaneo
          from snapshots s join m on s.market_id = m.id)
  select jsonb_build_object(
    'escaneo', (select escaneo from h),
    'alertas', coalesce((select jsonb_agg(jsonb_build_object(
        'id', a.id, 'objeto', a.item_id, 'nombre', _nombre_objeto(a.market_id, a.item_id),
        'condicion', a.condicion, 'umbral', a.umbral, 'cumplida', a.cumplida, 'creada', a.creada,
        'precio_actual', (select p.min_buyout from price_hourly p, h
                           where p.market_id = a.market_id and p.item_id = a.item_id and p.hour = h.hora))
        order by a.creada desc, a.id desc)
      from alertas a join m on a.market_id = m.id
     where p_item_id is null or a.item_id = p_item_id), '[]'::jsonb),
    'avisos', coalesce((select jsonb_agg(x.j order by x.visto, x.escaneo desc, x.id desc) from (
        select v.id, v.visto, v.escaneo, jsonb_build_object(
                 'id', v.id, 'alerta', a.id, 'objeto', a.item_id, 'nombre', _nombre_objeto(a.market_id, a.item_id),
                 'condicion', a.condicion, 'umbral', a.umbral, 'precio', v.precio, 'escaneo', v.escaneo,
                 'visto', v.visto) as j,
               row_number() over (partition by v.visto order by v.escaneo desc, v.id desc) as rn
          from avisos v join alertas a on a.id = v.alerta_id join m on a.market_id = m.id
         where p_item_id is null or a.item_id = p_item_id) x
       where not x.visto or x.rn <= 20), '[]'::jsonb),
    'sin_ver', (select count(*) from avisos v join alertas a on a.id = v.alerta_id join m on a.market_id = m.id where not v.visto))
$$;

-- p: {accion: crear|borrar|visto, objeto?, condicion?, umbral?, id?, ids? (lista de avisos o «todos»)}
create function gestionar_alerta(p_market_key text, p jsonb) returns jsonb language plpgsql as $$
declare
  v_m    markets%rowtype;
  v_acc  text := p->>'accion';
  v_obj  bigint := _param_entero(p, 'objeto');
  v_cond text := p->>'condicion';
  v_umb  bigint := _param_entero(p, 'umbral');
  v_id   bigint := _param_entero(p, 'id');
  v_hora timestamptz;
  v_ahora boolean;
begin
  select * into v_m from markets where key = p_market_key;
  if not found then raise exception 'Mercado % no registrado', p_market_key; end if;
  if v_acc not in ('crear', 'borrar', 'visto') then raise exception 'Acción no válida: % (crear, borrar o visto)', v_acc; end if;
  if v_acc = 'crear' then
    if v_obj is null or v_obj < 1 or v_obj > 2147483647 then raise exception 'Falta el objeto'; end if;
    if v_cond is null or v_cond not in ('menor', 'mayor') then raise exception 'Condición no válida (menor o mayor)'; end if;
    if v_umb is null or v_umb < 1 or v_umb > 100000000000 then raise exception 'El precio debe ser un entero positivo en cobre'; end if;
    if not exists (select 1 from catalogo c where c.game_type = v_m.game_type and c.item_id = v_obj and not v_m.is_demo)
       and not exists (select 1 from items i where i.market_id = v_m.id and i.item_id = v_obj) then
      raise exception 'Objeto % desconocido en este mercado', v_obj;
    end if;
    if (select count(*) from alertas where market_id = v_m.id) >= 200 then raise exception 'Máximo 200 alertas por mercado'; end if;
    -- Estado de partida: el último escaneo. Si ya se cumple, no avisa ahora (se ve en la respuesta).
    select date_trunc('hour', max(source_updated_at), 'UTC') into v_hora from snapshots where market_id = v_m.id;
    v_ahora := _cumple(v_cond, (select min_buyout from price_hourly where market_id = v_m.id and item_id = v_obj and hour = v_hora), v_umb);
    insert into alertas (market_id, item_id, condicion, umbral, cumplida, revisada)
    values (v_m.id, v_obj::integer, v_cond, v_umb, v_ahora, now()) returning id into v_id;
    return leer_alertas(p_market_key, v_obj::integer) || jsonb_build_object('id', v_id, 'cumple_ahora', v_ahora);
  elsif v_acc = 'borrar' then
    delete from alertas where id = v_id and market_id = v_m.id;
    if not found then raise exception 'Alerta desconocida: %', v_id; end if;
  else
    if p->>'ids' = 'todos' then
      update avisos v set visto = true from alertas a where a.id = v.alerta_id and a.market_id = v_m.id and not v.visto;
    elsif jsonb_typeof(p->'ids') = 'array' then
      update avisos v set visto = true from alertas a
       where a.id = v.alerta_id and a.market_id = v_m.id
         and v.id in (select (x #>> '{}')::bigint from jsonb_array_elements(p->'ids') x where (x #>> '{}') ~ '^\d{1,18}$');
    else
      raise exception 'ids debe ser una lista o «todos»';
    end if;
  end if;
  return leer_alertas(p_market_key, null);
end $$;

-- ---------- Tabla del Mercado: filtro «lista» ----------
create or replace function mercado_pagina(p_market_key text, p jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable as $$
declare
  v_m        markets%rowtype;
  v_orden    text := coalesce(nullif(p->>'orden', ''), 'nombre');
  v_dir      text;
  v_tam      integer := coalesce(_param_entero(p, 'por_pagina'), 100);
  v_pag      integer := coalesce(_param_entero(p, 'pagina'), 1);
  v_qraw     text := btrim(coalesce(p->>'q', ''));
  v_id       integer := (substring(v_qraw from '^#?(\d{1,9})$'))::integer;
  v_palabras text[];
  v_cat      text := nullif(p->>'categoria', '');
  v_sub      text := nullif(p->>'subcategoria', '');
  v_cal      text := nullif(p->>'calidad', '');
  v_prof     text := nullif(p->>'profesion', '');
  v_rol      text := nullif(p->>'rol', '');
  v_mat      boolean := coalesce((p->>'materiales')::boolean, false);
  v_fam      text := nullif(p->>'familia', '');
  v_nmin     bigint := _param_entero(p, 'nivel_min');
  v_nmax     bigint := _param_entero(p, 'nivel_max');
  v_pmin     bigint := _param_entero(p, 'precio_min');
  v_pmax     bigint := _param_entero(p, 'precio_max');
  v_ofertas  boolean := coalesce((p->>'solo_ofertas')::boolean, false);
  v_op       text := nullif(p->>'oportunidad', '');
  v_com      numeric := ajuste_num('motor.comision_pct', 5);
  v_vreg_t   text := nullif(btrim(coalesce(p->>'ventas_region_min', '')), '');
  v_vreg     numeric;
  v_lista    bigint := _param_entero(p, 'lista');
  v_res      jsonb;
begin
  select * into v_m from markets where key = p_market_key;
  if not found then raise exception 'Mercado % no registrado', p_market_key; end if;
  if v_orden not in ('nombre', 'precio', 'cantidad', 'var24', 'margen', 'margen_pct') then
    raise exception 'Orden no válido: % (nombre, precio, cantidad, var24, margen o margen_pct)', v_orden;
  end if;
  v_dir := coalesce(nullif(p->>'dir', ''), case when v_orden in ('nombre', 'precio') then 'asc' else 'desc' end);
  if v_dir not in ('asc', 'desc') then raise exception 'Dirección no válida: % (asc o desc)', v_dir; end if;
  if v_tam not between 1 and 200 then raise exception 'por_pagina debe estar entre 1 y 200'; end if;
  if v_pag < 1 then raise exception 'pagina debe ser 1 o más'; end if;
  if v_prof is not null and not (v_prof = any (_profesiones_todas())) then
    raise exception 'Profesión desconocida: %', v_prof;
  end if;
  if v_rol is not null and v_rol not in ('material', 'receta', 'producto') then
    raise exception 'Rol no válido: % (material, receta o producto)', v_rol;
  end if;
  if v_rol is not null and v_prof is null then raise exception 'El rol necesita una profesión'; end if;
  if v_fam is not null and not (v_fam = any (_familias())) then raise exception 'Familia desconocida: %', v_fam; end if;
  if v_op is not null and v_op not in ('ganga', 'npc', 'todas') then
    raise exception 'Oportunidad no válida: % (ganga, npc o todas)', v_op;
  end if;
  if v_vreg_t is not null then
    if v_vreg_t !~ '^\d{1,6}(\.\d{1,3})?$' then
      raise exception 'ventas_region_min no válido: % (número de ventas al día, p. ej. 5)', v_vreg_t;
    end if;
    v_vreg := v_vreg_t::numeric;
  end if;
  if v_lista is not null and not exists (select 1 from listas where id = v_lista) then
    raise exception 'Lista desconocida: %', v_lista;
  end if;
  -- Palabras normalizadas (sin tildes ni mayúsculas); % y _ se buscan como texto.
  select coalesce(array_agg(replace(replace(replace(w, '\', '\\'), '%', '\%'), '_', '\_')), '{}')
    into v_palabras
    from unnest(regexp_split_to_array(_normalizar(v_qraw), '\s+')) w
   where w <> '';

  with ult as (
    select date_trunc('hour', max(s.source_updated_at), 'UTC') as hora, max(s.source_updated_at) as escaneo
      from snapshots s where s.market_id = v_m.id
  ),
  base as (
    select c.item_id, c.nombre, c.calidad, c.clase, c.subclase, c.nivel, c.icono_url, c.busqueda, c.venta_npc
      from catalogo c
     where c.game_type = v_m.game_type and not v_m.is_demo
    union all
    -- Un objeto que la fuente publica sin nombre se muestra por su ID (no se inventa un nombre).
    select i.item_id, coalesce(nullif(btrim(i.name), ''), '#' || i.item_id), i.quality, i.category, i.item_subclass,
           i.level, i.icon_url, _normalizar(coalesce(nullif(btrim(i.name), ''), i.item_id::text)), i.vendor_price
      from items i
     where i.market_id = v_m.id
       and (v_m.is_demo or not exists (select 1 from catalogo c where c.game_type = v_m.game_type and c.item_id = i.item_id))
  ),
  rel as (select * from _relaciones_profesion(v_m.game_type)),
  con_precio as (
    select b.*, coalesce(b.clase, 'Sin clasificar') as categoria, _familia(b.clase, b.subclase) as familia,
           exists (select 1 from rel where rel.item_id = b.item_id and rel.rol = 'material') as es_material,
           pm.hour as visto,
           case when p.hour is null then 'sin_datos'
                when pm.hour >= u.hora then 'con_ofertas' else 'sin_ofertas' end as estado,
           case when pm.hour >= u.hora then pm.min_buyout end as precio,
           case when p.hour >= u.hora then p.market_value end as valor_mercado,
           case when p.hour >= u.hora then p.historical end as historico,
           case when pm.hour >= u.hora then p.quantity end as cantidad,
           pm.min_buyout as ultimo_precio,
           -- Referencia de TODA la región (no de este reino): solo para mostrar y para el filtro opcional.
           rg.sold_per_day as ventas_region,
           p24.precio as precio_24h, p24.hour as hora_24h
      from base b
      cross join ult u
      left join region_items rg on rg.game_type = v_m.game_type and rg.region = v_m.region
                               and rg.item_id = b.item_id and not v_m.is_demo
      left join lateral (select x.hour, x.min_buyout, x.market_value, x.quantity, x.historical from price_hourly x
                          where x.market_id = v_m.id and x.item_id = b.item_id
                          order by x.hour desc limit 1) p on true
      -- Último escaneo con compra mínima (puede ser anterior al último en que aparece el objeto).
      left join lateral (select x.hour, x.min_buyout from price_hourly x
                          where x.market_id = v_m.id and x.item_id = b.item_id and x.min_buyout is not null
                          order by x.hour desc limit 1) pm on p.hour is not null
      -- Variación: la MISMA métrica (compra mínima) ~24 h antes.
      left join lateral (select x.hour, x.min_buyout as precio from price_hourly x
                          where x.market_id = v_m.id and x.item_id = b.item_id and x.min_buyout is not null
                            and x.hour <= pm.hour - interval '24 hours' and x.hour >= pm.hour - interval '30 hours'
                          order by x.hour desc limit 1) p24 on pm.hour >= u.hora
  ),
  -- f0: filtros generales (texto, calidad, nivel, precio, disponibilidad).
  f0 as (
    select cp.*,
           case when cp.precio_24h > 0 and cp.precio is not null
                then round((cp.precio - cp.precio_24h) * 100.0 / cp.precio_24h, 1) end as var24,
           o.bajo_npc, o.ganga, o.margen, o.margen_tipo,
           case when cp.precio > 0 then round(o.margen * 100.0 / cp.precio, 1) end as margen_pct
      from con_precio cp
      cross join lateral (
        select m.bajo_npc, m.ganga,
               case when m.bajo_npc and (m.m_mercado is null or m.m_npc >= m.m_mercado) then m.m_npc else m.m_mercado end as margen,
               case when m.bajo_npc and (m.m_mercado is null or m.m_npc >= m.m_mercado) then 'npc'
                    when m.m_mercado is not null then 'mercado' end as margen_tipo
          from (select coalesce(cp.precio < cp.venta_npc, false) as bajo_npc,
                       _es_ganga(cp.precio, cp.valor_mercado, cp.historico, v_com) as ganga,
                       cp.venta_npc - cp.precio as m_npc,
                       _neto_venta(cp.valor_mercado, v_com) - cp.precio as m_mercado) m
      ) o
     where (v_id is null or cp.item_id = v_id or cp.busqueda like '%' || v_id::text || '%')
       and (v_id is not null or cardinality(v_palabras) = 0
            or (select bool_and(cp.busqueda like '%' || w || '%') from unnest(v_palabras) w))
       and (v_cal is null or cp.calidad = v_cal)
       and (v_nmin is null or cp.nivel >= v_nmin)
       and (v_nmax is null or cp.nivel <= v_nmax)
       and (v_pmin is null or cp.precio >= v_pmin)
       and (v_pmax is null or cp.precio <= v_pmax)
       and (not v_ofertas or cp.estado = 'con_ofertas')
       and (v_vreg is null or cp.ventas_region >= v_vreg)
       and (v_lista is null or exists (select 1 from lista_objetos lo where lo.lista_id = v_lista and lo.item_id = cp.item_id))
  ),
  marcas as (
    select f0.*,
           (v_cat is null or f0.categoria = v_cat) and (v_sub is null or f0.subclase = v_sub) as en_cat,
           (v_op is null or (v_op = 'ganga' and f0.ganga) or (v_op = 'npc' and f0.bajo_npc)
              or (v_op = 'todas' and (f0.ganga or f0.bajo_npc))) as en_op,
           (v_prof is null or exists (select 1 from rel where rel.item_id = f0.item_id and rel.profesion = v_prof
                                                     and (v_rol is null or rel.rol = v_rol)))
             and (not v_mat or f0.es_material)
             and (v_fam is null or (f0.es_material and f0.familia = v_fam)) as en_prof
      from f0
  ),
  sin_cat as (select * from marcas where en_prof and en_op),    -- para contar por categoría
  sin_prof as (select * from marcas where en_cat and en_op),    -- para contar por profesión y familia
  sin_op as (select * from marcas where en_cat and en_prof),    -- para contar las oportunidades
  filtrado as (select * from marcas where en_cat and en_prof and en_op),
  pagina as (
    select f.*, count(*) over () as total
      from filtrado f
     order by
       case when v_dir = 'asc' then case v_orden when 'precio' then f.precio::numeric when 'cantidad' then f.cantidad::numeric
                                                  when 'var24' then f.var24
                                                  when 'margen' then f.margen::numeric when 'margen_pct' then f.margen_pct end end asc nulls last,
       case when v_dir = 'desc' then case v_orden when 'precio' then f.precio::numeric when 'cantidad' then f.cantidad::numeric
                                                   when 'var24' then f.var24
                                                   when 'margen' then f.margen::numeric when 'margen_pct' then f.margen_pct end end desc nulls last,
       case when v_orden = 'nombre' and v_dir = 'asc' then f.busqueda end asc,
       case when v_orden = 'nombre' and v_dir = 'desc' then f.busqueda end desc,
       f.busqueda, f.item_id
     limit v_tam offset (v_pag - 1) * v_tam
  ),
  cats as (
    select categoria, count(*) as n,
           (array_agg(icono_url order by item_id) filter (where icono_url is not null))[1] as icono
      from sin_cat group by categoria
  ),
  subs as (
    select categoria, jsonb_agg(jsonb_build_object('subcategoria', subclase, 'n', n) order by subclase) as subcategorias
      from (select categoria, subclase, count(*) as n from sin_cat where subclase is not null group by 1, 2) x
     group by categoria
  )
  select jsonb_build_object(
    'mercado', v_m.key,
    'escaneo', (select escaneo from ult),
    'pagina', v_pag,
    'por_pagina', v_tam,
    'total', coalesce((select max(total) from pagina), (select count(*) from filtrado)),
    'total_catalogo', (select count(*) from base),
    'filas', coalesce((select jsonb_agg(jsonb_build_object(
        'id', pg.item_id, 'nombre', pg.nombre, 'calidad', pg.calidad, 'icono', pg.icono_url,
        'categoria', pg.categoria, 'subcategoria', pg.subclase, 'nivel', pg.nivel,
        'estado', pg.estado, 'precio', pg.precio, 'valor_mercado', pg.valor_mercado,
        'cantidad', pg.cantidad, 'var24', pg.var24,
        'venta_npc', pg.venta_npc, 'historico', pg.historico,
        'ganga', pg.ganga, 'bajo_npc', pg.bajo_npc,
        'margen', pg.margen, 'margen_pct', pg.margen_pct, 'margen_tipo', pg.margen_tipo,
        'ventas_region', pg.ventas_region,
        'precio_24h', pg.precio_24h, 'hora_24h', pg.hora_24h,
        'visto', pg.visto, 'ultimo_precio', case when pg.estado = 'sin_ofertas' then pg.ultimo_precio end,
        -- Minigráfico: compra mínima más baja de cada tramo de 6 h en los últimos 7 días (solo tramos observados).
        'spark', (select coalesce(jsonb_agg(jsonb_build_array((extract(epoch from t.tramo) * 1000)::bigint, t.v) order by t.tramo), '[]'::jsonb)
                    from (select date_bin('6 hours', x.hour, timestamptz '2000-01-01 00:00+00') as tramo,
                                 min(x.min_buyout) as v
                            from price_hourly x
                           where x.market_id = v_m.id and x.item_id = pg.item_id and x.min_buyout is not null
                             and x.hour > (select hora from ult) - interval '7 days'
                           group by 1) t)
      ) order by rn)
      from (select pagina.*, row_number() over () as rn from pagina) pg), '[]'::jsonb),
    'categorias', coalesce((select jsonb_agg(jsonb_build_object(
        'categoria', c.categoria, 'n', c.n, 'icono', c.icono, 'subcategorias', coalesce(s.subcategorias, '[]'::jsonb))
        order by c.categoria = 'Sin clasificar', c.categoria)
      from cats c left join subs s using (categoria)), '[]'::jsonb),
    'calidades', coalesce((select jsonb_agg(distinct calidad) from base where calidad is not null), '[]'::jsonb),
    'materiales_total', (select count(*) from sin_prof where es_material),
    'region', _region_estado(p_market_key),
    -- Oportunidades con los demás filtros aplicados, y las reglas con que se calculan.
    'oportunidades', (select jsonb_build_object('ganga', count(*) filter (where ganga),
                                                'npc', count(*) filter (where bajo_npc),
                                                'todas', count(*) filter (where ganga or bajo_npc)) from sin_op),
    'reglas_oportunidad', jsonb_build_object('comision_pct', v_com, 'historico_min_pct', _ganga_historico_min_pct(),
                                             'tramos', _ganga_tramos()),
    'familias', coalesce((select jsonb_agg(jsonb_build_object('familia', familia, 'n', n) order by array_position(_familias(), familia))
                            from (select familia, count(*) as n from sin_prof where es_material group by familia) x), '[]'::jsonb),
    -- Nombres de las profesiones (como antes de 0021, para páginas aún no actualizadas).
    'profesiones', coalesce((select jsonb_agg(distinct rel.profesion) from rel), '[]'::jsonb),
    -- Profesiones con sus contadores por rol (respetan la categoría y los filtros generales).
    'profesiones_roles', coalesce((select jsonb_agg(jsonb_build_object(
        'profesion', t.profesion, 'n', t.n, 'material', t.material, 'receta', t.receta, 'producto', t.producto,
        'icono', (select ic.icono from _icono_profesion(v_m.game_type) ic where ic.profesion = t.profesion))
        order by t.profesion)
      from (select rel.profesion, count(distinct sp.item_id) as n,
                   count(distinct sp.item_id) filter (where rel.rol = 'material') as material,
                   count(distinct sp.item_id) filter (where rel.rol = 'receta') as receta,
                   count(distinct sp.item_id) filter (where rel.rol = 'producto') as producto
              from rel join sin_prof sp on sp.item_id = rel.item_id
             group by rel.profesion) t), '[]'::jsonb)
  ) into v_res;
  return v_res;
end $$;


revoke execute on all functions in schema public from public, anon, authenticated;
