-- 0038 · Rendimiento: la tabla del Mercado y los mapas tardaban ~7 s en la web publicada.
--
-- Son funciones plpgsql con muchos filtros opcionales («v_cat is null or …»). PostgreSQL guarda el
-- plan de su consulta y, con la conexión abierta (como en Vercel), acaba usando un plan genérico que
-- no sabe qué filtros vienen vacíos: ~7 s por llamada. Con un plan hecho para cada llamada, 0,7–2 s.
-- Medido el 2026-11-10 en Supabase: mercado_pagina 7,1 s → 2,1 s (sin filtros), 7,8 s → 0,7 s (oportunidades).
alter function mercado_pagina(text, jsonb) set plan_cache_mode = force_custom_plan;
alter function mapa_materiales(text, jsonb) set plan_cache_mode = force_custom_plan;
alter function mapa_casa(text, jsonb) set plan_cache_mode = force_custom_plan;
