-- =====================================================================
-- 0013 — Textos de las explicaciones independientes de la fuente.
-- Las reglas escriben «valor histórico de TSM» porque al principio solo existía TSM;
-- con AHledger esa referencia es su mediana de 30 días. Se corrige al leer (como el
-- singular de «1 observación» en 0007), sin tocar los cálculos.
-- =====================================================================

create or replace function _singular(p text) returns text language sql immutable as $$
  select replace(
           regexp_replace(p, '(^|[^0-9,])1 observaciones', '\11 observación', 'g'),
           'respecto al valor histórico de TSM', 'respecto al valor de referencia histórico de la fuente')
$$;
