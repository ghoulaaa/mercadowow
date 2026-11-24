# MercadoWoW Crafting Sniper · avisos a Discord

El Crafting Sniper analiza todas las recetas con los precios del último escaneo y avisa por Discord de las
oportunidades de fabricación que cumplen tu configuración. Funciona en el servidor (Supabase): no hace falta
tener la página abierta. **Solo analiza y avisa**: no compra, no vende ni hace nada dentro del juego.

## Cómo funciona

1. **Cada 5 minutos**, `pg_cron` ejecuta `disparar_sniper()`. Solo llama a la Edge Function si el sniper está
   activo, hay algún webhook activo, nadie más está analizando, y llegó un escaneo nuevo o pasó el intervalo
   configurado.
2. La Edge Function (tarea `sniper`) calcula **con el mismo motor que la página** (`app/static`, copiado con
   `npm run motor`): coste con el material más barato entre subasta, NPC o fabricarlo; venta; comisión;
   ganancia neta; ROI; margen y precio de equilibrio.
3. Para cada receta con ganancia añade:
   - **Clasificación por ROI**: rentable, ganga, épica, legendaria y excepcional, con umbrales configurables.
   - **MercadoWoW Score (0–100)**. Rentabilidad conservadora 30 · demanda 25 · estabilidad 15 · materiales 15 ·
     competencia 10 · actualidad 5. Lo que no se sabe puntúa 0 y se indica.
   - **Protección contra falsas gangas**:
     - Precio actual frente a su mediana de 24 h, 7 y 30 días: más del doble de la de 7 o 30 días bloquea el aviso.
     - Escaneo demasiado viejo.
     - Producto sin ventas registradas.
     - Materiales publicados insuficientes.
     - Precio sospechoso frente a su histórico o a lo que paga el NPC.
   - **Escenario conservador**: venta al menor entre el precio actual y sus medianas, y un 5 % más barato. Si en
     ese escenario no gana, no se avisa.
4. Envía como mucho N avisos por análisis y **no repite** una oportunidad salvo que:
   - sea nueva;
   - vuelva tras desaparecer;
   - suba de clase;
   - la ganancia suba un X %;
   - el coste baje un Y %;
   - o haya pasado el intervalo de repetición.
5. Respeta los límites de Discord: espera lo que pida un `429` y reintenta una vez, y deja ~0,7 s entre envíos.

Datos que no existen no se inventan: las ventas son las que publica la fuente (AHledger del reino o TSM de
toda la región, marcadas como «región»). La fuente solo publica el precio mínimo por unidad, no la profundidad
del mercado, así que los costes de muchas unidades son estimaciones y así se indica.

## Instalación (una vez)

1. **Migraciones**: `0045_sniper.sql` (tablas y funciones) y `0046_sniper_cron.sql` (tarea programada).
   Se aplican con `configurar.bat` o con:
   ```
   .\.venv\Scripts\python.exe -c "from app import config, db; s=config.load_settings(); c=db.connect(s.database_url); print(db.apply_migrations(c))"
   ```
2. **Edge Function** con la tarea nueva (lleva el motor copiado en `motor/`):
   ```
   npm run motor
   npx supabase functions deploy actualizar-mercado --remote=<proyecto> --no-verify-jwt --use-api --yes
   ```
3. **Vercel**: `npm run vercel` y subir los cambios (la ruta `/api/sniper` va en `api/index.js`).

## Configurar Discord

1. En Discord: *Ajustes del servidor → Integraciones → Webhooks → Nuevo webhook*. Elige el canal y pulsa
   *Copiar URL del webhook*.
2. En MercadoWoW: *Fabricación → Sniper → Alertas Discord*. Pega la URL en «Añadir webhook».
   - La URL se valida: solo se aceptan direcciones `https://discord.com/api/webhooks/…`.
   - Se guarda **cifrada en Supabase Vault**.
   - Nunca se vuelve a mostrar: la página solo ve una pista (`discord.com/api/webhooks/1234…5678/••••`).
3. Pulsa **Probar**. Llega un mensaje de prueba sin cifras.
4. Ajusta lo que quieras avisar y activa **Avisos automáticos**. Puedes configurar:
   - ROI mínimo, beneficio mínimo, Score mínimo y riesgo máximo;
   - profesiones, y objetos incluidos o excluidos (por ID);
   - frecuencia, espera entre repeticiones y mejora necesaria para repetir;
   - comisión, escenario conservador y umbrales de cada clase;
   - mención de un rol (por su ID, nunca `@everyone`) desde la clase elegida.
5. Puedes tener varios webhooks y elegir las profesiones de cada uno (por ejemplo, uno para Alquimia).

## Seguridad

- La URL del webhook solo se lee en la Edge Function (servidor) y nunca aparece en la página, en las
  respuestas de la API, en los registros ni en los mensajes de error.
- Todas las acciones exigen haber iniciado sesión en MercadoWoW. Las pruebas, envíos manuales y «Analizar
  ahora» están limitadas a una petición cada 10 segundos.
- Todo se valida en SQL: URL de Discord, rangos numéricos, umbrales ordenados, mercado existente y listas de IDs.
- Las tablas del sniper no son accesibles con las claves públicas de Supabase (RLS activado y permisos revocados).

## Pruebas

- `npm test`. Comprueba:
  - el motor (`netlify/pruebas/sniper_motor.test.ts`);
  - la tarea con Postgres simulado y un Discord falso (`supabase/pruebas/sniper.test.ts`): envío, no repetir,
    falsas gangas, 429, prueba, envío manual y turno;
  - que la copia del motor coincide con la de la página.
