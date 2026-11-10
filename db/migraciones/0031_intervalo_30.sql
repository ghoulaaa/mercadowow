-- =====================================================================
-- 0031 — Consulta a los proveedores cada 30 minutos (antes, 60).
--
-- pg_cron ya mira cada 5 minutos si toca consultar; lo que decide la espera tras una consulta
-- correcta es el ajuste intervalo_minutos. Con ETag / If-None-Match, una consulta sin cambios
-- devuelve 304 y no guarda nada, así que preguntar más a menudo es barato para la fuente.
-- Los precios se siguen guardando por hora (price_hourly): un escaneo nuevo dentro de la misma
-- hora actualiza la fila de esa hora, no crea otra.
-- Los reintentos tras un fallo (5, 10, 20… min) quedan topados por este mismo intervalo.
-- =====================================================================

update settings set value = '30' where key = 'intervalo_minutos';

-- Que el cambio valga ya: las próximas consultas ya programadas a +60 min se adelantan a +30.
update fetch_state
   set next_attempt_at = last_success_at + interval '30 minutes'
 where last_success_at is not null
   and next_attempt_at > last_success_at + interval '30 minutes';
